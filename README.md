# Logistics Live Dashboard

A real-time shipping dashboard powered by Google Sheets with auto-refresh and task tracking capabilities.

## Features

### Live Data Updates
- **Auto-Refresh**: Dashboard automatically updates from Google Sheets every 5 minutes
- **Manual Refresh**: Click the "Refresh Data" button for immediate updates
- **Connection Status**: Visual indicator shows data sync status (loading, success, error)
- **Last Updated**: Timestamp showing when data was last refreshed
- **Next Refresh Timer**: Countdown showing seconds until the next automatic refresh

### Auto-Refresh Control
Toggle auto-refresh on/off with the checkbox in the status bar. When enabled:
- Dashboard fetches data every 5 minutes
- Real-time countdown timer updates every second
- Seamless updates preserve filter and search state

### Task Tracking

**Configured Tasks Panel** displays auto-tracked shipment tasks derived from live sheet data:

#### Task Types
- **Outbound Shipments**: From "All Outbound Shipping Schedule" sheet
- **Inbound Shipments**: From "INBOUND SHIPMENTS DATA" sheet

#### Task Status
- **Pending**: Items pending action (no status, customs hold, etc.)
- **In Progress**: Active shipments (ready to ship, in transit, arrived)
- **Completed**: Delivered or shipped items
- **Blocked**: Delayed, held, or failed items

#### Task Features
- Search by task ID, customer, description
- Filter by status
- Persistent storage (browser localStorage)
- Auto-updated on each data refresh

### KPI Dashboard
- Outbound Shipments count
- Shipped items count
- Active Inbound count (excluding delivered)
- Ocean container shipments
- Parcel/Air shipments (UPS, FedEx, DHL, USPS, Air)
- Estimated outbound cost

### Live Tables
1. **Outbound Shipping Schedule** - Searchable/filterable by source and status
2. **Inbound Shipments Data** - Searchable/filterable by carrier type and status
3. **Configured Tasks** - Searchable/filterable task tracking

### Timeline Views
- **Upcoming Inbound ETA**: Next 14 days of inbound shipments
- **Import 2-Week Schedule**: Live import schedule from the inbound tab

## Configuration

### Google Sheets Setup
1. Publish your spreadsheet to the web:
   - File → Share → Publish to web
   - Select sheets to publish
   - Copy the spreadsheet ID

2. Update `CONFIG.spreadsheetId` in `app.js`:
   ```javascript
   const CONFIG = {
     spreadsheetId: "YOUR_SHEET_ID_HERE",
     autoRefreshInterval: 5 * 60 * 1000, // 5 minutes
     sheets: {
       outbound: { name: "Sheet Name", range: "A3:W7000" },
       inbound: { name: "Sheet Name", range: "A3:Q1200" },
       importSchedule: { name: "Sheet Name", range: "U238:AI260" }
     }
   };
   ```

### Auto-Refresh Interval
Modify `CONFIG.autoRefreshInterval` to change update frequency:
- Default: `5 * 60 * 1000` (5 minutes)
- Examples:
  - `1 * 60 * 1000` = 1 minute
  - `15 * 60 * 1000` = 15 minutes
  - `30 * 60 * 1000` = 30 minutes

## Data Persistence

Tasks are automatically saved to browser localStorage and persist across page reloads. Clear localStorage to reset task history:
```javascript
localStorage.removeItem("dashboard_tasks");
```

## Sheet Structure Requirements

### Outbound Sheet
- Column A: SOURCE
- Column B: CUSTOMER
- Column C: INVOICE NO.
- Must start at row 3

### Inbound Sheet
- Column A: Carrier Type
- Column B: Shipment #
- Column C: Invoice
- Column M: Inbound Status
- Must start at row 3

## Browser Support
- Modern browsers with ES6 support
- Requires localStorage for task persistence
- CORS: Google Sheets must be publicly shared

## Troubleshooting

**"Could not load live sheet data"**
- Ensure spreadsheet is published to the web
- Verify sheet names and ranges in CONFIG
- Check browser console for CORS errors

**Tasks not updating**
- Clear browser cache and reload
- Verify `autoRefreshCheckbox` is enabled
- Check localStorage limit (5-10MB typical)

**Auto-refresh not working**
- Ensure "Auto-refresh every 5 min" checkbox is checked
- Check browser console for JavaScript errors
- Verify internet connection is stable
