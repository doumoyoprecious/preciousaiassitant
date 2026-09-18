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
