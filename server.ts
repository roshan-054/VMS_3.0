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

interface StationState {
  lastDesktopPing: number;
  lastPhonePing: number;
  desktopName?: string;
  phoneDevice?: string;
}

// In-memory ring buffer for recent scan events per station
const recentScans = new Map<string, ScanEvent[]>();
// Active SSE client connections keyed by station sessionId
const sseClients = new Map<string, Set<express.Response>>();
// Active station state tracker
const stationStates = new Map<string, StationState>();

// Long-polling pending waiters Map<sessionId, Array<(event: ScanEvent) => void>>
const pollWaiters = new Map<string, Set<(event: ScanEvent) => void>>();

function addScanEvent(sessionId: string, barcode: string, deviceInfo?: string): ScanEvent {
  const normSession = sessionId.trim().toUpperCase();
  const event: ScanEvent = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    sessionId: normSession,
    barcode: barcode.trim(),
    timestamp: Date.now(),
    deviceInfo: deviceInfo || 'Mobile Phone',
  };

  // Update ring buffer
  const list = recentScans.get(normSession) || [];
  list.push(event);
  if (list.length > 100) list.shift();
  recentScans.set(normSession, list);

  // Update phone heartbeat
  const state = stationStates.get(normSession) || { lastDesktopPing: 0, lastPhonePing: 0 };
  state.lastPhonePing = Date.now();
  if (deviceInfo) state.phoneDevice = deviceInfo;
  stationStates.set(normSession, state);

  // 1. Notify active SSE clients immediately
  const clients = sseClients.get(normSession);
  if (clients && clients.size > 0) {
    const dataStr = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      try {
        res.write(dataStr);
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
      } catch (err) {
        clients.delete(res);
      }
    }
  }

  // 2. Notify any pending long-poll waiters
  const waiters = pollWaiters.get(normSession);
  if (waiters && waiters.size > 0) {
    for (const waiter of waiters) {
      try {
        waiter(event);
      } catch {}
    }
    waiters.clear();
  }

  return event;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Enable open CORS for mobile companion devices on same or external networks
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    next();
  });

  // API Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: Date.now() });
  });

  // 1. Phone sends scanned barcode to station
  app.post('/api/phone-sync/scan', (req, res) => {
    const { sessionId, barcode, deviceInfo } = req.body || {};
    if (!sessionId || !barcode) {
      return res.status(400).json({ error: 'sessionId and barcode are required' });
    }

    const event = addScanEvent(sessionId, String(barcode), deviceInfo);
    console.log(`[PhoneSync] Scan for ${sessionId}: ${event.barcode}`);
    res.json({ success: true, event, serverTime: Date.now() });
  });

  // 2. Desktop connects via SSE stream for real-time zero-delay push
  app.get('/api/phone-sync/events/:sessionId', (req, res) => {
    const sessionId = (req.params.sessionId || '').trim().toUpperCase();
    if (!sessionId) {
      return res.status(400).end('Invalid sessionId');
    }

    // Set high-compatibility, non-buffered SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', sessionId, timestamp: Date.now() })}\n\n`);

    if (!sseClients.has(sessionId)) {
      sseClients.set(sessionId, new Set());
    }
    const clients = sseClients.get(sessionId)!;
    clients.add(res);

    // Update desktop state
    const state = stationStates.get(sessionId) || { lastDesktopPing: 0, lastPhonePing: 0 };
    state.lastDesktopPing = Date.now();
    stationStates.set(sessionId, state);

    // Keepalive ping every 10 seconds to prevent proxy / gateway drops
    const pingTimer = setInterval(() => {
      try {
        res.write(`: keepalive ${Date.now()}\n\n`);
      } catch {
        clearInterval(pingTimer);
        clients.delete(res);
      }
    }, 10000);

    req.on('close', () => {
      clearInterval(pingTimer);
      clients.delete(res);
    });
  });

  // 3. Ultra-responsive Long-Polling Fallback (delivers scans in <10ms if unread, or waits up to 4s)
  app.get('/api/phone-sync/poll/:sessionId', (req, res) => {
    const sessionId = (req.params.sessionId || '').trim().toUpperCase();
    const since = parseInt((req.query.since as string) || '0', 10);
    const wait = req.query.wait === '1' || req.query.wait === 'true';

    // Update station ping
    const state = stationStates.get(sessionId) || { lastDesktopPing: 0, lastPhonePing: 0 };
    state.lastDesktopPing = Date.now();
    stationStates.set(sessionId, state);

    const list = recentScans.get(sessionId) || [];
    const newItems = list.filter(item => item.timestamp > since);

    if (newItems.length > 0 || !wait) {
      return res.json({
        sessionId,
        scans: newItems,
        serverTime: Date.now(),
      });
    }

    // Long-polling: wait up to 4 seconds for an incoming scan event
    let responded = false;
    const waiter = (event: ScanEvent) => {
      if (responded) return;
      responded = true;
      clearTimeout(timeout);
      res.json({
        sessionId,
        scans: [event],
        serverTime: Date.now(),
      });
    };

    if (!pollWaiters.has(sessionId)) {
      pollWaiters.set(sessionId, new Set());
    }
    const waiters = pollWaiters.get(sessionId)!;
    waiters.add(waiter);

    const timeout = setTimeout(() => {
      if (responded) return;
      responded = true;
      waiters.delete(waiter);
      res.json({
        sessionId,
        scans: [],
        serverTime: Date.now(),
      });
    }, 4000);

    req.on('close', () => {
      responded = true;
      clearTimeout(timeout);
      waiters.delete(waiter);
    });
  });

  // 4. Heartbeat and connection status inspection
  app.post('/api/phone-sync/ping', (req, res) => {
    const { sessionId, role, device } = req.body || {};
    const norm = (sessionId || '').trim().toUpperCase();
    if (!norm) return res.status(400).json({ error: 'sessionId required' });

    const state = stationStates.get(norm) || { lastDesktopPing: 0, lastPhonePing: 0 };
    if (role === 'phone') {
      state.lastPhonePing = Date.now();
      if (device) state.phoneDevice = device;
    } else {
      state.lastDesktopPing = Date.now();
      if (device) state.desktopName = device;
    }
    stationStates.set(norm, state);

    res.json({
      ok: true,
      sessionId: norm,
      serverTime: Date.now(),
      isPhoneActive: Date.now() - state.lastPhonePing < 20000,
      isDesktopActive: Date.now() - state.lastDesktopPing < 20000,
    });
  });

  // 5. Get station status
  app.get('/api/phone-sync/status/:sessionId', (req, res) => {
    const sessionId = (req.params.sessionId || '').trim().toUpperCase();
    const state = stationStates.get(sessionId) || { lastDesktopPing: 0, lastPhonePing: 0 };
    res.json({
      sessionId,
      serverTime: Date.now(),
      isPhoneActive: Date.now() - state.lastPhonePing < 20000,
      isDesktopActive: Date.now() - state.lastDesktopPing < 20000,
      phoneDevice: state.phoneDevice,
      desktopName: state.desktopName,
    });
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
