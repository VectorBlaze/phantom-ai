"use strict";

const API      = "/api/chat";
const SAPI     = "/api/chat/stream";
const SKILL_EP = "/api/skills";
const SYS_EP   = "/api/sysinfo";
const TREE_EP  = "/api/tree";

const TOOL_META = {
  read_file:            { label:"Read file",        cls:"file", icon:"📄" },
  write_file:           { label:"Write file",       cls:"file", icon:"✏️"  },
  list_files:           { label:"List files",       cls:"file", icon:"📂" },
  file_exists:          { label:"Check path",       cls:"file", icon:"🔍" },
  run_command:          { label:"Run command",      cls:"cmd",  icon:"⚡" },
  web_search:           { label:"Web search",       cls:"web",  icon:"🌐" },
  make_directory:       { label:"Make directory",   cls:"file", icon:"📁" },
  delete_file:          { label:"Delete file",      cls:"file", icon:"🗑️" },
  move_file:            { label:"Move file",        cls:"file", icon:"↪️" },
  copy_file:            { label:"Copy file",        cls:"file", icon:"📋" },
  scan_network:         { label:"Scan network",      cls:"net",  icon:"📡" },
  scan_device:          { label:"Scan device",       cls:"net",  icon:"🔍" },
  get_network_changes:  { label:"Network changes",   cls:"net",  icon:"🔔" },
  get_system_info:      { label:"System info",      cls:"sys",  icon:"🖥️" },
  get_running_processes:{ label:"Processes",        cls:"sys",  icon:"⚙️" },
  kill_process:         { label:"Kill process",     cls:"sys",  icon:"🛑" },
  get_open_ports:       { label:"Open ports",       cls:"sys",  icon:"🔌" },
  scan_port:            { label:"Scan port",        cls:"sys",  icon:"🔌" },
  directory_tree:       { label:"Project tree",     cls:"file", icon:"🌲" },
  find_files:           { label:"Find files",       cls:"file", icon:"🔎" },
  grep_project:         { label:"Search code",      cls:"file", icon:"🔎" },
  git_status:           { label:"Git status",       cls:"git",  icon:"📋" },
  git_diff:             { label:"Git diff",         cls:"git",  icon:"📋" },
  git_log:              { label:"Git log",          cls:"git",  icon:"📋" },
  diff_files:           { label:"Diff files",       cls:"file", icon:"↔️" },
  file_info:            { label:"File info",        cls:"file", icon:"ℹ️" },
  surgical_edit:        { label:"Surgical Edit ✦",  cls:"sci",  icon:"🔬" },
  patch_file:           { label:"Patch file",       cls:"sci",  icon:"🩹" },
  inject_snippet:       { label:"Inject snippet",   cls:"sci",  icon:"💉" },
  rename_symbol:        { label:"Rename symbol",    cls:"sci",  icon:"✏️" },
  project_health:       { label:"Health check",     cls:"sci",  icon:"🩺" },
};

// Model map populated dynamically from /api/models
let MODEL_MAP = {
  "dots-studio/dots-3-note-preview:free": "Phantom-Fin",
};

// ── State ──────────────────────────────────────────────────────
let sessions      = loadJSON("ph_sessions", []);
let curId         = sessions[0]?.id || null;
let attached      = [];
let busy          = false;
let abortCtrl     = null;
let editorTabs    = [];
let editorIdx     = -1;
let selectedModel = "anthropic/claude-3.5-sonnet";
let sysInfo       = null;

const cfg = { web:true, terminal:true, files:true, skills:true, thoughts:true, stream:true, autoCode:false };
let loadedSkills = [];

// ── DOM ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const splash        = $("splash");
const appEl         = $("app");
const sessionList   = $("sessionList");
const panelFileList = $("panelFileList");
const skillList     = $("skillList");
const messages      = $("messages");
const welcome       = $("welcome");
const chatScroll    = $("chatScroll");
const liveBar       = $("liveBar");
const lbMain        = $("lbMain");
const lbSub         = $("lbSub");
const tbTitle       = $("tbTitle");
const msgInput      = $("msgInput");
const sendBtn       = $("sendBtn");
const fileInput     = $("fileInput");
const attachChips   = $("attachChips");
const editorPane    = $("editorPane");
const epTabs        = $("epTabs");
const codeEditor    = $("codeEditor");
const termView      = $("termView");
const termOutput    = $("termOutput");
const ssOverlay     = $("screenshotOverlay");
const modelPill     = $("modelPill");
const modelLabel    = $("modelLabel");
const modelDrop     = $("modelDrop");

const sbPanels = {
  chat:     $("pChat"),
  sessions: $("pSessions"),
  files:    $("pFiles"),
  skills:   $("pSkills"),
  settings: $("pSettings"),
  sysinfo:  $("pSysinfo"),
};

// ── Boot ───────────────────────────────────────────────────────
(function boot() {
  setTimeout(() => splash.classList.add("out"), 2200);
  if (!sessions.length) newSession();
  else { renderSessions(); loadSession(curId); }
  bindSidebar();
  bindTopbar();
  bindComposer();
  bindEditor();
  bindWelcomeCards();
  bindSettings();
  bindScreenshot();
  bindModelPicker();
  loadModels();
  loadSkills();
  fetchSysInfo();
  syncToggleBtns();
  bindMiniRail();
})();

