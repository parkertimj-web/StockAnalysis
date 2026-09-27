# StockApp — Claude working notes

## End-of-session directive
**When finishing a session (wrapping up a task, before ending your turn), present how to open or run whatever that task actually produced** — the thing the user needs in order to use the work.

Match the deliverable, not a fixed template:
- **Changes to this app** → the run instructions in *How to run the StockApp dev server* below. Show them even if the dev server appears to be running, since backend changes to `package.json` scripts or Node flags only take effect on a fresh start.
- **A generated file** (HTML page, report, spreadsheet) → its path or `file://` link.
- **A published page or PR** → its URL.
- **Analysis or an answer with no artifact** → nothing; do not append run instructions.

Only one set of instructions, for the work just completed. Do not append the StockApp dev-server block to unrelated tasks.

## How to run the StockApp dev server

```bash
cd /Users/homefolder/StockApp
npm run dev
```

Then open **http://localhost:5173**

- `npm run dev` runs both servers via `concurrently`:
  - **Backend API** → http://localhost:3001 (Express + SQLite, nodemon auto-restart)
  - **Frontend** → http://localhost:5173 (Vite, proxies `/api` to the backend)
- First run / after pulling changes: `npm install --prefix backend && npm install --prefix frontend`
- Requires **Node 22+** (backend uses `node --experimental-sqlite`).
- Backend config lives in `backend/.env`.
- In dev the backend ignores `PORT` (tools export it for the frontend) and uses `API_PORT` or 3001, matching the Vite proxy. `PORT` is only read in production (Railway).

## Notes
- Live prices resolve as: Yahoo batch quote (fresh, one call for the whole watchlist) → CBOE delayed quote → latest daily close. Every quote is validated for freshness (`isQuoteFresh`); a stale/frozen feed is rejected so it can't override the fresh close.
- Restart the dev server after changing `backend/package.json` scripts (e.g. the `--max-http-header-size` flag) — nodemon hot-reloads source files but not the launch command.
