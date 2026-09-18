/* ============ Precious AI — shared helpers ============ */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- API client ----------
   Base URL: "" = same origin; set window.PA_API in config.js for split
   hosting (UI and API on different hosts). */
const PA_BASE = (window.PA_API || "").replace(/\/+$/, "");

async function api(path, opts = {}) {
  const url = PA_BASE + path;
  const sameOrigin = PA_BASE === "";
  const init = { method: opts.method || (opts.body ? "POST" : "GET"),
    headers: opts.headers || {},
    credentials: sameOrigin ? "same-origin" : "include" };
  if (opts.body && !(opts.body instanceof FormData)) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  } else if (opts.body) {
    init.body = opts.body;
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (sameOrigin) throw new Error("Network error — check your connection and try again.");
    throw new Error("Cannot reach the AI server — check that it's running and PA_API in config.js points to it.");
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

/* ---------- icons (inline SVG, feather-style, no dependencies) ---------- */
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  clip: '<path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
  pencil: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.5 15"/>',
  up: '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>',
  down: '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/>',
  brain: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
  grad: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12.5V17c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
};
function icon(name, size = 16) {
  const p = ICONS[name];
  if (!p) return "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/* ---------- theme ---------- */
function getThemePref() {
  try { return localStorage.getItem("pa-theme") || "auto"; } catch (e) { return "auto"; }
}
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}
function applyTheme(pref) {
  let t = pref;
  if (t === "auto") t = (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("pa-theme", pref); } catch (e) { /* private mode */ }
  updateThemeBtn();
}
function toggleTheme() {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
}
function updateThemeBtn() {
  const b = $("#theme-btn");
  if (!b) return;
  const dark = currentTheme() === "dark";
  b.innerHTML = icon(dark ? "sun" : "moon", 17);
  b.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}

/* ---------- conversation grouping ---------- */
function groupConvs(convs) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const t0 = Math.floor(d0.getTime() / 1000);
  const groups = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const c of convs) {
    const t = c.updated_at || c.created_at || 0;
    if (t >= t0) groups[0].items.push(c);
    else if (t >= t0 - 86400) groups[1].items.push(c);
    else if (t >= t0 - 7 * 86400) groups[2].items.push(c);
    else groups[3].items.push(c);
  }
  return groups.filter(g => g.items.length);
}

const SUGGESTIONS = [
  { t: "Ask Precious AI anything", d: "A grounded answer from your knowledge, memory, and reasoning." },
  { t: "Analyze a document", d: "Attach a PDF, DOCX, TXT or CSV and get a summary with citations." },
  { t: "Search my knowledge base", d: "Find what I have saved — with real source documents." },
  { t: "Help me plan a project", d: "Break an idea into steps, risks, and next actions." },
];

/* ---------- markdown ----------
   Escapes all HTML first, then formats a safe superset: headings,
   paragraphs (with line breaks), lists, tables, blockquotes, hr, bold,
   inline code, links, [S1] citations, and fenced code blocks with
   language label + copy button + lightweight syntax highlighting. */

let __codeStore = []; // code payloads for copy buttons, rebuilt per render

