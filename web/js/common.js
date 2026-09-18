/* ============ Precious AI — shared helpers ============ */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body ? "POST" : "GET"),
    headers: opts.headers || {}, credentials: "same-origin" };
  if (opts.body && !(opts.body instanceof FormData)) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  } else if (opts.body) {
    init.body = opts.body;
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new Error("Network error — check your connection and try again.");
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json */ }
  if (!res.ok) {
    const msg = (data && (data.error || data.detail)) || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Markdown-lite renderer: escapes HTML first, then formats a safe subset. */
function md(text) {
  if (!text) return "";
  let src = esc(text);
  // code blocks
  src = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
  // inline code
  src = src.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // citations [S1]
  src = src.replace(/\[S(\d+)\]/g, '<sup class="cite">S$1</sup>');
  // bold
  src = src.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // links (no javascript:)
  src = src.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // headings
  src = src.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  src = src.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  src = src.replace(/^# (.*)$/gm, "<h1>$1</h1>");
  // block split
  const blocks = src.split(/\n{2,}/);
  src = blocks.map(b => {
    b = b.trim();
    if (!b) return "";
    if (b.startsWith("<pre>")) return b;
    if (b.startsWith("<h")) return b;
    const lines = b.split("\n");
    const isUl = lines.every(l => /^\s*[-*] /.test(l));
    const isOl = lines.every(l => /^\s*\d+[.)] /.test(l));
    if (isUl) return "<ul>" + lines.map(l => "<li>" + l.replace(/^\s*[-*] /, "") + "</li>").join("") + "</ul>";
    if (isOl) return "<ol>" + lines.map(l => "<li>" + l.replace(/^\s*\d+[.)] /, "") + "</li>").join("") + "</ol>";
    return "<p>" + b.replace(/\n/g, "<br>") + "</p>";
  }).join("");
  return src;
}

function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 3400);
  setTimeout(() => t.remove(), 3800);
}

function modal({ title, body, actions, wide = false }) {
  return new Promise(resolve => {
    const root = $("#modal-root");
    root.innerHTML = "";
    const back = document.createElement("div");
    back.className = "modal-backdrop";
    const box = document.createElement("div");
    box.className = "modal";
    if (wide) box.style.maxWidth = "720px";
    box.innerHTML = `<h3>${esc(title)}</h3>`;
    const bodyBox = document.createElement("div");
    if (typeof body === "string") bodyBox.innerHTML = body;
    else bodyBox.appendChild(body);
    box.appendChild(bodyBox);
    const acts = document.createElement("div");
    acts.className = "actions";
    (actions || []).forEach(a => {
      const b = document.createElement("button");
      b.className = `btn ${a.cls || ""}`;
      b.textContent = a.label;
      b.onclick = () => { if (a.onClick && a.onClick(box, b) === false) return; close(a.value); };
      acts.appendChild(b);
    });
    box.appendChild(acts);
    back.appendChild(box);
    back.addEventListener("click", e => { if (e.target === back) close("cancel"); });
    function close(v) { root.innerHTML = ""; resolve(v); }
    root.appendChild(back);
    const first = box.querySelector("input, textarea");
    if (first) setTimeout(() => first.focus(), 60);
  });
}

async function confirmModal(message, { danger = false, confirmLabel = "Confirm", requireType = null } = {}) {
  const body = document.createElement("div");
  body.innerHTML = `<p class="small muted" style="margin-bottom:12px">${esc(message)}</p>`;
  let inputEl = null;
  if (requireType) {
    const w = document.createElement("label");
    w.className = "field";
    w.innerHTML = `<span>Type <b>${esc(requireType)}</b> to confirm</span>`;
    const inp = document.createElement("input");
    inp.type = "text";
    w.appendChild(inp);
    body.appendChild(w);
    inputEl = inp;
  }
  const val = await modal({
    title: "Please confirm", body,
    actions: [
      { label: "Cancel", value: "cancel" },
      { label: confirmLabel, value: confirmLabel, cls: danger ? "btn-danger" : "btn-primary",
        onClick: () => { if (requireType && inputEl.value.trim() !== requireType) { toast("Confirmation text does not match.", "err"); return false; } } },
    ],
  });
  return val === confirmLabel ? confirmLabel : null;
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return fmtTime(ts);
}

function fmtBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

function copyText(t) {
  navigator.clipboard.writeText(t).then(() => toast("Copied to clipboard.", "ok"))
    .catch(() => toast("Could not copy.", "err"));
}

function download(filename, text, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const CATS = ["Personal", "Projects", "Education", "Career", "AI", "Data Analytics",
  "Blockchain/Web3", "Business", "Technical Documentation", "FAQs", "General Knowledge"];
const KINDS = ["preference", "fact", "terminology", "workflow", "business_rule", "format"];

function catSelect(sel, value = "General Knowledge") {
  return `<select id="${sel}">${CATS.map(c => `<option ${c === value ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
}
function kindSelect(sel, value = "fact") {
  return `<select id="${sel}">${KINDS.map(k => `<option ${k === value ? "selected" : ""}>${k}</option>`).join("")}</select>`;
}
