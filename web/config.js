/* ============ Precious AI — deployment config ============
 * SAME-ORIGIN deployment (UI and API served by the same server):
 *   leave PA_API as "" — all requests go to this same host.
 *
 * SPLIT deployment (UI on Vercel, API on its own server, e.g. a VPS):
 *   set PA_API to your API server's base URL, e.g.:
 *     window.PA_API = "https://api.yourserver.com";
 *   (no trailing slash). Then on the API server set:
 *     PA_CORS_ORIGINS=https://yourapp.vercel.app
 *   so the browser is allowed to talk to it (session cookie included).
 *
 * This file is the ONLY thing you need to change for split hosting —
 * no other code depends on the API being same-origin.
 * ============================================================ */
window.PA_API = "";
