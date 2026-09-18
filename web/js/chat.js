/* ============ Chat view ============ */
"use strict";

const Chat = {
  current: null,
  convs: [],
  files: [],
  busy: false,
  search: "",

  init(root) {
    this.current = null;
    this.files = [];
    this.busy = false;
    root.innerHTML = `
      <div class="chat-wrap">
        <div class="conv-pane" id="conv-pane"></div>
        <div class="chat-main">
          <div class="messages empty-state" id="messages">
            <div class="big">✦</div>
            <div><b>Precious AI</b> is ready.</div>
            <div class="small">Ask me anything, attach a document, or teach me something in Learn.</div>
          </div>
          <div class="composer">
            <div class="attach-row" id="attach-row"></div>
            <div class="composer-row">
              <input type="file" id="file-input" multiple class="hidden"
                accept=".pdf,.txt,.md,.markdown,.csv,.docx">
              <div class="composer-box">
                <button class="icon-btn" id="attach-btn" title="Attach files (PDF, DOCX, TXT, MD, CSV)">📎</button>
                <textarea id="chat-input" rows="1" placeholder="Message Precious AI…"></textarea>
              </div>
              <button class="send-btn" id="send-btn" title="Send">➤</button>
            </div>
            <div class="small faint" style="margin-top:6px;text-align:center">Precious AI can make mistakes. Verify important information.</div>
          </div>
        </div>
      </div>
      <div class="conv-backdrop" id="conv-backdrop"></div>
      <div class="drawer" id="conv-drawer"></div>`;

    const drawerHtml = () => this._convListHtml(true);
    $("#conv-pane", root).innerHTML = this._convListHtml(false);
    $("#conv-drawer", root).innerHTML = this._convListHtml(true);

    // conversation list actions (both panes)
    for (const pane of [$("#conv-pane", root), $("#conv-drawer", root)]) {
      this._wireConvList(pane, root);
    }
    $("#burger", document).onclick = () => this.toggleDrawer();
    $("#conv-backdrop", root).onclick = () => this.toggleDrawer(false);

    // composer
    const input = $("#chat-input", root);
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.send(); }
    });
    $("#send-btn", root).onclick = () => this.send();
    $("#attach-btn", root).onclick = () => $("#file-input", root).click();
    $("#file-input", root).onchange = async e => {
      for (const f of e.target.files) {
        if (this.files.length >= 5) { toast("Maximum 5 files at a time.", "err"); break; }
        if (f.size > 25 * 1024 * 1024) { toast(`'${f.name}' is larger than 25 MB.`, "err"); continue; }
        this.files.push(f);
      }
      e.target.value = "";
      this.renderAttachments();
    };
    this.loadConvs();
  },

  _convListHtml(isDrawer) {
    return `
      <div class="conv-head">
        <button class="btn btn-primary btn-block" data-act="new">＋ New conversation</button>
        <input id="conv-search" type="search" placeholder="Search conversations…" class="small" style="width:100%;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:8px 10px">
      </div>
      <div class="conv-list" data-convlist>
        <div class="small faint" style="padding:12px">Loading…</div>
      </div>`;
  },

  _wireConvList(pane, root) {
    const list = $("[data-convlist]", pane);
    pane.addEventListener("click", e => {
      const btn = e.target.closest("[data-act]");
      if (btn) {
        if (btn.dataset.act === "new") { this.newChat(); return; }
        const cid = btn.dataset.id;
        if (btn.dataset.act === "rename") { this.renameConv(cid); return; }
        if (btn.dataset.act === "clear") { this.clearConv(cid); return; }
        if (btn.dataset.act === "delete") { this.deleteConv(cid); return; }
        return;
      }
      const item = e.target.closest(".conv-item");
      if (item) {
        this.selectConv(item.dataset.id);
        if (item.closest(".drawer")) this.toggleDrawer(false);
      }
    });
    const search = $("#conv-search", pane);
    if (search) search.addEventListener("input", () => {
      this.search = search.value.trim();
      this.refreshConvList();
    });
  },

  async loadConvs() {
    try {
      this.convs = await api("/api/conversations");
    } catch (e) {
      this.convs = [];
      toast(e.message, "err");
      return;
    }
    this.refreshConvList();
    if (!this.current && this.convs.length) {
      this.selectConv(this.convs[0].id, true);
    } else if (!this.current) {
      this.newChat(true);
    }
  },

  refreshConvList() {
    const q = this.search.toLowerCase();
    const rows = q
      ? this.convs.filter(c => (c.title || "").toLowerCase().includes(q) || (c.last_content || "").toLowerCase().includes(q))
      : this.convs;
    for (const pane of $$(".conv-pane, .drawer")) {
      const list = $("[data-convlist]", pane);
      if (!list) continue;
      list.innerHTML = rows.length ? "" : `<div class="small faint" style="padding:12px">No conversations found.</div>`;
      for (const c of rows) {
        const el = document.createElement("div");
        el.className = "conv-item" + (c.id === this.current ? " active" : "");
        el.dataset.id = c.id;
        el.innerHTML = `
          <div class="t">${esc(c.title || "New conversation")}</div>
          <div class="s">${esc(c.last_content || "—")} · ${timeAgo(c.updated_at)}</div>
          <div class="row" style="margin-top:6px;display:none" data-actions>
            <button class="btn btn-ghost btn-sm" data-act="rename" data-id="${c.id}">Rename</button>
            <button class="btn btn-ghost btn-sm" data-act="clear" data-id="${c.id}">Clear</button>
            <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${c.id}" style="color:var(--err)">Delete</button>
          </div>`;
        el.addEventListener("mouseenter", () => { $("[data-actions]", el).style.display = "flex"; });
        list.appendChild(el);
      }
    }
  },

  async newChat(silent) {
    let conv;
    try {
      conv = await api("/api/conversations", { body: {} });
    } catch (e) { if (!silent) toast(e.message, "err"); return; }
    this.convs.unshift(conv);
    this.selectConv(conv.id, true);
  },

  async selectConv(id, noScroll) {
    this.current = id;
    this.refreshConvList();
    const msgsEl = $("#messages");
    msgsEl.classList.remove("empty-state");
    msgsEl.innerHTML = `<div class="small faint" style="padding:20px">Loading…</div>`;
    try {
      const data = await api(`/api/conversations/${id}`);
      const msgs = await api(`/api/conversations/${id}/messages`);
      msgsEl.innerHTML = "";
      if (!msgs.length) {
        msgsEl.classList.add("empty-state");
        msgsEl.innerHTML = `<div class="big">✦</div><div><b>${esc(data.title)}</b></div>
          <div class="small">Ask a question or attach a document to get started.</div>`;
        return;
      }
      for (const m of msgs) msgsEl.appendChild(this.renderMessage(m));
      this.markLastRegenerable();
      if (!noScroll) msgsEl.scrollTop = msgsEl.scrollHeight;
    } catch (e) {
      msgsEl.innerHTML = `<div class="msg-error-card" style="margin:20px">${esc(e.message)}</div>`;
    }
  },

  renderMessage(m) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${m.role === "user" ? "user" : "ai"}`;
    wrap.dataset.id = m.id;
    const isUser = m.role === "user";
    let extra = "";
    if (isUser) {
      if (m.training) extra = `<div class="train-pill" style="margin-bottom:6px">🎓 training</div>`;
    } else {
      if (m.steps && m.steps.length) {
        extra += `<div class="msg-steps">${m.steps.map(s => `<span>⚡ ${esc(s)}</span>`).join("")}</div>`;
      }
      if (m.sources && m.sources.length) {
        extra += `<div class="msg-sources">` + m.sources.map(s =>
          `<span class="src-chip" title="relevance ${(s.score * 100).toFixed(0)}%">📄 <b>${esc(s.doc_name)}</b>${s.page ? ` · p.${s.page}` : ""}${s.section ? ` · ${esc(s.section)}` : ""}</span>`
        ).join("") + `</div>`;
      }
      if (m.error) {
        extra += `<div class="msg-error-card">${esc(m.error)}</div>`;
      }
    }
    const actions = isUser ? "" : `
      <div class="msg-actions">
        <button data-mact="copy">⧉ Copy</button>
        <button data-mact="up" class="fb-up">👍 Helpful</button>
        <button data-mact="down" class="fb-down">👎 Not helpful</button>
        <button data-mact="issue">⚠ Report</button>
        <button data-mact="regen" style="display:none">↻ Regenerate</button>
      </div>`;
    wrap.innerHTML = `
      <div class="avatar">${isUser ? "You" : "✦"}</div>
      <div class="msg-body">
        <div class="msg-text">${md(m.content)}</div>
        ${extra}
        <div class="msg-meta"><span>${timeAgo(m.created_at)}</span>${m.model ? `<span>${esc(m.model)}</span>` : ""}${m.tokens_out ? `<span>${m.tokens_out} tok out</span>` : ""}</div>
        ${actions}
      </div>`;
    if (!isUser) {
      wrap.querySelector('[data-mact="regen"]').style.display = "none"; // set after mount for last msg
      const acts = wrap.querySelector(".msg-actions");
      acts.addEventListener("click", e => {
        const b = e.target.closest("[data-mact]");
        if (!b) return;
        const act = b.dataset.mact;
        if (act === "copy") copyText(m.content);
        else if (act === "up") this.sendFeedback(m, "up");
        else if (act === "down" || act === "issue") this.sendFeedback(m, act);
        else if (act === "regen") this.regenerate(m);
      });
    }
    return wrap;
  },

  markLastRegenerable() {
    $$(".msg.ai .msg-actions [data-mact=regen]").forEach(b => b.style.display = "none");
    const last = $$(".msg.ai .msg-actions [data-mact=regen]").pop();
    if (last) last.style.display = "";
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
      $$(".msg-actions button", $(`.msg[data-id="${m.id}"]`)).forEach(b => b.classList.remove("on"));
      $(`.msg[data-id="${m.id}"] .msg-actions [data-mact=${rating === "issue" ? "issue" : rating}]`).classList.add("on");
    } catch (e) { toast(e.message, "err"); }
  },

  async regenerate(m) {
    const box = document.createElement("div");
    box.innerHTML = `<div class="msg ai"><div class="avatar">✦</div><div class="msg-body">
      <div class="msg-text"><div class="typing"><i></i><i></i><i></i></div></div>
      <div class="pending-label">Regenerating…</div></div></div>`;
    $("#messages").appendChild(box.firstChild);
    this._scroll();
    try {
      const r = await api(`/api/messages/${m.id}/regenerate`, { body: {} });
      box.remove();
      const el = this.renderMessage({ ...r, role: "assistant", created_at: Math.floor(Date.now() / 1000) });
      $("#messages").appendChild(el);
      if (r.suggestion) this.addSuggestion(el, r.suggestion);
      this._scroll();
    } catch (e) {
      box.remove();
      toast(e.message, "err");
      this.selectConv(this.current);
    }
  },

  addSuggestion(msgEl, sug) {
    const div = document.createElement("div");
    div.className = "suggestion-chip";
    div.innerHTML = `
      <div class="q">💾 Suggested memory (not saved yet)</div>
      <div class="txt">“${esc(sug.content)}”</div>
      <div class="row">
        <button class="btn btn-sm btn-primary" data-s="approve">Save to long-term memory</button>
        <button class="btn btn-sm" data-s="reject">Dismiss</button>
      </div>`;
    div.querySelector('[data-s=approve]').onclick = async () => {
      try {
        await api(`/api/memories/suggestions/${sug.id}/approve`, { body: {} });
        div.innerHTML = `<div class="q" style="color:var(--ok)">✓ Saved to long-term memory</div>`;
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

  renderAttachments() {
    const row = $("#attach-row");
    row.innerHTML = "";
    this.files.forEach((f, i) => {
      const el = document.createElement("span");
      el.className = "attach";
      el.innerHTML = `📄 ${esc(f.name)} <b>${fmtBytes(f.size)}</b> <button data-i="${i}" title="Remove">✕</button>`;
      el.querySelector("button").onclick = () => { this.files.splice(i, 1); this.renderAttachments(); };
      row.appendChild(el);
    });
  },

  _pendingEl(label) {
    const box = document.createElement("div");
    box.innerHTML = `<div class="msg ai"><div class="avatar">✦</div><div class="msg-body">
      <div class="msg-text"><div class="typing"><i></i><i></i><i></i></div></div>
      <div class="pending-label">${esc(label)}</div></div></div>`;
    return box.firstElementChild;
  },

  _scroll() {
    const el = $("#messages");
    el.scrollTop = el.scrollHeight;
  },

  async send() {
    if (this.busy) return;
    const input = $("#chat-input");
    const text = input.value.trim();
    if (!text && !this.files.length) return;
    if (!this.current) await this.newChat(true);
    const convId = this.current;
    const isTraining = this.files.length === 0 && (
      (this.convs.find(c => c.id === convId) || {}).title || "").startsWith("🎓");

    // optimistic user message
    const msgsEl = $("#messages");
    if (msgsEl.classList.contains("empty-state")) {
      msgsEl.classList.remove("empty-state");
      msgsEl.innerHTML = "";
    }
    msgsEl.appendChild(this.renderMessage({
      id: "tmp-" + Date.now(), role: "user",
      content: text || (this.files.map(f => `📎 ${f.name}`).join("\n")),
      training: isTraining, created_at: Math.floor(Date.now() / 1000),
    }));
    input.value = "";
    input.style.height = "auto";
    this._scroll();

    const pending = this._pendingEl("Thinking…");
    msgsEl.appendChild(pending);
    this.busy = true;
    $("#send-btn").disabled = true;
    const started = Date.now();
    const tick = setInterval(() => {
      const lbl = pending.querySelector(".pending-label");
      if (lbl) lbl.textContent = `Thinking… ${Math.floor((Date.now() - started) / 1000)}s`;
    }, 1000);

    const fd = new FormData();
    fd.append("content", text);
    fd.append("training", isTraining ? "true" : "false");
    this.files.forEach(f => fd.append("files", f));

    try {
      const r = await api(`/api/conversations/${convId}/messages`, { body: fd });
      clearInterval(tick);
      pending.remove();
      const el = this.renderMessage({ ...r, role: "assistant", created_at: Math.floor(Date.now() / 1000) });
      msgsEl.appendChild(el);
      if (r.suggestion) this.addSuggestion(el, r.suggestion);
      this.markLastRegenerable();
      this.files = [];
      this.renderAttachments();
      this._scroll();
      await this.loadConvs();
    } catch (e) {
      clearInterval(tick);
      pending.remove();
      const errBox = document.createElement("div");
      errBox.className = "msg ai";
      errBox.innerHTML = `<div class="avatar">✦</div><div class="msg-body">
        <div class="msg-error-card">⚠ ${esc(e.message)}
          <div class="row"><button class="btn btn-sm" data-retry>↻ Try again</button></div>
        </div></div>`;
      msgsEl.appendChild(errBox);
      const retryBtn = errBox.querySelector("[data-retry]");
      retryBtn.onclick = async () => {
        retryBtn.disabled = true;
        const p = this._pendingEl("Trying again…");
        msgsEl.appendChild(p);
        this._scroll();
        try {
          const r = await api(`/api/conversations/${convId}/retry`, { body: {} });
          p.remove();
          const el2 = this.renderMessage({ ...r, role: "assistant", created_at: Math.floor(Date.now() / 1000) });
          msgsEl.appendChild(el2);
          if (r.suggestion) this.addSuggestion(el2, r.suggestion);
          this.markLastRegenerable();
          this._scroll();
        } catch (e2) {
          p.remove();
          errBox.querySelector(".msg-error-card").firstChild.textContent = "⚠ " + e2.message + " ";
        }
      };
      this.files = [];
      this.renderAttachments();
      this._scroll();
    }
    this.busy = false;
    $("#send-btn").disabled = false;
  },

  async renameConv(id) {
    const body = document.createElement("div");
    body.innerHTML = `<label class="field"><span>Conversation title</span><input id="cnv-title" type="text" maxlength="120"></label>`;
    const val = await modal({ title: "Rename conversation", body,
      actions: [{ label: "Cancel" }, { label: "Save", cls: "btn-primary", onClick: () => {} }] });
    const title = $("#cnv-title").value.trim();
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
      this.refreshConvList();
      toast("Conversation deleted.", "ok");
    } catch (e) { toast(e.message, "err"); }
  },

  toggleDrawer(force) {
    const d = $("#conv-drawer"), b = $("#conv-backdrop");
    const open = force !== undefined ? force : !d.classList.contains("open");
    d.classList.toggle("open", open);
    b.classList.toggle("open", open);
  },
};
