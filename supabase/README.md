# Supabase fast data

VMS answers searches, logs, reports, analytics, manifests, pack logs and the GTIN catalog from
Supabase, and saves those changes there first. The Google Sheet is unchanged and stays the
backup: a background job copies every change into it within about a minute (usually a few seconds).
Videos stay in Google Drive. If Supabase is not set up, paused or unreachable, the app uses
Apps Script exactly as before.

## One-time setup

1. In Supabase, open **SQL Editor**, paste the whole of `vms_schema.sql` (Settings > Supabase has a
   **Copy database script** button) and click **Run**. Running it again later is safe.
2. In VMS, go to **Settings > Backend code** and click **Update backend now**.
3. In **Settings > Supabase**, enter the Project URL, the anon (publishable) key and the
   service_role (secret) key from Supabase **Project Settings > API**, then click **Save and test**.
   The service key is stored only in Apps Script's Script Properties; it is never sent to browsers.
4. Click **Copy Sheet data to Supabase** once. Stations pick up the new setup at their next login
   or page load.

## Security

- All data lives in the `vms_private` schema, which the Supabase API does not expose. Row level
  security is on with no policies, and every table grant is revoked.
- Browsers can only call `vms_*` functions that check the VMS login token. Users and SecurityLog are
  admin-only; backups are admin-only. Password hashes are never copied to Supabase.
- Sync functions (`vms_sync_*`, `vms_mirror_rows`, `vms_reconcile_tab`, sessions) need the service key.

## Good to know

- Free Supabase projects pause after a week with no activity. VMS keeps working through Apps Script
  while paused; restore the project from the Supabase dashboard.
- **Settings > Download backup** exports every tab (or a date range of the log tabs) as Excel with
  the Sheet's tabs, columns and DD-MMM-YY dates. Users, Branding and GTINCatalog are always whole.
- Checks for recordings still in progress, uploads and anything touching Drive still go to Apps Script.