// ── Sessions ───────────────────────────────────────────────────
function newSession(label) {
  const id = "s" + Date.now();
  sessions.unshift({ id, name: label || "New session", msgs: [] });
  saveJSON("ph_sessions", sessions);
  curId = id;
  renderSessions();
  loadSession(id);
}

function loadSession(id) {
  curId = id;
  const s = getS();
  if (!s) return;
  tbTitle.textContent = s.name;
  messages.innerHTML  = "";
  attached = []; renderChips(); renderFilePanel();
  if (!s.msgs.length) welcome.classList.remove("hidden");
  else { welcome.classList.add("hidden"); s.msgs.forEach(restoreMsg); scrollBot(); }
}

function getS(id) { return sessions.find(s => s.id === (id || curId)); }

function saveMsg(role, data) {
  const s = getS(); if (!s) return;
  s.msgs.push({ role, data, ts: Date.now() });
  if (role === "user" && s.msgs.filter(m => m.role === "user").length === 1) {
    const t = data?.text || "";
    if (t) { s.name = t.slice(0,44)+(t.length>44?"…":""); tbTitle.textContent=s.name; renderSessions(); }
  }
  saveJSON("ph_sessions", sessions);
}

function delSession(id) {
  sessions = sessions.filter(s => s.id !== id);
  saveJSON("ph_sessions", sessions);
  sessions.length ? loadSession(sessions[0].id) : newSession();
  renderSessions();
}

function renderSessions() {
  [["sessionList","btnNewSession"],["sessionList2","btnNewSession2"]].forEach(([lid]) => {
    const el = $(lid); if (!el) return;
    el.innerHTML = "";
    if (!sessions.length) { el.innerHTML='<div style="padding:8px 2px;color:var(--t3);font-size:12px">No sessions yet</div>'; return; }
    sessions.forEach(s => {
      const row = mk("div","sess"+(s.id===curId?" active":""));
      const btn = mk("button","sess-btn"); btn.textContent = s.name;
      btn.onclick = () => { loadSession(s.id); renderSessions(); };
      const del = mk("button","sess-del"); del.textContent = "✕";
      del.onclick = e => { e.stopPropagation(); delSession(s.id); };
      row.append(btn,del); el.appendChild(row);
    });
  });
}

// ── Sidebar ────────────────────────────────────────────────────
let activePanel = "chat";

function bindSidebar() {
  document.querySelectorAll(".sn").forEach(btn => {
    btn.addEventListener("click", () => openPanel(btn.dataset.panel, btn));
  });
  $("btnNewSession")?.addEventListener("click",  () => newSession());
  $("btnNewSession2")?.addEventListener("click", () => newSession());
  $("rClear")?.addEventListener("click", clearChat);
  const dz = $("dropZone");
  dz?.addEventListener("click",    () => fileInput.click());
  dz?.addEventListener("dragover", e => e.preventDefault());
  dz?.addEventListener("drop",     e => { e.preventDefault(); handleFiles([...e.dataTransfer.files]); });
}

