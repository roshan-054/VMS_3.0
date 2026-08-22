export interface BrandingConfig {
  logoUrl: string;
  faviconUrl: string;
  appName: string;
  appSubtitle: string;
}

const BRANDING_STORAGE_KEY = 'ops_vms_branding_config_v2';
const BRANDING_CHANGE_EVENT = 'ops_vms_branding_changed';

export const DEFAULT_BRANDING: BrandingConfig = {
  logoUrl: '',
  faviconUrl: '',
  appName: 'VMS 2.0',
  appSubtitle: 'Order Packing System',
};

export function getStoredBranding(): BrandingConfig {
  try {
    const raw = localStorage.getItem(BRANDING_STORAGE_KEY);
    if (!raw) return DEFAULT_BRANDING;
    const parsed = JSON.parse(raw);
    return {
      logoUrl: parsed.logoUrl || '',
      faviconUrl: parsed.faviconUrl || '',
      appName: parsed.appName || DEFAULT_BRANDING.appName,
      appSubtitle: parsed.appSubtitle || DEFAULT_BRANDING.appSubtitle,
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
    if (faviconUrl && faviconUrl.trim()) {
      link.href = faviconUrl.trim();
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
  const updated: BrandingConfig = {
    ...current,
    ...config,
  };

  try {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to persist branding config:', err);
  }

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
  document.title = 'VMS 2.0 - Order Packing Video System';

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
