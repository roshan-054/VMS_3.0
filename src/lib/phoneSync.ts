/**
 * Phone-to-Desktop Wireless Barcode Scanner Sync Service
 * 
 * Facilitates instantaneous real-time syncing between any smartphone (via WiFi / 4G / 5G)
 * and the desktop packing workstation using:
 * 1. Server-Sent Events (SSE) stream over HTTP (/api/phone-sync/events/:sessionId)
 * 2. Adaptive Long-Polling Fallback (/api/phone-sync/poll/:sessionId)
 * 3. Real-time REST API endpoint (/api/phone-sync/scan)
 * 4. BroadcastChannel & LocalStorage event bus (for local / same-machine testing)
 * 5. Heartbeat & Live Pairing Presence Monitor
 */

export interface ScannedBarcodePayload {
  id?: string;
  sessionId: string;
  barcode: string;
  timestamp: number;
  deviceInfo?: string;
}

export interface StationStatus {
  sessionId: string;
  isPhoneActive: boolean;
  isDesktopActive: boolean;
  phoneDevice?: string;
  desktopName?: string;
  serverTime: number;
}

const CHANNEL_NAME = 'vms_phone_scanner_bus';
const LAST_SCAN_STORAGE_KEY = 'vms_remote_scanned_barcode';
const STATION_SESSION_KEY = 'vms_station_session_id';

/**
 * Generate or retrieve station ID
 */
export function getOrCreateStationSession(): string {
  let sid = '';
  try {
    sid = sessionStorage.getItem(STATION_SESSION_KEY) || localStorage.getItem(STATION_SESSION_KEY) || '';
  } catch {}
  
  if (!sid) {
    // Generate friendly 4-digit workstation code e.g. "PK-8492"
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    sid = `PK-${randomNum}`;
    try {
      sessionStorage.setItem(STATION_SESSION_KEY, sid);
      localStorage.setItem(STATION_SESSION_KEY, sid);
    } catch {}
  }
  return sid;
}

export function setStationSession(newId: string): void {
  const clean = newId.trim().toUpperCase();
  try {
    sessionStorage.setItem(STATION_SESSION_KEY, clean);
    localStorage.setItem(STATION_SESSION_KEY, clean);
  } catch {}
}

/**
 * Send Station Ping / Heartbeat
 */
