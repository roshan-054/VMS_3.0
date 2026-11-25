/**
 * CCTV-style on-screen display (OSD) burned into every recorded frame.
 * Shared by the recording worker (OffscreenCanvas) and the main-thread fallback (HTMLCanvasElement),
 * so both paths produce identical timestamps.
 */
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface OsdCache {
  second: number;
  text: string;
  font: string;
  width: number;
}

export function createOsdCache(): OsdCache {
  return { second: -1, text: '', font: '', width: 0 };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Burned-in timestamp in the app's standard format: 25-Nov-26  17:17:31 (DD-MMM-YY, 24-hour time). */
export function formatOsdTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${MON[d.getMonth()]}-${p(d.getFullYear() % 100)}  ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function drawOsd(ctx: Ctx2D, cw: number, ch: number, nowMs: number, recording: boolean, cache: OsdCache): void {
  const scale = Math.max(0.8, cw / 1280);
  const fontSize = Math.round(18 * scale);
  const font = `600 ${fontSize}px "SF Mono", Consolas, Menlo, "Courier New", monospace`;
  ctx.font = font;
  ctx.textBaseline = 'top';

  const sec = Math.floor(nowMs / 1000);
  if (sec !== cache.second || font !== cache.font) {
    cache.second = sec;
    cache.font = font;
    cache.text = formatOsdTime(nowMs);
    cache.width = ctx.measureText(cache.text).width;
  }

  const padX = Math.round(10 * scale);
  const padY = Math.round(6 * scale);
  const margin = Math.round(16 * scale);
  const boxH = fontSize + padY * 2;

  const boxW = cache.width + padX * 2;
  const x = cw - boxW - margin;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(x, margin, boxW, boxH);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(cache.text, x + padX, margin + padY);

  if (recording) {
    const rec = '● REC';
    const recW = ctx.measureText(rec).width + padX * 2;
    const rx = cw - recW - margin;
    const ry = ch - boxH - margin;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
    ctx.fillRect(rx, ry, recW, boxH);
    ctx.fillStyle = '#EF4444';
    ctx.fillText(rec, rx + padX, ry + padY);
  }
}
