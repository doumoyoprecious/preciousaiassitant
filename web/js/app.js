/* ============ App shell: auth, sidebar, routing, settings ============ */
"use strict";

/* ---------- Sidebar (rendered into #sidebar and #drawer) ---------- */
const Sidebar = {
  panes: [],

  init() {
    this.panes = [$("#sidebar"), $("#drawer")].filter(Boolean);
    for (const p of this.panes) this.renderInto(p);
    for (const p of this.panes) this.wire(p);

    $("#burger").addEventListener("click", () => this.openDrawer(true));
    $("#drawer-backdrop").addEventListener("click", () => this.openDrawer(false));
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && $("#drawer").classList.contains("open")) this.openDrawer(false);
    });

    // desktop collapse (persisted)
    const btns = $$("[data-sb=collapse]");
    const saved = (() => { try { return localStorage.getItem("pa-sb"); } catch (e) { return null; } })();
    if (saved === "collapsed") document.body.classList.add("sb-collapsed");
    btns.forEach(b => b.onclick = () => {
      document.body.classList.toggle("sb-collapsed");
      try {
        localStorage.setItem("pa-sb",
          document.body.classList.contains("sb-collapsed") ? "collapsed" : "open");
      } catch (e) { /* ignore */ }
    });
  },

  renderInto(pane) {
    pane.innerHTML = `
      <div class="sb-brand">
        <span class="brand-mark" aria-hidden="true">${logoMark(15)}</span>
        <span class="brand-name">Precious AI</span>
        ${pane.id === "sidebar"
          ? `<button data-sb="collapse" aria-label="Collapse sidebar" title="Collapse sidebar">
               ${icon("back", 15)}</button>` : ""}
      </div>
      <button class="sb-new" data-sb="new">${icon("plus", 15)}<span class="sb-label">New chat</span></button>
      <div class="sb-search-wrap">
        <input class="sb-search" type="search" placeholder="Search conversations"
               aria-label="Search conversations">
      </div>
      <nav class="side-nav" aria-label="Sections">
        <button data-view="knowledge"><span class="ico" aria-hidden="true">${icon("book", 16)}</span>
          <span class="sb-label">Knowledge</span></button>
        <button data-view="memory"><span class="ico" aria-hidden="true">${icon("brain", 16)}</span>
          <span class="sb-label">Memory</span></button>
        <button data-view="training"><span class="ico" aria-hidden="true">${icon("grad", 16)}</span>
          <span class="sb-label">Learn</span></button>
        <button data-view="admin" data-owner-only="1"><span class="ico" aria-hidden="true">${icon("shield", 16)}</span>
          <span class="sb-label">Admin</span></button>
      </nav>
      <div class="sb-history" role="list" aria-label="Conversation history"></div>
      <div class="sb-foot">
        <div class="sb-foot-meta" title="Active model"><span class="dot"></span><span class="m">…</span></div>
        <div class="sb-foot-btns">
          <button class="sb-foot-btn" data-sb="settings">${icon("gear", 15)}
            <span class="sb-label">Settings</span></button>
          <button class="sb-foot-btn" data-sb="logout">${icon("logout", 15)}
            <span class="sb-label">Log out</span></button>
        </div>
      </div>`;
  },

  wire(pane) {
    pane.addEventListener("click", e => {
      const sb = e.target.closest("[data-sb]");
      if (sb) {
        const act = sb.dataset.sb;
        if (act === "new") {
          this.openDrawer(false);
          const chatMounted = Chat.stage && Chat.stage.isConnected;
          if (!chatMounted) {       // not on the chat view — route there first
            App.pendingNew = true;
            window.location.hash = "#/chat";
          } else {
            Chat.newChat();
          }
        }
        else if (act === "settings") { App.openSettings(); this.openDrawer(false); }
        else if (act === "logout") App.logout();
        else if (act === "collapse") return; // handled in init
        return;
      }
      const nav = e.target.closest(".side-nav [data-view]");
      if (nav) {
        if (nav.dataset.ownerOnly && App.me && App.me.user && App.me.user.role !== "owner") return;
        window.location.hash = "#/" + nav.dataset.view;
        this.openDrawer(false);
        return;
      }
      const cact = e.target.closest("[data-cact]");
      if (cact) {
        const cid = cact.closest(".conv-item").dataset.cid;
        if (cact.dataset.cact === "rename") Chat.renameConv(cid);
        else if (cact.dataset.cact === "delete") Chat.deleteConv(cid);
        return;
      }
      const item = e.target.closest(".conv-item");
      if (item) {
        window.location.hash = "#/chat/" + item.dataset.cid;
        this.openDrawer(false);
      }
    });
    const search = $(".sb-search", pane);
    if (search) search.addEventListener("input", () => {
      Chat.search = search.value.trim();
      this.refresh();
    });
  },

  refresh() {
    if (!this.panes.length) this.init();
    const q = Chat.search.toLowerCase();
    for (const pane of this.panes) {
      const box = $(".sb-history", pane);
      if (!box) continue;
      let rows = Chat.convs;
      if (q) rows = rows.filter(c =>
        (c.title || "").toLowerCase().includes(q) ||
        (c.last_content || "").toLowerCase().includes(q));
      box.innerHTML = "";
      if (!rows.length) {
        box.innerHTML = `<div class="sb-empty">${q ? "No conversations match your search."
          : "No conversations yet. Start a new chat."}</div>`;
        continue;
      }
      if (q) {
        for (const c of rows) box.appendChild(this.itemEl(c));
      } else {
        for (const g of groupConvs(rows)) {
          const h = document.createElement("div");
          h.className = "sb-group";
          h.textContent = g.label;
          box.appendChild(h);
          for (const c of g.items) box.appendChild(this.itemEl(c));
        }
      }
    }
  },

  itemEl(c) {
    const el = document.createElement("div");
    el.className = "conv-item" + (c.id === Chat.current ? " active" : "");
    el.dataset.cid = c.id;
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.setAttribute("aria-current", c.id === Chat.current ? "true" : "false");
    el.setAttribute("aria-label", c.title || "New conversation");
    el.innerHTML = `
      <div class="t">${esc(displayTitle(c.title) || "New conversation")}</div>
      <div class="s">${esc(previewText(c.last_content) || "—")} · ${timeAgo(c.updated_at)}</div>
      <span class="c-acts">
        <button data-cact="rename" aria-label="Rename conversation" title="Rename">${icon("pencil", 12)}</button>
        <button data-cact="delete" class="del" aria-label="Delete conversation" title="Delete">${icon("trash", 12)}</button>
      </span>`;
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        if (e.target !== el) return;
        e.preventDefault();
        window.location.hash = "#/chat/" + c.id;
        this.openDrawer(false);
      }
    });
    return el;
  },

  openDrawer(force) {
    const d = $("#drawer"), b = $("#drawer-backdrop");
    const open = force !== undefined ? force : !d.classList.contains("open");
    d.classList.toggle("open", open);
    b.classList.toggle("open", open);
    if (open) {
      const first = $(".sb-new", d);
      if (first) first.focus();
    }
  }
};

