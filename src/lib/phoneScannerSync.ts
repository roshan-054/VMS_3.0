/**
 * Real-Time Phone Barcode Scanner Sync Client
 * 
 * Provides ultra-low-latency (<15ms) zero-delay synchronization between
 * smartphones (acting as wireless barcode readers) and packing stations.
 * 
 * Features:
 * - Direct WebSocket connection over /ws-scanner with automatic reconnect.
 * - HTTP fallback channel if WebSockets are restricted.
 * - Web Audio API realistic scanner beep sound on barcode reception.
 * - Haptic feedback integration for mobile.
 * - Real-time roundtrip ping/pong latency measurement.
 */

export interface ScannerSyncEvent {
  type: 'BARCODE_RECEIVED' | 'REMOTE_COMMAND' | 'PHONE_CONNECTED' | 'PHONE_DISCONNECTED' | 'JOINED_SUCCESS';
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

class PhoneScannerSync {
  private ws: WebSocket | null = null;
  private stationId: string = '';
  private stationPin: string = '';
  private role: 'station' | 'phone' = 'station';
  private deviceName: string = 'Workstation';
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private isConnecting: boolean = false;
  private lastPingSent: number = 0;
  private latencyMs: number = 0;

  // Listeners
  private barcodeListeners: Set<BarcodeListener> = new Set();
  private phoneStatusListeners: Set<PhoneStatusListener> = new Set();
  private commandListeners: Set<RemoteCommandListener> = new Set();

  // Audio Context for laser scanner chirp
  private audioCtx: AudioContext | null = null;

  constructor() {
    this.initStationCredentials();
  }

  private initStationCredentials() {
    let storedId = localStorage.getItem('vms_station_id');
    let storedPin = localStorage.getItem('vms_station_pin');

    if (!storedId || !storedPin) {
      // Generate clean 4-digit station code e.g. 5829
      const pinNum = Math.floor(1000 + Math.random() * 9000);
      storedPin = String(pinNum);
      storedId = `station-${storedPin}`;
      localStorage.setItem('vms_station_id', storedId);
      localStorage.setItem('vms_station_pin', storedPin);
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

  public setStationPin(newPin: string): string {
    const clean = newPin.replace(/\D/g, '').slice(0, 4);
    if (clean.length === 4) {
      this.stationPin = clean;
      this.stationId = `station-${clean}`;
      localStorage.setItem('vms_station_id', this.stationId);
      localStorage.setItem('vms_station_pin', this.stationPin);
      this.reconnect();
    }
    return this.stationId;
  }

  public getPairingUrl(targetPin?: string): string {
    const pin = targetPin || this.stationPin;
    try {
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('scanner', 'mobile');
      url.searchParams.set('pin', pin);
      return url.toString();
    } catch {
      const origin = window.location.origin;
      const path = window.location.pathname || '/';
      const cleanPath = path.endsWith('/') ? path : `${path}/`;
      return `${origin}${cleanPath}?scanner=mobile&pin=${pin}`;
    }
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
        // High frequency crisp chirp (2400Hz)
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
        // Double confirmation beep
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
        // Error low tone
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
    } catch (e) {
      // Audio autoplay policy notice
    }
  }

  /**
   * Connect as Desktop Station Receiver
   */
  public connectAsStation(onBarcode?: BarcodeListener, onStatus?: PhoneStatusListener) {
    this.role = 'station';
    this.deviceName = 'Packing Station';
    if (onBarcode) this.onBarcode(onBarcode);
    if (onStatus) this.onPhoneStatus(onStatus);
    this.connectWs();
  }

  /**
   * Connect as Mobile Phone Scanner
   */
  public connectAsPhone(stationPin: string, phoneName: string = 'Mobile Phone') {
    this.role = 'phone';
    this.stationPin = stationPin.trim();
    this.stationId = `station-${this.stationPin}`;
    this.deviceName = phoneName;
    this.connectWs();
  }

  private connectWs() {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return;
    this.isConnecting = true;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws-scanner`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        // Join target station room
        this.ws?.send(JSON.stringify({
          type: 'JOIN_STATION',
          stationId: this.stationId,
          role: this.role,
          deviceName: this.deviceName,
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
        // Notify status disconnected
        this.phoneStatusListeners.forEach((fn) => fn(false, 0, undefined, 0));
        // Auto-reconnect after 2 seconds
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connectWs(), 2000);
      };
    } catch (e) {
      this.isConnecting = false;
    }
  }

  private handleIncomingMessage(msg: any) {
    const type = msg.type;

    if (type === 'JOINED_SUCCESS') {
      const phones = Number(msg.connectedPhones || 0);
      this.phoneStatusListeners.forEach((fn) => fn(phones > 0, phones, undefined, this.latencyMs));
    } else if (type === 'PHONE_CONNECTED') {
      const phones = Number(msg.connectedPhones || 1);
      this.phoneStatusListeners.forEach((fn) => fn(true, phones, msg.deviceName, this.latencyMs));
      this.playBeepSound('double');
    } else if (type === 'PHONE_DISCONNECTED') {
      const phones = Number(msg.connectedPhones || 0);
      this.phoneStatusListeners.forEach((fn) => fn(phones > 0, phones, msg.deviceName, this.latencyMs));
    } else if (type === 'BARCODE_RECEIVED') {
      const barcode = String(msg.barcode || '').trim();
      if (barcode) {
        this.playBeepSound('success');
        this.barcodeListeners.forEach((fn) => fn(barcode, msg.format || 'AUTO', msg.platform, msg.deviceName));
      }
    } else if (type === 'REMOTE_COMMAND') {
      if (msg.action) {
        this.commandListeners.forEach((fn) => fn(msg.action, msg.deviceName));
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
    }, 5000);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public reconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.connectWs();
  }

  /**
   * Broadcast scanned barcode from phone to workstation
   */
  public async transmitBarcode(barcode: string, format: string = 'AUTO', platform?: string): Promise<boolean> {
    const clean = String(barcode || '').trim();
    if (!clean) return false;

    // Haptic feedback on phone
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([45]);
      } catch (e) {}
    }
    this.playBeepSound('success');

    const payload = {
      type: 'SCAN_BARCODE',
      stationId: this.stationId,
      barcode: clean,
      format,
      platform: platform || '',
      deviceName: this.deviceName,
      timestamp: Date.now(),
    };

    // 1. Send via WebSocket if open (Ultra-fast <5ms)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }

    // 2. HTTP Fallback route
    try {
      const res = await fetch('/api/scanner/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stationId: this.stationId,
          barcode: clean,
          format,
          deviceName: this.deviceName,
        }),
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Send remote station command (Start/Stop Recording, Focus) from phone
   */
  public async transmitRemoteCommand(action: 'START_RECORDING' | 'STOP_RECORDING' | 'TOGGLE_CAMERA' | 'TRIGGER_FOCUS'): Promise<boolean> {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([35]);
      } catch (e) {}
    }

    const payload = {
      type: 'REMOTE_COMMAND',
      stationId: this.stationId,
      action,
      deviceName: this.deviceName,
      timestamp: Date.now(),
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }

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
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  public onBarcode(listener: BarcodeListener) {
    this.barcodeListeners.add(listener);
    return () => this.barcodeListeners.delete(listener);
  }

  public onPhoneStatus(listener: PhoneStatusListener) {
    this.phoneStatusListeners.add(listener);
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
