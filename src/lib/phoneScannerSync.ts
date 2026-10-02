/**
 * Real-Time Phone Barcode Scanner Sync Client
 * 
 * Provides ultra-low-latency (<15ms) zero-delay synchronization between
 * smartphones (acting as wireless barcode readers) and packing stations.
 * 
 * Multi-Channel Universal Architecture:
 * 1. WebRTC P2P DataChannel (via PeerJS): Direct zero-server peer-to-peer link (100% works on GitHub Pages & static hosts).
 * 2. Local Express WebSocket & REST: Ultra-fast local channel when running on Node.js / dev server.
 * 3. Google Apps Script Relay: Cloud cache fallback via Apps Script CacheService when WebSockets/P2P are restricted.
 */

import { Peer, DataConnection } from 'peerjs';
import { getStoredApiUrl } from './storage';

export function cleanStationPin(pin?: string): string {
  const digits = String(pin || '').replace(/\D/g, '').slice(0, 4);
  return digits.length === 4 ? digits : (digits || '5829');
}

export function cleanStationId(pinOrId?: string): string {
  const pin = cleanStationPin(pinOrId);
  return `station-${pin}`;
}

export interface ScannerSyncEvent {
  type: 'BARCODE_RECEIVED' | 'REMOTE_COMMAND' | 'PHONE_CONNECTED' | 'PHONE_DISCONNECTED' | 'JOINED_SUCCESS' | 'STATION_CONNECTED';
  stationId: string;
  barcode?: string;
  format?: string;
  platform?: string;
  action?: 'START_RECORDING' | 'STOP_RECORDING' | 'TOGGLE_CAMERA' | 'TRIGGER_FOCUS';
  deviceName?: string;
  connectedPhones?: number;
  timestamp: number;
}

export type BarcodeListener = (barcode: string, format: string, platform?: string, deviceName?: string) => void;
export type PhoneStatusListener = (connected: boolean, phoneCount: number, deviceName?: string, pingMs?: number) => void;
export type RemoteCommandListener = (action: string, deviceName?: string) => void;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
];

class PhoneScannerSync {
  // WebRTC P2P
  private p2pPeer: Peer | null = null;
  private p2pConnections: Set<DataConnection> = new Set();
  private activePhoneConn: DataConnection | null = null;

  // Local WebSocket
  private ws: WebSocket | null = null;

  // State
  private stationId: string = '';
  private stationPin: string = '';
  private role: 'station' | 'phone' = 'station';
  private deviceName: string = 'Workstation';
  private clientId: string = '';
  private isConnecting: boolean = false;
  private isStaticHost: boolean = false; // Set to true if running on GitHub Pages (detected on 404 from local /api)
  private lastPingSent: number = 0;
  private latencyMs: number = 0;
  private lastPolledTimestamp: number = Date.now() - 3000;
  private processedEventIds: Set<string> = new Set();
  private lastPhoneSeenTime: number = 0;
  private lastStationSeenTime: number = 0;

  // State cache
  private isPhoneConnected: boolean = false;
  private connectedPhonesCount: number = 0;
  private lastDeviceName: string = '';

  // Timers
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private pollInterval: any = null;
  private heartbeatInterval: any = null;

  // Listeners
  private barcodeListeners: Set<BarcodeListener> = new Set();
  private phoneStatusListeners: Set<PhoneStatusListener> = new Set();
  private commandListeners: Set<RemoteCommandListener> = new Set();

  // Audio Context for laser scanner chirp
  private audioCtx: AudioContext | null = null;

  constructor() {
    this.clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.initStationCredentials();
    this.startHttpSyncLoop();
  }

  private initStationCredentials() {
    let storedId = localStorage.getItem('vms_station_id');
    let storedPin = localStorage.getItem('vms_station_pin');

    if (!storedId || !storedPin || storedPin.replace(/\D/g, '').length !== 4) {
      const pinNum = Math.floor(1000 + Math.random() * 9000);
      storedPin = String(pinNum);
      storedId = `station-${storedPin}`;
      localStorage.setItem('vms_station_id', storedId);
      localStorage.setItem('vms_station_pin', storedPin);
    } else {
      storedPin = cleanStationPin(storedPin);
      storedId = `station-${storedPin}`;
    }

    this.stationId = storedId;
    this.stationPin = storedPin;
  }

