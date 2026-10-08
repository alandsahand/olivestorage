# Olive Storage — project handoff

## What this is
A simple "olive storage" app, built by the owner on a PC. It is a small, easy project.
(Exact features and tech stack are NOT decided yet — first job is to settle them below.)

## How the owner works
- Works on this project from several different PCs, never one fixed place.
- Does not want to depend on GitHub push/pull to continue. Context must live with the project files.
- The project folder must be kept identical across PCs (synced folder such as OneDrive/Google Drive, or copy it).
- Planning started in a claude.ai chat linked to the "storage" Project; development continues in Claude Code.

## Starting on another PC (do this every time)
1. First time only: `git clone https://github.com/alandsahand/olivestorage.git` (sign in to GitHub when asked). If you copied the folder instead, delete `node_modules` and `src-tauri\target` from the copy first.
2. Double-click `setup.cmd` (installs/checks Git, Node, Rust, C++ Build Tools, WebView2, then `npm install`). Click Yes on admin prompts.
3. Every session start: `git pull`, then open Claude Code in the folder and say "read CLAUDE.md and continue".
4. Run the app: `npm run tauri dev` (first Rust build ~3 min).
5. Every session end: Claude updates CLAUDE.md, then `git add -A`, commit, `git push`.
The database is per-PC and is not in git.

## Rules for Claude in this project
1. At the START of every session, read this file and continue from "Next steps".
2. At the END of every session (or when asked), update "Decisions", "Done" and "Next steps" below.
3. Keep the app simple. Ask before adding big features or dependencies.

