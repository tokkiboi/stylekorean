# Database activation

The site is database-ready but intentionally remains in Google Sheets fallback
mode until a hosted Supabase project is configured and seeded.

## Deploy

1. Create a Supabase project in the desired US region.
2. Apply `supabase/migrations/202607200001_logistics_platform.sql`.
3. Deploy `supabase/functions/source-sync`.
4. Set Edge Function secrets: `SUPABASE_SECRET_KEY` and a random
   `SOURCE_SYNC_SECRET`. Never commit either value.
5. Add the GitHub Pages URL and the final custom domain to Supabase Auth redirect
   URLs. Enable only approved authentication methods.
6. Create source rows matching the keys in `platform-config.js`; place each
   protected Apps Script or API callback in `sources.config.writeback_url`.
7. Run an initial source ingest and reconcile counts against the Sheets
   dashboard before enabling database-first reads.
8. Set `url`, `publishableKey`, and `enabled: true` in `database-config.js`.
9. After reconciliation, set `preferDatabase: true` and publish.

The publishable browser key is designed for client use with RLS. The secret key
bypasses RLS and belongs only in the Edge Function environment.

## Two-way flow

```text
Google Sheets / Siliconii / carrier API
  -> source-sync ingest
  -> Postgres shipments + audit history
  -> member dashboard
  -> update_shipment RPC
  -> sync_outbox
  -> source-sync flush
  -> original source write-back endpoint
```

## Member roles

- Viewer: read synchronized operational data.
- Dispatcher: edit approved shipment fields and statuses.
- Admin: manage connectors and member roles through protected administration.

New members default to Viewer and must use an `@stylekoreanus.com` email.
