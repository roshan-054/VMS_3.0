import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

interface ScanEvent {
  id: string;
  sessionId: string;
  barcode: string;
  timestamp: number;
  deviceInfo?: string;
}

// In-memory ring buffer for recent scan events
const recentScans = new Map<string, ScanEvent[]>();
// Active SSE client connections keyed by station sessionId
const sseClients = new Map<string, Set<express.Response>>();

function addScanEvent(sessionId: string, barcode: string, deviceInfo?: string): ScanEvent {
  const normSession = sessionId.trim().toUpperCase();
  const event: ScanEvent = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    sessionId: normSession,
    barcode: barcode.trim(),
    timestamp: Date.now(),
    deviceInfo: deviceInfo || 'Mobile Phone',
  };

  const list = recentScans.get(normSession) || [];
  list.push(event);
  if (list.length > 50) list.shift();
  recentScans.set(normSession, list);

  // Notify active SSE clients for this station
  const clients = sseClients.get(normSession);
  if (clients && clients.size > 0) {
    const dataStr = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      try {
        res.write(dataStr);
      } catch (err) {
        clients.delete(res);
      }
    }
  }

  return event;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: Date.now() });
  });

  // 1. Phone sends scanned barcode to station
  app.post('/api/phone-sync/scan', (req, res) => {
    const { sessionId, barcode, deviceInfo } = req.body || {};
    if (!sessionId || !barcode) {
      return res.status(400).json({ error: 'sessionId and barcode are required' });
    }

    const event = addScanEvent(sessionId, barcode, deviceInfo);
    console.log(`[PhoneSync] Received scan for ${sessionId}: ${barcode}`);
    res.json({ success: true, event });
  });

  // 2. Desktop connects via SSE stream for real-time zero-delay push
  app.get('/api/phone-sync/events/:sessionId', (req, res) => {
    const sessionId = (req.params.sessionId || '').trim().toUpperCase();
    if (!sessionId) {
      return res.status(400).end('Invalid sessionId');
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', sessionId, timestamp: Date.now() })}\n\n`);

    if (!sseClients.has(sessionId)) {
      sseClients.set(sessionId, new Set());
    }
    const clients = sseClients.get(sessionId)!;
    clients.add(res);

    // Keepalive ping every 15s
    const pingTimer = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(pingTimer);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(pingTimer);
      clients.delete(res);
    });
  });

  // 3. Fallback Long-Polling for environments where SSE might be buffered
  app.get('/api/phone-sync/poll/:sessionId', (req, res) => {
    const sessionId = (req.params.sessionId || '').trim().toUpperCase();
    const lastTimestamp = parseInt((req.query.since as string) || '0', 10);

    const list = recentScans.get(sessionId) || [];
    const newItems = list.filter(item => item.timestamp > lastTimestamp);

    res.json({
      sessionId,
      scans: newItems,
      serverTime: Date.now(),
    });
  });

  // 4. Check if station has active mobile scanner connected / ping
  app.post('/api/phone-sync/ping', (req, res) => {
    const { sessionId } = req.body || {};
    res.json({ ok: true, sessionId });
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VMS Station Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
