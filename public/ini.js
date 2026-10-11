/**
 * PHANTØM ini.js — Frontend Connection Gate
 * Place in: public/ (frontend folder)
 * Load it as the FIRST script in index.html, before app.js.
 *
 * Behaviour:
 *   • Blocks the entire UI behind an overlay immediately on load.
 *   • Polls GET /health on the backend server.
 *   • If the backend responds with { ok: true } → removes overlay, app runs.
 *   • If opened via file:// OR backend never responds → shows error screen.
 *   • Retry button resets and probes again.
 *
 * No dependency on app.js, no backend file-checking logic needed here.
 * Just needs the server to be reachable and return { ok: true } from /health.
 */
(function () {
  "use strict";

  const HEALTH_URL   = "/health";
  const RETRY_MS     = 2500;
  const MAX_ATTEMPTS = 40;
  let   attempts     = 0;
  let   connected    = false;

  // ── Block app.js from running until we say so ──────────────
  // In index.html, wrap the app.js <script> tag boot code with:
  //   window.__phantomGate(function() { /* your boot */ });
  // OR just put ini.js before app.js — the overlay alone blocks the UI.
  let _appReadyCb = null;
  window.__phantomGate  = function (cb) {
    _appReadyCb = cb;
    if (connected) cb(); // already verified, fire immediately
  };

  // ── Inject overlay immediately (before DOM ready) ──────────
  function injectOverlay() {
    if (document.getElementById("iniOverlay")) return;
    const el = document.createElement("div");
    el.id = "iniOverlay";
    el.innerHTML = `
      <div id="iniConnecting">
        <div style="position:relative;width:48px;height:48px;display:grid;place-items:center">
          <div class="ini-ring"></div>
          <span class="ini-logo">Ø</span>
        </div>
        <div class="ini-wordmark">PHANTØM</div>
        <div class="ini-status" id="iniStatus">Connecting to backend…</div>
      </div>
      <div id="iniError">
        <div class="ini-err-icon">⚠️</div>
        <div class="ini-err-title">We are sorry for<br>your Inconvenience</div>
        <div class="ini-err-body">
          We're having trouble connecting to the server right now.<br>
          For your security, please close this page and try again later.
        </div>
        <button class="ini-retry-btn" id="iniRetryBtn">Retry</button>
      </div>`;

    // Insert as early as possible
    const target = document.body || document.documentElement;
    target.prepend(el);

    document.getElementById("iniRetryBtn").addEventListener("click", function () {
      attempts  = 0;
      connected = false;
      showConnecting();
      probe();
    });
  }

  // ── Screen helpers ─────────────────────────────────────────
  function showError() {
    injectOverlay();
    document.getElementById("iniConnecting").style.display = "none";
    document.getElementById("iniError").style.display      = "flex";
  }

  function showConnecting() {
    injectOverlay();
    document.getElementById("iniConnecting").style.display = "flex";
    document.getElementById("iniError").style.display      = "none";
  }

  // ── Health probe ───────────────────────────────────────────
  async function probe() {
    // Opened as a local file — backend can never exist
    if (location.protocol === "file:") { showError(); return; }

    attempts++;
    const statusEl = document.getElementById("iniStatus");

    try {
      const res = await fetch(HEALTH_URL, { cache: "no-store" });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));

        // Accept { ok: true } — that's all the backend needs to return.
        // If your /health endpoint returns anything other than ok:true
        // (e.g. 404 page, HTML error) this still catches it via !res.ok above.
        if (data.ok === false) { showError(); return; }

        // ✅ Backend is live
        connected = true;
        if (statusEl) statusEl.textContent = "Connected · PHANTØM " + (data.version || "");

        const overlay = document.getElementById("iniOverlay");
        if (overlay) {
          overlay.style.transition = "opacity .45s ease";
          overlay.style.opacity    = "0";
          overlay.style.pointerEvents = "none";
          setTimeout(() => overlay.remove(), 480);
        }

        if (_appReadyCb) _appReadyCb();
        return;
      }
    } catch (_) {
      // Server not reachable — fall through to retry
    }

    if (attempts < MAX_ATTEMPTS) {
      if (statusEl) statusEl.textContent = "Waiting for backend\u2026 (" + attempts + "/" + MAX_ATTEMPTS + ")";
      setTimeout(probe, RETRY_MS);
    } else {
      showError();
    }
  }

  // ── Init ───────────────────────────────────────────────────
  window.__phantomRetry = function () {
    attempts = 0; connected = false; showConnecting(); probe();
  };

  // Show connecting overlay right away, then start probing
  if (document.body) {
    injectOverlay();
    probe();
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      injectOverlay();
      probe();
    });
  }

})();