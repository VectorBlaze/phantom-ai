/**
 * PHANTØM Deep Inspector
 * - Recursive directory tree with sizes
 * - File type detection
 * - Git status / log
 * - Find files by pattern
 * - Grep across project
 * - Diff two files
 */
import fs   from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const run = promisify(exec);
const ROOT = path.resolve(process.cwd());

function safe(p) {
  const r = path.resolve(ROOT, p);
  if (r !== ROOT && !r.startsWith(ROOT + path.sep)) throw new Error("Path outside project.");
  return r;
}

async function safeRun(cmd, opts = {}) {
  try { const {stdout,stderr} = await run(cmd, {timeout:15000,...opts}); return (stdout+stderr).trim(); }
  catch(e) { return e.message.slice(0,300); }
}

// Deep tree — skip node_modules, .git, dist, build by default
export async function directoryTree(targetPath = ".", depth = 4, ignore = ["node_modules",".git","dist","build",".next","__pycache__",".venv"]) {
  const absPath = safe(targetPath);
  const lines   = [];

  async function walk(dir, prefix, level) {
    if (level > depth) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }

    const filtered = entries.filter(e => !ignore.includes(e.name)).sort((a,b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < filtered.length; i++) {
      const e       = filtered[i];
      const isLast  = i === filtered.length - 1;
      const branch  = isLast ? "└── " : "├── ";
      const childPfx= isLast ? "    " : "│   ";
      const fullPath= path.join(dir, e.name);

      let size = "";
      if (!e.isDirectory()) {
        try { const s = await fs.stat(fullPath); size = " (" + fmtSize(s.size) + ")"; }
        catch {}
      }

      lines.push(prefix + branch + e.name + (e.isDirectory() ? "/" : size));

      if (e.isDirectory()) {
        await walk(fullPath, prefix + childPfx, level + 1);
      }
    }
  }

  lines.push(path.relative(ROOT, absPath) || ".");
  await walk(absPath, "", 1);
  return lines.join("\n");
}

// Find files matching glob-like pattern
export async function findFiles(pattern, startPath = ".") {
  const start = safe(startPath);
  const isWin = process.platform === "win32";
  const results = [];

  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules",".git"].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.name.toLowerCase().includes(pattern.toLowerCase())) {
        const rel  = path.relative(ROOT, full);
        const stat = await fs.stat(full).catch(()=>null);
        results.push({ path: rel, type: e.isDirectory()?"dir":"file", size: stat ? fmtSize(stat.size) : "" });
      }
      if (e.isDirectory()) await walk(full);
    }
  }

  await walk(start);
  return results;
}

// Grep — search content
export async function grepProject(pattern, fileGlob = "*.{js,ts,py,json,md,html,css}", startPath = ".") {
  const cmd = process.platform === "win32"
    ? `findstr /S /I /N "${pattern}" "${path.join(safe(startPath),"**","*")}"`
    : `grep -r --include="${fileGlob.replace(/[{}]/g,"\\$&")}" -n -i "${pattern}" "${safe(startPath)}" --max-count=5 -l 2>/dev/null | head -20`;
  return await safeRun(cmd);
}

// Git operations
export async function gitStatus() { return await safeRun("git status --short && git log --oneline -10", { cwd: ROOT }); }
export async function gitDiff(file)  { return await safeRun(`git diff -- "${file}"`, { cwd: ROOT }); }
export async function gitLog(n = 10) { return await safeRun(`git log --oneline -${n} --graph --decorate`, { cwd: ROOT }); }

// File diff
export async function diffFiles(pathA, pathB) {
  const a = await fs.readFile(safe(pathA), "utf8").catch(()=>"<not found>");
  const b = await fs.readFile(safe(pathB), "utf8").catch(()=>"<not found>");

  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const out = [];
  const max = Math.max(linesA.length, linesB.length);

  for (let i = 0; i < max; i++) {
    const la = linesA[i] ?? "";
    const lb = linesB[i] ?? "";
    if (la !== lb) {
      out.push(`L${i+1} - ${la}`);
      out.push(`L${i+1} + ${lb}`);
    }
  }

  return out.length ? out.join("\n") : "Files are identical.";
}

// Get file metadata
export async function fileInfo(targetPath) {
  const abs = safe(targetPath);
  const stat = await fs.stat(abs);
  const ext  = path.extname(abs).toLowerCase();
  let preview = "";
  if (!stat.isDirectory() && stat.size < 50000) {
    try { preview = (await fs.readFile(abs,"utf8")).slice(0,500); } catch {}
  }
  return {
    path:      path.relative(ROOT, abs),
    type:      stat.isDirectory() ? "directory" : "file",
    size:      fmtSize(stat.size),
    modified:  stat.mtime.toISOString(),
    created:   stat.birthtime.toISOString(),
    extension: ext || "none",
    preview,
  };
}

function fmtSize(b) {
  if (b < 1024) return b+"B";
  if (b < 1048576) return (b/1024).toFixed(1)+"KB";
  return (b/1048576).toFixed(1)+"MB";
}
