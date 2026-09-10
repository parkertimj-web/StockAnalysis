# Running StockAnalysis on Windows

A simple one-time setup, then it's double-click to launch. ~15 minutes the first time.

---

## Step 1 — Install Node.js (one time)

1. Go to **https://nodejs.org**
2. Click the big **LTS** button (get **version 22 or newer**) and run the installer.
3. Click Next through the installer, accept the defaults, and finish.

*(This is the engine the app runs on. You only ever install it once.)*

---

## Step 2 — Download the app

1. Go to the project page: **https://github.com/parkertimj-web/StockAnalysis**
2. Click the green **Code** button → **Download ZIP**.
3. **Right-click the downloaded ZIP → Extract All…** and pick a folder you'll remember (e.g. your Desktop). You should end up with a `StockAnalysis` folder full of files.

---

## Step 3 — Run setup (one time)

1. Open the `StockAnalysis` folder.
2. **Double-click `setup.bat`.**
3. A black window opens and installs everything. Wait until it says **"Setup complete!"**, then close it.

> If Windows shows a blue **"Windows protected your PC"** box, click **More info → Run anyway**. (That warning appears for any file downloaded from the internet — it's just a script that installs the app.)

---

## Step 4 — Add your free price-data key (one time)

The stock charts and signals need a free key from TwelveData. *(Skip this if you only want the Options, FX, Crash History, Japan/China Watch, and news pages — those work without it.)*

1. Get a free key (30 seconds, no credit card) at **https://twelvedata.com/pricing** — pick the **Free / Basic** plan and copy the API key.
2. In the `StockAnalysis\backend` folder, open the file named **`.env`** with **Notepad**.
3. Find the line `TWELVEDATA_API_KEY=` and paste your key right after the `=`, so it looks like:
   ```
   TWELVEDATA_API_KEY=abcd1234yourkeyhere
   ```
4. **Save** the file (Ctrl+S) and close Notepad.

---

## Step 5 — Launch it (every time)

1. **Double-click `start.bat`.**
2. A window opens and, after a few seconds, your browser opens the app at **http://localhost:5173**.
3. **Keep that black window open** while you use the app.
4. To stop, just close the window.

That's it — from now on it's only Step 5. Double-click `start.bat`, use the app, close the window when done.

---

## Good to know

- **It runs only on this PC.** The app lives at `localhost`, so it works in this computer's browser but can't be opened from a phone or another machine.
- **Your data is your own.** Your watchlist, journal, and alerts are saved locally on this PC.
- **To get new features later**, download the ZIP again (Step 2), extract it over the old folder (or into a new one), and re-run `setup.bat`.

## If something doesn't work

- **"Node.js is not installed"** → do Step 1, then run `setup.bat` again.
- **Charts/signals are blank** → you likely skipped Step 4, or the key has a typo. Re-open `backend\.env` and check.
- **Browser says "can't reach this page"** → give it another 10–15 seconds after `start.bat` opens (the server is still starting), then refresh.
- **"Port already in use"** → an old copy is still running. Close any other StockAnalysis windows and try again.
