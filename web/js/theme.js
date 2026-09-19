/* ============ Precious AI — pre-paint theme init ============
 * External file (not inline) so the app's strict CSP
 * (script-src 'self') allows it. Runs synchronously in <head>,
 * before first paint, to prevent a theme flash.
 * ============================================================ */
(function () {
  var t;
  try { t = localStorage.getItem("pa-theme") || "auto"; } catch (e) { t = "auto"; }
  if (t === "auto") {
    t = (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", t);
})();
