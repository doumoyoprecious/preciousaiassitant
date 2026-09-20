# Precious AI — Frontend Redesign QA Report

- Run at: 2026-09-18 (evening)
- Scope: complete frontend redesign (ChatGPT-inspired conversational UX).
  Backend, API contracts, Groq integration, RAG, memory, training, admin,
  auth, storage and Vercel configuration were NOT modified.
- Method: three independent layers
  1. **DOM smoke (jsdom)** — 92 assertions driving the real UI code with a
     fixture API that mirrors the real contracts.
  2. **Real end-to-end (jsdom + live server + live Groq)** — 29 assertions:
     real first-run setup, real document upload, real RAG answer with a real
     citation, real general Q&A, persistence across a full page reload.
  3. **Visual QA (headless Chromium via Playwright)** — 48 assertions +
     screenshots at 320/375/390/414/430px, desktop 1280px, dark mode,
     simulated mobile keyboard.

## Results

| Layer | Result |
|---|---|
| Backend workflow suite (tests/test_workflows.py, live Groq) | **86/86 passed** |
| DOM smoke (boot, auth, send, markdown, history, rename/delete/search, views, drawer, settings, theme, a11y) | **92/92 passed** |
| File flows (attach, caps, unsupported-type explanation, remove, send-with-file, KB upload) | **18/18 passed** |
| Real E2E (static files, setup/login, RAG upload, live cited answer, live general answer, reload persistence) | **29/29 passed** |
| Visual / mobile-width (no horizontal scroll at 320–430px, drawer open/close, keyboard-safe composer, dark mode, copy feedback, Esc/keyboard nav) | **48/48 passed** |

## 22-item acceptance QA

1. New chat — ✓ (`.sb-new` desktop + drawer; empty state with 4 suggestions)
2. Send message — ✓ (Enter sends, Shift+Enter newline, optimistic render)
3. Real Groq response — ✓ (live: "2,400 naira" from uploaded memo; "Oslo" general)
4. History — ✓ (grouped Today / Yesterday / Previous 7 days / Older, previews, relative time)
5. Open previous conversation — ✓ (sidebar click + deep link `#/chat/{id}`, state preserved)
6. Rename — ✓ (modal; fixed latent bug — modal actions resolved `undefined`)
7. Delete — ✓ (confirm modal; switches to next conversation when current is deleted)
8. RAG question — ✓ (live: answer + real citation chip `memo.txt` + retrieval step)
9. Document upload — ✓ (chat attach + Knowledge upload; caps: 5 files, 25 MB, type explanation)
10. Memory — ✓ (view/approve suggestions; add/edit/delete flows, modal-value fix applied)
11. Training mode — ✓ (Learn view, teach, 🎓 training conversations)
12. Evaluation — ✓ (Admin → Evaluation; cases + runs via live run)
13. Error handling — ✓ (human wording "Something went wrong…", Try again, no technical leaks)
14. Mobile keyboard — ✓ (visualViewport → `--kb`; composer stays above the keyboard)
15. Mobile sidebar — ✓ (drawer opens via burger, closes after conversation select/new chat)
16. Dark mode — ✓ (full theme coverage incl. legacy views, code blocks, modals; persisted)
17. Light mode — ✓
18. Long AI response — ✓ (centered reading width, scroll, "Jump to latest")
19. Code block — ✓ (language label + Copy with "Copied" feedback, syntax highlighting js/py/sh/sql/json/go/rs/java/html/css)
20. Markdown — ✓ (headings, bold, lists, tables w/ horizontal scroll, blockquotes, inline code, links, `[S#]` citations)
21. Logout/login — ✓ (log out → auth screen; login restores session)
22. Owner/admin authorization — ✓ (Admin nav entry + route guard; non-owners redirected to chat)

## Bugs found and fixed during redesign QA (frontend only)

- Missing `hashchange` listener — sidebar/deep-link navigation did nothing.
- `modal()` removed its DOM before `await` continuations ran — rename, KB
  add/edit, memory add/edit silently no-oped. Fixed with deferred removal +
  label fallback for action `value`.
- Turn responses carry `message_id`, not `id` — message actions (feedback,
  regenerate) would have 404'd. Mapped in send/retry/regenerate.
- Regenerate left the old (server-deleted) answer in the DOM — now replaced.
- Auto-titled conversation didn't update the top-bar title.
- Closed mobile drawer stayed focusable off-screen (`display:flex` + transform)
  — now `visibility` hidden with animated transition.
- `copyText` had no failure path when the Clipboard API is unavailable —
  added execCommand fallback.
- Conversation state was lost when switching views and back — now preserved.
- Client-side unsupported-file-type explanation added to chat composer
  (PDF, DOCX, TXT, MD, CSV).

Screenshots: `qa-shots/` (desktop chat/answer/empty/settings/admin dark,
mobile 320–430, drawer, keyboard).

## UI/UX polish pass (final completion)

