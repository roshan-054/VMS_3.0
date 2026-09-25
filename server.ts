import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

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

  function recordPresence(stationId: string, clientId: string, role: 'station' | 'phone', deviceName: string) {
    if (!httpPresence.has(stationId)) {
      httpPresence.set(stationId, new Map());
    }
    httpPresence.get(stationId)!.set(clientId, {
      role,
      deviceName,
      lastSeen: Date.now(),
    });
  }

  function getActiveStationStats(stationId: string) {
    const now = Date.now();
    const wsRoom = stationRooms.get(stationId);
    const httpMap = httpPresence.get(stationId);

    const activePhoneDevices = new Set<string>();
    let connectedPhones = 0;
    let connectedStations = 0;

    // 1. WS clients
    if (wsRoom) {
      wsRoom.forEach((c) => {
        if (c.readyState === WebSocket.OPEN) {
          if (c.role === 'phone') {
            connectedPhones++;
            activePhoneDevices.add(c.deviceName || 'Phone');
          } else {
            connectedStations++;
          }
        }
      });
    }

    // 2. HTTP clients (active within last 8 seconds)
    if (httpMap) {
      httpMap.forEach((entry, clientId) => {
        if (now - entry.lastSeen < 8000) {
          if (entry.role === 'phone') {
            if (!activePhoneDevices.has(entry.deviceName)) {
              connectedPhones++;
              activePhoneDevices.add(entry.deviceName);
            }
          } else {
            if (!wsRoom || Array.from(wsRoom).filter(w => w.role === 'station' && w.readyState === WebSocket.OPEN).length === 0) {
              connectedStations++;
            }
          }
        } else {
          httpMap.delete(clientId);
        }
      });
    }

    return {
      connectedPhones,
      connectedStations,
      devices: Array.from(activePhoneDevices),
    };
  }

  function broadcastToStation(stationId: string, event: { type: string; [key: string]: any }, excludeSocket?: WebSocket) {
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
      try {
        const msg = JSON.parse(data.toString());
        const type = String(msg.type || '');
        const stationId = String(msg.stationId || 'default').trim();

        if (type === 'JOIN_STATION') {
          ws.stationId = stationId;
          ws.role = msg.role === 'phone' ? 'phone' : 'station';
          ws.deviceName = String(msg.deviceName || (ws.role === 'phone' ? 'Smartphone' : 'Packing Station')).slice(0, 40);

          if (!stationRooms.has(stationId)) {
            stationRooms.set(stationId, new Set());
          }
          stationRooms.get(stationId)!.add(ws);

          // Count active phones
          const room = stationRooms.get(stationId)!;
          const phoneCount = Array.from(room).filter((c) => c.role === 'phone' && c.readyState === WebSocket.OPEN).length;
          const stationCount = Array.from(room).filter((c) => c.role === 'station' && c.readyState === WebSocket.OPEN).length;

          // Acknowledge connection
          ws.send(JSON.stringify({
            type: 'JOINED_SUCCESS',
            stationId,
            role: ws.role,
            connectedPhones: phoneCount,
            connectedStations: stationCount,
            timestamp: Date.now(),
          }));

          // Notify station peers
          broadcastToStation(stationId, {
            type: ws.role === 'phone' ? 'PHONE_CONNECTED' : 'STATION_CONNECTED',
            stationId,
            deviceName: ws.deviceName,
            connectedPhones: phoneCount,
            connectedStations: stationCount,
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
        const phoneCount = Array.from(room).filter((c) => c.role === 'phone' && c.readyState === WebSocket.OPEN).length;
        if (room.size === 0) {
          stationRooms.delete(stationId);
        } else {
          broadcastToStation(stationId, {
            type: ws.role === 'phone' ? 'PHONE_DISCONNECTED' : 'STATION_DISCONNECTED',
            stationId,
            deviceName: ws.deviceName,
            connectedPhones: phoneCount,
            timestamp: Date.now(),
          });
        }
      }
    });
  });

  // Heartbeat ping interval to keep sockets alive and drop stale ones
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 25000);

  wss.on('close', () => clearInterval(heartbeatInterval));

  // Allow larger payload for keyframe snapshots sent for AI video inspection
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // REST API: Instant Barcode Broadcast (Works as zero-friction fallback if WebSockets are blocked)
  app.post('/api/scanner/broadcast', (req, res) => {
    const { stationId = 'default', barcode = '', format = 'AUTO', action, deviceName = 'Phone Scanner' } = req.body;
    if (!barcode && !action) {
      return res.status(400).json({ success: false, error: 'Barcode or action is required' });
    }

    let eventType = 'BARCODE_RECEIVED';
    let payload: any = { barcode, format, deviceName, timestamp: Date.now() };

    if (action) {
      eventType = 'REMOTE_COMMAND';
      payload = { action, deviceName, timestamp: Date.now() };
    }

    const sent = broadcastToStation(String(stationId), {
      type: eventType,
      stationId: String(stationId),
      ...payload,
    });

    res.json({
      success: true,
      stationId,
      deliveredToWsClients: sent,
      timestamp: Date.now(),
    });
  });

  // REST API: Poll events since timestamp (for HTTP fallback)
  app.get('/api/scanner/poll', (req, res) => {
    const stationId = String(req.query.stationId || 'default').trim();
    const since = Number(req.query.since || 0);

    const matches = recentEvents.filter((e) => e.stationId === stationId && e.timestamp > since);
    res.json({
      success: true,
      events: matches,
      serverTime: Date.now(),
    });
  });

  // REST API: Heartbeat (keeps station / phone linked even when WebSockets are restricted)
  app.post('/api/scanner/heartbeat', (req, res) => {
    const { stationId = 'default', clientId = 'anonymous', role = 'phone', deviceName = 'Device' } = req.body;
    recordPresence(String(stationId), String(clientId), role === 'station' ? 'station' : 'phone', String(deviceName));
    const stats = getActiveStationStats(String(stationId));
    res.json({
      success: true,
      stationId,
      ...stats,
      serverTime: Date.now(),
    });
  });

  // REST API: Station status
  app.get('/api/scanner/status', (req, res) => {
    const stationId = String(req.query.stationId || 'default').trim();
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
      geminiAvailable: Boolean(process.env.GEMINI_API_KEY),
      realtimeScannerWs: true,
      activeStations: stationRooms.size,
      time: Date.now(),
    });
  });

  // Serve backend Apps Script Code.gs
  app.get('/api/backend-code', (req, res) => {
    try {
      const codePath = path.join(process.cwd(), 'backend', 'Code.gs');
      if (fs.existsSync(codePath)) {
        const code = fs.readFileSync(codePath, 'utf-8');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(code);
      }
      res.status(404).send('// backend/Code.gs not found');
    } catch (err: any) {
      res.status(500).send(`// Error reading backend/Code.gs: ${err.message}`);
    }
  });

  // AI Packing Video Focus & Area Identification Endpoint
  app.post('/api/ai/analyze-packing-video', async (req, res) => {
    try {
      const {
        orderId = 'Unknown Order',
        fileId = '',
        driveLink = '',
        videoFrames = [], // Array of { timestampSec: number, base64: string }
        metadata = {},
      } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          success: false,
          error: 'GEMINI_API_KEY is not configured in server environment.',
        });
      }

      // Prepare parts for Gemini 3.8 Flash
      const parts: any[] = [];

      parts.push({
        text: `You are an expert E-Commerce Logistics Computer Vision Specialist for an Order Packing Video Management System (VMS 3.0).
Analyze this packing recording session (Order ID: "${orderId}", Drive File ID: "${fileId}").

Objective:
1. Identify all focusing areas automatically throughout the packing session (without any camera zooming - 1.0x full packing station view):
   - When the operator is showing the SHIPPING LABEL / AWB / BARCODE: evaluate clarity, barcode scanability, address visibility, and exact coordinates.
   - When the operator is showing the INVOICE / BILL OF SUPPLY: evaluate document framing, legibility of line items, tax numbers, and pricing.
   - When the operator is packing the PRODUCT: evaluate product verification, packaging condition, void filling, and security sealing.
2. Determine if the camera auto-focused appropriately to make each detail crystal clear.
3. Suggest calibrated auto-focus optical parameters and clarity enhancements to tune the live camera engine.

Provide your response in strictly structured JSON format matching the schema.`,
      });

      // Attach sampled video frames if provided
      if (Array.isArray(videoFrames) && videoFrames.length > 0) {
        // Limit to max 12 frames to remain snappy
        const framesToInclude = videoFrames.slice(0, 12);
        for (let i = 0; i < framesToInclude.length; i++) {
          const f = framesToInclude[i];
          const cleanB64 = String(f.base64 || '').replace(/^data:image\/\w+;base64,/, '');
          if (cleanB64) {
            parts.push({
              inlineData: {
                mimeType: 'image/jpeg',
                data: cleanB64,
              },
            });
            parts.push({
              text: `[Video Frame at ${f.timestampSec ? f.timestampSec.toFixed(1) : (i * 2).toFixed(1)}s - Frame #${i + 1}]`,
            });
          }
        }
      } else {
        parts.push({
          text: `No direct raw image frames provided. Analyze based on available metadata: Order ID: ${orderId}, Drive Link: ${driveLink}, File ID: ${fileId}. Provide simulated baseline calibration profiles for this packing workflow.`,
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overallClarityRating: {
                type: Type.STRING,
                description: 'Overall video clarity: Excellent, Good, Fair, or Needs Improvement',
              },
              executiveSummary: {
                type: Type.STRING,
                description: 'Concise summary of video quality and focus shifts',
              },
              focusShifts: {
                type: Type.ARRAY,
                description: 'Chronological timeline of detected focus zones',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    timestampSec: { type: Type.NUMBER },
                    focusTarget: { type: Type.STRING, description: 'LABEL, INVOICE, PRODUCT, or OVERVIEW' },
                    description: { type: Type.STRING },
                    clarityScore: { type: Type.NUMBER, description: '0 to 100 score' },
                    isOptimalFocus: { type: Type.BOOLEAN },
                    recommendation: { type: Type.STRING },
                  },
                  required: ['timestampSec', 'focusTarget', 'description', 'clarityScore'],
                },
              },
              labelAnalysis: {
                type: Type.OBJECT,
                properties: {
                  detected: { type: Type.BOOLEAN },
                  timestampSec: { type: Type.NUMBER },
                  barcodeReadable: { type: Type.BOOLEAN },
                  clarityScore: { type: Type.NUMBER },
                  notes: { type: Type.STRING },
                },
                required: ['detected', 'barcodeReadable', 'clarityScore', 'notes'],
              },
              invoiceAnalysis: {
                type: Type.OBJECT,
                properties: {
                  detected: { type: Type.BOOLEAN },
                  timestampSec: { type: Type.NUMBER },
                  legibilityScore: { type: Type.NUMBER },
                  notes: { type: Type.STRING },
                },
                required: ['detected', 'legibilityScore', 'notes'],
              },
              productPackingAnalysis: {
                type: Type.OBJECT,
                properties: {
                  detected: { type: Type.BOOLEAN },
                  timestampSec: { type: Type.NUMBER },
                  productIdentifiable: { type: Type.BOOLEAN },
                  packagingQualityScore: { type: Type.NUMBER },
                  notes: { type: Type.STRING },
                },
                required: ['detected', 'productIdentifiable', 'packagingQualityScore', 'notes'],
              },
              suggestedCalibration: {
                type: Type.OBJECT,
                properties: {
                  autoHardwareFocus: { type: Type.BOOLEAN, description: 'Whether hardware optical focus should lock on target' },
                  enableClarityEnhance: { type: Type.BOOLEAN, description: 'Whether edge clarity boost should be active' },
                  focusHoldTime: { type: Type.NUMBER, description: 'Focus hold time in ms, e.g. 1400' },
                  focusSensitivity: { type: Type.STRING, description: 'e.g. High, Medium, or Balanced' },
                },
                required: ['autoHardwareFocus', 'enableClarityEnhance'],
              },
            },
            required: [
              'overallClarityRating',
              'executiveSummary',
              'focusShifts',
              'labelAnalysis',
              'invoiceAnalysis',
              'productPackingAnalysis',
              'suggestedCalibration',
            ],
          },
        },
      });

      const parsed = JSON.parse(response.text?.trim() || '{}');
      return res.json({
        success: true,
        orderId,
        fileId,
        analysis: parsed,
      });
    } catch (err: any) {
      console.error('AI Video Focus Analysis failed:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Internal error during video focus analysis',
      });
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