function openPanel(name, btn) {
  activePanel = name;
  Object.values(sbPanels).forEach(p => p && (p.hidden = true));
  if (sbPanels[name]) sbPanels[name].hidden = false;
  document.querySelectorAll(".sn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  else document.querySelector(`.sn[data-panel="${name}"]`)?.classList.add("active");
}

function clearChat() {
  const s = getS(); if (!s) return;
  s.msgs = []; saveJSON("ph_sessions", sessions);
  messages.innerHTML = ""; welcome.classList.remove("hidden"); liveBar.hidden = true;
}

function bindMiniRail() {
  document.querySelectorAll(".rm-btn[data-panel]").forEach(btn => {
    btn.addEventListener("click", () => {
      appEl.classList.remove("sidebar-hidden");
      openPanel(btn.dataset.panel);
    });
  });
  $("rmClear")?.addEventListener("click", clearChat);
}

// ── System Info ────────────────────────────────────────────────
async function fetchSysInfo() {
  try {
    const r = await fetch(SYS_EP);
    sysInfo = await r.json();
    renderSysPanel();
  } catch { /* server not up yet */ }
}

function renderSysPanel() {
  const el = $("sysInfoContent"); if (!el || !sysInfo) return;
  const s = sysInfo;
  el.innerHTML = `
    <div class="sys-grid">
      <div class="sys-card"><div class="sys-card-label">Host</div><div class="sys-card-val">${s.hostname}</div></div>
      <div class="sys-card"><div class="sys-card-label">User</div><div class="sys-card-val">${s.username}</div></div>
      <div class="sys-card"><div class="sys-card-label">Platform</div><div class="sys-card-val">${s.platform}</div></div>
      <div class="sys-card"><div class="sys-card-label">CPU</div><div class="sys-card-val">${s.cpuModel}<br><span style="color:var(--t2)">${s.cpuCores} cores</span></div></div>
      <div class="sys-card"><div class="sys-card-label">RAM</div><div class="sys-card-val">${s.ram.total} <span style="color:var(--t2)">/ ${s.ram.free} free</span></div></div>
      <div class="sys-card"><div class="sys-card-label">GPU</div><div class="sys-card-val">${s.gpu||"—"}</div></div>
      <div class="sys-card full"><div class="sys-card-label">Local IPs</div><div class="sys-card-val">${(s.localIps||[]).join(" · ")||"—"}</div></div>
      <div class="sys-card full"><div class="sys-card-label">Runtimes</div><div class="sys-card-val mono">node ${s.runtimes?.node||"—"} &nbsp; npm ${s.runtimes?.npm||"—"} &nbsp; python ${s.runtimes?.python||"—"} &nbsp; git ${s.runtimes?.git||"—"}</div></div>
      <div class="sys-card"><div class="sys-card-label">Uptime</div><div class="sys-card-val">${s.uptime}</div></div>
      <div class="sys-card"><div class="sys-card-label">OS</div><div class="sys-card-val" style="font-size:11px">${(s.osVersion||"").slice(0,80)}</div></div>
    </div>
    <div class="sys-actions">
      <button class="sys-btn" onclick="fetchSysInfo()">⟳ Refresh</button>
      <button class="sys-btn" onclick="askSysQuestion('Show all running processes sorted by CPU')">⚙ Processes</button>
      <button class="sys-btn" onclick="askSysQuestion('Show all open ports and what is listening on them')">🔌 Open ports</button>
      <button class="sys-btn" onclick="askSysQuestion('Run a full project health check')">🩺 Health check</button>
    </div>`;
}

window.askSysQuestion = function(q) {
  msgInput.value = q;
  msgInput.dispatchEvent(new Event("input"));
  openPanel("chat", document.querySelector('.sn[data-panel="chat"]'));
  setTimeout(() => { if (!sendBtn.disabled && !busy) send(); }, 100);
};

// ── Topbar ─────────────────────────────────────────────────────
function bindTopbar() {
  $("btnToggleRail").addEventListener("click", () => appEl.classList.toggle("sidebar-hidden"));
  $("btnNewChat").addEventListener("click",    () => newSession());
  $("btnEditor").addEventListener("click",     toggleEditor);
  $("btnTermView").addEventListener("click",   toggleTermView);
  $("btnScreenshot").addEventListener("click", takeScreenshot);
  $("btnCancel").addEventListener("click",     () => abortCtrl?.abort());
}

// ── Model picker — dynamic from /api/models ───────────────────
async function loadModels() {
  try {
    const r   = await fetch("/api/models");
    const d   = await r.json();
    const inner = $("modelDropInner");
    if (!inner) return;
    inner.innerHTML = "";

    let firstAvail = null;

    Object.entries(d.providers).forEach(([key, prov]) => {
      // Provider header
      const hdr = mk("div","md-provider-hdr");
      hdr.innerHTML = `<span class="md-prov-name">${prov.label}</span>`+
        (prov.available
          ? `<span class="md-prov-ok">● Active</span>`
          : `<span class="md-prov-off">○ No key</span>`);
      inner.appendChild(hdr);

      prov.models.forEach(m => {
        MODEL_MAP[m.id] = m.label;
        const btn = mk("button", "md-opt" + (m.default ? " active" : "") + (prov.available ? "" : " md-unavail"));
        btn.dataset.val = m.id;
        btn.title = prov.available ? "" : `Set ${prov.envKey} in .env to use`;
        btn.innerHTML = `<span class="md-name">${m.label}</span>`+
          `<span class="md-sub">${prov.label}${prov.available ? "" : " · key missing"}</span>`;
        btn.onclick = () => {
          if (!prov.available) {
            addTermLine(`Set ${prov.envKey} in your .env to use ${prov.label}`, "to-err");
            return;
          }
          selectModel(m.id, m.label);
        };
        inner.appendChild(btn);
        if (prov.available && !firstAvail) firstAvail = m;
        if (m.default && prov.available) { selectedModel = m.id; modelLabel.textContent = m.label; }
      });
    });

    // Fall back to first available model
    if (!selectedModel && firstAvail) selectModel(firstAvail.id, firstAvail.label);
    if (!selectedModel) { selectedModel="dots-studio/dots-3-note-preview:free"; modelLabel.textContent="Phantom-Fin"; }

  } catch { modelLabel.textContent = "Phantom-Fin"; }
}

function selectModel(id, label) {
  selectedModel = id;
  modelLabel.textContent = label || MODEL_MAP[id] || id;
  document.querySelectorAll(".md-opt").forEach(o => o.classList.remove("active"));
  document.querySelectorAll(`.md-opt[data-val="${id}"]`).forEach(o => o.classList.add("active"));
  modelDrop.hidden = true;
  modelPill.classList.remove("open");
  addTermLine(`Model: ${label||id}`, "to-info");
}

function bindModelPicker() {
  modelPill.addEventListener("click", e => {
    e.stopPropagation();
    const open = !modelDrop.hidden;
    modelDrop.hidden = open;
    modelPill.classList.toggle("open", !open);
  });
  document.addEventListener("click", () => { modelDrop.hidden = true; modelPill.classList.remove("open"); });
}

// ── Settings ───────────────────────────────────────────────────
function bindSettings() {
  const map = { swWeb:"web", swTerminal:"terminal", swFiles:"files", swSkills:"skills", swThoughts:"thoughts", swStream:"stream", swAutoCode:"autoCode" };
  Object.entries(map).forEach(([id,key]) => {
    const el=$(id); if(!el) return;
    el.checked=cfg[key];
    el.addEventListener("change",()=>{ cfg[key]=el.checked; syncToggleBtns(); });
  });
}
function syncToggleBtns() {
  [["cWeb","web"],["cTerminal","terminal"],["cFiles","files"]].forEach(([id,k])=>$(id)?.classList.toggle("on",cfg[k]));
}

// ── Editor ─────────────────────────────────────────────────────
function bindEditor() {
  $("epClose").addEventListener("click",  closeEditor);
  $("epRun").addEventListener("click",    runCurrentFile);
  $("epCopy").addEventListener("click",   ()=>{ if(editorIdx>=0) navigator.clipboard.writeText(editorTabs[editorIdx].content); });
  $("termClear").addEventListener("click",()=>{ termOutput.innerHTML=""; });
}
function toggleEditor() { editorPane.classList.toggle("open"); $("btnEditor").classList.toggle("active",editorPane.classList.contains("open")); }
function closeEditor()  { editorPane.classList.remove("open"); $("btnEditor").classList.remove("active"); }
function toggleTermView() {
  const showing=!termView.hidden;
  termView.hidden=showing; codeEditor.hidden=!showing;
  $("btnTermView").classList.toggle("active",!showing);
  if(!showing) editorPane.classList.add("open");
}
function openInEditor(name,content) {
  const i=editorTabs.findIndex(t=>t.name===name);
  if(i>=0){editorTabs[i].content=content;editorIdx=i;}
  else{editorTabs.push({name,content});editorIdx=editorTabs.length-1;}
  editorPane.classList.add("open"); $("btnEditor").classList.add("active");
  renderEditorTabs(); renderEditorContent();
}
function renderEditorTabs() {
  epTabs.innerHTML="";
  editorTabs.forEach((t,i)=>{
    const tab=mk("div","ep-tab"+(i===editorIdx?" active":""));
    const sp=mk("span"); sp.textContent=t.name;
    const x=mk("button","ep-tab-close"); x.textContent="✕";
    x.onclick=e=>{e.stopPropagation();editorTabs.splice(i,1);editorIdx=Math.min(editorIdx,editorTabs.length-1);renderEditorTabs();renderEditorContent();};
    tab.onclick=()=>{editorIdx=i;renderEditorTabs();renderEditorContent();};
    tab.append(sp,x); epTabs.appendChild(tab);
  });
}
function renderEditorContent() {
  codeEditor.innerHTML="";
  if(editorIdx<0||!editorTabs.length){
    codeEditor.innerHTML='<div class="ce-empty"><div class="ce-empty-icon">◫</div><div class="ce-empty-text">No file open</div><div class="ce-empty-sub">Files written by PHANTØM appear here</div></div>';
    return;
  }
  const {content}=editorTabs[editorIdx];
  const pre=mk("pre");
  pre.innerHTML=content.split("\n").map((l,i)=>`<span class="ln">${i+1}</span>${escH(l)}`).join("\n");
  codeEditor.appendChild(pre);
}
const BROWSER_EXTS = new Set(["html","htm"]);

async function runCurrentFile() {
  if(editorIdx<0) return;
  const {name,content}=editorTabs[editorIdx];
  const ext=(name.split(".").pop()||"").toLowerCase();

  // HTML (and anything else meant to render in a browser, not execute in
  // Node) gets opened as a live page instead of being shipped to the
  // Node-based /api/run endpoint — that endpoint executes the file as a
  // script, which is why running an .html file was throwing a Node error
  // instead of actually displaying the page.
  if (BROWSER_EXTS.has(ext)) {
    addTermLine(`$ Opening ${name} in preview…`,"to-cmd");
    runInBrowserPreview(name, content);
    return;
  }

  addTermLine(`$ Running ${name}…`,"to-cmd");
  try {
    const r=await fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({file:name,content})});
    const d=await r.json();
    if(d.stdout) addTermLine(d.stdout,"to-ok");
    if(d.stderr) addTermLine(d.stderr,"to-err");
    if(!termView.hidden===false) { termView.hidden=false; codeEditor.hidden=true; editorPane.classList.add("open"); }
  } catch(e){ addTermLine("Error: "+e.message,"to-err"); }
}

