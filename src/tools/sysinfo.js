/**
 * PHANTØM System Inspector
 * Real machine specs via actual OS commands — no guessing.
 */
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

const run = promisify(exec);

async function safe(cmd, fallback = "") {
  try { const { stdout } = await run(cmd, { timeout: 8000 }); return stdout.trim(); }
  catch { return fallback; }
}

export async function getSystemInfo() {
  const platform = os.platform();
  const isWin = platform === "win32";
  const isMac = platform === "darwin";

  // ── Basic OS ──
  const hostname   = os.hostname();
  const username   = os.userInfo().username;
  const arch       = os.arch();
  const cpuModel   = os.cpus()[0]?.model || "Unknown";
  const cpuCores   = os.cpus().length;
  const totalRamGB = (os.totalmem() / 1073741824).toFixed(1);
  const freeRamGB  = (os.freemem()  / 1073741824).toFixed(1);
  const uptime     = formatUptime(os.uptime());
  const nodeVer    = process.version;

  let osVersion = "", gpuInfo = "", diskInfo = "", publicIp = "";

  if (isWin) {
    osVersion = await safe("wmic os get Caption,Version /value");
    gpuInfo   = await safe("wmic path win32_VideoController get Name /value");
    diskInfo  = await safe("wmic logicaldisk get Size,FreeSpace,Caption /format:list");
    publicIp  = await safe("powershell -Command \"(Invoke-WebRequest -Uri 'https://api.ipify.org' -UseBasicParsing).Content\"");
  } else if (isMac) {
    osVersion = await safe("sw_vers");
    gpuInfo   = await safe("system_profiler SPDisplaysDataType | grep 'Chipset Model'");
    diskInfo  = await safe("df -h /");
    publicIp  = await safe("curl -s https://api.ipify.org");
  } else {
    osVersion = await safe("cat /etc/os-release | head -5");
    gpuInfo   = await safe("lspci 2>/dev/null | grep -i 'vga\\|3d'");
    diskInfo  = await safe("df -h /");
    publicIp  = await safe("curl -s https://api.ipify.org");
  }

  // ── Network interfaces ──
  const nets = os.networkInterfaces();
  const localIps = Object.entries(nets)
    .flatMap(([iface, addrs]) => (addrs || [])
      .filter(a => !a.internal && a.family === "IPv4")
      .map(a => `${iface}: ${a.address}`)
    );

  // ── Installed runtimes ──
  const [nodeVersion, npmVersion, pythonVersion, gitVersion] = await Promise.all([
    safe("node --version"),
    safe("npm --version"),
    safe(isWin ? "python --version" : "python3 --version"),
    safe("git --version"),
  ]);

  return {
    hostname,
    username,
    platform: `${platform} (${arch})`,
    osVersion: osVersion.slice(0, 300),
    cpuModel,
    cpuCores,
    ram: { total: totalRamGB + " GB", free: freeRamGB + " GB" },
    gpu: gpuInfo.slice(0, 200) || "Not detected",
    disk: diskInfo.slice(0, 400),
    uptime,
    localIps,
    publicIp: publicIp || "Unavailable",
    runtimes: { node: nodeVersion, npm: npmVersion, python: pythonVersion, git: gitVersion },
    nodeVer,
  };
}

export async function getRunningProcesses() {
  const isWin = os.platform() === "win32";
  const raw = isWin
    ? await safe("tasklist /fo csv /nh")
    : await safe("ps aux --sort=-%cpu | head -20");
  return raw;
}

export async function killProcess(name) {
  const isWin = os.platform() === "win32";
  if (isWin) {
    return await safe(`taskkill /IM "${name}" /F`);
  } else {
    return await safe(`pkill -f "${name}" && echo "Killed" || echo "Not found"`);
  }
}

export async function getOpenPorts() {
  const isWin = os.platform() === "win32";
  if (isWin) return await safe("netstat -ano | findstr LISTENING");
  return await safe("ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null");
}

export async function scanPort(port) {
  const { exec } = await import("child_process");
  const p = promisify(exec);
  const isWin = os.platform() === "win32";
  const cmd = isWin
    ? `netstat -ano | findstr :${port}`
    : `ss -tlnp | grep :${port} || echo "Port ${port} is free"`;
  return await safe(cmd);
}

function formatUptime(secs) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
