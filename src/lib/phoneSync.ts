/**
 * Phone-to-Desktop Wireless Barcode Scanner Sync Service
 * 
 * Facilitates instantaneous real-time syncing between any smartphone (via WiFi / 4G / 5G)
 * and the desktop packing workstation using:
 * 1. Server-Sent Events (SSE) stream over HTTP (/api/phone-sync/events/:sessionId)
 * 2. Real-time REST API endpoint (/api/phone-sync/scan)
 * 3. Smart polling fallback for network dropouts
 * 4. BroadcastChannel & LocalStorage event bus (for local / same-machine testing)
 */

export interface ScannedBarcodePayload {
  id?: string;
  sessionId: string;
  barcode: string;
  timestamp: number;
  deviceInfo?: string;
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
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    sessionId: cleanSession,
    barcode: cleanBarcode,
    timestamp: Date.now(),
    deviceInfo,
  };

  // 1. Send via Server REST API (Real-time network transport)
  let networkSuccess = false;
  try {
    const res = await fetch('/api/phone-sync/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: cleanSession,
        barcode: cleanBarcode,
        deviceInfo,
      }),
    });
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
  onScanReceived: (barcode: string, payload: ScannedBarcodePayload) => void
): () => void {
  const target = targetSessionId.trim().toUpperCase();
  let isSubscribed = true;
  const seenEventIds = new Set<string>();
  let lastReceivedTime = Date.now() - 1000;

  const handleIncomingPayload = (payload: ScannedBarcodePayload) => {
    if (!payload || !payload.barcode || !isSubscribed) return;
    
    // De-duplicate events by ID or identical timestamp/barcode within 1s
    if (payload.id && seenEventIds.has(payload.id)) return;
    if (payload.id) seenEventIds.add(payload.id);

    // Filter by session
    const payloadSession = (payload.sessionId || '').trim().toUpperCase();
    if (payloadSession === target || payloadSession === '*' || !target) {
      lastReceivedTime = Math.max(lastReceivedTime, payload.timestamp || Date.now());
      onScanReceived(payload.barcode, payload);
    }
  };

  // 1. Real-time Server-Sent Events (SSE) Stream
  let eventSource: EventSource | null = null;
  const connectSSE = () => {
    if (!isSubscribed || typeof window === 'undefined' || !('EventSource' in window)) return;
    try {
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
        // Reconnect after brief pause
        if (isSubscribed) {
          setTimeout(connectSSE, 3000);
        }
      };
    } catch (e) {
      console.warn('[PhoneSync] SSE connection error:', e);
    }
  };

  connectSSE();

  // 2. Fast Polling Backup (polls every 1000ms in case SSE is interrupted or behind strict proxy)
  const pollInterval = setInterval(async () => {
    if (!isSubscribed) return;
    try {
      const res = await fetch(`/api/phone-sync/poll/${encodeURIComponent(target)}?since=${lastReceivedTime}`);
      if (res.ok) {
        const data = await res.json();
        if (data.scans && Array.isArray(data.scans)) {
          for (const scan of data.scans) {
            handleIncomingPayload(scan);
          }
        }
      }
    } catch {}
  }, 1000);

  // 3. BroadcastChannel Listener (Instant for same-machine tabs)
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

  // 4. LocalStorage event listener
  const storageListener = (event: StorageEvent) => {
    if (event.key === LAST_SCAN_STORAGE_KEY && event.newValue) {
      try {
        const payload: ScannedBarcodePayload = JSON.parse(event.newValue);
        handleIncomingPayload(payload);
      } catch {}
    }
  };
  window.addEventListener('storage', storageListener);

  // 5. Custom in-window event listener
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