function runInBrowserPreview(name, html) {
  // Render the HTML in an iframe inside the editor pane so "Run" on an
  // .html file actually shows the page instead of trying to execute it.
  termView.hidden = true; codeEditor.hidden = false; editorPane.classList.add("open");
  codeEditor.innerHTML = "";
  const frame = document.createElement("iframe");
  frame.className = "html-preview-frame";
  frame.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-popups");
  frame.srcdoc = html;
  codeEditor.appendChild(frame);
  addTermLine(`$ ${name} rendered in preview (not executed by Node)`, "to-ok");
}
function addTermLine(text,cls=""){
  const d=mk("div",cls); d.textContent=text; termOutput.appendChild(d);
  termOutput.scrollTop=termOutput.scrollHeight;
}

// ── Welcome cards ──────────────────────────────────────────────
function bindWelcomeCards() {
  document.querySelectorAll(".qc[data-prompt]").forEach(btn=>{
    btn.addEventListener("click",()=>{ msgInput.value=btn.dataset.prompt; msgInput.dispatchEvent(new Event("input")); msgInput.focus(); });
  });
}

// ── Composer ───────────────────────────────────────────────────
function bindComposer() {
  msgInput.addEventListener("input",()=>{
    msgInput.style.height="auto";
    msgInput.style.height=Math.min(msgInput.scrollHeight,150)+"px";
    sendBtn.disabled=!msgInput.value.trim()&&!attached.length;
  });
  msgInput.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(!sendBtn.disabled&&!busy)send();} });
  sendBtn.addEventListener("click",()=>{ if(!busy) send(); });
  $("cAttach").addEventListener("click",()=>fileInput.click());
  fileInput.addEventListener("change",()=>{ handleFiles([...fileInput.files]); fileInput.value=""; });
  [["cWeb","web"],["cTerminal","terminal"],["cFiles","files"]].forEach(([id,key])=>{
    const btn=$(id); if(!btn) return;
    btn.addEventListener("click",()=>{ cfg[key]=!cfg[key]; btn.classList.toggle("on",cfg[key]); const ck={web:"swWeb",terminal:"swTerminal",files:"swFiles"}[key]; if($(ck))$(ck).checked=cfg[key]; });
  });
}

