/**
 * The Apps Script backend source (backend/Code.gs), bundled into the app at build time so the
 * "copy backend code" buttons work on static hosting too. Loaded on demand as its own chunk.
 */
export async function loadBackendCode(): Promise<string> {
  const mod = await import('../../backend/Code.gs?raw');
  return mod.default as string;
}