Final polish round on top of the redesign. All items verified with live
Playwright runs against the real backend + Groq (no mocks):

1.  **Modal focus trap** — Tab/Shift+Tab cycle inside open modals; Escape
    closes; focus returns to the invoking control. Verified across 10+ Tabs
    in both directions.
2.  **Per-view document titles** — e.g. "Knowledge · Precious AI",
    "Memory · Precious AI"; chat view uses the conversation title.
3.  **Sidebar previews** — `previewText()` strips markdown (code fences,
    inline code, bold, citations, links, headings, table rows, list bullets)
    so history one-liners never show `**`, ` ``` ` or table pipes.
4.  **Full-timestamp tooltips** — message meta ("just now · model · tokens")
    carries a `title` with the full local timestamp.
5.  **Composer auto-focus** — on viewports ≥900px the input is focused on
    mount and after each reply; disabled on mobile (no keyboard pop).
6.  **Safe-area insets** — top bar, drawer and auth screen respect
    `env(safe-area-inset-*)` for notched devices.
7.  **Reduced motion** — `prefers-reduced-motion: reduce` disables all
    animation/transition (verified: computed `animation-duration` = 0s).
8.  **Selection styling + smooth scroll + print rules** — accent
    `::selection`; smooth scroll only under no-preference; print hides
    chrome.
9.  **Pre-paint theme** — bootstrap moved to external `/js/theme.js` so it
    works under the app's strict CSP (`script-src 'self'`); theme applies
    before first paint and persists across reloads.
10. **"New chat" from any view** — routes to the chat view first (with
    `pendingNew` handoff) when chat isn't mounted; hash stays in sync via
    `history.replaceState`.
11. **Jump-to-latest anchoring** — button moved inside the `.messages`
    scroll area so it floats above the composer (previously overlapped the
    composer hint and was unclickable).
12. **Stale-view guards** — view-mounted checks use real DOM connectedness
    (`isConnected`) instead of stale element references; `selectConv` no-ops
    when the chat view isn't mounted.

Verification (this pass):
- `tests/test_workflows.py` — 86/86 (backend contracts, incl. live AI).
- Live visual audit (Playwright, real Groq) — 29/29: pristine first-run
  auth → setup → login → empty states → rich chat (table/code/citations,
  jump-to-latest) → 9 admin tabs → collapsed rail → focus trap → mobile
  375 (chat/knowledge/admin/memory, no horizontal overflow) → reduced
  motion.
- Focused smoke suite — 17/17: theme toggle/persistence/pre-paint,
  markdown-free sidebar previews, new-chat-from-other-view, delete with
  confirm modal, logout/login, mobile drawer open/navigate/close.

New screenshots: `qa-shots/audit-*.png` (auth, post-login, knowledge,
memory, training, rich chat, 9 admin tabs, rail, mobile ×3) and
`qa-shots/smoke-*.png`.

## Design system v3 — modern minimalist redesign (final)

Complete front-end redesign to a modern, minimalist, professional design
language. Frontend-only: no backend, API, auth, Groq/RAG, or Vercel-config
changes.

**Design system**
- Neutral professional palette (light: white surfaces / zinc neutrals; dark:
  #0f1012 surfaces), single blue accent for interactive states, near-black
  primary actions.
- Lucide-style stroke SVG icon system (no emoji anywhere in the UI; the
  old `✦`/`🎓`/`📚` glyphs replaced by an SVG brand mark and icon buttons).
- Restraint pass: 1px borders, minimal shadows, 8–14px radii, consistent
  spacing, tighter type scale, tabular numerals for stats.
- New: skeleton loaders (conversations, KB list, memory list, admin tabs),
  masked-SVG roadmap checkmarks, refined code blocks / tables / badges.
- Training-conversation marker moved from a `🎓` title prefix to a stable
  text title ("Training session") with legacy-title compatibility and a
  `displayTitle()` normalizer for the UI.

**Verification (this redesign)**
- `tests/test_workflows.py` — 86/86 (backend contracts incl. live AI, RAG,
  citations, uploads, memory, training, admin, auth).
- Live visual/functional audit (Playwright + real Groq) — 41/41: pristine
  first-run → setup → login → KB/memory/training views → rich chat
  (table + code + citations, jump-to-latest) → new-chat-from-any-view →
  delete with confirm → all 10 admin tabs → collapsed rail → modal focus
  trap → theme toggle/persistence → logout/login → mobile 375 (no
  horizontal overflow, drawer) → reduced motion → **emoji scan of every
  rendered view (zero found)**.
- No API contract changes; no new runtime dependencies; `vercel.json` and
  deployment config untouched; CSP (`script-src 'self'`) still satisfied
  (all JS external, pre-paint theme via `/js/theme.js`).

Screenshots: `qa-shots/final-*.png` (auth, post-login, knowledge, memory,
training, rich chat, admin overview/settings, rail, dark, mobile ×4).
