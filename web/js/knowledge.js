/* ============ Knowledge view ============ */
"use strict";

const Knowledge = {
  root: null,
  category: "",

  init(root) {
    this.root = root;
    root.innerHTML = `
      <div class="page">
        <div class="row" style="margin-bottom:14px">
          <input id="kb-search" type="search" placeholder="Search knowledge base…" style="flex:1;min-width:160px;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:9px 12px">
          <select id="kb-filter" style="background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:9px 10px">
            <option value="">All categories</option>
            ${CATS.map(c => `<option ${c === this.category ? "selected" : ""}>${esc(c)}</option>`).join("")}
          </select>
        </div>
        <div class="row" style="margin-bottom:16px">
          <button class="btn btn-primary" data-k="upload">${icon("upload", 14)} Upload document</button>
          <button class="btn" data-k="text">${icon("pencil", 14)} Add text / note</button>
          <button class="btn" data-k="url">${icon("link", 14)} Add website</button>
          <input type="file" id="kb-file" class="hidden" multiple accept=".pdf,.txt,.md,.markdown,.csv,.docx">
        </div>
        <div id="kb-search-results" class="hidden" style="margin-bottom:16px"></div>
        <div id="kb-list">
          <div class="card skel-card" role="status" aria-label="Loading documents"><div class="skel w40"></div><div class="skel w90"></div></div>
          <div class="card skel-card" role="status" aria-hidden="true"><div class="skel w40"></div><div class="skel w70"></div></div>
        </div>
      </div>`;

    $("#kb-file", root).onclick = e => e.preventDefault();
    root.addEventListener("click", async e => {
      const btn = e.target.closest("[data-k]");
      if (!btn) return;
      const k = btn.dataset.k;
      if (k === "upload") $("#kb-file", root).click();
      if (k === "text") this.addTextModal();
      if (k === "url") this.addUrlModal();
    });
    $("#kb-file", root).onchange = async e => {
      for (const f of e.target.files) {
        if (f.size > 25 * 1024 * 1024) { toast(`'${f.name}' is larger than 25 MB.`, "err"); continue; }
        const cat = $("#kb-filter", root).value || "General Knowledge";
        try {
          toast(`Processing "${f.name}"…`);
          const fd = new FormData();
          fd.append("file", f);
          fd.append("category", cat);
          const doc = await api("/api/knowledge/upload", { body: fd });
          toast(`"${doc.name}" indexed (${doc.chunks} chunks).`, "ok");
        } catch (err) { toast(err.message, "err"); }
      }
      e.target.value = "";
      this.refresh();
    };
    $("#kb-filter", root).onchange = e => { this.category = e.target.value; this.refresh(); };
    let t;
    $("#kb-search", root).oninput = e => {
      clearTimeout(t);
      t = setTimeout(() => this.doSearch(e.target.value), 400);
    };
    this.refresh();
  },

  async refresh() {
    const list = $("#kb-list", this.root);
    if (!list) return;
    let docs;
    try {
      docs = await api("/api/knowledge" + (this.category ? `?category=${encodeURIComponent(this.category)}` : ""));
    } catch (e) {
      list.innerHTML = `<div class="msg-error-card">${esc(e.message)}</div>`;
      return;
    }
    if (!docs.length) {
      list.innerHTML = `<div class="empty-state card" style="padding:44px 30px">
        <div class="big">${icon("doc", 20)}</div>
        <div style="font-weight:600;font-size:14.5px">Your knowledge base is empty</div>
        <div class="small" style="margin-top:4px">Upload PDF, DOCX, TXT, MD or CSV files, add a note, or save a website.</div></div>`;
      return;
    }
    list.innerHTML = "";
    for (const d of docs) {
      const card = document.createElement("div");
      card.className = "doc-card";
      card.innerHTML = `
        <div class="doc-head">
          <div style="flex:1;min-width:0">
            <div class="doc-name">${esc(d.name)}</div>
            <div class="doc-meta">
              <span class="badge badge-info">${esc(d.category)}</span>
              <span>${esc(d.source_type)}</span>
              ${d.pages ? `<span>${d.pages} pages</span>` : ""}
              <span>${d.chunks} chunks</span>
              ${d.size_bytes ? `<span>${fmtBytes(d.size_bytes)}</span>` : ""}
              <span>${timeAgo(d.updated_at)}</span>
              ${d.is_outdated ? '<span class="badge badge-warn">outdated</span>' : ""}
            </div>
          </div>
        </div>
        <div class="doc-preview">${esc(d.preview || "")}</div>
        <div class="doc-actions">
          <label class="switch" title="Authoritative sources rank higher and are preferred">
            <input type="checkbox" data-t="auth" ${d.is_authoritative ? "checked" : ""}><span class="track"></span>Authoritative
          </label>
          <label class="switch" title="Mark stale documents">
            <input type="checkbox" data-t="out" ${d.is_outdated ? "checked" : ""}><span class="track"></span>Outdated
          </label>
          <span class="spacer"></span>
          <button class="btn btn-sm" data-a="cat">Category</button>
          <button class="btn btn-sm" data-a="replace">Replace</button>
          <button class="btn btn-sm btn-danger" data-a="del">Delete</button>
        </div>`;
      card.querySelector('[data-t=auth]').onchange = async e => {
        try { await api(`/api/knowledge/${d.id}`, { method: "PATCH", body: { is_authoritative: e.target.checked } }); this.refresh(); }
        catch (err) { toast(err.message, "err"); }
      };
      card.querySelector('[data-t=out]').onchange = async e => {
        try { await api(`/api/knowledge/${d.id}`, { method: "PATCH", body: { is_outdated: e.target.checked } }); this.refresh(); }
        catch (err) { toast(err.message, "err"); }
      };
      card.querySelector('[data-a=cat]').onclick = async () => {
        const body = document.createElement("div");
        body.innerHTML = `<label class="field"><span>Category</span>${catSelect("doc-cat", d.category)}</label>`;
        const val = await modal({ title: "Change category", body,
          actions: [{ label: "Cancel" }, { label: "Save", cls: "btn-primary", onClick: () => {} }] });
        if (val === "Save") {
          try {
            await api(`/api/knowledge/${d.id}`, { method: "PATCH", body: { category: $("#doc-cat").value } });
            this.refresh(); toast("Category updated.", "ok");
          } catch (err) { toast(err.message, "err"); }
        }
      };
      card.querySelector('[data-a=replace]').onclick = () => {
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = ".pdf,.txt,.md,.markdown,.csv,.docx";
        inp.onchange = async () => {
          if (!inp.files.length) return;
          try {
            const fd = new FormData();
            fd.append("file", inp.files[0]);
            await api(`/api/knowledge/${d.id}/replace`, { body: fd });
            toast("Document replaced and re-indexed.", "ok");
            this.refresh();
          } catch (err) { toast(err.message, "err"); }
        };
        inp.click();
      };
      card.querySelector('[data-a=del]').onclick = async () => {
        const ok = await confirmModal(`Delete "${d.name}" and all its indexed content? This cannot be undone.`,
          { danger: true, confirmLabel: "Delete" });
        if (!ok) return;
        try {
          await api(`/api/knowledge/${d.id}`, { method: "DELETE" });
          toast("Document deleted.", "ok");
          this.refresh();
        } catch (err) { toast(err.message, "err"); }
      };
      list.appendChild(card);
    }
  },

  async doSearch(q) {
    const box = $("#kb-search-results", this.root);
    q = q.trim();
    if (!q) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    let data;
    try {
      data = await api(`/api/knowledge/search?q=${encodeURIComponent(q)}&category=${encodeURIComponent(this.category)}`);
    } catch (e) { box.innerHTML = `<div class="msg-error-card">${esc(e.message)}</div>`; box.classList.remove("hidden"); return; }
    box.classList.remove("hidden");
    if (!data.results.length) {
      box.innerHTML = `<div class="card small muted">No closely matching passages found in the knowledge base.
        Try different wording, or check the category filter.</div>`;
      return;
    }
    box.innerHTML = `<div class="section-title" style="margin-top:0">Search results (${data.results.length})</div>` +
      data.results.map(r => `
        <div class="res-card">
          <div class="res-head">
            <span class="badge badge-info">${esc(r.doc_name)}</span>
            ${r.page ? `<span>p.${r.page}</span>` : ""}
            ${r.section ? `<span>${esc(r.section)}</span>` : ""}
            <span class="score">${(r.score * 100).toFixed(0)}%</span>
          </div>
          <div class="res-text">${esc(r.content)}</div>
        </div>`).join("");
  },

  async addTextModal() {
    const body = document.createElement("div");
    body.innerHTML = `
      <label class="field"><span>Title</span><input id="nt-title" type="text" maxlength="160" placeholder="e.g. Phoenix project notes"></label>
      <label class="field"><span>Content</span><textarea id="nt-content" style="min-height:120px" placeholder="Paste or type the knowledge…"></textarea></label>
      <div class="grid grid-2">
        <label class="field"><span>Category</span>${catSelect("nt-cat")}</label>
        <label class="field"><span>Type</span>
          <select id="nt-kind"><option>note</option><option>faq</option><option>fact</option><option>structured</option></select>
        </label>
      </div>`;
    const val = await modal({ title: "Add text / note to knowledge base", body,
      actions: [{ label: "Cancel" }, { label: "Add", cls: "btn-primary", onClick: () => {} }] });
    if (val !== "Add") return;
    const content = $("#nt-content").value.trim();
    if (!content) { toast("Content cannot be empty.", "err"); return; }
    try {
      const doc = await api("/api/knowledge/manual", {
        body: { title: $("#nt-title").value, content, category: $("#nt-cat").value, kind: $("#nt-kind").value } });
      toast(`"${doc.name}" added (${doc.chunks} chunks).`, "ok");
      this.refresh();
    } catch (e) { toast(e.message, "err"); }
  },

  async addUrlModal() {
    const body = document.createElement("div");
    body.innerHTML = `
      <label class="field"><span>URL</span><input id="nu-url" type="url" placeholder="https://…"></label>
      <label class="field"><span>Title (optional)</span><input id="nu-title" type="text" maxlength="160"></label>
      <label class="field"><span>Category</span>${catSelect("nu-cat")}</label>`;
    const val = await modal({ title: "Add website content", body,
      actions: [{ label: "Cancel" }, { label: "Fetch & index", cls: "btn-primary", onClick: () => {} }] });
    if (val !== "Fetch & index") return;
    const url = $("#nu-url").value.trim();
    if (!url) { toast("URL required.", "err"); return; }
    try {
      toast("Fetching page…");
      const doc = await api("/api/knowledge/url", {
        body: { url, title: $("#nu-title").value || null, category: $("#nu-cat").value } });
      toast(`"${doc.name}" indexed (${doc.chunks} chunks).`, "ok");
      this.refresh();
    } catch (e) { toast(e.message, "err"); }
  },
};