// ── Files ──────────────────────────────────────────────────────
async function handleFiles(files) {
  for(const f of files){
    if(attached.find(a=>a.name===f.name&&a.size===f.size)) continue;
    const e={name:f.name,size:f.size,type:f.type};
    if(f.type.startsWith("image/")) e.data=await readDataURL(f);
    else { try{e.text=await f.text();}catch{} }
    attached.push(e);
  }
  renderChips(); renderFilePanel();
  sendBtn.disabled=!msgInput.value.trim()&&!attached.length;
}
function renderChips(){
  attachChips.innerHTML=""; attachChips.hidden=!attached.length;
  attached.forEach((a,i)=>{
    const c=mk("div","ac");
    if(a.data){const img=document.createElement("img");img.src=a.data;img.className="ac-thumb";c.appendChild(img);}
    else{const ico=mk("div","ac-icon");ico.textContent=extIco(a.name);c.appendChild(ico);}
    const nm=mk("span","ac-name");nm.textContent=a.name;
    const x=mk("button","ac-x");x.textContent="✕";
    x.onclick=()=>{attached.splice(i,1);renderChips();renderFilePanel();sendBtn.disabled=!msgInput.value.trim()&&!attached.length;};
    c.append(nm,x);attachChips.appendChild(c);
  });
}
function renderFilePanel(){
  panelFileList.innerHTML="";
  attached.forEach((a,i)=>{
    const row=mk("div","fi");
    const ico=mk("div","fi-icon");ico.textContent=a.data?"🖼️":extIco(a.name);
    const nm=mk("div","fi-name");nm.textContent=a.name;
    const sz=mk("div","fi-size");sz.textContent=fmtSz(a.size);
    const del=mk("button","fi-del");del.textContent="✕";
    del.onclick=()=>{attached.splice(i,1);renderChips();renderFilePanel();};
    row.append(ico,nm,sz,del);panelFileList.appendChild(row);
  });
}

// ── Skills ─────────────────────────────────────────────────────
async function loadSkills(){
  try{
    const r=await fetch(SKILL_EP);
    if(!r.ok) throw new Error("HTTP "+r.status);
    const d=await r.json();
    loadedSkills = d.skills||[];
    skillList.innerHTML="";
    loadedSkills.forEach(s=>{
      const c=mk("div","skill-card");
      c.innerHTML=`<div class="sk-name">${escH(s.name)}</div>${s.description?`<div class="sk-desc">${escH(s.description)}</div>`:""}`;
      skillList.appendChild(c);
    });
    if(!loadedSkills.length) skillList.innerHTML='<div class="panel-loading">No skills in /skills/*.md</div>';
  }catch(e){
    loadedSkills=[];
    console.error("loadSkills failed:",e);
    skillList.innerHTML=`<div class="panel-loading">Could not load skills (${escH(e.message)})</div>`;
  }
}

// ── SEND ───────────────────────────────────────────────────────
async function send(){
  const text=msgInput.value.trim();
  if(!text&&!attached.length) return;
  if(busy) return;
  busy=true; welcome.classList.add("hidden");

  const atts=[...attached];
  appendUserMsg(text,atts);
  saveMsg("user",{text,files:atts.map(a=>({name:a.name,size:a.size}))});

  msgInput.value=""; msgInput.style.height="auto";
  attached=[]; renderChips(); renderFilePanel(); sendBtn.disabled=true;

  liveBar.hidden=false; lbMain.textContent="PHANTØM is reasoning…"; lbSub.textContent="";

  const {flow,thought,textEl}=appendAsstShell();

  try{
    if(cfg.stream){ await streamRequest(text,atts,flow,thought,textEl); }
    else{
      const r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({message:text,context:getCtx(),attachments:prepAtts(atts),model:selectedModel})});
      const d=await r.json();
      if(d.error){const err=new Error(d.error);if(d.status===429||d.error?.includes("429")) err.status=429; throw err;}
      if(d.thoughts&&cfg.thoughts) renderThought(thought,d.thoughts);
      if(d.steps?.length)          renderFlowMap(flow,d.steps);
      if(d.artifacts?.length)      renderArtifacts(textEl,d.artifacts);
      renderMd(textEl,d.response||"Done.");
      saveMsg("assistant",{thoughts:d.thoughts,steps:d.steps,text:d.response,artifacts:d.artifacts});
    }
  }catch(e){
    if(e.name!=="AbortError"){
      if(is429(e)){ show429Popup(); textEl.remove(); }
      else textEl.innerHTML=`<span style="color:var(--red)">⚠ ${escH(e.message)}</span>`;
    }
  }finally{
    busy=false; abortCtrl=null; liveBar.hidden=true; scrollBot();
  }
}

