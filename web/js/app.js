/* ============ App shell: auth, routing, nav ============ */
"use strict";

window.App = {
  health: null,
  convsCache: [],

  async init() {
    // auth screen
    const form = $("#auth-form");
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = $("#auth-submit");
      btn.disabled = true;
      $("#auth-error").textContent = "";
      try {
        const isSetup = !window.App.hasOwner;
        const payload = { username: $("#auth-username").value.trim() || "owner", password: $("#auth-password").value };
        await api(isSetup ? "/api/setup" : "/api/login", { body: payload });
        await this.enterApp();
      } catch (err) {
        $("#auth-error").textContent = err.message;
      }
      btn.disabled = false;
    });

    // navigation
    const titles = { chat: "Chat", knowledge: "Knowledge", memory: "Memory", training: "Learn", admin: "Admin" };
    const navBtns = $$("[data-view]");
    navBtns.forEach(b => b.addEventListener("click", () => {
      window.location.hash = "#/" + b.dataset.view;
    }));

    window.addEventListener("hashchange", () => this.route());
    $("#logout-btn").addEventListener("click", async () => {
      try { await api("/api/logout", { body: {} }); } catch (e) { /* ignore */ }
      location.reload();
    });

    // boot
    try {
      const me = await api("/api/me");
      this.hasOwner = me.has_owner;
      if (me.user) {
        await this.enterApp();
      } else if (me.has_owner) {
        // logged out, account exists → login mode
        $("#auth-sub").textContent = "Welcome back to your personal AI agent.";
        $("#auth-submit").textContent = "Log in";
        $("#auth-username").value = "";
        $("#auth-username").placeholder = me.owner_username || "owner";
        $("#auth-screen").classList.remove("hidden");
      } else {
        // first run → setup mode
        $("#auth-sub").textContent = "First run — create your owner account to start using Precious AI.";
        $("#auth-submit").textContent = "Create owner account";
        $("#auth-screen").classList.remove("hidden");
      }
    } catch (e) {
      console.error(e);
      toast("Could not start. Refresh the page.", "err");
    }
  },

  async enterApp() {
    $("#auth-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    this.updateChip();
    this.route();
  },

  async updateChip() {
    try {
      this.health = await api("/api/health");
      const chip = $("#provider-chip");
      const h = this.health;
      chip.innerHTML = `<span class="dot"></span> ${esc(h.provider)} · ${esc(h.model)}`;
      chip.classList.toggle("ok", h.api_key_configured);
      chip.title = h.api_key_configured ? "API key configured" : "No API key configured yet — add one in Admin → API Keys";
    } catch (e) { /* ignore */ }
  },

  route() {
    const m = (location.hash || "#/chat").match(/^#\/([a-z]+)(?:\/(.+))?$/);
    const view = m && m[1] && VIEWS[m[1]] ? m[1] : "chat";
    const arg = m && m[2] ? m[2] : null;
    $$("#sidebar .side-nav button, #bottomnav button").forEach(b =>
      b.classList.toggle("active", b.dataset.view === view));
    $("#view-title").textContent = { chat: "Chat", knowledge: "Knowledge", memory: "Memory",
      training: "Learn", admin: "Admin" }[view] || "Precious AI";
    $("#burger").style.display = view === "chat" ? "" : "none";
    const root = $("#view-root");
    root.scrollTop = 0;
    VIEWS[view].init(root);
    if (view === "chat" && arg) {
      // deep link #/chat/<id>
      Chat.selectConv(arg);
    }
  },
};

const VIEWS = { chat: Chat, knowledge: Knowledge, memory: Memory, training: Training, admin: Admin };

document.addEventListener("DOMContentLoaded", () => App.init());
