@echo off
REM ── StockAnalysis — launch the app (Windows) ─────────────────────────────────
REM Double-click to start. A browser tab opens automatically after a few seconds.
REM Keep this window OPEN while you use the app. Close it (or press Ctrl+C) to stop.

cd /d "%~dp0"
title StockAnalysis - running (keep this window open)

REM Safety check: has setup been run?
if not exist "node_modules" (
  echo It looks like setup hasn't been run yet.
  echo Please double-click  setup.bat  first, then run this again.
  echo(
  pause
  exit /b 1
)

echo(
echo Starting StockAnalysis...
echo A browser tab will open at  http://localhost:5173  in a few seconds.
echo Keep THIS window open while you use the app. Close it to stop.
echo(

REM Open the browser after a short delay, in parallel with the server starting
start "" cmd /c "timeout /t 9 >nul & start http://localhost:5173"

REM Run both backend + frontend (this blocks and keeps the app alive)
call npm run dev