async function streamRequest(text,atts,flow,thought,textEl){
  abortCtrl=new AbortController();
  const res=await fetch(SAPI,{
    method:"POST",signal:abortCtrl.signal,
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({message:text,context:getCtx(),attachments:prepAtts(atts),model:selectedModel}),
  });
  if(!res.ok){const d=await res.json().catch(()=>({error:"HTTP "+res.status}));const err=new Error(d.error||"Stream failed");if(res.status===429) err.status=429;throw err;}

  const reader=res.body.getReader();const dec=new TextDecoder();
  let buf="";let finalTxt="";let cur=null;
  cur=mk("span","cur");textEl.appendChild(cur);

  while(true){
    const {done,value}=await reader.read();if(done) break;
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split("\n");buf=lines.pop();
    for(const line of lines){
      if(!line.startsWith("data: ")) continue;
      const raw=line.slice(6).trim();if(raw==="[DONE]") break;
      let ev;try{ev=JSON.parse(raw);}catch{continue;}
      switch(ev.type){
        case "status":     lbMain.textContent=ev.text||"Working…";lbSub.textContent=ev.sub||"";break;
        case "tool_start": lbMain.textContent=toolLabel(ev.tool)+(ev.detail?`: ${ev.detail.slice(0,45)}`:"");
                           addTermLine(`▸ ${ev.tool}: ${ev.detail||""}`, "to-cmd");
                           addFlowStep(flow,ev.tool,ev.detail,"run"); break;
        case "tool_result": updateFlowStep(flow,ev.tool,ev.output,ev.error);
                            if(ev.output) addTermLine(ev.output.slice(0,400),ev.error?"to-err":"to-ok");
                            if(ev._path) openInEditor(ev._path,"// "+ev._path); break;
        case "thought":    if(cfg.thoughts) renderThought(thought,ev.content); break;
        case "artifacts":  renderArtifacts(textEl,ev.files); break;
        case "text_delta": finalTxt+=ev.content;if(cur)cur.remove();renderMd(textEl,finalTxt);cur=mk("span","cur");textEl.appendChild(cur);break;
        case "error":      if(cur)cur.remove();
                           if(ev.status===429||is429({message:ev.message})){ show429Popup(); textEl.remove(); }
                           else textEl.innerHTML=`<span style="color:var(--red)">⚠ ${escH(ev.message)}</span>`;
                           break;
      }
      scrollBot();
    }
  }
  if(cur) cur.remove();
  saveMsg("assistant",{text:finalTxt});
}

// ── Message rendering ──────────────────────────────────────────
function appendUserMsg(text,atts){
  const wrap=mk("div","msg-user");
  if(text){const t=mk("div","msg-user-text");t.textContent=text;wrap.appendChild(t);}
  if(atts.length){const fc=mk("div","msg-files");atts.forEach(a=>{const c=mk("span","mf-chip");c.textContent=a.name;fc.appendChild(c);});wrap.appendChild(fc);}
  messages.appendChild(wrap);scrollBot();
}
function appendAsstShell(){
  const wrap=mk("div","msg-asst");
  const av=mk("div","msg-av");av.textContent="Ø";
  const body=mk("div","msg-body");
  const thought=mk("div");const flow=mk("div");const textEl=mk("div","md");
  body.append(thought,flow,textEl);wrap.append(av,body);
  messages.appendChild(wrap);scrollBot();
  return{wrap,flow,thought,textEl};
}
function restoreMsg(m){
  if(m.role==="user"){appendUserMsg(m.data?.text||"",[]); return;}
  const {flow,thought,textEl}=appendAsstShell();
  if(m.data?.thoughts&&cfg.thoughts) renderThought(thought,m.data.thoughts);
  if(m.data?.steps?.length)          renderFlowMap(flow,m.data.steps);
  if(m.data?.artifacts?.length)      renderArtifacts(textEl,m.data.artifacts);
  if(m.data?.text)                   renderMd(textEl,m.data.text);
}

// ── Thought ────────────────────────────────────────────────────
function renderThought(container,txt){
  container.innerHTML="";
  const b=mk("div","thought");
  const hd=mk("div","thought-hd");hd.innerHTML=`<span>💭</span> Thought process <span class="thought-caret">▾</span>`;
  const bd=mk("div","thought-body");bd.textContent=txt;
  hd.onclick=()=>{hd.classList.toggle("open");bd.classList.toggle("open");};
  b.append(hd,bd);container.appendChild(b);
}