/* ---------- App ---------- */
window.App = {
  health: null,
  me: null,
  pendingNew: false,

  async init() {
    // theme
    updateThemeBtn();
    $("#theme-btn").addEventListener("click", () => toggleTheme());
    if (window.matchMedia) {
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (getThemePref() === "auto") applyTheme("auto");
      });
    }

    // auth
    const form = $("#auth-form");
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = $("#auth-submit");
      btn.disabled = true;
      $("#auth-error").textContent = "";
      try {
        const isSetup = !window.App.me || !window.App.me.has_owner;
        const payload = { username: $("#auth-username").value.trim() || "owner",
                          password: $("#auth-password").value };
        await api(isSetup ? "/api/setup" : "/api/login", { body: payload });
        await this.enterApp();
      } catch (err) {
        $("#auth-error").textContent = err.message;
      }
      btn.disabled = false;
    });

    // mobile keyboard: keep the composer visible above the soft keyboard
    if (window.visualViewport) {
      const onVv = () => {
        const kb = Math.max(0,
          window.innerHeight - (window.visualViewport.height + window.visualViewport.offsetTop));
        document.documentElement.style.setProperty("--kb", kb + "px");
      };
      window.visualViewport.addEventListener("resize", onVv);
      onVv();
    }

    Sidebar.init();

    // boot
    try {
      this.me = await api("/api/me");
      if (this.me.user) {
        await this.enterApp();
      } else if (this.me.has_owner) {
        $("#auth-sub").textContent = "Welcome back to your personal AI agent.";
        $("#auth-submit").textContent = "Log in";
        $("#auth-username").value = "";
        $("#auth-username").placeholder = this.me.owner_username || "owner";
        $("#auth-screen").classList.remove("hidden");
      } else {
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
    window.addEventListener("hashchange", () => {
      if (!$("#app").classList.contains("hidden")) this.route();
    });
    this.route();
  },

  setTitle(t) {
    const title = t || "Chat";
    $("#view-title").textContent = title;
    document.title = title + " · Precious AI";
  },

  async updateChip() {
    try {
      this.health = await api("/api/health");
      const h = this.health;
      $$(".sb-foot-meta").forEach(chip => {
        chip.querySelector(".m").textContent = `${h.provider} · ${h.model}`;
        chip.classList.toggle("ok", !!h.api_key_configured);
        chip.title = h.api_key_configured
          ? "API key configured"
          : "No API key configured yet — add one in Admin → API Keys";
      });
    } catch (e) { /* ignore */ }
  },

  async logout() {
    try { await api("/api/logout", { body: {} }); } catch (e) { /* ignore */ }
    location.reload();
  },

  route() {
    const m = (location.hash || "#/chat").match(/^#\/([a-z]+)(?:\/(.+))?$/);
    let view = m && m[1] && VIEWS[m[1]] ? m[1] : "chat";
    const arg = m && m[2] ? m[2] : null;
    if (view === "admin" && this.me && this.me.user && this.me.user.role !== "owner") view = "chat";

    $$(".side-nav button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    if (view === "chat") {
      const conv = Chat.convs.find(c => c.id === Chat.current);
      this.setTitle(conv ? (displayTitle(conv.title) || "New chat") : "Chat");
    } else {
      this.setTitle({ knowledge: "Knowledge", memory: "Memory",
        training: "Learn", admin: "Admin" }[view] || "Precious AI");
    }
    const root = $("#view-root");
    VIEWS[view].init(root);
    if (view === "chat") {
      if (arg) Chat.selectConv(arg);
      else if (App.pendingNew) { App.pendingNew = false; Chat.newChat(); }
    }
  },

  /* ---------- settings ---------- */
  openSettings() {
    const h = this.health || {};
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="settings-sec">
        <div class="sec-l">Appearance</div>
        <div class="settings-row">
          <div>Theme<div class="d">Light, dark, or follow your system.</div></div>
          <div class="seg" id="seg-theme" role="group" aria-label="Theme">
            <button data-t="light">Light</button>
            <button data-t="dark">Dark</button>
            <button data-t="auto">Auto</button>
          </div>
        </div>
      </div>
      <div class="settings-sec">
        <div class="sec-l">AI</div>
        <div class="settings-row">
          <div>Active model
            <div class="d">${h.provider ? esc(`${h.provider} · ${h.model}`) : "—"}</div></div>
          <button class="btn btn-sm" data-go="#/admin">Configure</button>
        </div>
        <div class="settings-row">
          <div>Storage
            <div class="d">${h.storage ? esc(h.storage.kind + (h.storage.persistent ? "" : " · temporary")) : "—"}</div></div>
        </div>
      </div>
      <div class="settings-sec">
        <div class="sec-l">Your data</div>
        <div class="settings-row"><div>Memories<div class="d">View or delete what I remember.</div></div>
          <button class="btn btn-sm" data-go="#/memory">Open</button></div>
        <div class="settings-row"><div>Conversations &amp; documents<div class="d">Export or delete your data.</div></div>
          <button class="btn btn-sm" data-go="#/admin">Open</button></div>
      </div>
      <div class="settings-sec">
        <div class="sec-l">About</div>
        <div class="d small">Precious AI — a personal agent that only says what it knows,
        with real citations and memory you approve.</div>
      </div>`;

    modal({ title: "Settings", body, actions: [{ label: "Done", cls: "btn-primary" }] });

    // wire after mount
    setTimeout(() => {
      const seg = body.querySelector("#seg-theme");
      if (seg) {
        const pref = getThemePref();
        $$("button", seg).forEach(b => b.classList.toggle("active", b.dataset.t === pref));
        seg.addEventListener("click", e => {
          const b = e.target.closest("button[data-t]");
          if (!b) return;
          applyTheme(b.dataset.t);
          $$("button", seg).forEach(x => x.classList.toggle("active", x === b));
        });
      }
      body.querySelectorAll("[data-go]").forEach(b => {
        b.onclick = () => { window.location.hash = b.dataset.go; };
      });
    }, 0);
  }
};

const VIEWS = { chat: Chat, knowledge: Knowledge, memory: Memory, training: Training, admin: Admin };

document.addEventListener("DOMContentLoaded", () => App.init());
