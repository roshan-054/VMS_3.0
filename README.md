# VMS 3.0 – Order Packing Video System

Records order-packing and return videos at a packing station, uploads them to Google Drive,
and logs every recording in Google Sheets. It also handles order manifests with GTIN item
verification, search, reports, analytics, user admin and a phone-as-barcode-scanner mode.

## How it fits together

| Part | Where it runs | What it does |
|---|---|---|
| React app (`src/`) | Browser. Published to GitHub Pages by `.github/workflows/deploy.yml` | UI, camera recording, offline upload queue (IndexedDB), uploads |
| Apps Script backend (`backend/Code.gs`) | Google Apps Script web app | Sign-in, Users, Sheets logs, Drive folders, resumable uploads, search, reports |
| Station server (`server.ts`) – optional | Your own Node host (not GitHub Pages) | WebSocket phone-scanner relay, fast Drive upload proxy, Sheet CSV proxy |

On GitHub Pages the app detects that the station server is missing and uses the parts that work
without it: phone pairing over PeerJS and uploads through Apps Script.

## Setting up the backend

1. Create a Google Sheet, open **Extensions → Apps Script**, and paste `backend/Code.gs`.
   Copy the settings from `backend/appsscript.json`.
2. Run `setupSystem` once from the editor.
3. **Deploy → New deployment → Web app**, execute as *Me*, access *Anyone*. Put the `/exec` URL
   into the app's setup screen.
4. Open the app and **Create Account**. The first account on an empty Users sheet becomes the
   administrator. Accounts created after that wait for an administrator to approve them.

After any change to `backend/Code.gs`, paste it again and deploy a **new version** of the same
deployment.

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
