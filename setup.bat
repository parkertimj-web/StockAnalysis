@echo off
REM ── StockAnalysis — first-time setup (Windows) ───────────────────────────────
REM Double-click this once after downloading. It installs everything the app
REM needs. Run it again any time you download a new version.

cd /d "%~dp0"
title StockAnalysis setup

echo(
echo ============================================
echo   StockAnalysis - first-time setup
echo ============================================
echo(

REM 1) Check Node.js is installed
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js is not installed.
  echo(
  echo     Install it first from:  https://nodejs.org
  echo     Choose the "LTS" button ^(version 22 or newer^), run the installer,
  echo     then double-click this setup.bat again.
  echo(
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo [OK] Node.js %%v detected
echo(

REM 2) Create backend\.env from the template if it doesn't exist yet
if not exist "backend\.env" (
  copy "backend\.env.example" "backend\.env" >nul
  echo [OK] Created backend\.env  ^(add your free TwelveData key inside it^)
) else (
  echo [OK] backend\.env already exists - leaving it as-is
)
echo(

REM 3) Install dependencies for the root, backend and frontend
echo Installing dependencies ^(this can take a few minutes the first time^)...
echo(
call npm run install:all
if errorlevel 1 (
  echo(
  echo [X] Something went wrong installing dependencies. Scroll up for the error.
  pause
  exit /b 1
)

echo(
echo ============================================
echo   Setup complete!
echo ============================================
echo(
echo   NEXT STEP - add your free price-data key:
echo     1. Open the file  backend\.env  in Notepad
echo     2. Get a free key at  https://twelvedata.com/pricing  (Free plan)
echo     3. Paste it after  TWELVEDATA_API_KEY=  and save
echo(
echo   Then double-click  start.bat  to launch the app.
echo(
pause