## Decisions
- Tech stack (owner's choice): React + Vite + TypeScript + Tauri + SQLite. Platform = Windows desktop app (Tauri).
- Owner has a GitHub account and wants the project connected to a GitHub repo (supersedes the "no GitHub" note above; keep this file in the repo so context travels).
- Process order (owner's rule): flow chart FIRST, then UI design, then build. Do NOT build anything before the owner approves flow + UI.
- App idea: general stock + selling app. Owner receives goods (amount, name, unit, buy price, default selling price). Selling picks an item, selling price is pre-filled from default (editable), stock decreases. Clients may pay partially -> debt, paid off later. Separate monthly costs section: electricity, workers, place. Owner-only dashboard (locked).
- Priorities: solid and reliable for years (long-run data safety, stock derived from records not typed), automatic calculations (owner has little time to check), easy to use, beautiful.
- Owner answers: buy price varies per delivery (stored per delivery); workers = one monthly total; currency IQD only (no decimals); dashboard lock = PIN; sales/stock/payments/costs editable and cancellable anytime with automatic recalculation + history log; languages = Kurdish (Sorani) + Arabic only, RTL.
- Units are user-defined (own list, customizable). Items are grouped by user-defined categories (permanent) + search, to find items fast. Default language = Kurdish.
- UI: simple, modern, beautiful. Owner likes 21st.dev-style (shadcn/ui-based) components -> plan: Tailwind + shadcn/ui, components from 21st.dev, RTL-first, Arabic-script font.
- Sell screen change (owner): sale starts with the CLIENT NAME, can hold several items (invoice style). Printing invoices is planned for later; keep room for it. The mockup's sell screen still needs updating to this.
- Build plan: docs/build-plan.md (steps 0-8), awaiting owner approval.
- Flow draft is in docs/flow.md (mermaid). Open questions are listed at its bottom.

## To decide first
- What does the app store/track? (olives, jars, barrels, oil, stock, sales, locations?) — owner will describe the flow
- GitHub repo URL
- SQLite file location across PCs (the .db file should NOT be committed to git; decide on sync/export)

## Done
- Nothing built yet. Environment installed (Node, Rust, Git, C++ Build Tools, WebView2), setup.cmd written, GitHub repo alandsahand/olivestorage connected and first commit pushed.
- Flow chart written: docs/flow.md (answers recorded).
- Step 1 scaffold DONE and running: Tauri 2 + React 19 + Vite + TS + Tailwind 4, RTL Kurdish/Arabic switch (src/i18n.tsx), sidebar + 5 placeholder pages (src/App.tsx), SQLite via tauri-plugin-sql with migrations in src-tauri/src/lib.rs (migration 1 = settings table), DB connected and verified.
- Step 2 Stock DONE and tested (2026-10-08): units + categories (create inline, rename, archive), items (new/edit/archive), receive goods (qty + buy price per delivery), deliveries list with edit/cancel, search (Arabic/Kurdish letter variants unified) + category chips, history_log on every change. Code: src/data/stock.ts, src/pages/Stock.tsx, src/pages/StockModals.tsx, src/components/ui.tsx, src/lib/format.ts. Migration: src-tauri/migrations/002_stock.sql.
- Engineering rules in force: money = whole IQD integers; quantities = integer thousandths (qty_milli, 2.5 kg = 2500); on-hand is always calculated; nothing hard-deleted (archive/cancel + history_log). NEVER edit a released migration (the DB checks checksums) — add 003_*.sql etc. Migration 1 stays inline in lib.rs byte-for-byte; .gitattributes forces LF on *.sql.
- Tests: `npm test` runs scripts/test-stock.ts (real SQLite via node:sqlite on the real migration file). Add a test file per step.
- Known limits to handle in step 3: editing/cancelling a delivery must be blocked or checked if sales already used that stock (on-hand must never go negative). The Stock screen has no delete of units/categories, only archive (by design).
- This PC's dev database contains test data created while verifying step 2 (item "زەیتوونی ڕەش", categories زەیتوون/زەیت, unit کیلۆ). Safe to delete the .db file to start clean.
- Step 3 Sell DONE and tested (2026-10-08): client first (typed name, existing clients suggested, new ones created automatically), several items per sale, price pre-filled + editable, qty +/- and typed decimals, live total, "paid" defaults to paid-in-full until the owner types a lower amount, debt = total - paid, stock check (can't oversell, message shows what is available), sales history tab with edit and cancel, print button present but disabled ("coming soon"). Code: src/data/sales.ts, src/pages/Sell.tsx, src-tauri/migrations/003_sales.sql, src/lib/errors.ts.
- Sales data model: a sale is visible only when sales.rev >= 1; sale_lines belong to a revision (sale_lines.rev); current lines = rev equal to sales.rev. Create = insert rev 0 + lines, then flip to rev 1; edit = insert lines at rev+1 then flip sales.rev in one UPDATE (atomic, old revisions stay as history; failed attempts are cleaned up). Any new query on sales/lines MUST filter `sa.rev >= 1` and join lines on `l.rev = sa.rev`, and exclude `cancelled_at IS NOT NULL` for stock/profit.
- Cost for profit: each sale line stores buy_price = the item's LAST buy price at the time of sale (kept unchanged when the sale is later edited). Owner has not been asked about this method (alternatives: average cost, FIFO) — mention it when building the Dashboard (step 6).
- Stock guard added: a delivery cannot be cancelled/shrunk if sold stock depends on it ("insufficient").
- Quantities in text boxes use qtyText() (Kurdish digits, "٫", no thousands separators); display uses formatQty().
- Dev DB on this PC also holds a test sale (cancelled) for client "ئاسۆ محمد".
- Mockup sell screen updated: client first, several items, print button (coming soon).
- UI mockup (Kurdish, RTL, olive green on cream, 5 screens): docs/mockup/index.html. Owner approved the look, edits to come.

## Next steps
0. On every PC, run `setup.cmd` (calls scripts/setup.ps1): checks/installs Git, Node, Rust, MSVC C++ Build Tools, WebView2, then npm install. First PC status: Node, Rust, WebView2 OK; Git and C++ Build Tools failed because the admin (UAC) prompt was cancelled — re-run setup.cmd by double-clicking and click Yes.
1. (done) Flow reviewed, questions answered.
2. (done, small edits pending) UI mockup docs/mockup/index.html — owner likes it. Collect the owner's edit list and apply to the mockup.
3. (done) MVP plan approved: docs/build-plan.md. Database stays per-PC (not synced), owner OK with it (all PCs are dev PCs).
4. (done) Step 0 + Step 1 of build plan.
5. (done) Step 2 — Stock.
6. (done) Step 3 — Sell.
7. NEXT: Step 4 — Debts: list clients who owe (sum of debt per client + per sale), record later payments (new `payments` table via migration 004; payments editable/cancellable), history. Then update the debt formula in src/data/sales.ts (SALE_COLS: debt = total - paid - SUM(non-cancelled payments)) and the History tab/Sell tests. Decide what happens to payments when a sale is cancelled (suggest: keep payment records, show them as money to refund/credit; ask the owner). Then steps 5-8; owner tests each step before the next.

How to run: `npm install` then `npm run tauri dev` (first Rust build ~3 min). DB file: %APPDATA%\com.olivestorage.app\olivestorage.db.
