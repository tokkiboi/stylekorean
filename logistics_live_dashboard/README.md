# Logistics Live Dashboard

This is a publish-ready public webpage for **LOGISTICS MASTER 2026**.

It reads live data from these Google Sheet tabs:

- `All Outbound Shipping Schedule`
- `INBOUND SHIPMENTS DATA`

## What is included

- Live Google Sheets data loading through Google Visualization API
- Outbound table with search, source filter, and status filter
- Inbound table with search, carrier-type filter, and status filter
- KPI cards for outbound/inbound totals
- 14-day inbound ETA timeline
- Light pastel source colors for outbound source types:
  - WH TRUCKING
  - B2B/E-COM
  - IHERB
  - TRANSFERS
  - ULTA
  - IMPORTS

## Important: make the Google Sheet readable by the website

The page runs in a public browser. It can only read the Sheet if the Sheet is publicly accessible.

In Google Sheets:

1. Open `LOGISTICS MASTER 2026`
2. Go to **File → Share → Publish to web**
3. Publish either:
   - **Entire document**, or
   - Only these tabs:
     - `All Outbound Shipping Schedule`
     - `INBOUND SHIPMENTS DATA`
4. Also make sure sharing is not blocked by your Workspace admin.

If the sheet is not public/published, the webpage will load but show a data-access warning.

## Publish option 1: GitHub Pages

1. Create a new GitHub repository, for example:
   `logistics-live-dashboard`

2. Upload these files to the repository root:
   - `index.html`
   - `styles.css`
   - `app.js`

3. Go to:
   **Settings → Pages**

4. Set:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`

5. Save.

The public URL will look like:

```text
https://YOUR-GITHUB-USERNAME.github.io/logistics-live-dashboard/
```

## Publish option 2: Netlify Drop

1. Go to Netlify Drop in your browser.
2. Drag the folder containing:
   - `index.html`
   - `styles.css`
   - `app.js`
3. Netlify will instantly create a public URL.

## Publish option 3: Vercel

```bash
npm i -g vercel
cd logistics_live_dashboard
vercel
```

Follow the prompts and choose a public project.

## Local preview

From the folder:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Change the source spreadsheet

Edit `app.js`:

```js
const CONFIG = {
  spreadsheetId: "YOUR_SPREADSHEET_ID",
  ...
};
```
