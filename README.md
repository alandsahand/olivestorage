# عالم طرشي والزيتون (Olive Storage)

A Windows desktop app (Tauri + React + TypeScript + SQLite) for a small olive business: stock, sales with several items per invoice, customer debts and refunds, monthly costs, and an owner-only dashboard. Kurdish (Sorani) and Arabic, right-to-left.

Project notes and decisions for the developer / Claude Code: see [CLAUDE.md](CLAUDE.md). Flow chart: [docs/flow.md](docs/flow.md). All texts for review: [docs/wording.md](docs/wording.md).

## Set up a PC (developer)

1. `git clone https://github.com/alandsahand/olivestorage.git`
2. Double-click `setup.cmd` (installs Git, Node, Rust, C++ Build Tools, WebView2, then `npm install`). Click Yes on admin prompts.
3. Run the app while developing: `npm run tauri dev` (the first build takes about 3 minutes).

## Check that everything works

```bash
npm test
```

Runs every automatic check (stock, sales, debts, costs, PIN security, dashboard numbers, translations). The Rust side has its own tests: `cargo test` inside `src-tauri`.

## Build the installer for the shop PC

```bash
npm run tauri build
```

The installer is created at `src-tauri/target/release/bundle/nsis/عالم طرشي والزيتون_<version>_x64-setup.exe`. Copy that one file to the shop PC and run it (installs for the current user, no admin needed; Windows 11 already has WebView2).

## Invoices (print / PDF)

On the Sell screen, a saved sale (or any sale in the sales list) has a **Print / PDF** button. It shows a preview of the invoice (logo, shop name, client, table of materials, totals, notes). The button opens the Windows print dialog: choose a printer to print on paper, or **Microsoft Print to PDF / Save as PDF** to save a PDF file.

The table columns are a plain list in `src/components/InvoiceSheet.tsx` (`INVOICE_COLUMNS`): to add, remove or reorder a column, edit that list. To preview the layout with sample data: `npm run dev`, then open `http://localhost:1420/#/__invoice-demo?lang=ar&lines=30&note=1` in a browser (development only).
## Where the data lives

`%APPDATA%\com.olivestorage.app\olivestorage.db` (one SQLite file). It is **not** in git.

### Backups

- Every time the app starts it copies the database to `%APPDATA%\com.olivestorage.app\backups\` (at most one copy per 6 hours). The newest 30 are kept.
- The **Backup** button in the sidebar makes a copy right now and opens the folder.

### Restore a backup

1. Close the app.
2. In `%APPDATA%\com.olivestorage.app\` delete `olivestorage.db`, `olivestorage.db-wal` and `olivestorage.db-shm`.
3. Copy the backup you want from `backups\` into that folder and rename it to `olivestorage.db`. If a file with the same name ending in `-wal` sits next to the backup, copy it too and rename it to `olivestorage.db-wal`.
4. Start the app.

### Moving data to another PC

Copy a backup file from the first PC and restore it on the second PC with the steps above.

## Forgotten owner PIN

On the Dashboard unlock screen choose "I forgot my PIN" and enter the long recovery code that was shown once when the PIN was created. If that code is lost too, the only way is to delete the two rows `pin_hash` and `recovery_hash` from the `settings` table (this removes the lock, it does not touch any business data).
