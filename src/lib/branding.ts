import { fetchCloudBranding, saveCloudBranding } from './api';
import { getStoredDriveFolderId, setStoredDriveFolderId } from './storage';

export interface BrandingConfig {
  logoUrl: string;
  faviconUrl: string;
  appName: string;
  appSubtitle: string;
  videoDriveFolderId?: string;
}

const BRANDING_STORAGE_KEY = 'ops_vms_branding_config_v3';
const BRANDING_CHANGE_EVENT = 'ops_vms_branding_changed';

export const DEFAULT_BRANDING: BrandingConfig = {
  logoUrl: '',
  faviconUrl: '',
  appName: 'VMS 3.0',
  appSubtitle: 'Order Packing System',
  videoDriveFolderId: '',
};

let isCloudSynced = false;

/**
 * Extracts a Google Drive File ID from any Google Drive sharing link, web view URL, or raw ID.
 */
export function extractDriveFileId(urlOrId: string): string | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;

  // Raw file ID check (typical Drive file IDs are 25-55 alphanumeric characters, hyphens, and underscores)
  if (/^[a-zA-Z0-9_-]{25,55}$/.test(trimmed)) {
    return trimmed;
  }

  // /file/d/{id} pattern
  const matchD = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (matchD && matchD[1]) return matchD[1];

  // /d/{id} pattern (e.g. lh3.googleusercontent.com/d/{id} or drive.google.com/d/{id})
  const matchLh3 = trimmed.match(/(?:googleusercontent\.com|drive\.google\.com)\/d\/([a-zA-Z0-9_-]+)/);
  if (matchLh3 && matchLh3[1]) return matchLh3[1];

  // id= or docid= query parameter
  const matchParam = trimmed.match(/[?&](?:id|docid)=([a-zA-Z0-9_-]+)/);
  if (matchParam && matchParam[1]) return matchParam[1];

  // open?id={id}
  const matchOpen = trimmed.match(/\/open\?id=([a-zA-Z0-9_-]+)/);
  if (matchOpen && matchOpen[1]) return matchOpen[1];

  return null;
}

/**
 * Converts any Google Drive web page, share link, or raw ID into a direct image CDN URL.
 * Works without requiring the user to be signed into Google.
 */
export function getDirectImageUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  // Direct data URIs and blob URIs are already directly displayable
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  const driveId = extractDriveFileId(trimmed);
  if (driveId) {
    // Primary direct CDN endpoint: Google UserContent direct image
    return `https://lh3.googleusercontent.com/d/${driveId}`;
  }

  return trimmed;
}

/**
 * High-resolution fallback endpoint for Drive images if the primary CDN endpoint fails.
 */
export function getAlternativeDirectImageUrl(rawUrl: string): string {
  const driveId = extractDriveFileId(rawUrl);
  if (driveId) {
    return `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`;
  }
  return '';
}

export async function syncCloudBranding(): Promise<BrandingConfig> {
  const local = getStoredBranding();
  try {
    const cloud = await fetchCloudBranding();
    if (cloud) {
      const cloudLogo = cloud.logoUrl && cloud.logoUrl.trim() ? getDirectImageUrl(cloud.logoUrl.trim()) : '';
      const cloudFavicon = cloud.faviconUrl && cloud.faviconUrl.trim() ? getDirectImageUrl(cloud.faviconUrl.trim()) : '';

      const merged: BrandingConfig = {
        logoUrl: cloudLogo || local.logoUrl,
        faviconUrl: cloudFavicon || local.faviconUrl,
        appName: (cloud.appName && cloud.appName.trim()) || local.appName || DEFAULT_BRANDING.appName,
        appSubtitle: (cloud.appSubtitle && cloud.appSubtitle.trim()) || local.appSubtitle || DEFAULT_BRANDING.appSubtitle,
        videoDriveFolderId: (cloud.videoDriveFolderId && cloud.videoDriveFolderId.trim()) || local.videoDriveFolderId || getStoredDriveFolderId(),
      };
      if (cloud.videoDriveFolderId && cloud.videoDriveFolderId.trim()) {
        setStoredDriveFolderId(cloud.videoDriveFolderId.trim());
      }
      localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(merged));
      applyFavicon(merged.faviconUrl);
      if (merged.appName) {
        document.title = `${merged.appName} - Order Packing Video System`;
      }
      isCloudSynced = true;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(BRANDING_CHANGE_EVENT, { detail: merged }));
      }
      return merged;
    }
  } catch (err) {
    // offline or unconfigured
  }
  return local;
}

