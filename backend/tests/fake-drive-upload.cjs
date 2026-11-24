'use strict';
// Fake Google Drive resumable upload API for UrlFetchApp: init returns a session URL, PUTs append
// bytes (308 until complete, then 200 with the new file id). Used by upload tests.
function fakeDriveUpload() {
  const sessions = new Map();
  const files = new Map();
  let n = 0;
  const bytesOf = (payload) => Buffer.from(Array.from(payload || [], (b) => b & 255));
  const UrlFetchApp = {
    fetch(url, opts = {}) {
      const method = String(opts.method || 'get').toLowerCase();
      if (url.includes('uploadType=resumable') && method === 'post') {
        const id = `sess${++n}`;
        const meta = JSON.parse(opts.payload || '{}');
        sessions.set(`https://upload.fake/${id}`, { name: meta.name, size: Number(opts.headers['X-Upload-Content-Length']), parts: [], received: 0 });
        return { getResponseCode: () => 200, getHeaders: () => ({ Location: `https://upload.fake/${id}` }), getContentText: () => '' };
      }
      const s = sessions.get(url);
      if (s && method === 'put') {
        const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(opts.headers['Content-Range']);
        const start = Number(m[1]);
        const buf = bytesOf(opts.payload);
        if (start === s.received) { s.parts.push(buf); s.received += buf.length; }
        if (s.received >= s.size) {
          const fid = `FILE_${s.name.replace(/[^A-Za-z0-9]/g, '')}_${n}`;
          files.set(fid, Buffer.concat(s.parts));
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id: fid }), getHeaders: () => ({}) };
        }
        return { getResponseCode: () => 308, getContentText: () => '', getHeaders: () => ({ Range: `bytes=0-${s.received - 1}` }) };
      }
      return { getResponseCode: () => 404, getContentText: () => 'not found', getHeaders: () => ({}) };
    },
  };
  return { UrlFetchApp, sessions, files };
}
module.exports = { fakeDriveUpload };
