// VMS video stream worker.
//
// Lets the browser's own video player play a full-quality recording while it is still being
// read from Google Drive. The player asks for /video-stream/<fileId> with a byte range; this
// worker asks the open VMS tab for those bytes (the tab reads them from Drive through the Apps
// Script backend, a few MB at a time) and hands them back as a normal ranged HTTP response.
// Playback starts after the first few MB instead of after the whole file, and seeking only
// fetches the part that is needed.
//
// Every other request is left alone (no caching, no offline mode).

const PREFIX = '/video-stream/';
const ASK_TIMEOUT_MS = 150000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const at = url.pathname.indexOf(PREFIX);
  if (at < 0) return;
  const fileId = decodeURIComponent(url.pathname.slice(at + PREFIX.length).split('/')[0] || '');
  event.respondWith(serve(event, fileId));
});

async function pageFor(event) {
  if (event.clientId) {
    const c = await self.clients.get(event.clientId);
    if (c) return c;
  }
  const all = await self.clients.matchAll({ type: 'window' });
  return all.find((c) => c.focused) || all.find((c) => c.visibilityState === 'visible') || all[0] || null;
}

function ask(client, msg) {
  return new Promise((resolve, reject) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('The video tab did not answer.')), ASK_TIMEOUT_MS);
    ch.port1.onmessage = (ev) => {
      clearTimeout(timer);
      const d = ev.data || {};
      if (d.ok) resolve(d);
      else reject(new Error(d.error || 'Could not read the video.'));
    };
    client.postMessage(Object.assign({ type: 'vms-video-range' }, msg), [ch.port2]);
  });
}

async function serve(event, fileId) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return new Response('Bad video id', { status: 400 });
  const client = await pageFor(event);
  if (!client) return new Response('No VMS tab is open', { status: 503 });

  const rangeHeader = event.request.headers.get('range') || '';
  const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  let start = m && m[1] ? Number(m[1]) : 0;
  let end = m && m[2] ? Number(m[2]) : Infinity;
  if (m && !m[1] && m[2]) {
    // "bytes=-N": the last N bytes. Learn the size first.
    const head = await ask(client, { fileId, start: 0, end: 0 }).catch(() => null);
    if (!head) return new Response('Video unavailable', { status: 502 });
    start = Math.max(0, head.size - Number(m[2]));
    end = Infinity;
  }

  let first;
  try {
    first = await ask(client, { fileId, start, end });
  } catch (err) {
    return new Response(String((err && err.message) || err), { status: 502 });
  }
  const size = first.size;
  if (start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  const last = Math.min(end, size - 1);
  const length = last - start + 1;

  // Send the first piece right away, then keep reading the following pieces as the player pulls
  // on the stream. If the player seeks elsewhere it cancels this stream and asks for a new range.
  let pos = start;
  let pending = first;
  let cancelled = false;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        if (!pending) pending = await ask(client, { fileId, start: pos, end: last });
        let bytes = new Uint8Array(pending.bytes);
        pending = null;
        if (cancelled) return;
        if (!bytes.length) throw new Error('Video ended early.');
        if (pos + bytes.length - 1 > last) bytes = bytes.subarray(0, last - pos + 1);
        controller.enqueue(bytes);
        pos += bytes.length;
        if (pos > last) controller.close();
      } catch (err) {
        if (!cancelled) controller.error(err);
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  const headers = {
    'Content-Type': first.mimeType || 'video/mp4',
    'Content-Length': String(length),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  if (m) headers['Content-Range'] = 'bytes ' + start + '-' + last + '/' + size;
  return new Response(body, { status: m ? 206 : 200, headers });
}