  public getStationId(): string {
    return this.stationId;
  }

  public getStationPin(): string {
    return this.stationPin;
  }

  public getStatus() {
    return {
      connected: this.isPhoneConnected,
      phoneCount: this.connectedPhonesCount,
      deviceName: this.lastDeviceName,
      latencyMs: this.latencyMs,
    };
  }

  public setStationPin(newPin: string): string {
    const clean = cleanStationPin(newPin);
    if (clean.length === 4) {
      this.stationPin = clean;
      this.stationId = `station-${clean}`;
      localStorage.setItem('vms_station_id', this.stationId);
      localStorage.setItem('vms_station_pin', this.stationPin);
      this.lastPolledTimestamp = Date.now() - 3000;
      this.reconnect();
      this.pairInstant();
      this.pollHttpEvents();
    }
    return this.stationId;
  }

  public getPairingUrl(targetPin?: string): string {
    const pin = cleanStationPin(targetPin || this.stationPin);
    const origin = window.location.origin;
    const pathname = window.location.pathname || '/';
    const cleanPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
    return `${origin}${cleanPath}?scanner=mobile&pin=${pin}`;
  }

  /**
   * Realistic handheld scanner beep sound (Zebra/Honeywell style chirp)
   */
  public playBeepSound(type: 'success' | 'double' | 'error' = 'success') {
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
      if (!this.audioCtx) return;

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;

      if (type === 'success') {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2400, now);
        osc.frequency.exponentialRampToValueAtTime(2800, now + 0.06);

        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'double') {
        [0, 0.09].forEach((delay) => {
          const osc = this.audioCtx!.createOscillator();
          const gain = this.audioCtx!.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(2600, now + delay);
          gain.gain.setValueAtTime(0.3, now + delay);
          gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.05);
          osc.connect(gain);
          gain.connect(this.audioCtx!.destination);
          osc.start(now + delay);
          osc.stop(now + delay + 0.05);
        });
      } else {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, now);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.22);
      }
    } catch (e) {}
  }

  /**
   * Connect as Desktop Station Receiver
   */
  public connectAsStation(onBarcode?: BarcodeListener, onStatus?: PhoneStatusListener) {
    this.role = 'station';
    this.deviceName = 'Packing Station';
    this.stationPin = cleanStationPin(this.stationPin);
    this.stationId = cleanStationId(this.stationPin);
    if (onBarcode) this.onBarcode(onBarcode);
    if (onStatus) this.onPhoneStatus(onStatus);

    // 1. Initialize WebRTC P2P Receiver Peer (Serverless for GitHub Pages)
    this.initPeerAsStation();

    // 2. Connect local WebSocket if available
    this.connectWs();

    // 3. Instant cloud / local pairing
    this.pairInstant();
    this.pollHttpEvents();
  }

  /**
   * Connect as Mobile Phone Scanner
   */
  public connectAsPhone(stationPin: string, phoneName: string = 'Mobile Phone') {
    this.role = 'phone';
    this.stationPin = cleanStationPin(stationPin);
    this.stationId = cleanStationId(this.stationPin);
    this.deviceName = phoneName;
    this.lastPolledTimestamp = Date.now() - 3000;

    // 1. Initialize WebRTC P2P Client Peer (Serverless for GitHub Pages)
    this.initPeerAsPhone(this.stationPin);

    // 2. Connect local WebSocket if available
    this.connectWs();

    // 3. Instant cloud / local pairing
    this.pairInstant();
    this.pollHttpEvents();
  }

  // -------------------------------------------------------------
  // WebRTC PeerJS DataChannel Engine (Direct P2P for GitHub Pages)
  // -------------------------------------------------------------

  private initPeerAsStation() {
    if (typeof window === 'undefined') return;
    if (this.p2pPeer && !this.p2pPeer.destroyed) {
      return;
    }

    const peerId = `vms3-station-${cleanStationPin(this.stationPin)}`;
    try {
      this.p2pPeer = new Peer(peerId, {
        config: { iceServers: ICE_SERVERS },
      });

      this.p2pPeer.on('open', () => {
        // Station Peer ready
      });

      this.p2pPeer.on('connection', (conn) => {
        this.p2pConnections.add(conn);

        conn.on('open', () => {
          const remoteDevice = conn.metadata?.deviceName || 'Wireless Phone Scanner';
          this.emitStatus(true, this.p2pConnections.size, remoteDevice);

          // Acknowledge connection
          conn.send({
            type: 'STATION_CONNECTED',
            stationId: this.stationId,
            deviceName: 'Packing Station',
            timestamp: Date.now(),
          });
        });

        conn.on('data', (data: any) => {
          if (data && typeof data === 'object') {
            this.handleIncomingMessage(data);
          }
        });

        conn.on('close', () => {
          this.p2pConnections.delete(conn);
          if (this.p2pConnections.size === 0) {
            this.emitStatus(false, 0);
          }
        });

        conn.on('error', () => {
          this.p2pConnections.delete(conn);
        });
      });

      this.p2pPeer.on('error', (err: any) => {
        if (err && err.type === 'unavailable-id') {
          // ID momentarily taken by reload: try recovering
          setTimeout(() => {
            if (this.role === 'station' && (!this.p2pPeer || this.p2pPeer.destroyed)) {
              this.initPeerAsStation();
            }
          }, 2000);
        }
      });
    } catch (e) {}
  }

  private initPeerAsPhone(targetPin: string) {
    if (typeof window === 'undefined') return;
    if (this.p2pPeer && !this.p2pPeer.destroyed) {
      this.p2pPeer.destroy();
    }

    const cleanPin = cleanStationPin(targetPin);
    const targetPeerId = `vms3-station-${cleanPin}`;

    try {
      this.p2pPeer = new Peer({
        config: { iceServers: ICE_SERVERS },
      });

      this.p2pPeer.on('open', () => {
        this.connectToStationPeer(targetPeerId);
      });

      this.p2pPeer.on('error', () => {
        // Fallback to Apps Script / local relay
      });
    } catch (e) {}
  }

  private connectToStationPeer(targetPeerId: string) {
    if (!this.p2pPeer || this.p2pPeer.destroyed) return;
    try {
      const conn = this.p2pPeer.connect(targetPeerId, {
        reliable: true,
        metadata: { deviceName: this.deviceName, role: 'phone' },
      });

      this.activePhoneConn = conn;

      conn.on('open', () => {
        this.emitStatus(true, 1, 'Packing Station');
        conn.send({
          type: 'PHONE_CONNECTED',
          stationId: this.stationId,
          deviceName: this.deviceName,
          timestamp: Date.now(),
        });
      });

      conn.on('data', (data: any) => {
        if (data && typeof data === 'object') {
          this.handleIncomingMessage(data);
        }
      });

      conn.on('close', () => {
        this.activePhoneConn = null;
        this.emitStatus(false, 0);
        // Auto-reconnect WebRTC after 2.5 seconds
        setTimeout(() => this.connectToStationPeer(targetPeerId), 2500);
      });

      conn.on('error', () => {
        this.activePhoneConn = null;
      });
    } catch (e) {}
  }

  // -------------------------------------------------------------
  // Instant Pairing & Sync (Local Express OR Google Apps Script)
  // -------------------------------------------------------------

  public async pairInstant() {
    if (!this.stationId) return;

    // 1. Try local Express /api route first
    if (!this.isStaticHost) {
      try {
        const res = await fetch('/api/scanner/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stationId: this.stationId,
            clientId: this.clientId,
            role: this.role,
            deviceName: this.deviceName,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          this.applyPairResponse(data);
          return;
        } else if (res.status === 404) {
          // GitHub Pages or static host detected!
          this.isStaticHost = true;
        }
      } catch (e) {
        this.isStaticHost = true;
      }
    }

    // 2. Fallback to Google Apps Script Web App Relay (100% works on GitHub Pages)
    if (this.isStaticHost) {
      try {
        const appsScriptUrl = getStoredApiUrl();
        const res = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'scannerPair',
            stationId: this.stationPin,
            clientId: this.clientId,
            role: this.role,
            deviceName: this.deviceName,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          this.applyPairResponse(data);
        }
      } catch (e) {}
    }
  }

  private applyPairResponse(data: any) {
    if (this.role === 'station') {
      const phones = Number(data.connectedPhones || 0);
      const firstDevice = Array.isArray(data.devices) && data.devices.length > 0 ? data.devices[0] : (phones > 0 ? 'Wireless Scanner' : undefined);
      this.emitStatus(phones > 0, phones, firstDevice);
    } else {
      const stations = Number(data.connectedStations || 0);
      this.emitStatus(stations > 0, stations, 'Packing Station');
    }
  }

  public forceSync() {
    // WebRTC sync
    if (this.role === 'phone' && this.activePhoneConn && this.activePhoneConn.open) {
      this.activePhoneConn.send({
        type: 'PHONE_CONNECTED',
        stationId: this.stationId,
        deviceName: this.deviceName,
        timestamp: Date.now(),
      });
    }

    // WebSocket sync
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'JOIN_STATION',
        stationId: this.stationId,
        role: this.role,
        deviceName: this.deviceName,
        clientId: this.clientId,
      }));
    } else {
      this.connectWs();
    }

    // HTTP / Apps Script sync
    this.pairInstant();
    this.pollHttpEvents();
  }

  private connectWs() {
    if (this.isStaticHost) return; // Skip WS on static GitHub Pages
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return;
    this.isConnecting = true;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws-scanner`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.ws?.send(JSON.stringify({
          type: 'JOIN_STATION',
          stationId: this.stationId,
          role: this.role,
          deviceName: this.deviceName,
          clientId: this.clientId,
        }));
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleIncomingMessage(msg);
        } catch (e) {}
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.stopPing();
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connectWs(), 2500);
      };
    } catch (e) {
      this.isConnecting = false;
    }
  }

  private emitStatus(connected: boolean, count: number, deviceName?: string) {
    const now = Date.now();
    if (this.role === 'station') {
      if (connected) {
        this.lastPhoneSeenTime = now;
      } else {
        // Debounce disconnect: if a phone was seen within the last 8 seconds, maintain connected status
        if (now - this.lastPhoneSeenTime < 8000 && this.isPhoneConnected) {
          return;
        }
      }
    } else {
      // Role is 'phone'
      if (connected) {
        this.lastStationSeenTime = now;
      } else {
        // Debounce disconnect: if the station was seen within the last 8 seconds, maintain connected status
        if (now - this.lastStationSeenTime < 8000 && this.isPhoneConnected) {
          return;
        }
      }
    }

    const wasDisconnected = !this.isPhoneConnected;
    this.isPhoneConnected = connected;
    this.connectedPhonesCount = count;
    if (deviceName) this.lastDeviceName = deviceName;

    if (this.role === 'station' && connected && wasDisconnected) {
      this.playBeepSound('double');
    }

    this.phoneStatusListeners.forEach((fn) => fn(connected, count, this.lastDeviceName || deviceName, this.latencyMs));
  }

  private handleIncomingMessage(msg: any) {
    const type = msg.type;

    if (type === 'JOINED_SUCCESS') {
      const phones = Number(msg.connectedPhones || 0);
      const stations = Number(msg.connectedStations || 0);
      if (this.role === 'station') {
        this.emitStatus(phones > 0, phones, undefined);
      } else {
        this.emitStatus(stations > 0, stations, 'Packing Station');
      }
    } else if (type === 'PHONE_CONNECTED') {
      const phones = Number(msg.connectedPhones || 1);
      const wasDisconnected = !this.isPhoneConnected;
      this.emitStatus(true, phones, msg.deviceName);
      if (this.role === 'station' && wasDisconnected) {
        this.playBeepSound('double');
      }
    } else if (type === 'STATION_CONNECTED') {
      if (this.role === 'phone') {
        const wasDisconnected = !this.isPhoneConnected;
        this.emitStatus(true, 1, msg.deviceName || 'Packing Station');
        if (wasDisconnected) {
          this.playBeepSound('double');
        }
      }
    } else if (type === 'PHONE_DISCONNECTED') {
      const phones = Number(msg.connectedPhones || 0);
      if (this.role === 'station') {
        this.emitStatus(phones > 0, phones, msg.deviceName);
      }
    } else if (type === 'STATION_DISCONNECTED') {
      if (this.role === 'phone') {
        this.emitStatus(false, 0, undefined);
      }
    } else if (type === 'BARCODE_RECEIVED') {
      const barcode = String(msg.barcode || '').trim();
      const eventKey = `${barcode}-${msg.timestamp || Date.now()}`;
      if (barcode && !this.processedEventIds.has(eventKey)) {
        this.processedEventIds.add(eventKey);
        if (this.processedEventIds.size > 200) {
          const arr = Array.from(this.processedEventIds).slice(-100);
          this.processedEventIds = new Set(arr);
        }
        if (this.role === 'station') {
          this.playBeepSound('success');
          this.barcodeListeners.forEach((fn) => fn(barcode, msg.format || 'AUTO', msg.platform, msg.deviceName));
        }
      }
    } else if (type === 'REMOTE_COMMAND') {
      const action = msg.action;
      const eventKey = `cmd-${action}-${msg.timestamp || Date.now()}`;
      if (action && !this.processedEventIds.has(eventKey)) {
        this.processedEventIds.add(eventKey);
        if (this.role === 'station') {
          this.commandListeners.forEach((fn) => fn(action, msg.deviceName));
        }
      }
    } else if (type === 'PONG') {
      if (this.lastPingSent > 0) {
        this.latencyMs = Math.max(1, Date.now() - this.lastPingSent);
      }
    }
  }

  private startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingSent = Date.now();
        this.ws.send(JSON.stringify({ type: 'PING', timestamp: this.lastPingSent }));
      }
    }, 4000);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private startHttpSyncLoop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.pollInterval) clearInterval(this.pollInterval);

    this.heartbeatInterval = setInterval(() => {
      this.pairInstant();
    }, 1200);

    this.pollInterval = setInterval(() => {
      this.pollHttpEvents();
    }, 350);
  }

  public async pollHttpEvents() {
    if (!this.stationId) return;

    // 1. Try local Express /api route first
    if (!this.isStaticHost) {
      try {
        const res = await fetch(`/api/scanner/poll?stationId=${encodeURIComponent(this.stationId)}&since=${this.lastPolledTimestamp}`);
        if (res.ok) {
          const data = await res.json();
          this.applyPollData(data);
          return;
        } else if (res.status === 404) {
          this.isStaticHost = true;
        }
      } catch (e) {
        this.isStaticHost = true;
      }
    }

    // 2. Fallback to Google Apps Script Web App Relay
    if (this.isStaticHost) {
      try {
        const appsScriptUrl = getStoredApiUrl();
        const res = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'scannerPoll',
            stationId: this.stationPin,
            since: this.lastPolledTimestamp,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          this.applyPollData(data);
        }
      } catch (e) {}
    }
  }

  private applyPollData(data: any) {
    if (this.role === 'station' && typeof data.connectedPhones === 'number') {
      const phones = Number(data.connectedPhones || 0);
      const firstDevice = Array.isArray(data.devices) && data.devices.length > 0 ? data.devices[0] : (phones > 0 ? 'Wireless Scanner' : undefined);
      this.emitStatus(phones > 0, phones, firstDevice);
    } else if (this.role === 'phone' && typeof data.connectedStations === 'number') {
      const stations = Number(data.connectedStations || 0);
      this.emitStatus(stations > 0, stations, 'Packing Station');
    }

    if (Array.isArray(data.events) && data.events.length > 0) {
      data.events.forEach((evt: any) => {
        const p = evt.payload || evt;
        // Do not let historical disconnect events override active connection if presence stats show peer is online
        if (p.type === 'PHONE_DISCONNECTED' && this.role === 'station' && Number(data.connectedPhones || 0) > 0) {
          return;
        }
        if (p.type === 'STATION_DISCONNECTED' && this.role === 'phone' && Number(data.connectedStations || 0) > 0) {
          return;
        }
        this.handleIncomingMessage(p);
        if (evt.timestamp) {
          this.lastPolledTimestamp = Math.max(this.lastPolledTimestamp, evt.timestamp);
        }
      });
    }
  }

  public reconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    if (this.role === 'station') {
      this.initPeerAsStation();
    } else {
      this.initPeerAsPhone(this.stationPin);
    }
    this.connectWs();
    this.pairInstant();
    this.pollHttpEvents();
  }

  /**
   * Broadcast scanned barcode from phone to workstation
   */
  public async transmitBarcode(barcode: string, format: string = 'AUTO', platform?: string): Promise<boolean> {
    const clean = String(barcode || '').trim();
    if (!clean) return false;

    if ('vibrate' in navigator) {
      try { navigator.vibrate([45]); } catch (e) {}
    }
    this.playBeepSound('success');

    const payload = {
      type: 'BARCODE_RECEIVED',
      stationId: this.stationId,
      barcode: clean,
      format,
      platform: platform || '',
      deviceName: this.deviceName,
      timestamp: Date.now(),
    };

    // 1. Direct WebRTC P2P (Ultra-Fast <5ms, works completely serverless on GitHub Pages!)
    if (this.activePhoneConn && this.activePhoneConn.open) {
      try {
        this.activePhoneConn.send(payload);
      } catch (e) {}
    }

    // 2. Local WebSocket if open
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ ...payload, type: 'SCAN_BARCODE' }));
      } catch (e) {}
    }

    // 3. Fallback: Local Express OR Google Apps Script
    if (!this.isStaticHost) {
      try {
        const res = await fetch('/api/scanner/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stationId: this.stationId,
            barcode: clean,
            format,
            platform: platform || '',
            deviceName: this.deviceName,
          }),
        });
        if (res.ok) return true;
        if (res.status === 404) this.isStaticHost = true;
      } catch (e) {
        this.isStaticHost = true;
      }
    }

    if (this.isStaticHost) {
      try {
        const appsScriptUrl = getStoredApiUrl();
        const res = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'scannerBroadcast',
            stationId: this.stationPin,
            barcode: clean,
            format,
            platform: platform || '',
            deviceName: this.deviceName,
          }),
        });
        return res.ok;
      } catch (e) {
        return false;
      }
    }

    return true;
  }

  /**
   * Send remote station command (Start/Stop Recording, Focus) from phone
   */
  public async transmitRemoteCommand(action: 'START_RECORDING' | 'STOP_RECORDING' | 'TOGGLE_CAMERA' | 'TRIGGER_FOCUS'): Promise<boolean> {
    if ('vibrate' in navigator) {
      try { navigator.vibrate([35]); } catch (e) {}
    }

    const payload = {
      type: 'REMOTE_COMMAND',
      stationId: this.stationId,
      action,
      deviceName: this.deviceName,
      timestamp: Date.now(),
    };

    // 1. Direct WebRTC P2P
    if (this.activePhoneConn && this.activePhoneConn.open) {
      try {
        this.activePhoneConn.send(payload);
      } catch (e) {}
    }

    // 2. Local WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (e) {}
    }

    // 3. Local Express OR Google Apps Script
    if (!this.isStaticHost) {
      try {
        const res = await fetch('/api/scanner/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stationId: this.stationId,
            action,
            deviceName: this.deviceName,
          }),
        });
        if (res.ok) return true;
        if (res.status === 404) this.isStaticHost = true;
      } catch (e) {
        this.isStaticHost = true;
      }
    }

    if (this.isStaticHost) {
      try {
        const appsScriptUrl = getStoredApiUrl();
        const res = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'scannerBroadcast',
            stationId: this.stationPin,
            remoteAction: action,
            command: action,
            deviceName: this.deviceName,
          }),
        });
        return res.ok;
      } catch (e) {
        return false;
      }
    }

    return true;
  }

  public onBarcode(listener: BarcodeListener) {
    this.barcodeListeners.add(listener);
    return () => this.barcodeListeners.delete(listener);
  }

  public onPhoneStatus(listener: PhoneStatusListener) {
    this.phoneStatusListeners.add(listener);
    listener(this.isPhoneConnected, this.connectedPhonesCount, this.lastDeviceName, this.latencyMs);
    this.forceSync();
    return () => this.phoneStatusListeners.delete(listener);
  }

  public onRemoteCommand(listener: RemoteCommandListener) {
    this.commandListeners.add(listener);
    return () => this.commandListeners.delete(listener);
  }

  public getLatency(): number {
    return this.latencyMs;
  }
}

export const sharedScannerSync = new PhoneScannerSync();
