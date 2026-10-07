# Build plan (MVP) — for owner approval

Rule: nothing is built until the owner approves this plan. Each step ends with something the owner can open and test before the next step starts.

Stack: Tauri + React + Vite + TypeScript + SQLite, Tailwind + shadcn/ui, Kurdish (Sorani) RTL first, Arabic second.

## Steps

| # | Step | Owner can test |
|---|---|---|
| 0 | Update the mockup with the owner's edit list (sell screen = client first, several items per sale, invoice style) | Approve final look |
| 1 | Scaffold: Tauri + React + TS + Tailwind + shadcn, RTL, Kurdish font, sidebar shell with 5 empty screens, SQLite connected with migrations | App opens, sidebar works |
| 2 | Settings + Stock: units, categories, items, receive goods (amount, buy price, selling price), search + category chips, edit/cancel | Add and find items |
| 3 | Sell: client first, add several items, price pre-filled, stock check, paid amount, automatic debt, edit/cancel | Make a full sale, stock drops |
| 4 | Debts: list by client, record payments, history | Pay off a debt |
| 5 | Monthly costs: electricity, workers (one total), place | Enter a month |
| 6 | Dashboard + PIN lock: sales, profit, stock value, debts, costs, simple chart | Numbers match by hand once |
| 7 | Arabic language + language switch | Switch language |
| 8 | Polish and safety: change history log, automatic database backup, empty states, error messages, installer (.msi/.exe) | Install on a second PC |

## Later (not in MVP)
- Print invoice / receipt (design must leave room for it: invoice layout on the sale)
- Backup export/import to move data between PCs

## Long-run rules (apply to every step)
- Money is stored as whole IQD integers, never decimals/floats.
- Stock on hand is always calculated (received minus sold), never typed.
- Nothing is hard-deleted: cancel/edit keeps a history record.
- Database migrations from day one so updates never break old data.
- Automatic backup of the database file on every app start (keeps last N copies).
- The .db file is never committed to git.

## Data location (to confirm before step 1)
Database lives in the app's data folder on each PC. Moving data between PCs = backup export/import (step 8 / later), not git.
