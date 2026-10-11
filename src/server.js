import "dotenv/config";
import express from "express";
import cors    from "cors";
import path    from "path";
import { fileURLToPath } from "url";
import { askModel } from "./agent.js";
import { resolveSkills } from "./index.js";
import fs from "fs/promises";
import os from "os";
import { getSystemInfo } from "./tools/sysinfo.js";
import { directoryTree } from "./tools/inspect.js";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT       = Number(process.env.PORT) || 7997;

const app = express();
app.use(cors());
app.use(express.json({ limit: "120mb" }));
app.use(express.static(PUBLIC_DIR));

// ── Health ────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status:"ok", version:"4.0" }));

// ── System info endpoint (used by UI sysinfo panel) ───────────
app.get("/api/sysinfo", async (_req, res) => {
  try { res.json(await getSystemInfo()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Models list ───────────────────────────────────────────────
app.get("/api/models", (_req, res) => {
  res.json({
    providers: {
      openrouter: {
        label: "OpenRouter",
        envKey: "OPENROUTER_API_KEY",
        available: !!process.env.OPENROUTER_API_KEY,
        models: [
          { id:"dots-studio/dots-3-note-preview:free", label:"Phantom-Fin (free)",   default:true },
          { id:"anthropic/claude-3.5-sonnet",          label:"Claude 3.5 Sonnet" },
          { id:"openai/gpt-4o",                        label:"GPT-4o" },
          { id:"meta-llama/llama-3.1-70b-instruct:free", label:"Llama 3.1 70B (free)" },
        ],
      },
      grok: {
        label: "Grok (xAI)",
        envKey: "XAI_API_KEY",
        available: !!process.env.XAI_API_KEY,
        models: [
          { id:"grok-3",      label:"Grok 3" },
          { id:"grok-3-mini", label:"Grok 3 Mini" },
          { id:"grok-2-1212", label:"Grok 2" },
        ],
      },
      openai: {
        label: "OpenAI",
        envKey: "OPENAI_API_KEY",
        available: !!process.env.OPENAI_API_KEY,
        models: [
          { id:"gpt-4o",      label:"GPT-4o" },
          { id:"gpt-4o-mini", label:"GPT-4o Mini" },
        ],
      },
      gemini: {
        label: "Google Gemini",
        envKey: "GEMINI_API_KEY",
        available: !!process.env.GEMINI_API_KEY,
        models: [
          { id:"gemini-2.0-flash", label:"Gemini 2.0 Flash" },
          { id:"gemini-1.5-pro",   label:"Gemini 1.5 Pro" },
        ],
      },
      groq: {
        label: "Groq (Ultra-fast)",
        envKey: "GROQ_API_KEY",
        available: !!process.env.GROQ_API_KEY,
        models: [
          { id:"llama-3.3-70b-versatile", label:"Llama 3.3 70B" },
          { id:"llama-3.1-8b-instant",    label:"Llama 3.1 8B (instant)" },
          { id:"mixtral-8x7b-32768",      label:"Mixtral 8x7B" },
          { id:"gemma2-9b-it",            label:"Gemma 2 9B" },
          { id:"compound-beta",           label:"Compound Beta" },
        ],
      },
    },
  });
});

// ── Skills list ───────────────────────────────────────────────
app.get("/api/skills", async (_req, res) => {
  try {
    const dir   = path.join(process.cwd(), "skills");
    let names   = [];
    try {
      const files = await fs.readdir(dir);
      names = files.filter(f => f.endsWith(".md")).map(f => ({
        id:   f.replace(".md",""),
        name: f.replace(".md","").replace(/-/g," ").replace(/\b\w/g, c => c.toUpperCase()),
      }));
    } catch {}
    res.json({ skills: names });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Project tree (used by file panel) ────────────────────────
app.get("/api/tree", async (req, res) => {
  try {
    const depth = Number(req.query.depth) || 4;
    res.json({ tree: await directoryTree(".", depth) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Source-code probe detection ──────────────────────────────
const SOURCE_PROBE_PATTERNS = [
  /agent\.js/i, /server\.js/i, /knowledge\.json/i,
  /sysinfo\.js/i, /inspect\.js/i, /codeops\.js/i,
  /show.{0,20}source/i, /print.{0,20}prompt/i,
  /your.{0,20}system.{0,20}prompt/i, /how.{0,20}(are|were).{0,20}(you|phantom).{0,20}(built|made|coded)/i,
  /reveal.{0,20}(code|prompt|source)/i,
  /ignore.{0,20}(previous|above|prior|all).{0,20}(instruction|rule)/i,
];

function sanitizeRequest(message) {
  return SOURCE_PROBE_PATTERNS.some(p => p.test(message));
}

// ── Standard JSON ─────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  try {
    const { message="", context={}, attachments=[] } = req.body;
    if (sanitizeRequest(message)) {
      return res.json({
        success: true,
        response: "I don't have access to my own source code or system prompt by design. I'm here to help you build your project — what would you like me to create?",
        steps: [],
        thoughts: null,
        artifacts: [],
      });
    }
    const result = await askModel(message, context, attachments, null);
    res.json(result);
  } catch(e) {
    console.error("[PHANTØM]", e);
    res.status(500).json({ error: e.message });
  }
});

// ── SSE Streaming ─────────────────────────────────────────────
app.post("/api/chat/stream", async (req, res) => {
  const { message="", context={}, attachments=[] } = req.body;

  // Block source probes at server level
  if (sanitizeRequest(message)) {
    res.setHeader("Content-Type","text/event-stream");
    res.setHeader("Cache-Control","no-cache");
    res.setHeader("Connection","keep-alive");
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type:"text_delta", content:"I don't have access to my own source code or system prompt by design. What would you like me to build for you?" })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  res.setHeader("Content-Type",      "text/event-stream");
  res.setHeader("Cache-Control",     "no-cache");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const emit = obj => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
  const beat = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 12000);

  try {
    emit({ type:"status", text:"PHANTØM is reasoning…" });

    const onStep = ({ phase, tool, input, output, error }) => {
      if (phase === "start") {
        emit({ type:"tool_start", tool, detail:input });
        emit({ type:"status", text:toolLabel(tool), sub:(input||"").slice(0,60) });
      } else {
        emit({ type:"tool_result", tool, output, error,
          _path: (tool==="write_file"||tool==="surgical_edit") ? (input||"").split(" ")[0] : undefined });
      }
    };

    const result = await askModel(message, context, attachments, onStep);

    if (result.thoughts)        emit({ type:"thought",   content: result.thoughts });
    if (result.artifacts?.length) emit({ type:"artifacts", files: result.artifacts });

    emit({ type:"status", text:"Writing response…" });
    const words = result.response.split(/(\s+)/);
    let buf = "";
    for (const w of words) {
      buf += w;
      if (buf.length >= 50) { emit({ type:"text_delta", content:buf }); buf=""; await sleep(8); }
    }
    if (buf) emit({ type:"text_delta", content:buf });

    emit({ type:"done", stepCount: result.steps?.length||0 });
    res.write("data: [DONE]\n\n");
  } catch(e) {
    console.error("[PHANTØM/stream]", e);
    emit({ type:"error", message: e.message });
  } finally {
    clearInterval(beat);
    if (!res.writableEnded) res.end();
  }
});

// ── Run file shortcut (from editor Run button) ────────────────
app.post("/api/run", async (req, res) => {
  try {
    const { file="", content="" } = req.body;
    const ext = path.extname(file).toLowerCase();
    const tmp = path.join(os.tmpdir(), "phantom_run_" + Date.now() + ext);
    await fs.writeFile(tmp, content, "utf8");

    const runners = {
      ".js":  `node "${tmp}"`,
      ".mjs": `node "${tmp}"`,
      ".ts":  `npx ts-node "${tmp}"`,
      ".py":  `python3 "${tmp}"`,
      ".sh":  `bash "${tmp}"`,
      ".rb":  `ruby "${tmp}"`,
      ".go":  `go run "${tmp}"`,
    };
    const cmd = runners[ext] || `node "${tmp}"`;

    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const run = promisify(exec);

    try {
      const { stdout, stderr } = await run(cmd, { timeout:20000, cwd:process.cwd() });
      res.json({ success:true, stdout, stderr });
    } catch(e) {
      res.json({ success:false, stdout:e.stdout||"", stderr:e.stderr||e.message });
    } finally {
      fs.unlink(tmp).catch(()=>{});
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SPA fallback ──────────────────────────────────────────────
app.get(/.*/, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("╔══════════════════════════════╗");
  console.log("║        PHANTØM  v4.0         ║");
  console.log("╚══════════════════════════════╝");
  console.log(`  UI:     http://localhost:${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
  console.log("");
});

const TOOL_LABELS = {
  read_file:"Reading file", write_file:"Writing file", list_files:"Listing files",
  file_exists:"Checking path", run_command:"Running command", web_search:"Searching web",
  make_directory:"Creating directory", delete_file:"Deleting file",
  move_file:"Moving file", copy_file:"Copying file",
  get_system_info:"Reading system specs", get_running_processes:"Scanning processes",
  kill_process:"Killing process", get_open_ports:"Scanning ports", scan_port:"Checking port",
  directory_tree:"Mapping project", find_files:"Finding files", grep_project:"Searching code",
  git_status:"Checking git", git_diff:"Reading diff", git_log:"Reading git log",
  diff_files:"Comparing files", file_info:"Reading file info",
  surgical_edit:"Surgical edit (SCI)", patch_file:"Patching file",
  inject_snippet:"Injecting code", rename_symbol:"Renaming symbol", project_health:"Health check",
  scan_network:"Scanning network", scan_device:"Scanning device", get_network_changes:"Checking network changes",
};
function toolLabel(t) { return TOOL_LABELS[t] || t; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
