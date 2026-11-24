import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { isDriveUploadUrl } from './serverSecurity';

dotenv.config();


interface ScannerClientSocket extends WebSocket {
  stationId?: string;
  role?: 'station' | 'phone';
  deviceName?: string;
  isAlive?: boolean;
}

interface ScannerEvent {
  id: string;
  stationId: string;
  type: string;
  payload: any;
  timestamp: number;
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);

  // In-memory real-time scanner state
  const stationRooms = new Map<string, Set<ScannerClientSocket>>();
  const httpPresence = new Map<string, Map<string, { role: 'station' | 'phone'; deviceName: string; lastSeen: number }>>();
  const recentEvents: ScannerEvent[] = []; // Circular buffer of last 50 events for HTTP poll fallback
  const lastBroadcastTime = new Map<string, number>();

  function cleanStationId(raw: any): string {
    const str = String(raw || '').trim().toLowerCase();
    const digits = str.replace(/\D/g, '').slice(0, 4);
    return digits ? `station-${digits}` : 'station-5829';
  }

  function recordPresence(rawStationId: string, clientId: string, role: 'station' | 'phone', deviceName: string) {
    const stationId = cleanStationId(rawStationId);
    if (!httpPresence.has(stationId)) {
      httpPresence.set(stationId, new Map());
    }
    httpPresence.get(stationId)!.set(clientId, {
      role,
      deviceName,
      lastSeen: Date.now(),
    });
  }

  function getActiveStationStats(rawStationId: string) {
    const stationId = cleanStationId(rawStationId);
    const now = Date.now();
    const wsRoom = stationRooms.get(stationId);
    const httpMap = httpPresence.get(stationId);

    const activePhoneDevices = new Set<string>();
    let wsPhones = 0;
    let wsStations = 0;
    let httpPhones = 0;
    let httpStations = 0;

    // 1. WS clients
    if (wsRoom) {
      wsRoom.forEach((c) => {
        if (c.readyState === WebSocket.OPEN) {
          if (c.role === 'phone') {
            wsPhones++;
            activePhoneDevices.add(c.deviceName || 'Phone');
          } else {
            wsStations++;
          }
        }
      });
    }

    // 2. HTTP clients (active within last 4.5 seconds)
    const activeHttpPhoneClientIds = new Set<string>();
    if (httpMap) {
      httpMap.forEach((entry, clientId) => {
        if (now - entry.lastSeen < 4500) {
          if (entry.role === 'phone') {
            activeHttpPhoneClientIds.add(clientId);
            activePhoneDevices.add(entry.deviceName || 'Mobile Phone');
          } else {
            httpStations++;
          }
        } else {
          httpMap.delete(clientId);
        }
      });
    }

    const finalPhones = wsPhones > 0 ? wsPhones : activeHttpPhoneClientIds.size;
    const finalStations = wsStations > 0 ? wsStations : httpStations;

    return {
      connectedPhones: finalPhones,
      connectedStations: finalStations,
      devices: Array.from(activePhoneDevices),
    };
  }

  function broadcastToStation(rawStationId: string, event: { type: string; [key: string]: any }, excludeSocket?: WebSocket) {
    const stationId = cleanStationId(rawStationId);
    // Record in fallback buffer
    const entry: ScannerEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      stationId,
      type: event.type,
      payload: event,
      timestamp: Date.now(),
    };
    recentEvents.push(entry);
    if (recentEvents.length > 50) recentEvents.shift();

    const room = stationRooms.get(stationId);
    if (!room) return 0;
    const msg = JSON.stringify(event);
    let sentCount = 0;
    room.forEach((client) => {
      if (client !== excludeSocket && client.readyState === WebSocket.OPEN) {
        try {
          client.send(msg);
          sentCount++;
        } catch (e) {
          // Socket send notice
        }
      }
    });
    return sentCount;
  }

  // WebSocket Server on path /ws-scanner
  const wss = new WebSocketServer({ server, path: '/ws-scanner' });

  wss.on('connection', (ws: ScannerClientSocket) => {
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      ws.isAlive = true;
      try {
        const msg = JSON.parse(data.toString());
        const type = String(msg.type || '');
        const stationId = cleanStationId(msg.stationId);

        if (type === 'JOIN_STATION') {
          // Leave old room if changing station
          if (ws.stationId && ws.stationId !== stationId && stationRooms.has(ws.stationId)) {
            stationRooms.get(ws.stationId)!.delete(ws);
          }

          ws.stationId = stationId;
          ws.role = msg.role === 'phone' ? 'phone' : 'station';
          ws.deviceName = String(msg.deviceName || (ws.role === 'phone' ? 'Smartphone' : 'Packing Station')).slice(0, 40);
          const clientId = String(msg.clientId || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

          recordPresence(stationId, clientId, ws.role, ws.deviceName);

          if (!stationRooms.has(stationId)) {
            stationRooms.set(stationId, new Set());
          }
          stationRooms.get(stationId)!.add(ws);

          const stats = getActiveStationStats(stationId);

          // Acknowledge connection
          ws.send(JSON.stringify({
            type: 'JOINED_SUCCESS',
            stationId,
            role: ws.role,
            connectedPhones: stats.connectedPhones,
            connectedStations: stats.connectedStations,
            devices: stats.devices,
            timestamp: Date.now(),
          }));

          // Notify station peers
          broadcastToStation(stationId, {
            type: ws.role === 'phone' ? 'PHONE_CONNECTED' : 'STATION_CONNECTED',
            stationId,
            deviceName: ws.deviceName,
            connectedPhones: stats.connectedPhones,
            connectedStations: stats.connectedStations,
            devices: stats.devices,
            timestamp: Date.now(),
          }, ws);
        } else if (type === 'SCAN_BARCODE') {
          // Instant relay from phone to workstation
          const barcode = String(msg.barcode || '').trim();
          if (barcode) {
            broadcastToStation(stationId, {
              type: 'BARCODE_RECEIVED',
              stationId,
              barcode,
              format: msg.format || 'AUTO',
              platform: msg.platform || '',
              deviceName: ws.deviceName || 'Wireless Phone Scanner',
              timestamp: Date.now(),
            }, ws);
          }
        } else if (type === 'REMOTE_COMMAND') {
          // Remote action (e.g. START_RECORDING, STOP_RECORDING, TRIGGER_FOCUS)
          broadcastToStation(stationId, {
            type: 'REMOTE_COMMAND',
            stationId,
            action: msg.action,
            deviceName: ws.deviceName || 'Wireless Phone Scanner',
            timestamp: Date.now(),
          }, ws);
        } else if (type === 'PING') {
          ws.isAlive = true;
          ws.send(JSON.stringify({
            type: 'PONG',
            clientTime: msg.timestamp || Date.now(),
            serverTime: Date.now(),
          }));
        }
      } catch (err) {
        console.warn('WS message parse notice:', err);
      }
    });

    ws.on('close', () => {
      const stationId = ws.stationId;
      if (stationId && stationRooms.has(stationId)) {
        const room = stationRooms.get(stationId)!;
        room.delete(ws);
        const stats = getActiveStationStats(stationId);
        // Only broadcast disconnect if truly 0 devices remain across both WS and HTTP
        if (ws.role === 'phone' && stats.connectedPhones === 0) {
          broadcastToStation(stationId, {
            type: 'PHONE_DISCONNECTED',
            stationId,
            deviceName: ws.deviceName,
            connectedPhones: 0,
            connectedStations: stats.connectedStations,
            timestamp: Date.now(),
          });
        } else if (ws.role === 'station' && stats.connectedStations === 0) {
          broadcastToStation(stationId, {
            type: 'STATION_DISCONNECTED',
            stationId,
            deviceName: ws.deviceName,
            connectedPhones: stats.connectedPhones,
            connectedStations: 0,
            timestamp: Date.now(),
          });
        }
      }
    });
  });

  // Heartbeat ping interval (45s) to keep sockets alive safely without premature disconnections
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch (e) {}
        return;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (e) {}
    });
  }, 45000);

  wss.on('close', () => clearInterval(heartbeatInterval));

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

  // REST API: Instant Barcode Broadcast (Works as zero-friction fallback if WebSockets are blocked)
  app.post('/api/scanner/broadcast', (req, res) => {
    const stationId = cleanStationId(req.body.stationId);
    const { barcode = '', format = 'AUTO', action, deviceName = 'Phone Scanner' } = req.body;
    if (!barcode && !action) {
      return res.status(400).json({ success: false, error: 'Barcode or action is required' });
    }

    let eventType = 'BARCODE_RECEIVED';
    let payload: any = { barcode, format, deviceName, timestamp: Date.now() };

    if (action) {
      eventType = 'REMOTE_COMMAND';
      payload = { action, deviceName, timestamp: Date.now() };
    }

    const sent = broadcastToStation(stationId, {
      type: eventType,
      stationId,
      ...payload,
    });

    res.json({
      success: true,
      stationId,
      deliveredToWsClients: sent,
      timestamp: Date.now(),
    });
  });

  // REST API: Instant Station & Phone Pairing Handshake (<20ms response)
  app.post('/api/scanner/pair', (req, res) => {
    const stationId = cleanStationId(req.body.stationId);
    const { clientId = `client-${Date.now()}`, role = 'phone', deviceName = 'Device' } = req.body;

    // A phone only joins the station whose PIN it was given. (Auto-attaching unknown phones to
    // whichever station was active let anyone send barcodes or start/stop a station's recording.)

    recordPresence(stationId, String(clientId), role === 'station' ? 'station' : 'phone', String(deviceName));
    const stats = getActiveStationStats(stationId);

    // Only broadcast connection event on initial pairing or when reconnecting after inactivity (>15s)
    const broadcastKey = `${stationId}:${role}:${clientId}`;
    const now = Date.now();
    const lastBroadcast = lastBroadcastTime.get(broadcastKey) || 0;
    if (now - lastBroadcast > 15000) {
      lastBroadcastTime.set(broadcastKey, now);
      broadcastToStation(stationId, {
        type: role === 'phone' ? 'PHONE_CONNECTED' : 'STATION_CONNECTED',
        stationId,
        deviceName: String(deviceName),
        connectedPhones: stats.connectedPhones,
        connectedStations: stats.connectedStations,
        devices: stats.devices,
        timestamp: now,
      });
    }

    const stationPin = stationId.replace(/\D/g, '').slice(0, 4) || '5829';

    res.json({
      success: true,
      stationId,
      stationPin,
      role,
      paired: true,
      ...stats,
      serverTime: Date.now(),
    });
  });

  // REST API: Network info for mobile scanner QR code & direct Wi-Fi pairing
  app.get('/api/scanner/info', (_req, res) => {
    const interfaces = os.networkInterfaces();
    const lanIps: string[] = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          lanIps.push(iface.address);
        }
      }
    }
    // Active station PINs are not disclosed here: knowing a PIN is what lets a phone pair.
    res.json({
      success: true,
      lanIps,
      port: PORT,
      serverTime: Date.now(),
    });
  });

  // REST API: Poll events since timestamp (with live peer presence stats)
  app.get('/api/scanner/poll', (req, res) => {
    const stationId = cleanStationId(req.query.stationId);
    const since = Number(req.query.since || 0);

    // If client polls with since=0 (initial load), only return events from last 3000ms and omit historical disconnects
    const cutoff = since > 0 ? since : (Date.now() - 3000);
    const matches = recentEvents.filter((e) => {
      if (cleanStationId(e.stationId) !== stationId || e.timestamp <= cutoff) return false;
      if (since <= 0 && (e.type === 'PHONE_DISCONNECTED' || e.type === 'STATION_DISCONNECTED')) return false;
      return true;
    });

    const stats = getActiveStationStats(stationId);
    res.json({
      success: true,
      stationId,
      events: matches,
      connectedPhones: stats.connectedPhones,
      connectedStations: stats.connectedStations,
      devices: stats.devices,
      serverTime: Date.now(),
    });
  });

  // REST API: Heartbeat (keeps station / phone linked even when WebSockets are restricted)
  app.post('/api/scanner/heartbeat', (req, res) => {
    const stationId = cleanStationId(req.body.stationId);
    const { clientId = 'anonymous', role = 'phone', deviceName = 'Device' } = req.body;
    recordPresence(stationId, String(clientId), role === 'station' ? 'station' : 'phone', String(deviceName));
    const stats = getActiveStationStats(stationId);
    res.json({
      success: true,
      stationId,
      ...stats,
      serverTime: Date.now(),
    });
  });

  // REST API: Station status
  app.get('/api/scanner/status', (req, res) => {
    const stationId = cleanStationId(req.query.stationId);
    const stats = getActiveStationStats(stationId);

    res.json({
      success: true,
      stationId,
      ...stats,
      serverTime: Date.now(),
    });
  });

  // API Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'Order Packing Video System (VMS 3.0)',
      realtimeScannerWs: true,
      activeStations: stationRooms.size,
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
    console.log(`VMS Station Server with Real-Time WebSocket Scanner running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
