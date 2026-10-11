/**
 * PHANTØM anomaly.js — Network Device Scanner & Anomaly Monitor
 * 
 * Scans, detects, and monitors nearby/connected devices relative
 * to the host machine using real OS-level commands.
 * 
 * Capabilities:
 * - ARP table scan (devices on local network)
 * - Ping sweep (discover live hosts in subnet)
 * - Port scan per device
 * - Change detection (new/missing devices since last scan)
 * - Risk scoring per device
 * - Continuous monitoring mode
 */

import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import fs from "fs/promises";
import path from "path";

const run  = promisify(exec);
const ROOT = path.resolve(process.cwd());
const SNAPSHOT_FILE = path.join(ROOT, ".phantom_network_snapshot.json");

async function safe(cmd, timeout = 15000) {
  try {
    const { stdout, stderr } = await run(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 });
    return (stdout + stderr).trim();
  } catch (e) {
    return e.stdout || e.stderr || e.message || "";
  }
}

// ── Get local subnet from network interfaces ──────────────────
function getLocalSubnets() {
  const nets = os.networkInterfaces();
  const subnets = [];
  for (const [iface, addrs] of Object.entries(nets)) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        // e.g. 192.168.1.105 → 192.168.1
        const base = addr.address.split(".").slice(0, 3).join(".");
        subnets.push({ iface, ip: addr.address, base, cidr: addr.cidr });
      }
    }
  }
  return subnets;
}

// ── ARP table — devices the OS already knows about ───────────
async function getArpTable() {
  const isWin = process.platform === "win32";
  const raw   = isWin ? await safe("arp -a") : await safe("arp -a 2>/dev/null || ip neigh 2>/dev/null");
  const devices = [];
  const lines   = raw.split("\n");

  for (const line of lines) {
    // Windows: 192.168.1.1   00-11-22-33-44-55   dynamic
    // Linux:   192.168.1.1 (192.168.1.1) at aa:bb:cc:dd:ee:ff [ether] on eth0
    // macOS:   192.168.1.1 (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope
    const ipMatch  = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    const macMatch = line.match(/([0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2})/);

    if (ipMatch && macMatch) {
      const ip  = ipMatch[1];
      const mac = macMatch[1].toUpperCase().replace(/-/g, ":");
      if (!ip.endsWith(".255") && ip !== "224.0.0.1") {
        devices.push({ ip, mac, vendor: lookupVendor(mac), source: "arp" });
      }
    }
  }
  return devices;
}

// ── Ping sweep — active host discovery ───────────────────────
async function pingSweep(subnet, timeout = 800) {
  const isWin = process.platform === "win32";
  const alive = [];

  // Ping 1-254 in parallel batches of 32
  const BATCH = 32;
  for (let start = 1; start <= 254; start += BATCH) {
    const batch = [];
    for (let i = start; i < start + BATCH && i <= 254; i++) {
      const ip  = `${subnet}.${i}`;
      const cmd = isWin
        ? `ping -n 1 -w ${timeout} ${ip}`
        : `ping -c 1 -W 1 ${ip}`;
      batch.push(
        safe(cmd, timeout + 500)
          .then(out => {
            const alive = isWin
              ? out.includes("TTL=") || out.includes("ttl=")
              : out.includes("1 received") || out.includes("1 packets received") || out.includes("bytes from");
            return alive ? ip : null;
          })
          .catch(() => null)
      );
    }
    const results = await Promise.all(batch);
    results.filter(Boolean).forEach(ip => alive.push({ ip, source: "ping" }));
  }

  return alive;
}

// ── Fast port scan per device ─────────────────────────────────
async function scanDevicePorts(ip, ports = [22, 23, 80, 443, 3389, 8080, 8443, 445, 139, 21, 25, 53]) {
  const isWin   = process.platform === "win32";
  const open    = [];

  // Try nmap first (fastest, most reliable)
  const nmapOut = await safe(`nmap -p ${ports.join(",")} --open -T4 ${ip} 2>/dev/null`, 10000);
  if (nmapOut && nmapOut.includes("open")) {
    const portLines = nmapOut.split("\n").filter(l => /\d+\/tcp/.test(l) && l.includes("open"));
    portLines.forEach(l => {
      const m = l.match(/(\d+)\/tcp\s+open\s+(\S*)/);
      if (m) open.push({ port: parseInt(m[1]), service: m[2] || "unknown" });
    });
    return open;
  }

  // Fallback: nc (netcat) checks
  await Promise.all(ports.map(async port => {
    const cmd = isWin
      ? `powershell -Command "Test-NetConnection -ComputerName ${ip} -Port ${port} -WarningAction SilentlyContinue | Select-Object -ExpandProperty TcpTestSucceeded"`
      : `nc -z -w 1 ${ip} ${port} 2>/dev/null && echo open`;
    const out = await safe(cmd, 2000);
    if (out.toLowerCase().includes("open") || out.trim() === "True") {
      open.push({ port, service: knownPort(port) });
    }
  }));

  return open;
}