function md(text) {
  if (!text) return "";
  __codeStore = [];
  const src = String(text);
  const segs = [];
  const fenceRe = /```([\w+#-]*)[ \t]*\n?([\s\S]*?)(?:```|$)/g;
  let last = 0, m;
  while ((m = fenceRe.exec(src))) {
    if (m.index > last) segs.push({ code: false, text: src.slice(last, m.index) });
    segs.push({ code: true, lang: m[1], text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < src.length) segs.push({ code: false, text: src.slice(last) });
  return segs.map(s => (s.code ? codeBlock(s.lang, s.text) : mdBlocks(s.text))).join("");
}

function codeBlock(lang, code) {
  const l = (lang || "").toLowerCase();
  const idx = __codeStore.push(code.replace(/\n$/, "")) - 1;
  return `<div class="codeblock">` +
    `<div class="codeblock-head"><span class="lang">${esc(l || "code")}</span>` +
    `<button class="copy-code" data-ci="${idx}" aria-label="Copy code">${icon("copy", 12)} Copy</button></div>` +
    `<pre><code>${highlightCode(code.replace(/\n$/, ""), l)}</code></pre></div>`;
}

function mdBlocks(raw) {
  const lines = esc(raw).split("\n");
  const out = [];
  let i = 0;

  const inline = s => {
    let buf = s;
    const codes = [];
    buf = buf.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    buf = buf.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    buf = buf.replace(/\[S(\d+)\]/g, '<sup class="cite">S$1</sup>');
    buf = buf.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    buf = buf.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${codes[+n]}</code>`);
    return buf;
  };

  const UL = /^\s*[-*]\s+(.*)$/;
  const OL = /^\s*\d+[.)]\s+(.*)$/;
  const QT = /^\s*&gt;\s?/;
  const HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { const lv = h[1].length; out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); i++; continue; }

    if (HR.test(line)) { out.push("<hr>"); i++; continue; }

    if (QT.test(line)) {
      const q = [];
      while (i < lines.length && QT.test(lines[i])) { q.push(lines[i].replace(QT, "")); i++; }
      out.push(`<blockquote>${inline(q.join(" "))}</blockquote>`);
      continue;
    }

    // table: header row + separator row
    if (line.includes("|") && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const parseRow = r => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      const head = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(parseRow(lines[i])); i++;
      }
      out.push(`<div class="table-scroll"><table><thead><tr>` +
        head.map(c => `<th>${inline(c)}</th>`).join("") +
        `</tr></thead><tbody>` +
        rows.map(r => `<tr>` + head.map((_, ci) => `<td>${inline(r[ci] ?? "")}</td>`).join("") + `</tr>`).join("") +
        `</tbody></table></div>`);
      continue;
    }

    if (UL.test(line) || OL.test(line)) {
      const ordered = OL.test(line);
      const re = ordered ? OL : UL;
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (i < lines.length) {
        const mm = lines[i].match(re);
        if (mm) { items.push(`<li>${inline(mm[1])}</li>`); i++; }
        else if (!lines[i].trim() && i + 1 < lines.length && re.test(lines[i + 1])) { i++; }
        else break;
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() &&
      !/^#{1,3}\s/.test(lines[i]) && !UL.test(lines[i]) && !OL.test(lines[i]) &&
      !QT.test(lines[i]) && !HR.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    out.push(`<p>${inline(para.join("<br>"))}</p>`);
  }
  return out.join("");
}

/* ---------- lightweight syntax highlighting (no dependencies) ---------- */
const HL_KW = {
  js: "const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|delete|void|yield|static|null|undefined|true|false",
  py: "def|return|if|elif|else|for|while|in|not|and|or|import|from|as|class|try|except|finally|raise|with|lambda|pass|None|True|False|print|yield|global|nonlocal|assert|self",
  sh: "if|then|else|elif|fi|for|do|done|while|case|function|local|return|echo|export|cd|git|npm|pip|python|python3|sudo|docker",
  sql: "SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|INDEX|VIEW|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|ON|AS|AND|OR|NOT|NULL|PRIMARY|KEY|ORDER|BY|GROUP|LIMIT|OFFSET|COUNT|SUM|AVG|MIN|MAX|DISTINCT|UNION|HAVING|IN|BETWEEN|LIKE|ASC|DESC",
  json: "true|false|null",
  go: "func|return|if|else|for|range|var|const|type|struct|map|chan|go|defer|package|import|nil|true|false",
  rs: "fn|return|if|else|for|while|let|mut|struct|enum|impl|trait|use|mod|pub|match|move|ref|as|self|true|false",
  java: "public|private|protected|class|interface|extends|implements|return|if|else|for|while|new|this|super|import|package|void|static|final|true|false|null",
};
const HL_ALIAS = { javascript: "js", typescript: "js", jsx: "js", tsx: "js", node: "js",
  python: "py", python3: "py", py3: "py", bash: "sh", shell: "sh", zsh: "sh", dockerfile: "sh",
  scss: "css", xml: "html", htm: "html", golang: "go" };

function highlightCode(code, rawLang) {
  const lang = String(rawLang || "").toLowerCase().trim();
  const l = HL_ALIAS[lang] || lang;
  const kw = HL_KW[l];
  if (!kw && l !== "html" && l !== "css") return esc(code); // plain text, still safe

  let commentRe;
  if (l === "py" || l === "sh") commentRe = "#[^\\n]*";
  else if (l === "sql") commentRe = "--[^\\n]*";
  else if (l === "html") commentRe = "<!--[\\s\\S]*?-->";
  else if (l === "css") commentRe = "/\\*[\\s\\S]*?\\*/";
  else if (l === "json") commentRe = null;
  else commentRe = "//[^\\n]*|/\\*[\\s\\S]*?\\*/";

  const parts = [];
  if (commentRe) parts.push(`(?:${commentRe})`);
  parts.push(`(?:"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`" + `)`);
  if (l === "css") parts.push("(?:#[0-9a-fA-F]{3,8}\\b|[-\\w]+(?=\\s*:))");
  if (l === "html") parts.push("(?:</?[a-zA-Z][\\w-]*|/?>)");
  parts.push("(?:\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b)");
  if (l !== "html" && l !== "css") parts.push(`(?:\\b(?:${kw})\\b)`);
  const master = new RegExp(parts.join("|"), "gm");

  let out = "", last = 0, m;
  while ((m = master.exec(code))) {
    out += esc(code.slice(last, m.index));
    const t = m[0];
    let cls;
    if (commentRe && new RegExp(`^${commentRe}`).test(t)) cls = "com";
    else if (/^["'`]/.test(t)) cls = "str";
    else if (l === "html" && /^<\/?[a-zA-Z]|^\/?>$/.test(t)) cls = "tag";
    else if (/^\d/.test(t)) cls = "num";
    else if (l === "css" && /^[-\w]+$/.test(t)) cls = "attr";
    else cls = "kw";
    out += `<span class="tk-${cls}">${esc(t)}</span>`;
    last = m.index + t.length;
    if (t.length === 0) master.lastIndex++;
  }
  out += esc(code.slice(last));
  return out;
}

/* delegated copy for code blocks + message copy buttons */
document.addEventListener("click", e => {
  const b = e.target.closest(".copy-code");
  if (b) {
    copyText(__codeStore[+b.dataset.ci] ?? "");
    const old = b.innerHTML;
    b.innerHTML = `${icon("check", 12)} Copied`;
    setTimeout(() => { b.innerHTML = old; }, 1400);
  }
});

/* ---------- UI helpers ---------- */
function toast(msg, type = "") {
  const wrap = $("#toasts");
  if (!wrap) return;
  while (wrap.children.length >= 3) wrap.firstChild.remove();
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.setAttribute("role", "status");
  t.textContent = msg;
  wrap.appendChild(t);
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
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", title);
    if (wide) box.style.maxWidth = "720px";
    const h = document.createElement("h3");
    h.textContent = title;
    box.appendChild(h);
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
      // `value` falls back to the button label so callers can `if (val === "Save")`
      b.onclick = () => { if (a.onClick && a.onClick(box, b) === false) return; close(a.value !== undefined ? a.value : a.label); };
      acts.appendChild(b);
    });
    box.appendChild(acts);
    back.appendChild(box);
    back.addEventListener("click", e => { if (e.target === back) close("cancel"); });
    const onKey = e => { if (e.key === "Escape") { document.removeEventListener("keydown", onKey); close("cancel"); } };
    document.addEventListener("keydown", onKey);
    function close(v) {
      document.removeEventListener("keydown", onKey);
      resolve(v);
      // remove on next tick so `await modal()` callers can still read field values
      setTimeout(() => { if (back.isConnected) root.innerHTML = ""; }, 0);
    }
    root.appendChild(back);
    const first = box.querySelector("input, textarea, select");
    if (first) setTimeout(() => first.focus(), 60);
  });
}

async function confirmModal(message, { danger = false, confirmLabel = "Confirm", requireType = null } = {}) {
  const body = document.createElement("div");
  body.innerHTML = `<p class="muted" style="margin-bottom:12px;line-height:1.55">${esc(message)}</p>`;
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
        onClick: () => {
          if (requireType && inputEl.value.trim() !== requireType) {
            toast("Confirmation text does not match.", "err");
            return false;
          }
        } },
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

const SUPPORTED_EXT = /\.(pdf|docx|txt|md|markdown|csv)$/i;

function fmtBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
  } catch (e) {
    try { // fallback for contexts without clipboard permission
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    } catch (e2) { /* nothing else to do */ }
  }
  toast("Copied to clipboard.", "ok");
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
