import express from 'express';
import http from 'http';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { isDriveUploadUrl } from './serverSecurity';

dotenv.config();


async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);


  // High-Speed Direct Google Drive Binary Chunk Streaming Proxy
  // Bypasses browser CORS & Apps Script Base64 bottlenecks: streams raw binary directly to Google Drive (100+ Mbps)
  app.put('/api/drive/resumable-chunk', express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
    const uploadUrl = (req.headers['x-drive-upload-url'] as string || '').trim();
    const contentRange = (req.headers['content-range'] as string || '').trim();
    const contentType = (req.headers['content-type'] as string || 'video/mp4').trim();

    if (!uploadUrl) {
      return res.status(400).json({ success: false, error: 'Missing x-drive-upload-url header' });
    }
    if (!isDriveUploadUrl(uploadUrl)) {
      return res.status(400).json({ success: false, error: 'x-drive-upload-url must be a Google Drive resumable upload session URL' });
    }
    if (!/^bytes (\d+-\d+|\*)\/(\d+|\*)$/.test(contentRange)) {
      return res.status(400).json({ success: false, error: 'Invalid Content-Range header' });
    }

    try {
      const driveResp = await fetch(uploadUrl, {
        method: 'PUT',
        redirect: 'manual',
        headers: {
          'Content-Range': contentRange,
          'Content-Type': contentType,
        },
        body: req.body, // Raw binary Buffer from client
      });

      const status = driveResp.status;

      if (status === 308) {
        // Chunk accepted by Google Drive, waiting for next chunk
        return res.status(200).json({
          success: true,
          status: 308,
          driveStatus: 308,
          range: driveResp.headers.get('range') || '',
        });
      }

      if (status === 200 || status === 201) {
        // Completed: Google Drive created the file!
        const driveJson = await driveResp.json().catch(() => ({}));
        return res.status(200).json({
          success: true,
          status: 200,
          driveStatus: status,
          fileId: driveJson.id || '',
          file: driveJson,
        });
      }

      if (status === 404 || status === 410) {
        return res.status(200).json({
          success: false,
          status: status,
          driveStatus: status,
          sessionExpired: true,
          error: 'Google Drive upload session expired',
        });
      }

      const errText = await driveResp.text().catch(() => '');
      return res.status(200).json({
        success: false,
        status: status,
        driveStatus: status,
        error: `Google Drive returned ${status}: ${errText}`,
      });
    } catch (err: any) {
      console.warn('Drive resumable chunk streaming error:', err);
      return res.status(502).json({
        success: false,
        error: err.message || 'Error streaming chunk to Google Drive',
      });
    }
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // API Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'Order Packing Video System (VMS 3.0)',
      stationServer: true,
      time: Date.now(),
    });
  });

  // Google Sheet direct CSV fetch proxy (bypasses browser CORS & provides clear error messaging)
  app.get('/api/proxy/sheet-csv', async (req, res) => {
    try {
      const sheetId = String(req.query.sheetId || '').trim();
      const tabName = String(req.query.tabName || 'GTINCatalog').trim();
      if (!sheetId) {
        return res.status(400).json({ error: 'Missing sheetId query parameter' });
      }
      if (!/^[A-Za-z0-9_-]{10,100}$/.test(sheetId) || tabName.length > 100) {
        return res.status(400).json({ error: 'Invalid sheetId or tabName' });
      }

      const encTab = encodeURIComponent(tabName);
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encTab}`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      const text = await response.text();
      if (
        text.startsWith('<!DOCTYPE') ||
        text.startsWith('<html') ||
        text.includes('accounts.google.com') ||
        text.includes('login') ||
        text.includes('找不到網頁')
      ) {
        return res.status(403).json({
          error:
            'Google Sheet is not shared publicly. In Google Sheets, click "Share" -> change General Access to "Anyone with the link can view".',
        });
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(text);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to fetch Google Sheet CSV' });
    }
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`VMS Station Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
