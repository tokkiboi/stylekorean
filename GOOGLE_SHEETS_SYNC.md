# Google Sheets relational write-back

The dashboard already reads **LOGISTICS MASTER 2026**. These files add validated status write-back to the original source worksheets.

## Deploy the endpoint

1. Open https://script.google.com and create a project named `StyleKorean Logistics Sync`.
2. Replace `Code.gs` with the contents of `google-apps-script/Code.gs`.
3. Deploy > New deployment > Web app.
4. Execute as: **Me**.
5. Choose the narrowest access option that works for dashboard users. Do not use anonymous public access unless you accept that anyone with the endpoint can submit allowed status changes.
6. Copy the `/exec` deployment URL.
7. In `relational-sync.js`, set `appsScriptUrl` to that URL and commit the change.

## Relations

- Outbound rows resolve to their original source tab using PRO/BOL, invoice/PO, customer, and ship date.
- Inbound rows use the existing `IMPORTS Source Row` relation and update the matching IMPORTS row.
- The endpoint only accepts the configured source tabs and the exact status values already used by the workbook.
- A stale-value check prevents overwriting a status that changed after the dashboard loaded.
