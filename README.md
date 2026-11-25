# VMS 3.0 – Order Packing Video System

Records order-packing and return videos at a packing station, uploads them to Google Drive,
and logs every recording in Google Sheets. It also handles order manifests with GTIN item
verification, search, reports, analytics and user admin.

## How it fits together

| Part | Where it runs | What it does |
|---|---|---|
| React app (`src/`) | Browser. Published to GitHub Pages by `.github/workflows/deploy.yml` | UI, camera recording, offline upload queue (IndexedDB), uploads |
| Apps Script backend (`backend/Code.gs`) | Google Apps Script web app | Sign-in, Users, Sheets logs, Drive folders, resumable uploads, search, reports |
| Station server (`server.ts`) – optional | Your own Node host (not GitHub Pages) | Fast Drive upload proxy, Sheet CSV proxy |

On GitHub Pages the app detects that the station server is missing and uses the parts that work
without it: uploads go through Apps Script.

## Setting up the backend

1. Create a Google Sheet, open **Extensions → Apps Script**, and paste `backend/Code.gs`.
   Copy the settings from `backend/appsscript.json`.
2. Run `setupSystem` once from the editor.
3. **Deploy → New deployment → Web app**, execute as *Me*, access *Anyone*. Put the `/exec` URL
   into the app's setup screen.
4. Open the app and **Create Account**. The first account on an empty Users sheet becomes the
   administrator. Accounts created after that wait for an administrator to approve them.

After any change to `backend/Code.gs`, paste it again and deploy a **new version** of the same
deployment, or use the admin button below.

### Updating the backend from the admin panel

**Settings → Backend code → Update backend now** downloads `backend/Code.gs` and
`backend/appsscript.json` from the `main` branch on GitHub, writes them into the Apps Script
project with the Apps Script API, saves a new version and moves the existing web-app deployment
to it (the `/exec` URL does not change). **Go back to vN** moves the deployment back.

One-time setup, done by the Google account that owns the script:

1. Turn on **Google Apps Script API** at https://script.google.com/home/usersettings.
2. In the editor, **Project Settings → Show "appsscript.json"**, then replace it with
   `backend/appsscript.json` (adds the `script.projects` and `script.deployments` permissions).
3. Paste `backend/Code.gs`, run `authorizeBackendUpdater` once and allow access.
4. **Deploy → Manage deployments → Edit → New version → Deploy.**

Limits: the button only installs what is on GitHub `main` (the browser cannot send code). If a new
`appsscript.json` asks for more Google permissions, the button stops and that update has to be done
by hand once. If Google reports that the Apps Script API is not enabled for the script's Cloud
project, open the link in that message and enable it.

## Development

```bash
npm install
npm run dev        # app + station server on http://localhost:3000
npm run lint       # TypeScript check
npm test           # backend (Code.gs in an Apps Script harness) and frontend tests
npm run build      # static app in dist/ and dist/server.cjs
```

`backend/tests/gas-harness.cjs` runs the real `Code.gs` under Node with in-memory Sheets,
Properties and Cache, so backend behaviour can be tested without Google.
