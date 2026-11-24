/**
 * Request checks for server.ts, kept separate so they can be unit tested.
 */

// Only genuine Google Drive resumable-upload session URLs may be proxied.
export function isDriveUploadUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === 'https:' &&
      u.hostname === 'www.googleapis.com' &&
      !u.port &&
      !u.username &&
      !u.password &&
      u.pathname.startsWith('/upload/drive/') &&
      u.searchParams.get('uploadType') === 'resumable' &&
      Boolean(u.searchParams.get('upload_id'))
    );
  } catch {
    return false;
  }
}
