# Olive Storage — project handoff

## What this is
A simple "olive storage" app, built by the owner on a PC. It is a small, easy project.
(Exact features and tech stack are NOT decided yet — first job is to settle them below.)

## How the owner works
- Works on this project from several different PCs, never one fixed place.
- Does not want to depend on GitHub push/pull to continue. Context must live with the project files.
- The project folder must be kept identical across PCs (synced folder such as OneDrive/Google Drive, or copy it).
- Planning started in a claude.ai chat linked to the "storage" Project; development continues in Claude Code.

## Rules for Claude in this project
1. At the START of every session, read this file and continue from "Next steps".
2. At the END of every session (or when asked), update "Decisions", "Done" and "Next steps" below.
3. Keep the app simple. Ask before adding big features or dependencies.

## Decisions
- Tech stack (owner's choice): React + Vite + TypeScript + Tauri + SQLite. Platform = Windows desktop app (Tauri).
- Owner has a GitHub account and wants the project connected to a GitHub repo (supersedes the "no GitHub" note above; keep this file in the repo so context travels).
- Owner will describe the app's flow/sequence themselves, step by step.

## To decide first
- What does the app store/track? (olives, jars, barrels, oil, stock, sales, locations?) — owner will describe the flow
- GitHub repo URL
- SQLite file location across PCs (the .db file should NOT be committed to git; decide on sync/export)

## Done
- Nothing built yet. Folder created: olivestorage.

## Next steps
0. On every PC, run `setup.cmd` (calls scripts/setup.ps1): checks/installs Git, Node, Rust, MSVC C++ Build Tools, WebView2, then npm install. First PC status: Node, Rust, WebView2 OK; Git and C++ Build Tools failed because the admin (UAC) prompt was cancelled — re-run setup.cmd by double-clicking and click Yes.
1. Get the GitHub repo URL, `git init`, connect the remote.
1b. Get the owner's description of the app flow and record it under Decisions.
2. Propose a minimal first version (MVP) and get approval.
3. Scaffold the project and update this file.
