# StyleKorean Logistics Integration Platform

## Purpose

The platform consolidates operational sources into one dashboard while keeping
source ownership visible. Google Sheets is the current read-only provider. Any
provider requiring credentials must be connected through a private server-side
API; secrets must never be added to this public GitHub Pages repository.

## Runtime architecture

1. `platform-config.js` registers providers, sources, ranges, roles, completion
   rules, refresh timing, and verified carrier overrides.
2. `app.js` loads every registered source independently, normalizes it into
   inbound, outbound, parcel, exclusion, or KPI records, and reconciles
   duplicate planning-grid entries.
3. The dashboard renders operational schedules, source links, health, row
   coverage, exceptions, costs, tracking, and active-only views.
4. The Health JSON export provides a machine-readable integration snapshot for
   support, monitoring, or a future alerting service.

## Normalized operational fields

- Identity: source, source tab, shipment/order/invoice/container/tracking ID
- Schedule: ship date, ETA, delivery date
- Route: origin, destination, carrier, mode
- Load: pallets, cartons, quantity, dimensions, weight
- Finance: rate and cost totals
- State: Scheduled, Shipping, Delivered, Received, Completed, Cancelled
- Traceability: direct source-sheet and carrier-tracking links

## Connector contract

Each source entry in `platform-config.js` requires:

- `id`: stable internal identifier
- `tab`: source dataset name
- `range`: bounded source range
- `kind`: inbound, outbound, filter, or KPI
- `provider`: registered provider name
- `gid`: link target for the source sheet

New source layouts also require a mapper in `app.js` that outputs the normalized
fields above. Add a smoke-test fixture before publishing.

## Secure API connector boundary

Siliconii, DHL, UPS, FedEx, or other authenticated APIs should use this pattern:

`GitHub Pages dashboard -> private API/worker -> provider API`

The private API should return normalized JSON, enforce `@stylekoreanus.com`
access, store credentials in encrypted deployment secrets, use a least-privilege
service account, and record an audit log. Browser code must never receive a
provider username, password, session cookie, TOTP secret, or unrestricted token.

## Editable operations backlog

| Job name | Operation detail |
| --- | --- |
| Source Registry | Add, remove, rename, or reclassify source datasets in one manifest. |
| Sheet Ingestion | Fetch every registered Google Sheet range independently with timeout and health reporting. |
| Siliconii Connector | Retrieve approved CSMS order/shipment fields through a private authenticated adapter. |
| Status Normalization | Map source wording and greyed/completed markers into the shared state model. |
| Schedule Reconciliation | Merge detailed shipment rows with IMPORTS planning-grid dates without duplicates. |
| Completion Automation | Write approved completion status changes through a domain-restricted endpoint. |
| Carrier Tracking | Link and optionally poll supported carrier APIs through private server-side adapters. |
| Data Quality Monitor | Detect missing dates, duplicate IDs, stale sources, unavailable tabs, and unmapped fields. |
| Health Export | Download current connectivity, freshness, row volume, and active-record totals as JSON. |
| Alerting | Notify operations when a source fails, a shipment is late, or tracking reports an exception. |
| Access Control | Restrict private operational actions and APIs to authorized StyleKorean members. |
| Audit Log | Record source refreshes, completion changes, connector errors, and user actions. |

## Validation before publishing

```bash
node --check platform-config.js
node --check app.js
node --test '*.test.js'
node smoke-test.js
```