// ── Flow map ───────────────────────────────────────────────────
function renderFlowMap(container,steps){
  container.innerHTML="";if(!steps?.length) return;
  const map=mk("div","flow-map");
  const hd=mk("div","flow-hd");
  hd.innerHTML=`<span>⚡</span><span class="flow-hd-label">Agent actions</span><span class="flow-hd-count">${steps.length} steps</span><span class="flow-caret">▾</span>`;
  hd.onclick=()=>map.classList.toggle("collapsed");
  const body=mk("div","flow-body");
  steps.forEach(s=>body.appendChild(buildStep(s.tool,s.input,s.output,s.error,"done")));
  map.append(hd,body);container.appendChild(map);
}
function buildStep(tool,input,output,error,state){
  const meta=TOOL_META[tool]||{label:tool,cls:"code",icon:"⚙️"};
  const step=mk("div","flow-step "+(error?"err":state));
  step.dataset.tool=tool;
  const fn=mk("div","fn");fn.textContent=error?"✕":state==="run"?"":"✓";
  const fr=mk("div","fr");
  const badge=mk("span","fbadge "+meta.cls);badge.textContent=meta.icon+" "+meta.label;
  const fl=mk("div","fl");fl.textContent=input?input.slice(0,90):meta.label;
  fr.append(badge,fl);
  if(output||error){
    const fo=mk("div","fo");const tog=mk("button","fo-tog");tog.textContent=error?"▸ Error":"▸ Output";
    const bd=mk("div","fo-body"+(error?" error":""));bd.textContent=error||output||"";
    tog.onclick=()=>{bd.classList.toggle("open");tog.textContent=bd.classList.contains("open")?(error?"▾ Error":"▾ Output"):(error?"▸ Error":"▸ Output");};
    fo.append(tog,bd);fr.appendChild(fo);
  }
  if((tool==="write_file"||tool==="surgical_edit")&&input){
    const oe=mk("button","open-editor-btn");oe.textContent="◫ Open in editor";
    oe.onclick=()=>openInEditor(input.split(" ")[0],output||"// "+input);
    fr.appendChild(oe);
  }
  step.append(fn,fr);return step;
}
function addFlowStep(container,tool,detail,state){
  let map=container.querySelector(".flow-map");
  if(!map){
    map=mk("div","flow-map");
    const hd=mk("div","flow-hd");
    hd.innerHTML=`<span>⚡</span><span class="flow-hd-label">Agent actions</span><span class="flow-hd-count">0 steps</span><span class="flow-caret">▾</span>`;
    hd.onclick=()=>map.classList.toggle("collapsed");
    const body=mk("div","flow-body");map.append(hd,body);container.appendChild(map);
  }
  const body=map.querySelector(".flow-body");
  body.appendChild(buildStep(tool,detail,null,null,state));
  const cnt=body.querySelectorAll(".flow-step").length;
  map.querySelector(".flow-hd-count").textContent=cnt+" step"+(cnt!==1?"s":"");
  scrollBot();
}
function updateFlowStep(container,tool,output,error){
  const map=container.querySelector(".flow-map");if(!map) return;
  const steps=[...map.querySelectorAll(".flow-step.run")].filter(s=>s.dataset.tool===tool);
  const step=steps[steps.length-1];if(!step) return;
  step.classList.remove("run");step.classList.add(error?"err":"done");
  step.querySelector(".fn").textContent=error?"✕":"✓";
  const fr=step.querySelector(".fr");
  if(output||error){
    const fo=mk("div","fo");const tog=mk("button","fo-tog");tog.textContent=error?"▸ Error":"▸ Output";
    const bd=mk("div","fo-body"+(error?" error":""));bd.textContent=error||output||"";
    tog.onclick=()=>{bd.classList.toggle("open");tog.textContent=bd.classList.contains("open")?(error?"▾ Error":"▾ Output"):(error?"▸ Error":"▸ Output");};
    fo.append(tog,bd);fr.appendChild(fo);
  }
}
function renderArtifacts(container,files){
  if(!files?.length) return;
  const row=mk("div","artifacts-row");
  files.forEach(f=>{
    const c=mk("div","art-chip");c.innerHTML=`📄 <span>${f}</span>`;
    c.onclick=()=>openInEditor(f,"// "+f);
    row.appendChild(c);
  });
  container.parentElement?.insertBefore(row,container);
}

// ── Markdown ───────────────────────────────────────────────────
function renderMd(container,text){
  if(!text) return;container.innerHTML="";

  // Pull fenced code blocks out BEFORE markdown parsing and keep the raw
  // code (real newlines, unescaped) in memory. Previously the escaped code
  // was wrapped in a fake <CBLK> tag and sent back through marked.parse(),
  // which re-tokenized it as markdown: newlines got turned into <br> (lost
  // when later read back via .textContent — causing the editor pane to show
  // one giant single-line blob) and entities got double-escaped, e.g.
  // "&lt;" became "&amp;lt;" which renders as the literal text "&lt;/style&gt;".
  // Using a plain <div> placeholder (a real HTML block tag marked passes
  // through untouched) and swapping it back in from the `blocks` array
  // avoids both problems entirely.
  const blocks=[];
  const processed=text.replace(/```(\w*)\n?([\s\S]*?)```/g,(_,lang,code)=>{
    const i=blocks.length;
    blocks.push({lang:lang||"code",code:code.replace(/\n$/,"")});
    return `\n\n<div class="cblk-slot" data-cblk="${i}"></div>\n\n`;
  });

  const raw=typeof marked!=="undefined"?marked.parse(processed,{breaks:true,gfm:true}):`<p>${escH(text)}</p>`;
  const safe=typeof DOMPurify!=="undefined"
    ?DOMPurify.sanitize(raw,{ADD_ATTR:["data-cblk"]})
    :raw;

  const tmp=document.createElement("div");tmp.innerHTML=safe;
  tmp.querySelectorAll(".cblk-slot").forEach(slot=>{
    const b=blocks[+slot.dataset.cblk];
    if(b) slot.replaceWith(buildCodeBlock(b.lang,b.code));
  });
  while(tmp.firstChild) container.appendChild(tmp.firstChild);
}
function buildCodeBlock(lang,code){
  const d = document.createElement("details");
  d.className = "code-blk";
  if (cfg.autoCode) d.open = true;

  const s = document.createElement("summary");

  // Icon based on lang
  const iconMap = {js:"📜",ts:"📘",jsx:"⚛",tsx:"⚛",py:"🐍",html:"🌐",css:"🎨",json:"{}",sh:"⚡",go:"🐹",rs:"🦀",sql:"🗄",md:"📝"};
  const ico = mk("div","cb-icon"); ico.textContent = iconMap[lang] || "📄";

  const meta = mk("div","cb-meta");
  const lb   = mk("div","cb-lang"); lb.textContent = lang || "code";
  const lines= mk("div","cb-lines"); lines.textContent = code.split("\n").length + " lines";
  meta.append(lb, lines);

  const btns = mk("div","cb-btns");
  const cp   = mk("button","cb-btn"); cp.textContent = "Copy";
  cp.onclick = e => {
    e.stopPropagation();
    navigator.clipboard.writeText(code).then(() => { cp.textContent="Copied!"; setTimeout(()=>cp.textContent="Copy",1500); });
  };
  const oe = mk("button","cb-btn"); oe.textContent = "◫ Editor";
  oe.onclick = e => { e.stopPropagation(); openInEditor("snippet."+lang, code); };
  btns.append(cp, oe);

  s.append(ico, meta, btns);

  const pre = document.createElement("pre");
  const cEl = document.createElement("code");
  cEl.textContent = code;
  pre.appendChild(cEl);

  d.append(s, pre);
  return d;
}

