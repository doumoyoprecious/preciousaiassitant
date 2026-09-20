/* ============ Training / Learn view ============ */
"use strict";

const Training = {
  root: null,

  init(root) {
    this.root = root;
    root.innerHTML = `
      <div class="page">
        <div class="card" style="margin-bottom:14px">
          <h3>Training Mode</h3>
          <p class="sub">Teach Precious AI directly — facts, preferences, response formats, terminology,
          business rules and workflows. Everything you save here is <b>explicitly stored</b> (long-term memory
          or knowledge base) and used in every future conversation. This does not modify the underlying AI
          model; it is controlled knowledge and instructions.</p>
        </div>
        <div class="card" style="margin-bottom:14px">
          <h3>Teach something</h3>
          <label class="field"><span>Save it as</span>
            <select id="t-target">
              <option value="memory:preference">Long-term memory — preference (e.g. “keep LinkedIn posts concise”)</option>
              <option value="memory:fact">Long-term memory — fact (e.g. “I live in Port Harcourt”)</option>
              <option value="memory:format">Long-term memory — response format</option>
              <option value="memory:workflow">Long-term memory — workflow</option>
              <option value="memory:business_rule">Long-term memory — business rule</option>
              <option value="memory:terminology">Long-term memory — terminology</option>
              <option value="faq">Knowledge base — FAQ</option>
              <option value="terminology">Knowledge base — terminology / definition</option>
              <option value="note">Knowledge base — note</option>
            </select></label>
          <label class="field"><span>What to teach</span>
            <textarea id="t-content" style="min-height:100px"
              placeholder="Example: Whenever I ask for a professional LinkedIn description, keep it concise — max 3 lines, no buzzwords."></textarea></label>
          <div class="grid grid-2">
            <label class="field"><span>Title (for knowledge base items)</span><input id="t-title" type="text" maxlength="160" placeholder="optional"></label>
            <label class="field"><span>Category</span>${catSelect("t-cat")}</label>
          </div>
          <div class="row">
            <button class="btn btn-primary" id="t-save">Save teaching</button>
            <button class="btn" id="t-practice">Practice in conversation →</button>
            <span class="spacer"></span>
            <span class="chip" id="t-summary">…</span>
          </div>
        </div>
        <div class="card">
          <h3>How it works</h3>
          <ul style="margin:8px 0 0 18px;font-size:13.5px;color:var(--muted)">
            <li><b>Chat suggestions:</b> when you say things like “remember that …” or “always keep …” in normal chat,
            Precious AI suggests a memory — it is only saved if you tap <i>Save to long-term memory</i>.</li>
            <li><b>Structured teaching (above):</b> saved immediately because you explicitly told it to.</li>
            <li><b>Corrections:</b> mark an answer “Not helpful” in chat and provide the correct answer —
            review it later in Admin → Feedback and save it to the knowledge base as an FAQ.</li>
            <li><b>Instructions:</b> for permanent behavior changes (tone, rules, formats) use Admin → Instructions
            — every change is versioned and reversible.</li>
          </ul>
        </div>
      </div>`;

    $("#t-save", root).onclick = async () => {
      const target = $("#t-target").value;
      const [tType, kind] = target.split(":");
      const content = $("#t-content").value.trim();
      if (!content) { toast("Type what you want to teach first.", "err"); return; }
      try {
        const r = await api("/api/training/teach", {
          body: { target: tType, kind: kind || "preference", content,
                  category: $("#t-cat").value, title: $("#t-title").value } });
        toast(`Saved to ${r.saved_to}.`, "ok");
        $("#t-content").value = ""; $("#t-title").value = "";
        this.summary();
      } catch (e) { toast(e.message, "err"); }
    };

    $("#t-practice", root).onclick = async () => {
      try {
        const convs = await api("/api/conversations");
        let conv = convs.find(c => isTrainingTitle(c.title));
        if (!conv) conv = await api("/api/conversations", { body: { title: TRAINING_CONV_TITLE } });
        window.location.hash = "#/chat/" + conv.id;
        toast("Training conversation opened — things you teach here are handled in training mode.", "ok");
      } catch (e) { toast(e.message, "err"); }
    };
    this.summary();
  },

  async summary() {
    const el = $("#t-summary", this.root);
    if (!el) return;
    try {
      const s = await api("/api/training/summary");
      el.textContent = `${s.memories_from_training} memories · ${s.knowledge_from_training} KB items from training`;
    } catch (e) { el.textContent = "…"; }
  },
};