// Trigger background cloud sync immediately on module load
if (typeof window !== 'undefined') {
  syncCloudBranding().catch(() => {});
}

export function getStoredBranding(): BrandingConfig {
  try {
    const raw = localStorage.getItem(BRANDING_STORAGE_KEY);
    if (!raw) return DEFAULT_BRANDING;
    const parsed = JSON.parse(raw);
    const logo = parsed.logoUrl ? getDirectImageUrl(parsed.logoUrl) : '';
    const favicon = parsed.faviconUrl ? getDirectImageUrl(parsed.faviconUrl) : '';
    return {
      logoUrl: logo,
      faviconUrl: favicon,
      appName: parsed.appName || DEFAULT_BRANDING.appName,
      appSubtitle: parsed.appSubtitle || DEFAULT_BRANDING.appSubtitle,
      videoDriveFolderId: parsed.videoDriveFolderId || getStoredDriveFolderId(),
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}

export function applyFavicon(faviconUrl: string): void {
  try {
    let link: HTMLLinkElement | null = document.querySelector("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.type = 'image/x-icon';
      link.rel = 'shortcut icon';
      document.getElementsByTagName('head')[0].appendChild(link);
    }
    const directFavicon = faviconUrl ? getDirectImageUrl(faviconUrl) : '';
    if (directFavicon && directFavicon.trim()) {
      link.href = directFavicon.trim();
    } else {
      // Default SVG camera/video favicon
      link.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%232563eb"><path d="M4 4h10a2 2 0 0 1 2 2v2.5l4-2.5v12l-4-2.5V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';
    }
  } catch (err) {
    console.warn('Failed to apply favicon:', err);
  }
}

export function setStoredBranding(config: Partial<BrandingConfig>): BrandingConfig {
  const current = getStoredBranding();
  const normalizedConfig: Partial<BrandingConfig> = { ...config };
  if (normalizedConfig.logoUrl) {
    normalizedConfig.logoUrl = getDirectImageUrl(normalizedConfig.logoUrl);
  }
  if (normalizedConfig.faviconUrl) {
    normalizedConfig.faviconUrl = getDirectImageUrl(normalizedConfig.faviconUrl);
  }

  const updated: BrandingConfig = {
    ...current,
    ...normalizedConfig,
  };

  try {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(updated));
    if (updated.videoDriveFolderId) {
      setStoredDriveFolderId(updated.videoDriveFolderId);
    }
  } catch (err) {
    console.error('Failed to persist branding config:', err);
  }

  // Persist to Google Sheet / backend in background
  saveCloudBranding(updated).catch(() => {});

  // Update dynamic document title and favicon
  if (updated.faviconUrl !== undefined) {
    applyFavicon(updated.faviconUrl);
  }
  if (updated.appName) {
    document.title = `${updated.appName} - Order Packing Video System`;
  }

  // Dispatch custom window event so all mounted components react immediately
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BRANDING_CHANGE_EVENT, { detail: updated }));
  }

  return updated;
}

export function resetStoredBranding(): BrandingConfig {
  try {
    localStorage.removeItem(BRANDING_STORAGE_KEY);
  } catch {
    // Ignore
  }
  applyFavicon('');
  document.title = 'VMS 3.0 - Order Packing Video System';

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BRANDING_CHANGE_EVENT, { detail: DEFAULT_BRANDING }));
  }

  return DEFAULT_BRANDING;
}

export function subscribeBranding(callback: (config: BrandingConfig) => void): () => void {
  const handler = (e: Event) => {
    const customEvent = e as CustomEvent<BrandingConfig>;
    if (customEvent.detail) {
      callback(customEvent.detail);
    } else {
      callback(getStoredBranding());
    }
  };

  window.addEventListener(BRANDING_CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);

  return () => {
    window.removeEventListener(BRANDING_CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}
