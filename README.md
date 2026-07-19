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
- **Outbound Shipments**: Derived from the `TRANSFERS`, `ULTA`, `IHERB`, `B2B/E-COM TRUCKING`, `WH Trucking Request`, and `NATIONAL ORDER PROGRESS` source tabs
- **Inbound Shipments**: Derived from the `IMPORTS` source tab; rows without a Shipping Date are excluded
- **Import Schedule**: Displayed separately from `INBOUND SHIPMENTS DATA!U238:AI260`

#### Task Status
- **Pending**: Items pending action (no status, customs hold, etc.)
- **In Progress**: Active shipments (ready to ship, in transit, arrived)
- **Completed**: Delivered, received, completed, cancelled, or shipped items
- **Blocked**: Delayed, held, or failed items

#### Task Features
- Search by task ID, customer, description, or reference
- Filter by status
- Persistent storage (browser localStorage) after a complete source refresh
- Paginated results when more than 1,000 tasks match the filters
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

2. Update the `ID` constant in `app.js`:
   ```javascript
   const ID = "YOUR_SHEET_ID_HERE";
   const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
   ```

### Auto-Refresh Interval
Modify `AUTO_REFRESH_INTERVAL` to change update frequency:
- Default: `5 * 60 * 1000` (5 minutes)
- Examples:
  - `1 * 60 * 1000` = 1 minute
  - `15 * 60 * 1000` = 15 minutes
  - `30 * 60 * 1000` = 30 minutes

`loadBase()` reads these source tabs and ranges:

- `IMPORTS!A1:AD340`
- `TRANSFERS!A1:N974`
- `ULTA!A1:N1012`
- `IHERB!A1:M967`
- `B2B/E-COM TRUCKING!A1:R853`
- `WH Trucking Request!A2:U1551`
- `NATIONAL ORDER PROGRESS!A1:U2503`
- `OUTBOUND WEBSITE EXCLUSIONS!A1:C500`

`loadImportSchedule()` reads `INBOUND SHIPMENTS DATA!U238:AI260` for the separate import timeline.

## Data Persistence

Tasks are automatically saved to browser localStorage and persist across page reloads. Clear localStorage to reset task history:
```javascript
localStorage.removeItem("dashboard_tasks");
```

## Sheet Structure Requirements

- Keep the source tab names and ranges listed above in sync with `loadBase()` and `loadImportSchedule()`.
- `IMPORTS` rows must include a Shipping Date plus an invoice, clean container, or air waybill identifier to appear in inbound shipments.
- `IMPORTS` parcel sections use the carrier and tracking columns in the existing workbook layout; rows without a Shipping Date are excluded.
- Outbound source tabs should retain their existing header labels because the loader maps fields by normalized header name.

## Browser Support
- Modern browsers with ES6 support
- Requires localStorage for task persistence
- CORS: Google Sheets must be publicly shared

## Troubleshooting

**"Could not load live sheet data"**
- Ensure spreadsheet is published to the web
- Verify the `ID`, source tab names, and ranges used by `loadBase()` and `loadImportSchedule()`
- Check browser console for CORS errors

**Tasks not updating**
- Clear browser cache and reload
- Verify the `autoRefresh` checkbox is enabled
- Check localStorage limit (5-10MB typical)

**Auto-refresh not working**
- Ensure "Auto-refresh every 5 min" checkbox is checked
- Check browser console for JavaScript errors
- Verify internet connection is stable
