/* ============ Admin view (owner only) ============ */
"use strict";

const Admin = {
  root: null,
  tab: "overview",

  init(root) {
    this.root = root;
    root.innerHTML = `
      <div class="tabs" id="admin-tabs">
        <button data-tab="overview" class="active">Overview</button>
        <button data-tab="instructions">Instructions</button>
        <button data-tab="settings">Settings</button>
        <button data-tab="keys">API Keys</button>
        <button data-tab="tools">Tools</button>
        <button data-tab="eval">Evaluation</button>
        <button data-tab="feedback">Feedback</button>
        <button data-tab="errors">Errors</button>
        <button data-tab="data">Data</button>
        <button data-tab="modules">Modules</button>
      </div>
      <div class="page" id="admin-content"></div>`;
    $("#admin-tabs", root).addEventListener("click", e => {
      const b = e.target.closest("[data-tab]");
      if (!b) return;
      this.tab = b.dataset.tab;
      $$("#admin-tabs button", root).forEach(x => x.classList.toggle("active", x === b));
      this.render();
    });
    this.render();
  },

  render() {
    const fn = {
      overview: this.tabOverview, instructions: this.tabInstructions, settings: this.tabSettings,
      keys: this.tabKeys, tools: this.tabTools, eval: this.tabEval, feedback: this.tabFeedback,
      errors: this.tabErrors, data: this.tabData, modules: this.tabModules,
    }[this.tab];
    const el = $("#admin-content", this.root);
    el.innerHTML = `<div class="small faint" style="padding:16px">Loading…</div>`;
    Promise.resolve(fn.call(this, el)).catch(e => {
      el.innerHTML = `<div class="msg-error-card">${esc(e.message)}</div>`;
    });
  },

  /* ---------- Overview ---------- */
  async tabOverview(el) {
    const o = await api("/api/admin/overview");
    const c = o.counts;
    const max = Math.max(1, ...o.daily.map(d => d.count));
    el.innerHTML = `
      <div class="stat-grid" style="margin-bottom:16px">
        ${[
          [c.conversations, "Conversations"], [c.user_messages, "Your messages"],
          [c.documents, "Knowledge docs"], [c.chunks, "Indexed chunks"],
          [c.memories, "Long-term memories"], [c.pending_suggestions, "Pending suggestions"],
          [o.feedback.helpful, "👍 Helpful"], [o.feedback.not_helpful + o.feedback.issues, "👎 Not helpful"],
        ].map(([n, l]) => `<div class="stat"><div class="n">${n ?? 0}</div><div class="l">${l}</div></div>`).join("")}
      </div>
      <div class="grid grid-2">
        <div class="card">
          <h3>Activity — last 14 days</h3>
          <div class="bars">${o.daily.map(d =>
            `<div class="bar" style="height:${Math.round((d.count / max) * 100)}%" title="${d.count} answers"><span>${d.day.split(" ")[0]}</span></div>`).join("")}
          </div>
          <div style="height:20px"></div>
        </div>
        <div class="card">
          <h3>Retrieval & gaps</h3>
          <div class="qrow"><span>Failed retrievals (search, no match)</span><span class="n">${o.failed_retrievals}</span></div>
          <div class="qrow"><span>Unanswered / errored messages</span><span class="n">${o.unanswered}</span></div>
          <div class="qrow"><span>Embedding backend</span><span class="small">${esc(o.embedder)}</span></div>
          <div class="qrow"><span>Helpful rate</span><span class="n">${o.feedback.helpful_rate != null ? (o.feedback.helpful_rate * 100).toFixed(0) + "%" : "—"}</span></div>
        </div>
      </div>
      ${o.top_questions.length ? `
      <div class="card" style="margin-top:14px">
        <h3>Frequently asked questions</h3>
        ${o.top_questions.map(q => `<div class="qrow"><span>${esc(q.question)}</span><span class="n">×${q.count}</span></div>`).join("")}
      </div>` : ""}
      ${o.knowledge_gaps.length ? `
      <div class="card" style="margin-top:14px">
        <h3>Potential knowledge gaps</h3>
        <p class="sub" style="margin-bottom:8px">Answers you marked as wrong with no knowledge source — candidates for the knowledge base.</p>
        ${o.knowledge_gaps.map(g => `<div class="qrow"><span class="small">${esc(g.question || g.note || "(see conversation)")}</span>
          <button class="btn btn-sm" data-gap="${g.id}">Review</button></div>`).join("")}
      </div>` : ""}
      ${o.recent_errors.length ? `
      <div class="card" style="margin-top:14px">
        <h3>Recent errors</h3>
        ${o.recent_errors.slice(0, 5).map(e => `<div class="qrow small"><span class="muted">[${esc(e.area)}] ${esc(e.message)}</span><span class="faint">${timeAgo(e.created_at)}</span></div>`).join("")}
      </div>` : ""}`;
    el.querySelectorAll("[data-gap]").forEach(b => b.onclick = () => {
      const g = o.knowledge_gaps.find(x => x.id === b.dataset.gap);
      modal({ title: "Knowledge gap", wide: true,
        body: `<div class="small" style="margin-bottom:8px"><b>Question:</b> ${esc(g.question || "(none captured)")}</div>
          <div class="small" style="margin-bottom:8px"><b>Your note:</b> ${esc(g.note || "—")}</div>
          <div class="small"><b>Suggested correction:</b><br>${esc(g.corrected_answer || "—")}</div>`,
        actions: [{ label: "Close" }, { label: "Save as FAQ", cls: "btn-primary", onClick: async () => {
          try {
            await api(`/api/admin/feedback/${g.id}/save_as_knowledge`, { body: { title: (g.question || "Corrected answer").slice(0, 60) } });
            toast("Saved to knowledge base as FAQ.", "ok");
          } catch (e) { toast(e.message, "err"); return false; }
        }}] });
    });
  },

  /* ---------- Instructions ---------- */
  async tabInstructions(el) {
    const list = await api("/api/admin/instructions");
    const active = list.find(v => v.active) || list[0];
    const f = active.fields;
    const listArea = k => (f[k] || []).map(x => esc(x)).join("\n");
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <h3>Agent instructions — currently version ${active.version}</h3>
        <p class="sub">Changes are saved as a new version and activated immediately. You can revert to any previous version.</p>
        <label class="field" style="margin-top:12px"><span>Personality</span><textarea id="ins-personality">${esc(f.personality || "")}</textarea></label>
        <label class="field"><span>Tone</span><input id="ins-tone" type="text" value="${esc(f.tone || "")}"></label>
        <label class="field"><span>Response length guidance</span><input id="ins-length" type="text" value="${esc(f.length || "")}"></label>
        <label class="field"><span>Domain context</span><textarea id="ins-domain">${esc(f.domain || "")}</textarea></label>
        <label class="field"><span>Output formats</span><textarea id="ins-formats">${esc(f.formats || "")}</textarea></label>
        <label class="field"><span>Business instructions</span><textarea id="ins-business">${esc(f.business || "")}</textarea></label>
        <label class="field"><span>Safety instructions</span><textarea id="ins-safety">${esc(f.safety || "")}</textarea></label>
        <label class="field"><span>Rules (one per line)</span><textarea id="ins-rules">${listArea("rules")}</textarea></label>
        <label class="field"><span>Restrictions (one per line)</span><textarea id="ins-restrictions">${listArea("restrictions")}</textarea></label>
        <label class="field"><span>Preferred terminology (one per line)</span><textarea id="ins-terminology">${listArea("terminology")}</textarea></label>
        <label class="field"><span>Note for this version (optional)</span><input id="ins-note" type="text" placeholder="e.g. tightened tone for client work"></label>
        <button class="btn btn-primary" id="ins-save">Save as new version & activate</button>
      </div>
      <div class="card">
        <h3>Version history</h3>
        ${list.map(v => `
          <div class="row" style="padding:9px 0;border-bottom:1px solid var(--line)">
            <span class="badge ${v.active ? "badge-ok" : "badge-mute"}">v${v.version}${v.active ? " · active" : ""}</span>
            <span class="small muted">${esc(v.note || "")} · ${fmtTime(v.created_at)}</span>
            <span class="spacer"></span>
            ${v.active ? "" : `<button class="btn btn-sm" data-v="${v.version}">Restore this version</button>`}
          </div>`).join("")}
      </div>`;
    $("#ins-save", el).onclick = async () => {
      try {
        const r = await api("/api/admin/instructions", {
          body: {
            fields: {
              personality: $("#ins-personality").value, tone: $("#ins-tone").value,
              length: $("#ins-length").value, domain: $("#ins-domain").value,
              formats: $("#ins-formats").value, business: $("#ins-business").value,
              safety: $("#ins-safety").value, rules: $("#ins-rules").value,
              restrictions: $("#ins-restrictions").value, terminology: $("#ins-terminology").value,
            },
            note: $("#ins-note").value,
          } });
        toast(`Saved as v${r.version} and activated.`, "ok");
        this.render();
      } catch (e) { toast(e.message, "err"); }
    };
    el.querySelectorAll("[data-v]").forEach(b => b.onclick = async () => {
      const ok = await confirmModal(`Restore instruction set v${b.dataset.v}? It becomes active immediately (current version stays in history).`);
      if (!ok) return;
      try {
        await api(`/api/admin/instructions/${b.dataset.v}/activate`, { body: {} });
        toast(`v${b.dataset.v} is now active.`, "ok");
        this.render();
      } catch (e) { toast(e.message, "err"); }
    });
  },

  /* ---------- Settings ---------- */
  async tabSettings(el) {
    const [s, health] = await Promise.all([api("/api/admin/settings"), api("/api/health")]);
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <h3>Model & provider</h3>
        <div class="grid grid-2">
          <label class="field"><span>Provider</span>
            <select id="st-provider">
              ${["groq","openai","anthropic","gemini","openrouter","ollama"].map(p =>
                `<option value="${p}" ${s.provider === p ? "selected" : ""}>${p}</option>`).join("")}
            </select></label>
          <label class="field"><span>Model</span><input id="st-model" type="text" value="${esc(s.model)}" placeholder="model name (custom allowed)"></label>
        </div>
        <div class="small faint" style="margin-bottom:14px">Quick picks: <span id="model-picks"></span></div>
        <div class="grid grid-2">
          <label class="field"><span>Temperature (${esc(s.temperature)})</span>
            <input id="st-temp" type="number" step="0.1" min="0" max="1.5" value="${esc(s.temperature)}"></label>
          <label class="field"><span>Max output tokens</span><input id="st-maxtok" type="number" min="100" max="8000" value="${esc(s.max_tokens)}"></label>
        </div>
      </div>
      <div class="card" style="margin-bottom:14px">
        <h3>RAG (retrieval)</h3>
        <div class="grid grid-2">
          <label class="field"><span>Top-k passages</span><input id="st-topk" type="number" min="1" max="12" value="${esc(s.rag_top_k)}"></label>
          <label class="field"><span>Min relevance (0–1)</span><input id="st-minscore" type="number" step="0.05" min="0" max="1" value="${esc(s.rag_min_score)}"></label>
          <label class="field"><span>Chunk size (chars)</span><input id="st-chunk" type="number" min="200" max="2000" step="50" value="${esc(s.chunk_size)}"></label>
          <label class="field"><span>Conversation history length</span><input id="st-hist" type="number" min="2" max="40" value="${esc(s.history_limit)}"></label>
        </div>
        <div class="small faint">Embeddings: <b>${esc(health.embedder)}</b> — runs locally, no API cost.</div>
      </div>
      <div class="card">
        <h3>Agent switches</h3>
        <div class="row" style="padding:8px 0">
          <label class="switch"><input type="checkbox" id="st-memory" ${s.memory_enabled === "true" ? "checked" : ""}><span class="track"></span>
            Use approved long-term memory in conversations</label>
          <label class="switch"><input type="checkbox" id="st-tools" ${s.tools_enabled === "true" ? "checked" : ""}><span class="track"></span>
            Enable tools</label>
        </div>
        <label class="field"><span>Timezone (for date/time tool & context)</span>
          <input id="st-tz" type="text" value="${esc(s.timezone)}" placeholder="Africa/Lagos"></label>
        <button class="btn btn-primary" id="st-save">Save settings</button>
        <span class="chip" id="st-status" style="margin-left:10px">${health.api_key_configured ? "API key configured" : "⚠ No API key yet — see API Keys tab"}</span>
      </div>`;
    const loadPicks = async () => {
      try {
        const m = await api("/api/admin/models?provider=" + $("#st-provider").value);
        $("#model-picks", el).innerHTML = m.catalog.slice(0, 5).map(x =>
          `<button class="chip" style="cursor:pointer;margin-right:6px" data-m="${esc(x)}">${esc(x)}</button>`).join("");
        el.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { $("#st-model").value = b.dataset.m; });
      } catch (e) { /* keep custom */ }
    };
    $("#st-provider", el).onchange = loadPicks;
    loadPicks();
    $("#st-save", el).onclick = async () => {
      try {
        const r = await api("/api/admin/settings", {
          body: { values: {
            provider: $("#st-provider").value, model: $("#st-model").value.trim(),
            temperature: $("#st-temp").value, max_tokens: $("#st-maxtok").value,
            rag_top_k: $("#st-topk").value, rag_min_score: $("#st-minscore").value,
            chunk_size: $("#st-chunk").value, history_limit: $("#st-hist").value,
            memory_enabled: $("#st-memory").checked ? "true" : "false",
            tools_enabled: $("#st-tools").checked ? "true" : "false",
            timezone: $("#st-tz").value.trim() || "Africa/Lagos",
          } } });
        toast("Settings saved. New model takes effect on the next message.", "ok");
        window.App.updateChip();
      } catch (e) { toast(e.message, "err"); }
    };
  },

  /* ---------- API Keys ---------- */
  async tabKeys(el) {
    const keys = await api("/api/admin/keys");
    el.innerHTML = `
      <div class="card">
        <h3>API keys</h3>
        <p class="sub">Keys are stored <b>server-side only</b> (never sent to the browser) and used to call the
        provider. Environment variables (.env) also work — DB keys take precedence. Test before saving work.</p>
        ${keys.map(k => `
          <div class="key-row">
            <span class="name">${esc(k.display)}</span>
            ${k.set ? `<span class="badge badge-ok">configured</span><span class="small faint">${esc(k.masked)}</span>`
              : k.from_env ? `<span class="badge badge-info">env var</span>`
              : `<span class="badge badge-mute">not set</span>`}
            <input id="key-${k.provider}" type="password" placeholder="paste key (leave blank to remove)" autocomplete="off">
            <button class="btn btn-sm" data-test="${k.provider}">Test</button>
            <button class="btn btn-sm btn-primary" data-save="${k.provider}">Save</button>
          </div>`).join("")}
      </div>`;
    el.querySelectorAll("[data-test]").forEach(b => b.onclick = async () => {
      const provider = b.dataset.test;
      const inp = $(`#key-${provider}`, el);
      if (inp.value.trim()) {
        try { await api("/api/admin/keys", { body: { provider, key: inp.value.trim() } }); }
        catch (e) { toast(e.message, "err"); return; }
      }
      b.disabled = true; b.textContent = "Testing…";
      try {
        const r = await api(`/api/admin/keys/${provider}/test`, { body: {} });
        toast(r.ok ? `${provider}: ${r.message}` : `${provider}: ${r.message}`, r.ok ? "ok" : "err");
      } catch (e) { toast(e.message, "err"); }
      b.disabled = false; b.textContent = "Test";
    });
    el.querySelectorAll("[data-save]").forEach(b => b.onclick = async () => {
      const provider = b.dataset.save;
      const key = $(`#key-${provider}`, el).value.trim();
      try {
        const r = await api("/api/admin/keys", { body: { provider, key } });
        toast(r.removed ? "Key removed." : "Key saved (server-side).", "ok");
        window.App.updateChip();
        this.render();
      } catch (e) { toast(e.message, "err"); }
    });
  },

  /* ---------- Tools ---------- */
  async tabTools(el) {
    const tools = await api("/api/admin/tools");
    const built = tools.filter(t => t.built_in);
    const planned = tools.filter(t => !t.built_in);
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <h3>Active tool framework</h3>
        <p class="sub">Tools are used when the model decides they're needed, and Precious AI tells you when it uses one.
        Enable or disable any tool — changes apply on the next message.</p>
        ${built.map(t => `
          <div class="row" style="padding:10px 0;border-bottom:1px solid var(--line)">
            <div style="flex:1;min-width:0">
              <b style="font-size:13.5px">${esc(t.name)}</b>
              <div class="small muted">${esc(t.description)}</div>
            </div>
            <label class="switch"><input type="checkbox" data-tool="${esc(t.name)}" ${t.enabled ? "checked" : ""}><span class="track"></span></label>
          </div>`).join("")}
      </div>
      <div class="card">
        <h3>Planned tools (Phase 7 — not yet implemented)</h3>
        <p class="sub" style="margin-bottom:8px">These are wired into the architecture but intentionally not active.
        They will appear here as enabled tools once built.</p>
        ${planned.map(t => `
          <div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)">
            <span class="badge badge-mute">planned</span>
            <div style="flex:1;min-width:0"><b class="small">${esc(t.name)}</b>
              <div class="small muted">${esc(t.description)}</div></div>
          </div>`).join("")}
      </div>`;
    el.querySelectorAll("[data-tool]").forEach(cb => cb.onchange = async () => {
      try {
        await api("/api/admin/tools", { body: { name: cb.dataset.tool, enabled: cb.checked } });
        toast(`Tool ${cb.dataset.tool} ${cb.checked ? "enabled" : "disabled"}.`, "ok");
      } catch (e) { toast(e.message, "err"); cb.checked = !cb.checked; }
    });
  },

  /* ---------- Evaluation ---------- */
  async tabEval(el) {
    const cases = await api("/api/eval/cases");
    const runs = await api("/api/eval/runs?limit=100");
    const lastRun = {};
    for (const r of runs) if (!lastRun[r.case_id]) lastRun[r.case_id] = r;
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <h3>Add test case</h3>
        <label class="field"><span>Question</span><input id="ev-q" type="text" placeholder="e.g. What tech does the Phoenix project use?"></label>
        <label class="field"><span>Expected behavior</span><input id="ev-behavior" type="text" placeholder="e.g. Answer from knowledge base, cite the doc"></label>
        <label class="field"><span>Required information (separate with ; or commas — used for auto-scoring)</span>
          <input id="ev-info" type="text" placeholder="e.g. Kafka; Postgres; data pipeline"></label>
        <label class="field"><span>Notes</span><input id="ev-notes" type="text"></label>
        <button class="btn btn-primary" id="ev-add">Add case</button>
        <span class="spacer"></span>
        <button class="btn" id="ev-run-all">▶ Run all cases</button>
      </div>
      <div class="card">
        <h3>Test cases & results</h3>
        ${cases.length ? cases.map(c => {
          const r = lastRun[c.id];
          return `
          <div style="padding:12px 0;border-bottom:1px solid var(--line)">
            <div class="row" style="margin-bottom:6px">
              ${r ? (r.passed ? '<span class="badge badge-ok">pass</span>' : '<span class="badge badge-err">fail</span>')
                   : '<span class="badge badge-mute">not run</span>'}
              ${r && r.score != null ? `<span class="small">score ${(r.score * 100).toFixed(0)}%</span>` : ""}
              <span class="small faint">${r ? fmtTime(r.created_at) : ""}</span>
              <span class="spacer"></span>
              <button class="btn btn-sm" data-run="${c.id}">▶ Run</button>
              <button class="btn btn-sm btn-danger" data-dc="${c.id}">Delete</button>
            </div>
            <div style="font-size:13.5px"><b>Q:</b> ${esc(c.question)}</div>
            ${c.expected_behavior ? `<div class="small muted">Expected: ${esc(c.expected_behavior)}</div>` : ""}
            ${c.expected_info ? `<div class="small muted">Required info: ${esc(c.expected_info)}</div>` : ""}
            ${r ? `
              <details style="margin-top:8px">
                <summary class="small" style="cursor:pointer;color:var(--accent2)">Actual answer & details</summary>
                <div class="small" style="margin-top:8px;white-space:pre-wrap;background:var(--bg2);border-radius:8px;padding:10px">${esc(r.answer || r.error || "(no answer)")}</div>
                ${r.flags && JSON.parse(r.flags || "[]").length ? `<div class="small" style="margin-top:6px">
                  ${JSON.parse(r.flags).map(f => `<div>⚑ ${esc(f)}</div>`).join("")}</div>` : ""}
                ${r.expected_hits ? `<div class="small" style="margin-top:6px">${(JSON.parse(r.expected_hits)).map(h =>
                  `<span class="badge ${h.hit ? "badge-ok" : "badge-err"}" style="margin-right:6px">${h.hit ? "✓" : "✗"} ${esc(h.phrase)}</span>`).join("")}</div>` : ""}
              </details>` : ""}
          </div>`;
        }).join("") : `<div class="small faint" style="padding:10px">No test cases yet. Add your first one above — a good starting point: questions your documents answer.</div>`}
      </div>`;
    $("#ev-add", el).onclick = async () => {
      const q = $("#ev-q").value.trim();
      if (!q) { toast("Question required.", "err"); return; }
      try {
        await api("/api/eval/cases", {
          body: { question: q, expected_behavior: $("#ev-behavior").value,
                  expected_info: $("#ev-info").value, notes: $("#ev-notes").value } });
        toast("Test case added.", "ok");
        this.render();
      } catch (e) { toast(e.message, "err"); }
    };
    $("#ev-run-all", el).onclick = async () => {
      if (!cases.length) { toast("Add at least one case first.", "err"); return; }
      try {
        toast("Running all cases… (one LLM call per case)");
        await api("/api/eval/run", { body: { case_id: "" } });
        this.render();
      } catch (e) { toast(e.message, "err"); }
    };
    el.querySelectorAll("[data-run]").forEach(b => b.onclick = async () => {
      b.disabled = true; b.textContent = "Running…";
      try {
        toast("Running test case… (one LLM call)");
        await api("/api/eval/run", { body: { case_id: b.dataset.run } });
        this.render();
      } catch (e) { toast(e.message, "err"); }
    });
    el.querySelectorAll("[data-dc]").forEach(b => b.onclick = async () => {
      const ok = await confirmModal("Delete this test case and its run history?", { danger: true, confirmLabel: "Delete" });
      if (!ok) return;
      try { await api(`/api/eval/cases/${b.dataset.dc}`, { method: "DELETE" }); this.render(); }
      catch (e) { toast(e.message, "err"); }
    });
  },

  /* ---------- Feedback ---------- */
  async tabFeedback(el, filter = "all") {
    const rows = await api(`/api/admin/feedback?filter=${filter}`);
    el.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        ${["all", "down", "issue"].map(f => `
          <button class="btn btn-sm ${filter === f ? "btn-primary" : ""}" data-fb="${f}">
            ${f === "all" ? "All" : f === "down" ? "👎 Not helpful" : "⚠ Issues"} (${f === "all" ? rows.length : ""})</button>`).join("")}
      </div>
      ${rows.length ? rows.map(r => `
        <div class="doc-card">
          <div class="row" style="margin-bottom:6px">
            <span class="badge ${r.rating === "up" ? "badge-ok" : r.rating === "down" ? "badge-err" : "badge-warn"}">${esc(r.rating)}</span>
            <span class="small faint">${esc(r.conv_title || "")} · ${timeAgo(r.created_at)}</span>
          </div>
          <div class="small" style="margin-bottom:6px"><b>Your question:</b> ${esc(r.question || "—")}</div>
          <div class="small muted" style="margin-bottom:6px"><b>Answer given:</b> ${esc(r.answer || "—")}</div>
          ${r.note ? `<div class="small"><b>Note:</b> ${esc(r.note)}</div>` : ""}
          ${r.corrected_answer ? `<div class="small" style="margin-top:6px"><b>Your correction:</b> ${esc(r.corrected_answer)}</div>` : ""}
          ${(r.rating === "down" || r.rating === "issue") && (r.corrected_answer || r.note) ? `
            <div class="row" style="margin-top:10px">
              <button class="btn btn-sm" data-sfk="${r.id}">💾 Save correction as FAQ (fixes this gap)</button>
            </div>` : ""}
        </div>`).join("") : `<div class="card small muted">No ${filter === "all" ? "" : filter + " "}feedback yet. Feedback appears when you tap 👍/👎/ on answers in chat.</div>`}`;
    el.querySelectorAll("[data-fb]").forEach(b => b.onclick = () => this.tabFeedback(el, b.dataset.fb));
    el.querySelectorAll("[data-sfk]").forEach(b => b.onclick = async () => {
      const row = rows.find(x => x.id === b.dataset.sfk);
      try {
        const r = await api(`/api/admin/feedback/${b.dataset.sfk}/save_as_knowledge`, {
          body: { title: (row && row.question || "Corrected answer").slice(0, 60), category: "FAQs" } });
        toast(r.document ? `"${r.document}" saved to knowledge base.` : "Saved.", "ok");
        this.render();
      } catch (e) { toast(e.message, "err"); }
    });
  },

  /* ---------- Errors ---------- */
  async tabErrors(el) {
    const rows = await api("/api/admin/errors?limit=100");
    el.innerHTML = `
      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <h3 style="margin:0">Error logs (${rows.length})</h3><span class="spacer"></span>
          <button class="btn btn-sm" id="err-clear">Clear logs</button>
        </div>
        ${rows.length ? `<div class="tbl-wrap"><table class="tbl">
          <tr><th>When</th><th>Level</th><th>Area</th><th>Message</th></tr>
          ${rows.map(r => `<tr>
            <td class="small" style="white-space:nowrap">${fmtTime(r.created_at)}</td>
            <td><span class="badge ${r.level === "error" ? "badge-err" : "badge-warn"}">${esc(r.level)}</span></td>
            <td class="small">${esc(r.area)}</td>
            <td class="small">${esc(r.message)}</td>
          </tr>`).join("")}</table></div>`
          : `<div class="small faint" style="padding:10px">No errors logged. 🎉</div>`}
      </div>`;
    $("#err-clear", el).onclick = async () => {
      const ok = await confirmModal("Clear all error logs?");
      if (!ok) return;
      try { await api("/api/admin/errors/clear", { body: {} }); this.render(); toast("Logs cleared.", "ok"); }
      catch (e) { toast(e.message, "err"); }
    };
  },

  /* ---------- Data ---------- */
  async tabData(el) {
    el.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <h3>Export</h3>
          <p class="sub">Download everything (conversations, knowledge documents list, memories,
          instructions, feedback, settings) as JSON.</p>
          <button class="btn btn-primary" id="data-export" style="margin-top:10px">⬇ Export my data</button>
        </div>
        <div class="card">
          <h3>Delete data</h3>
          <p class="sub">Delete specific data. Knowledge base documents, their files and indexed chunks are removed together.</p>
          <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
            ${["conversations", "memories", "knowledge", "feedback", "events", "all"].map(s =>
              `<button class="btn btn-sm btn-danger" data-wipe="${s}">Delete ${s}</button>`).join("")}
          </div>
        </div>
      </div>`;
    $("#data-export", el).onclick = async () => {
      try {
        const data = await api("/api/admin/data/export");
        download(`precious-ai-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
        toast("Export downloaded.", "ok");
      } catch (e) { toast(e.message, "err"); }
    };
    el.querySelectorAll("[data-wipe]").forEach(b => b.onclick = async () => {
      const scope = b.dataset.wipe;
      const msg = scope === "all"
        ? "Delete ALL data (conversations, memories, knowledge base, feedback, logs)? Your account, settings and instruction versions are kept."
        : `Delete all ${scope}? This cannot be undone.`;
      const ok = await confirmModal(msg, { danger: true, confirmLabel: "Delete", requireType: "YES" });
      if (!ok) return;
      try {
        await api("/api/admin/data/wipe", { body: { scope, confirm: "YES" } });
        toast(`Deleted ${scope}.`, "ok");
      } catch (e) { toast(e.message, "err"); }
    });
  },

  /* ---------- Modules / roadmap ---------- */
  async tabModules(el) {
    const m = await api("/api/admin/modules");
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <h3>Architecture status</h3>
        <p class="sub">Implemented features are fully functional. Planned modules are designed into the
        architecture (tools registry, provider abstraction, event log) and marked clearly — nothing is faked.</p>
        <div class="qrow"><span>Embedding backend</span><span class="small">${esc(m.embedder)}</span></div>
        <div class="qrow"><span>Knowledge base</span><span class="small">${m.kb.documents} docs · ${m.kb.chunks} chunks</span></div>
      </div>
      ${m.phases.map(p => `
        <div class="phase">
          <div class="ph-head">
            <span class="badge ${p.status === "implemented" ? "badge-ok" : p.status === "partial" ? "badge-warn" : "badge-mute"}">
              Phase ${p.phase} · ${p.status}</span>
            <b>${esc(p.name)}</b>
          </div>
          <ul>${p.features.map(f => `<li class="${p.status === "planned" ? "todo" : "done"}">${esc(f)}</li>`).join("")}</ul>
        </div>`).join("")}`;
  },
};
