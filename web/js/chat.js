/* ============ Chat view — conversational experience ============ */
"use strict";

const Chat = {
  current: null,
  convs: [],
  files: [],
  busy: false,
  search: "",
  atBottom: true,
  stage: null,
  col: null,
  msgsEl: null,
  input: null,

  init(root) {
    if (this.mounted && this.stage && root.contains(this.stage)) return; // keep state
    const prev = this.current; // preserve conversation across view switches
    this.current = null;
    this.files = [];
    this.busy = false;
    this.atBottom = true;

    root.innerHTML = `
      <div class="chat-stage" id="chat-stage">
        <div class="messages" id="messages" role="log" aria-live="polite" aria-label="Conversation">
          <div class="msg-col" id="msg-col"></div>
          <button class="jump-latest" id="jump-latest" aria-label="Jump to latest message">
            ${icon("chevron", 14)} Jump to latest
          </button>
        </div>
        <div class="composer">
          <div class="composer-shell">
            <div class="attach-row" id="attach-row"></div>
            <div class="composer-box">
              <button class="comp-btn" id="attach-btn" title="Attach files (PDF, DOCX, TXT, MD, CSV)"
                      aria-label="Attach files">${icon("clip", 18)}</button>
              <textarea id="chat-input" rows="1" placeholder="Message Precious AI…"
                        aria-label="Message Precious AI" enterkeyhint="send"></textarea>
              <button class="send-btn" id="send-btn" title="Send" aria-label="Send message"
                      disabled>${icon("send", 16)}</button>
            </div>
            <input type="file" id="file-input" multiple class="hidden"
                   accept=".pdf,.txt,.md,.markdown,.csv,.docx">
          </div>
          <div class="composer-hint">Precious AI can make mistakes. Verify important information.</div>
        </div>
      </div>`;

    this.stage = $("#chat-stage");
    this.msgsEl = $("#messages");
    this.col = $("#msg-col");
    this.input = $("#chat-input");
    this.mounted = true;

    // ---- composer behavior ----
    const sendBtn = $("#send-btn");
    this.input.addEventListener("input", () => {
      this.autoGrow();
      this.setSendState();
    });
    this.input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.send();
      }
    });
    sendBtn.onclick = () => this.send();
    $("#attach-btn").onclick = () => $("#file-input").click();
    $("#file-input").onchange = e => {
      this.addFiles([...e.target.files]);
      e.target.value = "";
    };

    // ---- drag & drop (desktop) ----
    let dragDepth = 0;
    this.stage.addEventListener("dragenter", e => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) {
        e.preventDefault();
        dragDepth++;
        this.stage.classList.add("dragover");
      }
    });
    this.stage.addEventListener("dragover", e => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault();
    });
    this.stage.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) this.stage.classList.remove("dragover");
    });
    this.stage.addEventListener("drop", e => {
      dragDepth = 0;
      this.stage.classList.remove("dragover");
      if (e.dataTransfer && e.dataTransfer.files.length) {
        e.preventDefault();
        this.addFiles([...e.dataTransfer.files]);
      }
    });

    // ---- scroll behavior ----
    this.msgsEl.addEventListener("scroll", () => {
      this.atBottom = this.isNearBottom();
      $("#jump-latest").classList.toggle("show", !this.atBottom);
    });
    $("#jump-latest").onclick = () => this.scrollToBottom(true);

    this.loadConvs();
  },

  /* ---------- helpers ---------- */

  autoGrow() {
    this.input.style.height = "auto";
    this.input.style.height = Math.min(this.input.scrollHeight, 190) + "px";
  },

  setSendState() {
    const btn = $("#send-btn");
    if (!btn) return;
    const empty = !this.input.value.trim() && !this.files.length;
    if (this.busy) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" aria-hidden="true"></span>';
    } else {
      btn.disabled = empty;
      btn.innerHTML = icon("send", 16);
    }
  },

  addFiles(fileList) {
    for (const f of fileList) {
      if (this.files.length >= 5) { toast("Maximum 5 files at a time.", "err"); break; }
      if (f.size > 25 * 1024 * 1024) { toast(`'${f.name}' is larger than 25 MB.`, "err"); continue; }
      if (!SUPPORTED_EXT.test(f.name)) {
        toast(`'${f.name}' isn't supported. Upload PDF, DOCX, TXT, MD or CSV files.`, "err");
        continue;
      }
      this.files.push(f);
    }
    this.renderAttachments();
    this.setSendState();
    this.input.focus();
  },

  renderAttachments() {
    const row = $("#attach-row");
    if (!row) return;
    row.innerHTML = "";
    this.files.forEach((f, i) => {
      const el = document.createElement("span");
      el.className = "attach";
      el.innerHTML = `${icon("doc", 13)} <span class="nm">${esc(f.name)}</span>
        <b>${fmtBytes(f.size)}</b>
        <button data-i="${i}" aria-label="Remove ${esc(f.name)}">${icon("x", 11)}</button>`;
      el.querySelector("button").onclick = () => {
        this.files.splice(i, 1);
        this.renderAttachments();
        this.setSendState();
      };
      row.appendChild(el);
    });
  },

  isNearBottom() {
    return this.msgsEl.scrollHeight - this.msgsEl.scrollTop - this.msgsEl.clientHeight < 90;
  },

  scrollToBottom(smooth = false) {
    this.msgsEl.scrollTo({ top: this.msgsEl.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  },

  maybeScroll(force = false) {
    if (force || this.isNearBottom()) this.scrollToBottom(true);
  },

  /* ---------- conversations ---------- */

  async loadConvs(preferId) {
    try {
      this.convs = await api("/api/conversations");
    } catch (e) {
      this.convs = [];
      toast(e.message, "err");
      return;
    }
    if (this.current && !this.convs.some(c => c.id === this.current)) this.current = null;
    Sidebar.refresh();
    if (this.current) {
      const c = this.convs.find(x => x.id === this.current);
      if (c && c.title && window.App) App.setTitle(c.title);
    }
    if (!this.current && preferId && this.convs.some(c => c.id === preferId)) {
      this.selectConv(preferId, true);
    } else if (!this.current && this.convs.length) {
      this.selectConv(this.convs[0].id, true);
    } else if (!this.current) {
      this.newChat(true);
    }
  },

  async newChat(silent) {
    let conv;
    try {
      conv = await api("/api/conversations", { body: {} });
    } catch (e) {
      if (!silent) toast(e.message, "err");
      return;
    }
    this.convs.unshift(conv);
    this.selectConv(conv.id, true);
    if (this.col) history.replaceState(null, "", "#/chat/" + conv.id); // keep hash in sync, no re-route
  },

  async selectConv(id, noScroll) {
    if (!this.col || !this.col.isConnected) return; // chat view not mounted
    this.current = id;
    Sidebar.refresh();
    const conv = this.convs.find(c => c.id === id);
    App.setTitle(conv ? conv.title : "Chat");

    this.col.innerHTML = `<div class="small faint" style="padding:26px 6px">Loading…</div>`;
    try {
      const data = await api(`/api/conversations/${id}`);
      const msgs = await api(`/api/conversations/${id}/messages`);
      this.col.innerHTML = "";
      App.setTitle(data.title);
      const desktop = window.matchMedia && matchMedia("(min-width: 900px)").matches;
      if (!msgs.length) {
        const fresh = (data.title || "") === "New conversation";
        this.col.appendChild(this.emptyStateEl(fresh ? null : data.title));
        if (desktop) this.input.focus();
        return;
      }
      for (const m of msgs) this.col.appendChild(this.renderMessage(m));
      this.markLastRegenerable();
      this.scrollToBottom();
      this.atBottom = true;
      $("#jump-latest").classList.remove("show");
      if (desktop) this.input.focus();
    } catch (e) {
      this.col.innerHTML = `<div class="msg-error-card" style="max-width:780px;margin:20px auto">
        ${esc(e.message)}</div>`;
    }
  },

  emptyStateEl(convoTitle) {
    const wrap = document.createElement("div");
    wrap.className = "empty-state";
    wrap.innerHTML = `
      <div class="logo">✦</div>
      <h2>${convoTitle ? esc(convoTitle) : "Precious AI"}</h2>
      <div class="sub">${convoTitle ? "Ask a question or attach a document to get started." : "How can I help you today?"}</div>
      ${convoTitle ? "" : `
      <div class="suggest-grid" role="list">
        ${SUGGESTIONS.map(s => `
          <button class="suggest" role="listitem" data-sugg="${esc(s.t)}">
            <b>${esc(s.t)}</b>${esc(s.d)}
          </button>`).join("")}
      </div>`}`;
    wrap.querySelectorAll("[data-sugg]").forEach(b => {
      b.onclick = () => {
        this.input.value = b.dataset.sugg;
        this.autoGrow();
        this.setSendState();
        this.input.focus();
      };
    });
    return wrap;
  },

  /* ---------- message rendering ---------- */

  renderMessage(m) {
    const wrap = document.createElement("div");
    wrap.dataset.id = m.id;
    const isUser = m.role === "user";

    if (isUser) {
      wrap.className = "msg user";
      wrap.innerHTML = `
        <div class="msg-body">
          ${m.training ? `<div class="train-pill" style="margin-bottom:6px">Training</div>` : ""}
          <div class="msg-text">${esc(m.content)}</div>
        </div>`;
      return wrap;
    }

    wrap.className = "msg ai";
    let extra = "";
    if (m.steps && m.steps.length) {
      extra += `<div class="msg-steps">${m.steps.map(s => `<span>${esc(s)}</span>`).join("")}</div>`;
    }
    if (m.sources && m.sources.length) {
      extra += `<div class="msg-sources">` + m.sources.map(s =>
        `<span class="src-chip" title="relevance ${(s.score * 100).toFixed(0)}%">
          ${icon("doc", 12)} <b>${esc(s.doc_name)}</b>${s.page ? ` · p.${s.page}` : ""}${s.section ? ` · ${esc(s.section)}` : ""}
        </span>`).join("") + `</div>`;
    }
    if (m.error) {
      extra += `<div class="msg-error-card">Something went wrong while processing this request.
        <span class="small" style="opacity:.75"> · ${esc(m.error)}</span></div>`;
    }
    const time = m.created_at ? `<span title="${fullTime(m.created_at)}">${timeAgo(m.created_at)}</span>` : "";
    const meta = [time, m.model ? esc(m.model) : "",
      m.tokens_out ? `${m.tokens_out} tokens` : ""].filter(Boolean).join(" · ");

    wrap.innerHTML = `
      <div class="avatar" aria-hidden="true">✦</div>
      <div class="msg-body">
        ${m.error ? "" : `<div class="msg-text">${md(m.content)}</div>`}
        ${extra}
        ${meta ? `<div class="msg-meta"><span>${meta}</span></div>` : ""}
        <div class="msg-actions">
          <button data-mact="copy" aria-label="Copy response">${icon("copy", 12)} Copy</button>
          <button data-mact="regen" style="display:none" aria-label="Regenerate response">${icon("refresh", 12)} Regenerate</button>
          <button data-mact="up" aria-label="Mark as helpful">${icon("up", 12)} Helpful</button>
          <button data-mact="down" aria-label="Mark as not helpful">${icon("down", 12)} Not helpful</button>
        </div>
      </div>`;

    wrap.querySelector(".msg-actions").addEventListener("click", e => {
      const b = e.target.closest("[data-mact]");
      if (!b) return;
      const act = b.dataset.mact;
      if (act === "copy") copyText(m.content);
      else if (act === "up") this.sendFeedback(m, "up");
      else if (act === "down") this.sendFeedback(m, "down");
      else if (act === "regen") this.regenerate(m);
    });
    return wrap;
  },

  markLastRegenerable() {
    const btns = $$("#msg-col .msg.ai [data-mact=regen]");
    btns.forEach(b => b.style.display = "none");
    const last = btns[btns.length - 1];
    if (last) last.style.display = "";
  },

  thinkingEl(label = "Thinking…") {
    const el = document.createElement("div");
    el.className = "msg ai";
    el.dataset.pending = "1";
    el.innerHTML = `
      <div class="avatar" aria-hidden="true">✦</div>
      <div class="msg-body">
        <div class="thinking">
          <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="lbl">${esc(label)}</span>
        </div>
      </div>`;
    return el;
  },

  /* ---------- send / regenerate / retry ---------- */

  async send() {
    if (this.busy) return;
    const text = this.input.value.trim();
    if (!text && !this.files.length) return;
    if (!this.current) await this.newChat(true);
    const convId = this.current;
    const conv = this.convs.find(c => c.id === convId);
    const isTraining = this.files.length === 0 && (conv && (conv.title || "").startsWith("🎓"));

    // optimistic user message
    const es = this.col.querySelector(".empty-state");
    if (es) es.remove();
    this.col.appendChild(this.renderMessage({
      id: "tmp-" + Date.now(), role: "user",
      content: text || this.files.map(f => `${f.name} (attached)`).join("\n"),
      training: isTraining, created_at: Math.floor(Date.now() / 1000),
    }));
    this.input.value = "";
    this.autoGrow();
    this.renderAttachmentsKeep = this.files.slice();
    this.files = [];
    this.renderAttachments();
    this.setSendState();
    this.scrollToBottom(true);
    this.atBottom = true;

    const wasNearBottom = true;
    const pending = this.thinkingEl("Thinking…");
    this.col.appendChild(pending);
    this.busy = true;
    this.setSendState();
    const started = Date.now();
    const lbl = pending.querySelector(".lbl");
    const tick = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      if (s >= 4) lbl.textContent = `Thinking… ${s}s`;
    }, 1000);

    const fd = new FormData();
    fd.append("content", text);
    fd.append("training", isTraining ? "true" : "false");
    this.renderAttachmentsKeep.forEach(f => fd.append("files", f));
    this.renderAttachmentsKeep = null;

    try {
      const r = await api(`/api/conversations/${convId}/messages`, { body: fd });
      clearInterval(tick);
      pending.remove();
      const el = this.renderMessage({ ...r, id: r.message_id, role: "assistant",
        training: isTraining, created_at: Math.floor(Date.now() / 1000) });
      this.col.appendChild(el);
      if (r.suggestion) this.addSuggestion(el, r.suggestion);
      this.markLastRegenerable();
      this.maybeScroll(wasNearBottom);
      this.loadConvs(); // sidebar titles / ordering (title auto-generated server-side)
    } catch (e) {
      clearInterval(tick);
      pending.remove();
      this.col.appendChild(this.errorEl(convId, e.message));
      this.maybeScroll(true);
    }
    this.busy = false;
    this.setSendState();
    this.input.focus();
  },

  errorEl(convId, detail) {
    const box = document.createElement("div");
    box.className = "msg ai";
    box.innerHTML = `
      <div class="avatar" aria-hidden="true">✦</div>
      <div class="msg-body">
        <div class="msg-error-card">
          Something went wrong while processing your request.
          <div class="row"><button class="btn btn-sm" data-retry>${icon("refresh", 12)} Try again</button></div>
        </div>
      </div>`;
    box.querySelector("[data-retry]").onclick = async () => {
      const b = box.querySelector("[data-retry]");
      b.disabled = true;
      const p = this.thinkingEl("Trying again…");
      this.col.appendChild(p);
      this.scrollToBottom(true);
      try {
        const r = await api(`/api/conversations/${convId}/retry`, { body: {} });
        p.remove();
        const el = this.renderMessage({ ...r, id: r.message_id, role: "assistant",
          created_at: Math.floor(Date.now() / 1000) });
        this.col.appendChild(el);
        if (r.suggestion) this.addSuggestion(el, r.suggestion);
        this.markLastRegenerable();
        this.scrollToBottom(true);
      } catch (e2) {
        p.remove();
        const card = box.querySelector(".msg-error-card");
        card.innerHTML = `Something went wrong while processing your request.
          <span class="small" style="opacity:.75"> · ${esc(e2.message)}</span>
          <div class="row"><button class="btn btn-sm" data-retry2>${icon("refresh", 12)} Try again</button></div>`;
        card.querySelector("[data-retry2]").onclick = box.querySelector("[data-retry]").onclick;
      }
    };
    return box;
  },

  async regenerate(m) {
    const pending = this.thinkingEl("Regenerating…");
    this.col.appendChild(pending);
    this.scrollToBottom(true);
    try {
      const r = await api(`/api/messages/${m.id}/regenerate`, { body: {} });
      pending.remove();
      const el = this.renderMessage({ ...r, id: r.message_id, role: "assistant",
        created_at: Math.floor(Date.now() / 1000) });
      const oldEl = this.col.querySelector(`.msg[data-id="${m.id}"]`);
      if (oldEl) oldEl.replaceWith(el); else this.col.appendChild(el);
      if (r.suggestion) this.addSuggestion(el, r.suggestion);
      this.markLastRegenerable();
      this.scrollToBottom(true);
    } catch (e) {
      pending.remove();
      toast(e.message, "err");
      this.selectConv(this.current);
    }
  },

  addSuggestion(msgEl, sug) {
    const div = document.createElement("div");
    div.className = "suggestion-chip";
    div.innerHTML = `
      <div class="q">Suggested memory — not saved yet</div>
      <div class="txt">“${esc(sug.content)}”</div>
      <div class="row">
        <button class="btn btn-sm btn-primary" data-s="approve">Save to long-term memory</button>
        <button class="btn btn-sm" data-s="reject">Dismiss</button>
      </div>`;
    div.querySelector('[data-s=approve]').onclick = async () => {
      try {
        await api(`/api/memories/suggestions/${sug.id}/approve`, { body: {} });
        div.innerHTML = `<div class="q" style="color:var(--ok)">${icon("check", 12)} Saved to long-term memory</div>`;
        toast("Memory saved. I'll use it in all future conversations.", "ok");
      } catch (e) { toast(e.message, "err"); }
    };
    div.querySelector('[data-s=reject]').onclick = async () => {
      try {
        await api(`/api/memories/suggestions/${sug.id}/reject`, { body: {} });
        div.remove();
      } catch (e) { toast(e.message, "err"); }
    };
    msgEl.querySelector(".msg-body").appendChild(div);
  },

  async sendFeedback(m, rating) {
    let note = "", corrected = "";
    if (rating !== "up") {
      const body = document.createElement("div");
      body.innerHTML = `
        <label class="field"><span>What was wrong? (optional)</span>
          <textarea id="fb-note" placeholder="e.g. the number was outdated"></textarea></label>
        <label class="field"><span>The correct answer (optional — helps me learn)</span>
          <textarea id="fb-correct"></textarea></label>`;
      await modal({ title: rating === "down" ? "Not helpful" : "Report an issue", body,
        actions: [{ label: "Cancel" }, { label: "Submit", cls: "btn-primary", onClick: () => {
          note = $("#fb-note").value; corrected = $("#fb-correct").value;
        }}] });
    }
    try {
      await api(`/api/messages/${m.id}/feedback`, { body: { rating, note, corrected_answer: corrected } });
      toast(rating === "up" ? "Thanks for the feedback!" : "Thanks — I'll review this in Admin → Feedback.", "ok");
      const msgEl = $(`#msg-col .msg[data-id="${m.id}"]`);
      if (msgEl) {
        $$(".msg-actions button", msgEl).forEach(b => b.classList.remove("on"));
        const target = msgEl.querySelector(`.msg-actions [data-mact="${rating}"]`);
        if (target) target.classList.add("on");
      }
    } catch (e) { toast(e.message, "err"); }
  },

  /* ---------- conversation management ---------- */

  async renameConv(id) {
    const conv = this.convs.find(c => c.id === id);
    const body = document.createElement("div");
    body.innerHTML = `<label class="field"><span>Conversation title</span>
      <input id="cnv-title" type="text" maxlength="120" value="${esc(conv ? conv.title : "")}"></label>`;
    let title = "";
    const val = await modal({ title: "Rename conversation", body,
      actions: [{ label: "Cancel" }, { label: "Save", cls: "btn-primary",
        onClick: () => { title = $("#cnv-title").value.trim(); } }] });
    if (val === "Save" && title) {
      try {
        await api(`/api/conversations/${id}`, { method: "PATCH", body: { title } });
        await this.loadConvs();
        toast("Renamed.", "ok");
      } catch (e) { toast(e.message, "err"); }
    }
  },

  async clearConv(id) {
    const ok = await confirmModal("Clear all messages in this conversation? The conversation and its title are kept.",
      { danger: true, confirmLabel: "Clear" });
    if (!ok) return;
    try {
      await api(`/api/conversations/${id}/clear`, { body: {} });
      if (this.current === id) this.selectConv(id);
      await this.loadConvs();
      toast("Conversation cleared.", "ok");
    } catch (e) { toast(e.message, "err"); }
  },

  async deleteConv(id) {
    const ok = await confirmModal("Delete this conversation and all its messages? This cannot be undone.",
      { danger: true, confirmLabel: "Delete" });
    if (!ok) return;
    try {
      await api(`/api/conversations/${id}`, { method: "DELETE" });
      this.convs = this.convs.filter(c => c.id !== id);
      if (this.current === id) {
        this.current = null;
        if (this.convs.length) this.selectConv(this.convs[0].id);
        else this.newChat();
      }
      Sidebar.refresh();
      toast("Conversation deleted.", "ok");
    } catch (e) { toast(e.message, "err"); }
  }
};