// ── Screenshot ─────────────────────────────────────────────────
function bindScreenshot(){
  $("ssClose")?.addEventListener("click",()=>ssOverlay.hidden=true);
  $("ssCopy")?.addEventListener("click",()=>{const img=$("ssImg");fetch(img.src).then(r=>r.blob()).then(b=>navigator.clipboard.write([new ClipboardItem({"image/png":b})]));});
  $("ssDownload")?.addEventListener("click",()=>{const a=document.createElement("a");a.href=$("ssImg").src;a.download="phantom-"+Date.now()+".png";a.click();});
}
async function takeScreenshot(){
  try{
    const stream=await navigator.mediaDevices.getDisplayMedia({preferCurrentTab:true});
    const video=document.createElement("video");video.srcObject=stream;await video.play();
    const canvas=document.createElement("canvas");canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    canvas.getContext("2d").drawImage(video,0,0);stream.getTracks().forEach(t=>t.stop());
    $("ssImg").src=canvas.toDataURL("image/png");ssOverlay.hidden=false;
  }catch{addTermLine("Screenshot: grant screen-share permission.","to-info");if(termView.hidden)toggleTermView();}
}

// ── 429 Rate-limit popup ───────────────────────────────────────
function show429Popup(){
  // Remove any existing popup first
  document.getElementById("ph429Overlay")?.remove();

  const overlay=mk("div","");
  overlay.id="ph429Overlay";
  overlay.style.cssText="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);backdrop-filter:blur(10px);animation:fadein .2s ease";
  overlay.innerHTML=`
    <div style="background:rgba(22,18,32,0.97);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:36px 40px;max-width:380px;width:90%;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.6),0 0 0 1px rgba(139,92,246,0.2) inset;animation:ph-menu .22s ease">
      <div style="font-size:38px;margin-bottom:16px">⏳</div>
      <div style="font-size:19px;font-weight:650;color:#f4f4f5;letter-spacing:-0.02em;margin-bottom:10px">PHANTØM's limit for today is over!</div>
      <div style="font-size:13.5px;color:#a1a1aa;line-height:1.6;margin-bottom:28px">The limit will be reset tomorrow.<br>Come back then to continue building.</div>
      <button id="ph429Close" style="padding:10px 28px;border-radius:999px;border:0;background:linear-gradient(135deg,#7c3aed,#9333ea);color:#fff;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 6px 16px rgba(124,58,237,.4)">Got it</button>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener("click", e=>{ if(e.target===overlay) overlay.remove(); });
  document.getElementById("ph429Close").addEventListener("click", ()=>overlay.remove());
}

function is429(e){
  return e?.message?.includes("429") || e?.status===429 || String(e?.message).toLowerCase().includes("rate limit");
}

// ── Helpers ────────────────────────────────────────────────────
function mk(tag,cls){const e=document.createElement(tag);if(cls)e.className=cls;return e;}
function escH(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function fmtSz(b){return b<1024?b+"B":b<1048576?(b/1024).toFixed(1)+"KB":(b/1048576).toFixed(1)+"MB";}
function extIco(n){const e=(n.split(".").pop()||"").toLowerCase();return{js:"JS",ts:"TS",jsx:"JSX",tsx:"TSX",py:"PY",go:"GO",rs:"RS",css:"CSS",html:"HTM",json:"JSON",md:"MD",sh:"SH",sql:"SQL",yaml:"YML",yml:"YML",env:"ENV",txt:"TXT"}[e]||(e.slice(0,3).toUpperCase()||"?");}
function toolLabel(t){return TOOL_META[t]?.label||t;}
function getCtx(){return{webSearch:cfg.web,terminal:cfg.terminal,files:cfg.files,skills:cfg.skills,availableSkills:cfg.skills?loadedSkills.map(s=>s.name):[]};}
function prepAtts(atts){return atts.map(a=>({name:a.name,type:a.type,...(a.data?{data:a.data}:{}),...(a.text?{text:a.text}:{})}));}
function scrollBot(){requestAnimationFrame(()=>{if(chatScroll) chatScroll.scrollTop=chatScroll.scrollHeight;});}
function readDataURL(f){return new Promise((r,j)=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.onerror=j;fr.readAsDataURL(f);});}
function loadJSON(k,d){try{return JSON.parse(localStorage.getItem(k))||d;}catch{return d;}}
function saveJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}