export async function sendStationPing(
  sessionId: string, 
  role: 'phone' | 'desktop', 
  device?: string
): Promise<StationStatus | null> {
  const clean = (sessionId || '').trim().toUpperCase();
  if (!clean) return null;

  try {
    const res = await fetch('/api/phone-sync/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: clean, role, device }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return null;
}

/**
 * Check live status of station
 */
export async function fetchStationStatus(sessionId: string): Promise<StationStatus | null> {
  const clean = (sessionId || '').trim().toUpperCase();
  if (!clean) return null;

  try {
    const res = await fetch(`/api/phone-sync/status/${encodeURIComponent(clean)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return null;
}

/**
 * Transmit barcode from Phone to Desktop in real-time
 */
export async function sendBarcodeFromPhone(
  sessionId: string, 
  rawBarcode: string, 
  deviceInfo = 'Mobile Phone'
): Promise<boolean> {
  if (!rawBarcode || !rawBarcode.trim()) return false;

  const cleanSession = sessionId.trim().toUpperCase();
  const cleanBarcode = rawBarcode.trim();

  const payload: ScannedBarcodePayload = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    sessionId: cleanSession,
    barcode: cleanBarcode,
    timestamp: Date.now(),
    deviceInfo,
  };

  // 1. Send via Server REST API (Real-time network transport)
  let networkSuccess = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch('/api/phone-sync/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: cleanSession,
        barcode: cleanBarcode,
        deviceInfo,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      networkSuccess = true;
    }
  } catch (err) {
    console.warn('[PhoneSync] Network API send error:', err);
  }

  // 2. BroadcastChannel (instant for same-browser / local testing)
  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.postMessage(payload);
      bc.close();
    }
  } catch {}

  // 3. LocalStorage event bus
  try {
    localStorage.setItem(LAST_SCAN_STORAGE_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('vms:phone_scan', { detail: payload }));
  } catch {}

  return networkSuccess;
}

/**
 * Listen on Desktop Workstation for incoming scans from paired Phone
 */
export function subscribeToPhoneScans(
  targetSessionId: string,
  onScanReceived: (barcode: string, payload: ScannedBarcodePayload) => void,
  onStatusChange?: (isPhoneOnline: boolean) => void
): () => void {
  const target = targetSessionId.trim().toUpperCase();
  let isSubscribed = true;
  const seenEventIds = new Set<string>();
  
  // Track server-synced timestamp to completely eliminate clock skew
  let lastReceivedServerTime = 0;

  const handleIncomingPayload = (payload: ScannedBarcodePayload) => {
    if (!payload || !payload.barcode || !isSubscribed) return;
    
    // De-duplicate events by ID
    if (payload.id && seenEventIds.has(payload.id)) return;
    if (payload.id) {
      seenEventIds.add(payload.id);
      // Keep seen set bounded
      if (seenEventIds.size > 200) {
        const first = seenEventIds.values().next().value;
        if (first) seenEventIds.delete(first);
      }
    }

    // Filter by session
    const payloadSession = (payload.sessionId || '').trim().toUpperCase();
    if (payloadSession === target || payloadSession === '*' || !target) {
      if (payload.timestamp && payload.timestamp > lastReceivedServerTime) {
        lastReceivedServerTime = payload.timestamp;
      }
      onScanReceived(payload.barcode, payload);
    }
  };

  // 1. Real-time Server-Sent Events (SSE) Stream
  let eventSource: EventSource | null = null;
  const connectSSE = () => {
    if (!isSubscribed || typeof window === 'undefined' || !('EventSource' in window)) return;
    try {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }

      eventSource = new EventSource(`/api/phone-sync/events/${encodeURIComponent(target)}`);
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.barcode) {
            handleIncomingPayload(data);
          }
        } catch {}
      };

      eventSource.onerror = () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        // Auto-reconnect quickly on drop
        if (isSubscribed) {
          setTimeout(connectSSE, 2500);
        }
      };
    } catch (e) {
      console.warn('[PhoneSync] SSE connection error:', e);
    }
  };

  connectSSE();

  // 2. High-speed Adaptive Polling Safety Net (every 450ms)
  let isPolling = false;
  const pollInterval = setInterval(async () => {
    if (!isSubscribed || isPolling) return;
    isPolling = true;

    try {
      const url = `/api/phone-sync/poll/${encodeURIComponent(target)}?since=${lastReceivedServerTime}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.serverTime) {
          // Initialize or update baseline server timestamp
          if (lastReceivedServerTime === 0) {
            lastReceivedServerTime = data.serverTime - 500;
          }
        }
        if (data.scans && Array.isArray(data.scans)) {
          for (const scan of data.scans) {
            handleIncomingPayload(scan);
          }
        }
      }
    } catch {} finally {
      isPolling = false;
    }
  }, 450);

  // 3. Periodic Station Status / Heartbeat Check (every 3 seconds)
  const heartbeatInterval = setInterval(async () => {
    if (!isSubscribed) return;
    try {
      const status = await fetchStationStatus(target);
      if (status && onStatusChange) {
        onStatusChange(Boolean(status.isPhoneActive));
      }
    } catch {}
  }, 3000);

  // 4. BroadcastChannel Listener (Instant for same-machine tabs)
  let bc: BroadcastChannel | null = null;
  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (event) => {
        if (event.data) {
          handleIncomingPayload(event.data);
        }
      };
    }
  } catch {}

  // 5. LocalStorage event listener
  const storageListener = (event: StorageEvent) => {
    if (event.key === LAST_SCAN_STORAGE_KEY && event.newValue) {
      try {
        const payload: ScannedBarcodePayload = JSON.parse(event.newValue);
        handleIncomingPayload(payload);
      } catch {}
    }
  };
  window.addEventListener('storage', storageListener);

  // 6. Custom in-window event listener
  const customListener = (event: Event) => {
    const customEv = event as CustomEvent<ScannedBarcodePayload>;
    if (customEv.detail) {
      handleIncomingPayload(customEv.detail);
    }
  };
  window.addEventListener('vms:phone_scan', customListener);

  // Cleanup
  return () => {
    isSubscribed = false;
    clearInterval(pollInterval);
    clearInterval(heartbeatInterval);
    if (eventSource) {
      try {
        eventSource.close();
      } catch {}
    }
    if (bc) {
      try {
        bc.close();
      } catch {}
    }
    window.removeEventListener('storage', storageListener);
    window.removeEventListener('vms:phone_scan', customListener);
  };
}

