/* ============ Memory view ============ */
"use strict";

const Memory = {
  root: null,

  init(root) {
    this.root = root;
    root.innerHTML = `
      <div class="page">
        <div class="card" style="margin-bottom:14px">
          <h3>Long-term memory</h3>
          <p class="sub">Only information you explicitly save (or approve) is stored here. Precious AI never
          silently remembers conversations — it asks first with a suggestion chip.</p>
        </div>
        <div id="mem-suggestions"></div>
        <div class="card" style="margin-bottom:14px">
          <div class="row" style="margin-bottom:10px">
            <input id="mem-search" type="search" placeholder="Search memories…" style="flex:1;min-width:140px;background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:8px 12px;font-size:13px" aria-label="Search memories">
            <button class="btn" id="mem-add-btn">${icon("plus", 14)} Add memory</button>
            <button class="btn btn-danger" id="mem-clear-btn">Clear all</button>
          </div>
          <div id="mem-list"><div class="skel w70" style="margin-bottom:10px"></div><div class="skel w90"></div></div>
        </div>
      </div>`;
    $("#mem-clear-btn", root).onclick = async () => {
      const ok = await confirmModal("Delete ALL long-term memories? Suggestions and the knowledge base are not affected.",
        { danger: true, confirmLabel: "Delete all" });
      if (!ok) return;
      try {
        const r = await api("/api/memories/clear", { body: {} });
        toast(`Deleted ${r.deleted} memories.`, "ok");
        this.refresh();
      } catch (e) { toast(e.message, "err"); }
    };
    $("#mem-add-btn", root).onclick = () => this.addModal();
    let t;
    $("#mem-search", root).oninput = e => { clearTimeout(t); t = setTimeout(() => this.renderList(e.target.value), 300); };
    this.refresh();
  },

  async refresh() {
    try {
      const sugs = await api("/api/memories/suggestions");
      this.renderSuggestions(sugs);
      this.renderList("");
    } catch (e) { toast(e.message, "err"); }
  },

  renderSuggestions(sugs) {
    const box = $("#mem-suggestions", this.root);
    if (!sugs.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="section-title" style="margin-top:0">Pending suggestions (${sugs.length})</div>`;
    for (const s of sugs) {
      const card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "8px";
      card.innerHTML = `
        <div class="row" style="margin-bottom:6px">
          <span class="badge badge-warn">suggested · ${esc(s.kind)}</span>
          <span class="small faint">${timeAgo(s.created_at)}</span>
        </div>
        <div style="font-size:13.5px;font-style:italic">“${esc(s.content)}”</div>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-sm btn-primary" data-a="approve">${icon("check", 13)} Approve & save</button>
          <button class="btn btn-sm" data-a="reject">${icon("x", 13)} Reject</button>
        </div>`;
      card.querySelector('[data-a=approve]').onclick = async () => {
        try {
          await api(`/api/memories/suggestions/${s.id}/approve`, { body: {} });
          toast("Memory approved and saved.", "ok");
          this.refresh();
        } catch (e) { toast(e.message, "err"); }
      };
      card.querySelector('[data-a=reject]').onclick = async () => {
        try {
          await api(`/api/memories/suggestions/${s.id}/reject`, { body: {} });
          this.refresh();
        } catch (e) { toast(e.message, "err"); }
      };
      box.appendChild(card);
    }
  },

  async renderList(q) {
    const list = $("#mem-list", this.root);
    let rows;
    try {
      rows = q ? await api(`/api/memories/search?q=${encodeURIComponent(q)}`) : await api("/api/memories");
    } catch (e) { list.innerHTML = `<div class="msg-error-card">${esc(e.message)}</div>`; return; }
    if (!rows.length) {
      list.innerHTML = `<div class="small faint" style="padding:10px">${q ? "No matching memories." : "No memories yet. Add one, or teach Precious AI in the Learn tab."}</div>`;
      return;
    }
    list.innerHTML = "";
    for (const m of rows) {
      const el = document.createElement("div");
      el.style.cssText = "padding:11px 0;border-bottom:1px solid var(--line)";
      el.innerHTML = `
        <div class="row" style="margin-bottom:5px">
          <span class="badge ${m.kind === "preference" ? "badge-info" : "badge-mute"}">${esc(m.kind)}</span>
          <span class="small faint">${esc(m.category)} · ${esc(m.source)} · ${timeAgo(m.updated_at)}</span>
          <span class="spacer"></span>
          <button class="btn btn-sm" data-a="edit">Edit</button>
          <button class="btn btn-sm btn-danger" data-a="del">Delete</button>
        </div>
        <div style="font-size:13.5px">${esc(m.content)}</div>`;
      el.querySelector('[data-a=edit]').onclick = () => this.editModal(m);
      el.querySelector('[data-a=del]').onclick = async () => {
        const ok = await confirmModal("Delete this memory?", { danger: true, confirmLabel: "Delete" });
        if (!ok) return;
        try {
          await api(`/api/memories/${m.id}`, { method: "DELETE" });
          this.refresh(); toast("Memory deleted.", "ok");
        } catch (e) { toast(e.message, "err"); }
      };
      list.appendChild(el);
    }
  },

  memFieldsHtml() {
    return `
      <label class="field"><span>Content</span><textarea id="mem-content" style="min-height:80px" maxlength="1000"
        placeholder="e.g. My preferred format for reports: executive summary first, then details."></textarea></label>
      <div class="grid grid-2">
        <label class="field"><span>Type</span>${kindSelect("mem-kind")}</label>
        <label class="field"><span>Category</span><input id="mem-cat" type="text" maxlength="40" value="General"></label>
      </div>`;
  },

  async addModal() {
    const body = document.createElement("div");
    body.innerHTML = this.memFieldsHtml();
    const val = await modal({ title: "Add long-term memory", body,
      actions: [{ label: "Cancel" }, { label: "Save", cls: "btn-primary", onClick: () => {} }] });
    if (val !== "Save") return;
    const content = $("#mem-content").value.trim();
    if (!content) { toast("Content cannot be empty.", "err"); return; }
    try {
      await api("/api/memories", {
        body: { content, kind: $("#mem-kind").value, category: $("#mem-cat").value.trim() || "General" } });
      toast("Memory saved.", "ok");
      this.refresh();
    } catch (e) { toast(e.message, "err"); }
  },

  async editModal(m) {
    const body = document.createElement("div");
    body.innerHTML = this.memFieldsHtml();
    $("#mem-content", body).value = m.content;
    $("#mem-kind", body).value = m.kind;
    $("#mem-cat", body).value = m.category;
    const val = await modal({ title: "Edit memory", body,
      actions: [{ label: "Cancel" }, { label: "Save", cls: "btn-primary", onClick: () => {} }] });
    if (val !== "Save") return;
    try {
      await api(`/api/memories/${m.id}`, {
        method: "PATCH",
        body: { content: $("#mem-content").value, kind: $("#mem-kind").value, category: $("#mem-cat").value } });
      toast("Memory updated.", "ok");
      this.refresh();
    } catch (e) { toast(e.message, "err"); }
  },
};