// ── Hostname resolution ───────────────────────────────────────
async function resolveHostname(ip) {
  const isWin = process.platform === "win32";
  const cmd   = isWin ? `nslookup ${ip}` : `host ${ip} 2>/dev/null || nslookup ${ip} 2>/dev/null`;
  const out   = await safe(cmd, 3000);
  const match = out.match(/(?:name\s*=\s*|pointer\s+|Name:\s*)([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/i);
  return match ? match[1] : null;
}

// ── Risk scoring ─────────────────────────────────────────────
function riskScore(device) {
  let score  = 0;
  let flags  = [];
  const ports = device.openPorts || [];

  // Dangerous ports
  if (ports.some(p => p.port === 23))   { score += 30; flags.push("TELNET open (insecure)"); }
  if (ports.some(p => p.port === 21))   { score += 20; flags.push("FTP open"); }
  if (ports.some(p => p.port === 3389)) { score += 20; flags.push("RDP open"); }
  if (ports.some(p => p.port === 445))  { score += 25; flags.push("SMB open"); }
  if (ports.some(p => p.port === 139))  { score += 15; flags.push("NetBIOS open"); }
  if (ports.some(p => p.port === 22))   { score += 5;  flags.push("SSH open"); }
  if (ports.some(p => p.port === 25))   { score += 15; flags.push("SMTP open"); }

  // Unknown vendor = potentially rogue
  if (!device.vendor || device.vendor === "Unknown") { score += 10; flags.push("Unknown vendor"); }

  // No hostname = suspicious
  if (!device.hostname) { score += 5; flags.push("No hostname"); }

  const level = score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : score >= 10 ? "LOW" : "NONE";
  return { score, level, flags };
}

// ── Vendor lookup (OUI prefix) ────────────────────────────────
function lookupVendor(mac) {
  const prefix = mac.replace(/:/g,"").toUpperCase().slice(0,6);
  const OUI = {
    "001A2B":"Cisco", "0050F2":"Microsoft", "001D0F":"Dell",
    "B827EB":"Raspberry Pi", "DC:A6:32":"Raspberry Pi",
    "F4F5D8":"Google", "3C5AB4":"Google",
    "001E52":"Apple", "3C0754":"Apple", "F0189B":"Apple",
    "001CB3":"Apple", "8C85C1":"Apple", "A4C361":"Apple",
    "00165A":"Samsung", "8CC8D0":"Samsung",
    "001D7E":"Linksys", "0018F8":"Linksys",
    "C83A35":"Netgear", "10DA43":"Netgear",
    "000C29":"VMware", "005056":"VMware",
    "080027":"VirtualBox", "0A0027":"VirtualBox",
    "001517":"Hewlett-Packard", "3C4A92":"HP",
    "001B63":"Intel", "8086A5":"Intel",
  };
  // Try exact 6-char prefix
  if (OUI[prefix]) return OUI[prefix];
  // Try 8-char
  const p8 = mac.replace(/:/g,"").toUpperCase().slice(0,8);
  for (const [k,v] of Object.entries(OUI)) if (p8.startsWith(k)) return v;
  return "Unknown";
}

function knownPort(port) {
  const PORTS = { 22:"SSH", 23:"Telnet", 25:"SMTP", 53:"DNS", 80:"HTTP", 139:"NetBIOS",
    443:"HTTPS", 445:"SMB", 3389:"RDP", 8080:"HTTP-Alt", 8443:"HTTPS-Alt", 21:"FTP" };
  return PORTS[port] || "unknown";
}

// ── Snapshot: save/load last known state ──────────────────────
async function saveSnapshot(devices) {
  try {
    await fs.writeFile(SNAPSHOT_FILE, JSON.stringify({ ts: Date.now(), devices }, null, 2), "utf8");
  } catch {}
}

async function loadSnapshot() {
  try {
    const raw = await fs.readFile(SNAPSHOT_FILE, "utf8");
    return JSON.parse(raw);
  } catch { return null; }
}

// ── Change detection ──────────────────────────────────────────
function detectChanges(prev, current) {
  const prevMap = Object.fromEntries((prev||[]).map(d => [d.ip, d]));
  const currMap = Object.fromEntries(current.map(d => [d.ip, d]));

  const newDevices     = current.filter(d => !prevMap[d.ip]);
  const missingDevices = (prev||[]).filter(d => !currMap[d.ip]);
  const changedDevices = current.filter(d => {
    const p = prevMap[d.ip];
    if (!p) return false;
    const prevPorts = (p.openPorts||[]).map(x=>x.port).sort().join(",");
    const currPorts = (d.openPorts||[]).map(x=>x.port).sort().join(",");
    return prevPorts !== currPorts || p.mac !== d.mac;
  });

  return { newDevices, missingDevices, changedDevices };
}

// ── MAIN EXPORT: Full scan ────────────────────────────────────
export async function scanNetwork({ deep = false, subnet = null } = {}) {
  const hostInfo = {
    hostname: os.hostname(),
    platform: process.platform,
    ips:      [],
    subnets:  [],
  };

  const nets    = getLocalSubnets();
  hostInfo.ips  = nets.map(n => n.ip);
  hostInfo.subnets = nets.map(n => n.base);

  const targetSubnets = subnet ? [subnet] : nets.map(n => n.base);
  if (!targetSubnets.length) {
    return { error: "No active network interfaces found.", hostInfo };
  }

  // 1. Get ARP table (fast — already known to OS)
  const arpDevices = await getArpTable();

  // 2. Ping sweep to discover more hosts
  let allDevices = [...arpDevices];
  for (const sub of targetSubnets) {
    const pinged = await pingSweep(sub);
    for (const p of pinged) {
      if (!allDevices.find(d => d.ip === p.ip)) {
        allDevices.push({ ip: p.ip, mac: "Unknown", vendor: "Unknown", source: "ping" });
      }
    }
  }

  // Remove host's own IPs
  allDevices = allDevices.filter(d => !hostInfo.ips.includes(d.ip));

  // 3. For each device: resolve hostname + scan ports (if deep)
  for (const device of allDevices) {
    device.hostname = await resolveHostname(device.ip);
    if (deep) {
      device.openPorts = await scanDevicePorts(device.ip);
    } else {
      device.openPorts = [];
    }
    const risk = riskScore(device);
    device.risk     = risk.level;
    device.riskScore= risk.score;
    device.riskFlags= risk.flags;
    device.scannedAt= new Date().toISOString();
  }

  // 4. Load previous snapshot and detect changes
  const snapshot = await loadSnapshot();
  const changes  = detectChanges(snapshot?.devices, allDevices);

  // 5. Summary
  const highRisk   = allDevices.filter(d => d.risk === "HIGH");
  const medRisk    = allDevices.filter(d => d.risk === "MEDIUM");
  const summary = {
    totalDevices:   allDevices.length,
    newSinceLastScan:     changes.newDevices.length,
    missingDevices:       changes.missingDevices.length,
    changedDevices:       changes.changedDevices.length,
    highRiskDevices:      highRisk.length,
    mediumRiskDevices:    medRisk.length,
    lastSnapshot:         snapshot ? new Date(snapshot.ts).toISOString() : "None",
    subnetsScanned:       targetSubnets,
  };

  // 6. Save snapshot
  await saveSnapshot(allDevices);

  return {
    hostInfo,
    summary,
    devices: allDevices,
    changes,
    alerts: [
      ...changes.newDevices.map(d => ({ type:"NEW_DEVICE",    severity:"WARN",  device:d, message:`New device appeared: ${d.ip} (${d.vendor})` })),
      ...changes.missingDevices.map(d => ({ type:"DEVICE_GONE", severity:"INFO",  device:d, message:`Device disappeared: ${d.ip}` })),
      ...highRisk.map(d =>            ({ type:"HIGH_RISK",    severity:"HIGH",  device:d, message:`High risk device: ${d.ip} — ${d.riskFlags.join(", ")}` })),
    ],
  };
}

// ── Targeted device deep-scan ─────────────────────────────────
export async function scanDevice(ip) {
  const hostname  = await resolveHostname(ip);
  const openPorts = await scanDevicePorts(ip, [
    21,22,23,25,53,80,110,143,443,445,
    3306,3389,5432,6379,8080,8443,8888,27017
  ]);
  const mac     = await getMacForIp(ip);
  const vendor  = lookupVendor(mac || "");
  const device  = { ip, mac, vendor, hostname, openPorts };
  const risk    = riskScore(device);
  return { ...device, risk: risk.level, riskScore: risk.score, riskFlags: risk.flags, scannedAt: new Date().toISOString() };
}

async function getMacForIp(ip) {
  const isWin = process.platform === "win32";
  await safe(isWin ? `ping -n 1 -w 500 ${ip}` : `ping -c 1 -W 1 ${ip}`);
  const arp  = isWin ? await safe(`arp -a ${ip}`) : await safe(`arp -n ${ip} 2>/dev/null`);
  const m    = arp.match(/([0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2})/);
  return m ? m[1].toUpperCase().replace(/-/g,":") : "Unknown";
}

// ── Monitor: diff from last snapshot only ────────────────────
export async function getNetworkChanges() {
  const snapshot = await loadSnapshot();
  if (!snapshot) return { error: "No previous snapshot. Run scanNetwork first." };

  const current = await getArpTable();
  const changes = detectChanges(snapshot.devices, current);
  const age     = Math.round((Date.now() - snapshot.ts) / 1000);

  return {
    snapshotAge: `${age}s ago`,
    ...changes,
    alerts: [
      ...changes.newDevices.map(d => ({ severity:"WARN", message:`New: ${d.ip} (${d.mac})` })),
      ...changes.missingDevices.map(d => ({ severity:"INFO", message:`Gone: ${d.ip}` })),
    ],
  };
}
