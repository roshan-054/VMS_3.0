/*
 * Order Packing Video System — GitHub Pages configuration
 * CLEAN BUILD v2.9.36
 *
 * The default URL is only a fallback. Customers can configure their own /exec URL from First-time Setup / Connect.
 */
const DEFAULT_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwZFm2t3o2vLFC7blM1AOzmgDMxB0UiZ_scWkLYasPGn7iB9XPoCCIi3mggjObpaMP_/exec";
const CONFIG_STORAGE_KEY = "ops_api_url";
const urlParam = new URLSearchParams(location.search).get("api");
if (urlParam && /^https:\/\/script\.google\.com\/macros\/s\/[^\s]+\/exec(?:\?.*)?$/.test(urlParam)) {
  localStorage.setItem(CONFIG_STORAGE_KEY, urlParam);
}
const APPS_SCRIPT_URL = localStorage.getItem(CONFIG_STORAGE_KEY) || DEFAULT_APPS_SCRIPT_URL;

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024; // 1 GB
const UPLOAD_CHUNK_SIZE = 1024 * 1024;

const PLATFORMS = ["Amazon", "D2C", "JioMart", "Custom Platform"];

const APP_CONFIG = {
  version: "2.9.36.1",
  apiUrl: APPS_SCRIPT_URL,
  maxVideoBytes: MAX_VIDEO_BYTES,
  uploadChunkBytes: UPLOAD_CHUNK_SIZE,
  sessionStorageKey: "ops_token"
};
