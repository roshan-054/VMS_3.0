/**
 * ORDER PACKING VIDEO SYSTEM (VMS 3.0)
 * COMPLETE INTEGRATED BACKEND
 *
 * Features:
 * 1. Resumable Chunked Drive Upload (Fast 4MB/8MB/16MB/32MB slices)
 * 2. Hierarchical Date & Platform Folder Routing (Drive Folder ID: 1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA)
 * 3. Non-destructive Append-only Google Sheet Logging (Sheet ID: 1jFsY0d0vCXPrRSi1OXvtgJusi-oZs50Y7wPFPWy6avQ)
 * 4. Automatic Google Sheet Duplicate Order ID Conditional Formatting (Highlights duplicate Order IDs in red)
 * 5. Duplicate Order ID Pre-check and Collision Guard
 * 6. Single & Bulk Manual Backup Upload Support
 * 7. Permanent Custom Branding & Drive "VMS_Branding" Folder Sync (Google Sheet reference)
 *
 * Deploy instructions:
 * 1. In Google Apps Script Editor, paste this code into Code.gs
 * 2. Select setupSystem from toolbar and click 'Run' once
 * 3. Click 'Deploy' -> 'Manage deployments' -> Edit -> New version -> Deploy
 *    (Execute as: Me, Who has access: Anyone)
 */

const CONFIG = {
  // Hardwired Drive & Sheet IDs provided by user:
  HARDWIRED_PARENT_FOLDER_ID: '1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA',
  HARDWIRED_SPREADSHEET_ID: '1jFsY0d0vCXPrRSi1OXvtgJusi-oZs50Y7wPFPWy6avQ',
  DEFAULT_PARENT_FOLDER_NAME: 'Order Packing Video System',
  BRANDING_FOLDER_NAME: 'VMS_Branding',

  // Sheet tab names
  USERS_SHEET: 'Users',
  ORDER_LOG_SHEET: 'OrderLog',
  RETURN_LOG_SHEET: 'ReturnLog',
  DOWNLOAD_LOG_SHEET: 'DownloadLog',
  UPLOAD_LOG_SHEET: 'UploadLog',
  SECURITY_LOG_SHEET: 'SecurityLog',
  BRANDING_SHEET: 'Branding',
  TRASH_LOG_SHEET: 'TrashLog',
  ORDER_MANIFEST_SHEET: 'OrderManifest',
  PACK_VERIFICATION_LOG_SHEET: 'PackVerificationLog',
  GTIN_CATALOG_SHEET: 'GTINCatalog',
  PACKAGE_DETAILS_SHEET: 'PackageDetails',
  SHOPIFY_ORDERS_SHEET: 'ShopifyOrders',
  RETURN_DETAILS_SHEET: 'ReturnDetails',

  // Limits
  MAX_VIDEO_BYTES: 1024 * 1024 * 1024 * 20, // 20 GB technical ceiling; the admin limit (Branding MaxVideoSizeMb) applies below it
  DEFAULT_CHUNK_BYTES: 4 * 1024 * 1024, // 4 MB (aligned to 256 KB Google Drive blocks)
  SESSION_SECONDS: 86400, // 24 hours
  RESERVATION_SECONDS: 86400,
  ALLOWED_PLATFORMS: ['Amazon', 'D2C', 'JioMart', 'Custom']
};

function doGet(e) {
  const callback = String((e && e.parameter && e.parameter.callback) || '').trim();
  const payload = {
    success: true,
    status: 'online',
    service: 'Order Packing Video System (VMS 3.0)',
    version: '3.0.0',
    driveFolderId: CONFIG.HARDWIRED_PARENT_FOLDER_ID,
    spreadsheetId: CONFIG.HARDWIRED_SPREADSHEET_ID,
    transport: 'github-pages',
    timestamp: new Date().toISOString()
  };
  return output_(payload, callback);
}

// Passwords that were shipped as defaults in earlier versions and must never work again.
const BLOCKED_DEFAULT_PASSWORDS = ['Admin@123'];

// Actions that may be called without signing in.
const PUBLIC_ACTIONS = ['health', 'login', 'signup', 'logout', 'validateSession', 'getBranding'];

// Actions that change system setup or permanently remove data: administrators only.
const ADMIN_ACTIONS = [
  'setup', 'repairPlaybackUrls', 'migrateReturns', 'migrateDriveFolders', 'migrateMonthlyFolders',
  'adminCreateUser', 'adminManageUser', 'adminResetPassword', 'adminDeleteUser',
  'deleteLogEntry', 'removeUploadLog', 'deleteOrderLog',
  'scanDuplicates', 'scanDuplicateRecords', 'cleanDuplicates', 'removeDuplicates', 'removeDuplicateRecords',
  'scanOlder', 'scanOlderVideos', 'deleteOlder', 'deleteOlderVideos',
  'applyConditionalFormatting', 'saveBranding', 'uploadBrandingImage', 'checkDriveFolder',
  'getStationQueues', 'getTeamActivity', 'getDriveStorage', 'applyDateFormats',
  'scanSheetCleanup', 'runSheetCleanup', 'scanOrderIdFormat', 'fixOrderIdFormat',
  'getBackendUpdateStatus', 'updateBackend', 'rollbackBackend', 'getSheetCleanupProgress',
  'listCleanupArchive', 'restoreCleanupArchive',
  'getSupabaseConfig', 'saveSupabaseConfig', 'supabaseImport', 'supabaseSweep', 'setUserPermissions'
];

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const p = JSON.parse(raw);
    const a = String(p.action || '');
    SB_TOUCH_ = null;
    SB_DEFER_ = (a === 'uploadChunk' || a === 'heartbeatUpload');
    if (SB_ACTION_TABS_[a]) sbTouchTabs_(SB_ACTION_TABS_[a]);
    if (PUBLIC_ACTIONS.indexOf(a) === -1) {
      REQ_ACCESS_ = null;
      authorizeRequest_(a, p.token);
      // Any other administrator-only action keeps needing an Admin or Super Admin.
      if (ADMIN_ACTIONS.indexOf(a) !== -1 && !ACTION_PERMISSIONS_[a]) admin_(p.token);
      try { applySheetDateFormats_(false); } catch (_) {}
    }
    switch(a) {
      case 'health': return output_({success:true, status:'online', version:'3.0.0', service:'Order Packing Video System (VMS 3.0)'});
      case 'setup': return output_(setupSystem());
      case 'repairPlaybackUrls': return output_(repairPlaybackUrls());
      case 'migrateReturns': return output_(migrateExistingReturns());
      case 'migrateDriveFolders': return output_(migrateDriveFoldersToMonthly_(p.driveFolderId));
      case 'migrateMonthlyFolders': return output_(migrateDriveFoldersToMonthly_(p.driveFolderId));
      case 'login': return output_(login_(p));
      case 'signup': return output_(signup_(p));
      case 'validateSession': return output_(validateSession_(p));
      case 'logout': return output_(logout_(p));
      case 'getUsers': return output_(getUsers_(p));
      case 'getMyAccess': return output_(getMyAccess_(p));
      case 'setUserPermissions': return output_(setUserPermissions_(p));
      case 'adminCreateUser': return output_(adminCreateUser_(p));
      case 'adminManageUser': return output_(adminManageUser_(p));
      case 'adminResetPassword': return output_(adminResetPassword_(p));
      case 'adminDeleteUser': return output_(adminDeleteUser_(p));
      case 'advancedSearch': return output_(advancedSearch_(p));
      case 'searchOrders': return output_(advancedSearch_(p));
      case 'checkDuplicateOrder': return output_(checkDuplicateOrder_(p));
      case 'cleanupStuckUploads': return output_(cleanupStuckUploads_(p));
      case 'acquireUploadSlot': return output_(checkGlobalUploadSlot_(p.orderId, p.uploadId, p.packerEmail));
      case 'releaseUploadSlot': return output_({ success: true, released: (releaseGlobalUploadSlot_(p.uploadId), true) });
      case 'heartbeatUpload': return output_({ success: true, touched: (touchGlobalUploadSlot_(p.uploadId), true) });
      case 'startUpload': return output_(startUpload_(p));
      case 'uploadChunk': return output_(uploadChunk_(p));
      case 'finishUpload': return output_(finishUpload_(p));
      case 'uploadLogs': return output_(uploadLogs_(p));
      case 'getUploadLogs': return output_(uploadLogs_(p));
      case 'downloadLog': return output_(downloadLog_(p));
      case 'getReportData': return output_(getReportData_(p));
      case 'getOrderRecordingReport': return output_(getReportData_(p));
      case 'getAnalyticsData': return output_(getAnalyticsData_(p));
      case 'checkVideoStatus': return output_(checkVideoStatus_(p));
      case 'deleteLogEntry': return output_(deleteLogEntry_(p));
      case 'removeUploadLog': return output_(deleteLogEntry_(p));
      case 'deleteOrderLog': return output_(deleteLogEntry_(p));
      case 'scanDuplicates':
      case 'scanDuplicateRecords': return output_(scanDuplicateRecords_(p));
      case 'cleanDuplicates':
      case 'removeDuplicates':
      case 'removeDuplicateRecords': return output_(removeDuplicateRecords_(p));
      case 'scanOlder':
      case 'scanOlderVideos': return output_(scanOlderVideos_(p));
      case 'deleteOlder':
      case 'deleteOlderVideos': return output_(deleteOlderVideos_(p));
      case 'applyConditionalFormatting': return output_(applyFormattingEndpoint_());
      case 'getBranding': return output_(getBrandingConfig_());
      case 'checkDriveFolder': return output_(checkDriveFolder_(p));
      case 'saveBranding': return output_(saveBrandingConfig_(p));
      case 'uploadBrandingImage': return output_(uploadBrandingImage_(p));
      case 'getDriveFileSize': return output_(getDriveFileSize_(p));
      case 'getVideoChunk': return output_(getVideoChunk_(p));
      case 'reportStationQueue': return output_(reportStationQueue_(p));
      case 'getStationQueues': return output_(getStationQueues_(p));
      case 'getTeamActivity': return output_(getTeamActivity_(p));
      case 'getBoxSettings': return output_(getBoxSettings_(p));
      case 'setBoxFeature': return output_(setBoxFeature_(p));
      case 'saveBoxPreset': return output_(saveBoxPreset_(p));
      case 'deleteBoxPreset': return output_(deleteBoxPreset_(p));
      case 'savePackageDetails': return output_(savePackageDetails_(p));
      case 'getReturnSettings': return output_(getReturnSettings_(p));
      case 'saveLogisticsPartner': return output_(saveLogisticsPartner_(p));
      case 'deleteLogisticsPartner': return output_(deleteLogisticsPartner_(p));
      case 'saveReturnDetails': return output_(saveReturnDetails_(p));
      case 'getReturnOrderInfo': return output_(getReturnOrderInfo_(p));
      case 'getReturnAnalytics': return output_(getReturnAnalytics_(p));
      case 'getShopifySettings': return output_(getShopifySettings_(p));
      case 'saveShopifySettings': return output_(saveShopifySettings_(p));
      case 'testShopifyConnection': return output_(testShopifyConnection_(p));
      case 'shopifySyncNow': return output_(shopifySyncNow_(p));
      case 'getShopifyOrders': return output_(getShopifyOrders_(p));
      case 'getDriveStorage': return output_(getDriveStorage_(p));
      case 'scanSheetCleanup': return output_(scanSheetCleanup_(p));
      case 'runSheetCleanup': return output_(runSheetCleanup_(p));
      case 'scanOrderIdFormat': return output_(fixOrderIdFormat_(p, false));
      case 'fixOrderIdFormat': return output_(fixOrderIdFormat_(p, true));
      case 'getSheetCleanupProgress': return output_(getSheetCleanupProgress_());
      case 'listCleanupArchive': return output_(listCleanupArchive_(p));
      case 'restoreCleanupArchive': return output_(restoreCleanupArchive_(p));
      case 'applyDateFormats': return output_(applySheetDateFormats_(true));
      case 'getBackendUpdateStatus': return output_(getBackendUpdateStatus_(p));
      case 'updateBackend': return output_(updateBackend_(p));
      case 'rollbackBackend': return output_(rollbackBackend_(p));
      case 'saveOrderManifest': return output_(manifestWrite_(saveOrderManifest_(p)));
      case 'saveOrderManifestsBatch': return output_(manifestWrite_(saveOrderManifestsBatch_(p)));
      case 'getOrderManifests': return output_(getOrderManifests_(p));
      case 'updateManifestStatus': return output_(manifestWrite_(updateManifestStatus_(p)));
      case 'deleteOrderManifest': return output_(manifestWrite_(deleteOrderManifest_(p)));
      case 'logPackVerification': return output_(logPackVerification_(p));
      case 'getPackVerificationLogs': return output_(getPackVerificationLogs_(p));
      case 'getGtinCatalog': return output_(getGtinCatalog_(p));
      case 'saveGtinProduct': return output_(saveGtinProduct_(p));
      case 'deleteGtinProduct': return output_(deleteGtinProduct_(p));
      case 'deleteGtinProductsBatch': return output_(deleteGtinProductsBatch_(p));
      case 'saveGtinCatalogBatch': return output_(saveGtinCatalogBatch_(p));
      case 'syncExternalGtinSheet': return output_(syncExternalGtinSheet_(p));
      case 'getSupabaseConfig': return output_(getSupabaseConfig_(p));
      case 'saveSupabaseConfig': return output_(saveSupabaseConfig_(p));
      case 'supabaseImport': return output_(supabaseImport_(p));
      case 'supabaseSweep': return output_({ success: true, results: sbSweep_(true) });
      case 'syncSheetNow': return output_(syncSheetNow_(p));
      case 'supabaseSession': return output_(supabaseSession_(p));
      default: return output_({success:false, error:'Unknown action: '+a});
    }
  } catch(err) {
    const out = {success:false, error:err && err.message ? err.message : String(err)};
    if (err && err.code) out.code = err.code;
    return output_(out);
  }
}

function output_(obj, callback) {
  try { sbFlush_(SB_DEFER_); } catch (sbErr) { console.warn('Supabase copy note:', sbErr); }
  const json = JSON.stringify(obj);
  if(callback && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback+'('+json+')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function scriptProps_(){ return PropertiesService.getScriptProperties(); }

function ss_() {
  const props = scriptProps_();
  // 1. CRITICAL: If script is running container-bound to a Google Sheet (Extensions > Apps Script),
  // always prioritize the active spreadsheet that the user is currently working on!
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) {
      props.setProperty('SPREADSHEET_ID', active.getId());
      return active;
    }
  } catch (e) {
    // getActiveSpreadsheet() is unavailable in standalone Apps Script context
  }

  // 2. Check explicitly stored SPREADSHEET_ID in Script Properties
  const propId = props.getProperty('SPREADSHEET_ID');
  if (propId) {
    try {
      return SpreadsheetApp.openById(propId);
    } catch (e) {
      console.warn('Could not open spreadsheet by stored SPREADSHEET_ID: ' + propId);
    }
  }

  // 3. Fall back to hardwired ID
  const fallbackId = CONFIG.HARDWIRED_SPREADSHEET_ID;
  if (fallbackId) {
    try {
      return SpreadsheetApp.openById(fallbackId);
    } catch (e) {
      console.warn('Could not open hardwired spreadsheet: ' + fallbackId);
    }
  }

  throw new Error('Google Sheet is not configured. Please open your Google Sheet -> Extensions -> Apps Script and run setupSystem(), or set SPREADSHEET_ID in Project Settings -> Script Properties.');
}

const VIDEO_ROOT_CACHE_KEY = 'VMS_VIDEO_ROOT_FOLDER_ID';
// A change typed straight into the Branding tab is picked up within a minute.
const VIDEO_ROOT_CACHE_SECONDS_ = 60;
const VIDEO_FOLDER_SETTING_HELP_ = 'Video upload folder. Paste a Google Drive folder link or ID; every station uploads here within 1 minute (Platform / Type / Month / Date folders are created inside it).';

function cleanFolderId_(raw) {
  const v = String(raw || '').trim();
  const m = v.match(/folders\/([a-zA-Z0-9_-]+)/) || v.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : v;
}

/** The one Drive folder all stations upload videos into: Branding sheet row VideoDriveFolderId
 *  (set from Admin > System Settings), then the PARENT_FOLDER_ID script property, then the built-in default. */
function videoRootFolderId_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(VIDEO_ROOT_CACHE_KEY);
  if (cached) return cached;
  let id = '';
  let hasRow = false;
  let sh = null;
  try {
    sh = ss_().getSheetByName(CONFIG.BRANDING_SHEET);
    if (sh) {
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const k = String(data[i][0] || '').trim();
        if (k === 'VideoDriveFolderId' || k === 'DriveFolderId') {
          hasRow = true;
          id = cleanFolderId_(data[i][1]);
          if (id) break;
        }
      }
    }
  } catch (e) {}
  if (!id) id = scriptProps_().getProperty('PARENT_FOLDER_ID') || CONFIG.HARDWIRED_PARENT_FOLDER_ID;
  // Always show the setting in the Branding tab, so the folder can be changed right there.
  if (sh && !hasRow) {
    try { logAppend_(sh, ['VideoDriveFolderId', id, new Date(), VIDEO_FOLDER_SETTING_HELP_]); } catch (_) {}
  }
  cache.put(VIDEO_ROOT_CACHE_KEY, id, VIDEO_ROOT_CACHE_SECONDS_);
  return id;
}

/** Admin check of a Drive folder before it becomes the video location. */
function checkDriveFolder_(p) {
  const id = cleanFolderId_(p.folder || p.videoDriveFolderId || p.driveFolderId);
  if (!id || id.length < 10) return { success: false, error: 'Paste a Google Drive folder link or folder ID.' };
  let folder;
  try {
    folder = DriveApp.getFolderById(id);
    folder.getName();
  } catch (e) {
    return {
      success: false,
      error: 'This Google account cannot open that folder. Share it with the account that deployed the Apps Script (as Editor), or use a Shared Drive folder.',
      folderId: id
    };
  }
  let canWrite = false;
  try {
    const probe = folder.createFile('vms_write_check.txt', 'VMS write check - safe to delete');
    probe.setTrashed(true);
    canWrite = true;
  } catch (e) {}
  let owner = '';
  try { const o = folder.getOwner(); owner = o ? o.getEmail() : ''; } catch (e) {}
  const info = { success: canWrite, folderId: id, name: folder.getName(), url: folder.getUrl(), owner: owner, canWrite: canWrite };
  if (!canWrite) info.error = 'The folder opens but this account cannot add files to it. Give the Apps Script account Editor access.';
  return info;
}

function parentFolder_(customFolderId, strict) {
  const props = scriptProps_();
  let folderId = customFolderId;

  // 1. If not explicitly provided in call, check the Branding sheet tab
  if (!folderId) {
    try {
      const sh = ss_().getSheetByName(CONFIG.BRANDING_SHEET);
      if (sh) {
        const data = sh.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const k = String(data[i][0] || '').trim();
          if (k === 'VideoDriveFolderId' || k === 'DriveFolderId') {
            const v = String(data[i][1] || '').trim();
            if (v) {
              const urlMatch = v.match(/folders\/([a-zA-Z0-9_-]+)/);
              folderId = urlMatch ? urlMatch[1] : v;
              break;
            }
          }
        }
      }
    } catch (e) {}
  }

  // 2. Fall back to script properties or hardwired ID
  if (!folderId) {
    folderId = props.getProperty('PARENT_FOLDER_ID') || CONFIG.HARDWIRED_PARENT_FOLDER_ID;
  }

  // Clean if full URL passed
  if (folderId && typeof folderId === 'string') {
    const urlMatch = folderId.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) folderId = urlMatch[1];
  }

  if(folderId && folderId.length > 5){
    try {
      return DriveApp.getFolderById(folderId);
    } catch(e){
      if (strict) {
        throw new Error('Cannot open the Google Drive video folder (' + folderId + '). Ask an admin to check Admin > System Settings > Video storage location: ' + e.message);
      }
      console.warn('Could not access folder ID: '+folderId+', falling back to default root.');
    }
  }
  const ss = ss_();
  const file = DriveApp.getFileById(ss.getId());
  const parents = file.getParents();
  const base = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const it = base.getFoldersByName(CONFIG.DEFAULT_PARENT_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : base.createFolder(CONFIG.DEFAULT_PARENT_FOLDER_NAME);
  props.setProperty('PARENT_FOLDER_ID', folder.getId());
  return folder;
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if(!sh) {
    setupSystem();
    const sh2 = ss_().getSheetByName(name);
    if(sh2) return sh2;
    throw new Error('Sheet "'+name+'" not found.');
  }
  return sh;
}

/**
 * Applies Refined Conditional Formatting to Sheets (UploadLog, OrderLog, ReturnLog, DownloadLog, etc.):
 * Automatically highlights duplicate records in Column B ONLY when BOTH the Order ID AND the Recording Type match.
 * Forward and Return recordings for the same Order ID are NOT considered duplicates and will not be highlighted.
 */
function applyDuplicateConditionalFormatting_(sh) {
  if (!sh) return;
  try {
    const sheetName = sh.getName();
    // Exclude system tabs
    if (sheetName === CONFIG.USERS_SHEET || sheetName === CONFIG.BRANDING_SHEET || 
        sheetName === CONFIG.SECURITY_LOG_SHEET || sheetName === CONFIG.TRASH_LOG_SHEET) {
      return;
    }
    const lastRow = Math.max(sh.getMaxRows(), 1000);
    const orderIdRange = sh.getRange('B2:B' + lastRow);

    // Filter out existing custom duplicate rules on Column B to remove old single-criteria formulas
    const rules = sh.getConditionalFormatRules() || [];
    const filteredRules = rules.filter(function(r) {
      const ranges = r.getRanges();
      return !ranges.some(function(rng) {
        const notation = rng.getA1Notation();
        return notation.indexOf('B2:B') !== -1 || notation.indexOf('B:B') !== -1;
      });
    });

    // Formulate strict COUNTIFS formula:
    // In UploadLog: Column B is Order ID, Column M (13) is Recording Type
    // In OrderLog & ReturnLog: Column B is Order ID, Column I (9) is Recording Type
    // In DownloadLog: Column B is Order ID, Column H (8) is Recording Type
    let formula = '';
    if (sheetName === CONFIG.UPLOAD_LOG_SHEET) {
      formula = '=AND(LEN($B2)>0, COUNTIFS($B$2:$B, $B2, $M$2:$M, $M2)>1)';
    } else if (sheetName === CONFIG.ORDER_LOG_SHEET || sheetName === CONFIG.RETURN_LOG_SHEET) {
      formula = '=AND(LEN($B2)>0, COUNTIFS($B$2:$B, $B2, $I$2:$I, $I2)>1)';
    } else if (sheetName === CONFIG.DOWNLOAD_LOG_SHEET) {
      formula = '=AND(LEN($B2)>0, COUNTIFS($B$2:$B, $B2, $H$2:$H, $H2)>1)';
    } else {
      formula = '=AND(LEN($B2)>0, COUNTIF($B$2:$B, $B2)>1)';
    }

    // Create Rule: Highlight cells in Column B where count of (Order ID + Recording Type) > 1
    const duplicateRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula)
      .setBackground('#FEE2E2') // Soft light red
      .setFontColor('#991B1B')  // Crisp dark red
      .setBold(true)
      .setRanges([orderIdRange])
      .build();

    filteredRules.push(duplicateRule);
    sh.setConditionalFormatRules(filteredRules);
  } catch(e) {
    console.warn('Conditional format rule apply note: ', e);
  }
}

function formatFileSize_(bytes) {
  if (bytes === undefined || bytes === null || bytes === '' || bytes === '—' || bytes === '0' || bytes === 0) return '—';
  if (typeof bytes === 'string' && (bytes.includes('MB') || bytes.includes('KB') || bytes.includes('GB') || bytes.includes('B'))) {
    return bytes;
  }
  const n = Number(bytes);
  if (isNaN(n) || n <= 0) return String(bytes);
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function standardizeSheetFileSizes_() {
  const ss = ss_();
  let convertedCount = 0;

  // 1. UploadLog (Column F is index 6 in 1-based)
  try {
    const uploadSh = ss.getSheetByName(CONFIG.UPLOAD_LOG_SHEET);
    if (uploadSh) {
      const data = uploadSh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const rawSize = data[i][5];
        if (typeof rawSize === 'number' || (typeof rawSize === 'string' && /^\d+(\.\d+)?$/.test(rawSize.trim()))) {
          const formatted = formatFileSize_(rawSize);
          if (formatted !== '—' && formatted !== String(rawSize)) {
            uploadSh.getRange(i + 1, 6).setValue(formatted);
            convertedCount++;
          }
        }
      }
    }
  } catch(e) {
    console.warn('UploadLog size standardization note:', e);
  }

  // 2. OrderLog & ReturnLog (Column G is index 7 in 1-based)
  [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET].forEach(function(sName) {
    try {
      const sh = ss.getSheetByName(sName);
      if (sh) {
        const data = sh.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const rawSize = data[i][6];
          if (typeof rawSize === 'number' || (typeof rawSize === 'string' && /^\d+(\.\d+)?$/.test(rawSize.trim()))) {
            const formatted = formatFileSize_(rawSize);
            if (formatted !== '—' && formatted !== String(rawSize)) {
              sh.getRange(i + 1, 7).setValue(formatted);
              convertedCount++;
            }
          }
        }
      }
    } catch(e) {
      console.warn(sName + ' size standardization note:', e);
    }
  });

  SpreadsheetApp.flush();
  return { success: true, convertedCount: convertedCount };
}

function applyFormattingEndpoint_() {
  const ss = ss_();
  const orderSh = ss.getSheetByName(CONFIG.ORDER_LOG_SHEET);
  const returnSh = ss.getSheetByName(CONFIG.RETURN_LOG_SHEET);
  const uploadSh = ss.getSheetByName(CONFIG.UPLOAD_LOG_SHEET);

  if (orderSh) applyDuplicateConditionalFormatting_(orderSh);
  if (returnSh) applyDuplicateConditionalFormatting_(returnSh);
  if (uploadSh) applyDuplicateConditionalFormatting_(uploadSh);
  repairPlaybackUrls();
  standardizeSheetFileSizes_();
  return { success: true, message: 'Conditional formatting refined & file sizes standardized across UploadLog, OrderLog, and ReturnLog.' };
}

/**
 * Repairs Column F ("Video Playback URL") in both OrderLog and ReturnLog.
 * If Column F contains a plain file name (e.g. 407-..._Amazon_Return.mp4) instead of a clickable URL,
 * this function reads the Google Drive ID in Column E and converts Column F into a live clickable link!
 */
function repairPlaybackUrls() {
  const ss = ss_();
  const sheets = [CONFIG.RETURN_LOG_SHEET, CONFIG.ORDER_LOG_SHEET];
  let fixedCount = 0;

  sheets.forEach(function(sName) {
    const sh = ss.getSheetByName(sName);
    if (!sh) return;
    const data = sh.getDataRange().getValues();
    if (data.length <= 1) return;

    for (let i = 1; i < data.length; i++) {
      let fid = String(data[i][4] || '').trim();
      let playback = String(data[i][5] || '').trim();

      // Check if Column E and Column F were swapped
      if (!fid && playback && playback.length > 15 && playback.indexOf('.mp4') === -1 && playback.indexOf('.webm') === -1) {
        fid = playback;
        sh.getRange(i + 1, 5).setValue(fid);
      }

      // If Column E has a valid Drive ID but Column F is a filename or not a URL
      if (fid && fid.length > 8 && (!playback || !playback.startsWith('http') || playback.endsWith('.mp4') || playback.endsWith('.webm'))) {
        const fullUrl = 'https://drive.google.com/file/d/' + fid + '/preview';
        sh.getRange(i + 1, 6).setValue(fullUrl);
        fixedCount++;
      }
    }
  });

  SpreadsheetApp.flush();
  return {
    success: true,
    fixedRows: fixedCount,
    message: `Repaired ${fixedCount} rows. Video Playback URLs in Column F are now clickable links!`
  };
}

function createBrandingTabOnly() {
  const ss = ss_();
  let sh = ss.getSheetByName(CONFIG.BRANDING_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.BRANDING_SHEET);
  }
  try {
    sh.showSheet();
    sh.setTabColor('#4f46e5');
  } catch (_) {}

  const headers = ['Setting Key', 'Setting Value', 'Last Updated', 'Description'];
  const existing = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  headers.forEach(h => {
    if (existing.indexOf(h) === -1) sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
  });
  if (sh.getFrozenRows() === 0) sh.setFrozenRows(1);
  try {
    sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn())).setFontWeight('bold');
  } catch(_) {}

  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(2, 360);
  sh.setColumnWidth(3, 180);
  sh.setColumnWidth(4, 300);

  const bVals = sh.getDataRange().getValues();
  const existingKeys = new Set(bVals.map(r => String(r[0] || '').trim()));
  const now = new Date();
  if (!existingKeys.has('AppName')) logAppend_(sh, ['AppName', 'VMS 3.0', now, 'Application Display Name']);
  if (!existingKeys.has('AppSubtitle')) logAppend_(sh, ['AppSubtitle', 'Order Packing System', now, 'Workstation Subtitle']);
  if (!existingKeys.has('LogoUrl')) logAppend_(sh, ['LogoUrl', '', now, 'Logo Image URL or Drive Direct Link']);
  if (!existingKeys.has('FaviconUrl')) logAppend_(sh, ['FaviconUrl', '', now, 'Browser Favicon URL or Drive Direct Link']);
  if (!existingKeys.has('BrandingFolderId')) logAppend_(sh, ['BrandingFolderId', '', now, 'Google Drive Folder for Brand Assets']);
  if (!existingKeys.has('VideoDriveFolderId') && !existingKeys.has('DriveFolderId')) {
    logAppend_(sh, ['VideoDriveFolderId', CONFIG.HARDWIRED_PARENT_FOLDER_ID || '', now, VIDEO_FOLDER_SETTING_HELP_]);
  }
  if (!existingKeys.has('LastBrandingSync')) logAppend_(sh, ['LastBrandingSync', now.toISOString(), now, 'Last Synchronization Timestamp']);

  SpreadsheetApp.flush();
  Logger.log('==================================================');
  Logger.log('BRANDING TAB CREATED / VERIFIED SUCCESSFULLY!');
  Logger.log('Spreadsheet Name: ' + ss.getName());
  Logger.log('Spreadsheet ID:   ' + ss.getId());
  Logger.log('Spreadsheet URL:  ' + ss.getUrl());
  Logger.log('==================================================');

  return {
    success: true,
    message: 'Branding tab successfully configured in ' + ss.getName(),
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl()
  };
}

function setupSystem() {
  const ss = ss_();
  const folder = parentFolder_();
  const specs = [
    [CONFIG.USERS_SHEET,['Timestamp','Full Name','Email','Password','Role','Status','Permissions']],
    [CONFIG.ORDER_LOG_SHEET,['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status']],
    [CONFIG.RETURN_LOG_SHEET,['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status']],
    [CONFIG.DOWNLOAD_LOG_SHEET,['Timestamp','Order ID','Platform','User Email','File Name','File Size','Download Type','Recording Type']],
    [CONFIG.UPLOAD_LOG_SHEET,['Timestamp','Order ID','Platform','Packer Email','File Name','File Size','Upload ID','Stage','Progress','Drive File ID','Status','Error','Recording Type','Source','Queue Job ID']],
    [CONFIG.SECURITY_LOG_SHEET,['Timestamp','Email','Action','Result','Details']],
    [CONFIG.BRANDING_SHEET,['Setting Key','Setting Value','Last Updated','Description']],
    [CONFIG.TRASH_LOG_SHEET,['Timestamp','Order ID','Platform','Recording Type','Action','Original Sheet','Drive File ID','Playback URL','Cleaned By','Details']],
    [CONFIG.ORDER_MANIFEST_SHEET,['Timestamp','Order ID','Platform','Assigned Packer Name','Assigned Packer Email','Processed By Name','Processed By Email','Total Items Count','Items List','Status','Notes','Packed At','Packed By Name','Video Drive Link']],
    [CONFIG.PACK_VERIFICATION_LOG_SHEET,['Timestamp','Order ID','Platform','Assigned Packer','Verified By Packer','Packer Email','Processed By','Status','Total Required Items','Total Scanned Items','Items Summary','Scanned GTINs Log','Duration Seconds','Drive Video URL']],
    [CONFIG.GTIN_CATALOG_SHEET,['Timestamp','GTIN','SKU','Product Name','Short Name','Category','Image URL','Default Quantity','Notes','Tag']],
    [CONFIG.PACKAGE_DETAILS_SHEET,PACKAGE_DETAILS_HEADERS_],
    [CONFIG.RETURN_DETAILS_SHEET,RETURN_DETAILS_HEADERS_]
  ];
  specs.forEach(([name,headers])=>{
    let sh=ss.getSheetByName(name);
    if(!sh)sh=ss.insertSheet(name);
    try {
      sh.showSheet(); // Guarantee tab is unhidden in the sheet tab bar
    } catch(_) {}
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (sh.getFrozenRows() === 0) sh.setFrozenRows(1);
    try {
      const headerRange = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn()));
      headerRange.setFontWeight('bold');
    } catch(_) {}
  });

  // Seed default branding settings if Branding sheet is empty or missing keys
  const brandSh = ss.getSheetByName(CONFIG.BRANDING_SHEET);
  if (brandSh) {
    try {
      brandSh.showSheet();
      brandSh.setTabColor('#4f46e5');
      brandSh.setColumnWidth(1, 180);
      brandSh.setColumnWidth(2, 360);
      brandSh.setColumnWidth(3, 180);
      brandSh.setColumnWidth(4, 300);
      const bVals = brandSh.getDataRange().getValues();
      const existingKeys = new Set(bVals.map(r => String(r[0] || '').trim()));
      const now = new Date();
      if (!existingKeys.has('AppName')) logAppend_(brandSh, ['AppName', 'VMS 3.0', now, 'Application Display Name']);
      if (!existingKeys.has('AppSubtitle')) logAppend_(brandSh, ['AppSubtitle', 'Order Packing System', now, 'Workstation Subtitle']);
      if (!existingKeys.has('LogoUrl')) logAppend_(brandSh, ['LogoUrl', '', now, 'Logo Image URL or Drive Direct Link']);
      if (!existingKeys.has('FaviconUrl')) logAppend_(brandSh, ['FaviconUrl', '', now, 'Browser Favicon URL or Drive Direct Link']);
      if (!existingKeys.has('BrandingFolderId')) logAppend_(brandSh, ['BrandingFolderId', '', now, 'Google Drive Folder for Brand Assets']);
      if (!existingKeys.has('VideoDriveFolderId') && !existingKeys.has('DriveFolderId')) {
        logAppend_(brandSh, ['VideoDriveFolderId', CONFIG.HARDWIRED_PARENT_FOLDER_ID || '', now, VIDEO_FOLDER_SETTING_HELP_]);
      }
      if (!existingKeys.has('LastBrandingSync')) logAppend_(brandSh, ['LastBrandingSync', now.toISOString(), now, 'Last Synchronization Timestamp']);
    } catch(bErr) {
      console.warn('Branding setup format notice:', bErr);
    }
  }

  // Apply refined conditional formatting on OrderLog, ReturnLog, UploadLog, DownloadLog
  const orderSh = ss.getSheetByName(CONFIG.ORDER_LOG_SHEET);
  if (orderSh) {
    applyDuplicateConditionalFormatting_(orderSh);
  }
  const returnSh = ss.getSheetByName(CONFIG.RETURN_LOG_SHEET);
  if (returnSh) {
    applyDuplicateConditionalFormatting_(returnSh);
  }
  const uploadSh = ss.getSheetByName(CONFIG.UPLOAD_LOG_SHEET);
  if (uploadSh) {
    applyDuplicateConditionalFormatting_(uploadSh);
  }
  const downloadSh = ss.getSheetByName(CONFIG.DOWNLOAD_LOG_SHEET);
  if (downloadSh) {
    applyDuplicateConditionalFormatting_(downloadSh);
  }

  // Run repair for any existing rows where Column F has plain filename instead of clickable URL
  repairPlaybackUrls();

  // Reorganize any existing flat date folders into monthly folders
  try {
    migrateDriveFoldersToMonthly_();
  } catch (mErr) {
    console.warn('Folder migration note during setup: ', mErr);
  }

  // No default admin account is seeded. The first person to sign up on an empty Users sheet
  // becomes the administrator (see signup_).

  SpreadsheetApp.flush();

  Logger.log('==================================================');
  Logger.log('SYSTEM SETUP COMPLETED SUCCESSFULLY!');
  Logger.log('Spreadsheet Name: ' + ss.getName());
  Logger.log('Spreadsheet ID:   ' + ss.getId());
  Logger.log('Spreadsheet URL:  ' + ss.getUrl());
  Logger.log('Drive Parent Folder: ' + folder.getName() + ' (' + folder.getId() + ')');
  Logger.log('Tabs in Spreadsheet:');
  ss.getSheets().forEach(function(s) {
    Logger.log('  - ' + s.getName() + (s.isSheetHidden() ? ' [HIDDEN]' : ' [VISIBLE]'));
  });
  Logger.log('==================================================');

  try { applySheetDateFormats_(true); } catch (_) {}
  return {
    success: true,
    message: 'System setup completed & duplicate formatting configured.',
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    parentFolder: folder.getName(),
    parentFolderId: folder.getId()
  };
}

function hash_(password) {
  const b=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(password||''),Utilities.Charset.UTF_8);
  return b.map(x=>{if(x<0)x+=256;return ('0'+x.toString(16)).slice(-2)}).join('');
}

function newToken_(){return Utilities.getUuid()+'-'+Utilities.getUuid()}

function saveSession_(user){
  const t=newToken_();
  const record=JSON.stringify({user:user, exp:Date.now()+CONFIG.SESSION_SECONDS*1000});
  CacheService.getScriptCache().put('SESSION_'+t,record,CONFIG.SESSION_SECONDS);
  PropertiesService.getScriptProperties().setProperty('SESS_'+t, record);
  try { sbPutSession_(t, JSON.parse(record)); } catch (_) {}
  pruneExpiredSessions_();
  return t;
}

function authError_(message){
  const err=new Error(message||'Your session has expired. Please sign in again.');
  err.code='AUTH_REQUIRED';
  return err;
}

// Returns the signed-in user for a token, or throws AUTH_REQUIRED.
// Missing, unknown, expired and legacy (no expiry) sessions are all rejected.
function session_(token){
  token=String(token||'').trim();
  if(!token) throw authError_('Please sign in to continue.');
  let raw=CacheService.getScriptCache().get('SESSION_'+token);
  if(!raw) raw=PropertiesService.getScriptProperties().getProperty('SESS_'+token);
  if(!raw) throw authError_();
  let rec=null;
  try{rec=JSON.parse(raw)}catch(_){rec=null}
  if(!rec||!rec.user||!rec.exp||Number(rec.exp)<Date.now()){
    try{CacheService.getScriptCache().remove('SESSION_'+token)}catch(_){}
    try{PropertiesService.getScriptProperties().deleteProperty('SESS_'+token)}catch(_){}
    throw authError_();
  }
  return rec.user;
}

function isAdminRole_(role){
  const r=String(role||'').toLowerCase().replace(/[\s_-]/g,'');
  return r==='admin'||r==='masteradmin'||r==='superadmin';
}

function isSuperAdminRole_(role){
  const r=String(role||'').toLowerCase().replace(/[\s_-]/g,'');
  return r==='superadmin'||r==='masteradmin';
}

/** The three roles written to the Users sheet: Super Admin, Admin or User. */
function canonicalRole_(role){
  if(isSuperAdminRole_(role))return 'Super Admin';
  return isAdminRole_(role)?'Admin':'User';
}

function admin_(token){
  const u=session_(token);
  // The request was already allowed by its permission (for example a User the Super Admin
  // allowed to manage users): the function's own administrator check is satisfied.
  if(REQ_ACCESS_&&REQ_ACCESS_.token===String(token||'').trim()&&REQ_ACCESS_.granted)return u;
  const live=REQ_ACCESS_&&REQ_ACCESS_.token===String(token||'').trim()?REQ_ACCESS_.access:null;
  if(!isAdminRole_(live?live.role:u.role))throw new Error('Administrator permission required.');
  return u;
}

/* ---------- Super Admin and permissions ----------
 * Roles: Super Admin > Admin > User. Each user's permissions start from their role's defaults,
 * so existing Admins and Users keep exactly what they had. Only a Super Admin can change a
 * user's permissions (stored as JSON in the Users sheet "Permissions" column G) or see the
 * Supabase settings. Every request is checked against the user's current row in the Users
 * sheet, so a change applies within a minute without signing in again. */
const PERMISSION_KEYS_ = [
  'canAccessRecord', 'canAccessProcessing', 'canAccessQueue', 'canAccessLogs',
  'canAccessSearch', 'canAccessReports', 'canAccessAnalytics', 'canAccessHealth',
  'canDeleteData', 'canManageUsers', 'canManageSettings', 'canManageBranding'
];
const USER_PERMISSION_DEFAULTS_ = {
  canAccessRecord: true, canAccessProcessing: true, canAccessQueue: true, canAccessLogs: true,
  canAccessSearch: false, canAccessReports: false, canAccessAnalytics: false, canAccessHealth: false,
  canDeleteData: false, canManageUsers: false, canManageSettings: false, canManageBranding: false
};
// The one account made Super Admin automatically while the sheet has no Super Admin yet,
// and only if it is already an approved Admin. Afterwards this email has no special rights.
const SUPER_ADMIN_BOOTSTRAP_EMAIL_ = 'roshan.k@paraayan.com';
const USERS_PERMISSIONS_COL_ = 7;
const ACCESS_CACHE_SECONDS_ = 60;
let REQ_ACCESS_ = null;

// Which permission each protected action needs. 'superAdmin' = Super Admin only,
// 'admin' = Admin or Super Admin. Arrays mean any one of them.
const ACTION_PERMISSIONS_ = {
  getSupabaseConfig: 'superAdmin', saveSupabaseConfig: 'superAdmin', supabaseImport: 'superAdmin', supabaseSweep: 'superAdmin',
  setUserPermissions: 'superAdmin', setBoxFeature: 'superAdmin',
  getShopifySettings: 'superAdmin', saveShopifySettings: 'superAdmin', testShopifyConnection: 'superAdmin',
  adminCreateUser: 'canManageUsers', adminManageUser: 'canManageUsers', adminResetPassword: 'canManageUsers', adminDeleteUser: 'canManageUsers',
  deleteLogEntry: 'canDeleteData', removeUploadLog: 'canDeleteData', deleteOrderLog: 'canDeleteData',
  scanDuplicates: 'canDeleteData', scanDuplicateRecords: 'canDeleteData', cleanDuplicates: 'canDeleteData',
  removeDuplicates: 'canDeleteData', removeDuplicateRecords: 'canDeleteData',
  scanOlder: 'canDeleteData', scanOlderVideos: 'canDeleteData', deleteOlder: 'canDeleteData', deleteOlderVideos: 'canDeleteData',
  saveBranding: ['canManageBranding', 'canManageSettings'], uploadBrandingImage: 'canManageBranding',
  setup: 'canManageSettings', repairPlaybackUrls: 'canManageSettings', migrateReturns: 'canManageSettings',
  migrateDriveFolders: 'canManageSettings', migrateMonthlyFolders: 'canManageSettings',
  applyConditionalFormatting: 'canManageSettings', checkDriveFolder: 'canManageSettings',
  getDriveStorage: 'canManageSettings', applyDateFormats: 'canManageSettings',
  scanSheetCleanup: 'canManageSettings', runSheetCleanup: 'canManageSettings', getSheetCleanupProgress: 'canManageSettings',
  listCleanupArchive: 'canManageSettings', restoreCleanupArchive: 'canManageSettings',
  getBackendUpdateStatus: 'canManageSettings', updateBackend: 'canManageSettings', rollbackBackend: 'canManageSettings',
  getStationQueues: 'admin', getTeamActivity: 'admin', getReturnAnalytics: 'canAccessAnalytics'
};

function roleDefaultPermissions_(role){
  const out={};
  const all=isAdminRole_(role);
  PERMISSION_KEYS_.forEach(function(k){out[k]=all?true:USER_PERMISSION_DEFAULTS_[k]===true});
  return out;
}

function parseStoredPermissions_(raw){
  let obj=null;
  if(raw&&typeof raw==='object')obj=raw;
  else{try{obj=JSON.parse(String(raw||''))}catch(_){obj=null}}
  const out={};
  if(!obj||typeof obj!=='object')return out;
  PERMISSION_KEYS_.forEach(function(k){if(typeof obj[k]==='boolean')out[k]=obj[k]});
  return out;
}

/** A user's permissions: their role's defaults with the Super Admin's changes on top. */
function effectivePermissions_(role, stored){
  const base=roleDefaultPermissions_(role);
  if(isSuperAdminRole_(role))return base; // a Super Admin always has everything
  const custom=parseStoredPermissions_(stored);
  Object.keys(custom).forEach(function(k){base[k]=custom[k]});
  return base;
}

function hasPermission_(access, need){
  if(!access)return false;
  if(isSuperAdminRole_(access.role))return true;
  if(need==='superAdmin')return false;
  if(need==='admin')return isAdminRole_(access.role);
  const list=Array.isArray(need)?need:[need];
  return list.some(function(k){return access.permissions&&access.permissions[k]===true});
}

function isApprovedStatus_(raw){
  const s=String(raw||'Approved').trim().toLowerCase();
  return !s||s==='approved'||s==='active'||s==='enabled'||s==='true';
}

function ensurePermissionsHeader_(sh){
  try{
    if(sh.getLastColumn()<USERS_PERMISSIONS_COL_||String(sh.getRange(1,USERS_PERMISSIONS_COL_).getValue()||'')!=='Permissions'){
      sh.getRange(1,USERS_PERMISSIONS_COL_).setValue('Permissions');
    }
  }catch(_){}
}

/** Make the bootstrap account Super Admin while the sheet has none. Returns true if it changed. */
function ensureSuperAdmin_(sh, values){
  for(let i=1;i<values.length;i++)if(isSuperAdminRole_(values[i][4])&&isApprovedStatus_(values[i][5]))return false;
  for(let i=1;i<values.length;i++){
    if(normalize_(values[i][2])!==SUPER_ADMIN_BOOTSTRAP_EMAIL_)continue;
    if(!isAdminRole_(values[i][4])||!isApprovedStatus_(values[i][5]))return false;
    sh.getRange(i+1,5).setValue('Super Admin');
    values[i][4]='Super Admin';
    try{sbTouchTabs_([CONFIG.USERS_SHEET])}catch(_){}
    securityLog_(SUPER_ADMIN_BOOTSTRAP_EMAIL_,'ROLE','SUCCESS','Made Super Admin (no Super Admin existed)');
    return true;
  }
  return false;
}

function accessCacheKey_(email){return 'ACCESS_'+normalize_(email)}
function clearAccessCache_(email){try{CacheService.getScriptCache().remove(accessCacheKey_(email))}catch(_){}}

/**
 * The user's current role, status and permissions from the Users sheet (cached for a minute).
 * Returns null when the account no longer exists. Throws only if the sheet cannot be read.
 */
function liveAccess_(email){
  const key=accessCacheKey_(email);
  try{
    const hit=CacheService.getScriptCache().get(key);
    if(hit){const rec=JSON.parse(hit);return rec.missing?null:rec}
  }catch(_){}
  const sh=sheet_(CONFIG.USERS_SHEET), values=sh.getDataRange().getValues();
  try{if(ensureSuperAdmin_(sh,values))clearAccessCache_(SUPER_ADMIN_BOOTSTRAP_EMAIL_)}catch(_){}
  let rec={missing:true};
  for(let i=1;i<values.length;i++){
    if(normalize_(values[i][2])!==normalize_(email))continue;
    const role=canonicalRole_(values[i][4]);
    rec={
      email:normalize_(email), name:String(values[i][1]||''), role:role,
      approved:isApprovedStatus_(values[i][5]),
      permissions:effectivePermissions_(role, values[i][USERS_PERMISSIONS_COL_-1]),
      customPermissions:Object.keys(parseStoredPermissions_(values[i][USERS_PERMISSIONS_COL_-1])).length>0
    };
    break;
  }
  try{CacheService.getScriptCache().put(key,JSON.stringify(rec),ACCESS_CACHE_SECONDS_)}catch(_){}
  return rec.missing?null:rec;
}

/**
 * Checks a signed-in request against the user's current access. Ends the session when the
 * account was removed or disabled, and refuses actions the user is not allowed to take.
 */
function authorizeRequest_(action, token){
  const user=session_(token);
  let access=null;
  try{access=liveAccess_(user.email)}catch(_){
    // Users sheet not readable right now: fall back to the role saved at sign-in.
    const role=canonicalRole_(user.role);
    access={email:normalize_(user.email),name:user.name,role:role,approved:true,permissions:effectivePermissions_(role,null),fallback:true};
  }
  if(!access||!access.approved){
    try{CacheService.getScriptCache().remove('SESSION_'+token)}catch(_){}
    try{PropertiesService.getScriptProperties().deleteProperty('SESS_'+token)}catch(_){}
    try{sbDropSessions_(token, null)}catch(_){}
    throw authError_('Your account is no longer active. Please sign in again or contact an administrator.');
  }
  const need=ACTION_PERMISSIONS_[action];
  const granted=need?hasPermission_(access,need):false;
  REQ_ACCESS_={token:String(token||'').trim(), access:access, granted:granted};
  if(need&&!granted){
    throw new Error(need==='superAdmin'
      ? 'Only the Super Admin can do this.'
      : 'You do not have permission to do this. Ask the Super Admin to allow it.');
  }
  return access;
}

function publicUser_(access, fallbackUser){
  return {
    name: access ? (access.name || (fallbackUser && fallbackUser.name) || '') : String((fallbackUser && fallbackUser.name) || ''),
    email: access ? access.email : normalize_(fallbackUser && fallbackUser.email),
    role: access ? access.role : canonicalRole_(fallbackUser && fallbackUser.role),
    permissions: access ? access.permissions : effectivePermissions_(fallbackUser && fallbackUser.role, null)
  };
}

/** The signed-in user's current role and permissions (the app refreshes its menu from this). */
function getMyAccess_(p){
  const user=session_(p.token);
  const access=REQ_ACCESS_&&REQ_ACCESS_.access?REQ_ACCESS_.access:liveAccess_(user.email);
  return {success:true, user:publicUser_(access,user)};
}

/** Super Admin only: set which pages and actions a user has. */
function setUserPermissions_(p){
  const me=session_(p.token);
  return withScriptLock_(function(){
    const sh=sheet_(CONFIG.USERS_SHEET), values=sh.getDataRange().getValues();
    const target=normalize_(p.email||p.expectedEmail);
    let row=-1;
    for(let i=1;i<values.length;i++)if(normalize_(values[i][2])===target){row=i;break}
    if(row<0)throw new Error('User account not found.');
    if(isSuperAdminRole_(values[row][4]))throw new Error('A Super Admin always has every permission.');
    const role=canonicalRole_(values[row][4]);
    let stored='';
    if(!p.reset){
      const wanted=parseStoredPermissions_(p.permissions), defaults=roleDefaultPermissions_(role), diff={};
      // Store only what differs from the role, so a role change later still works as expected.
      Object.keys(wanted).forEach(function(k){if(wanted[k]!==defaults[k])diff[k]=wanted[k]});
      stored=Object.keys(diff).length?JSON.stringify(diff):'';
    }
    ensurePermissionsHeader_(sh);
    sh.getRange(row+1,USERS_PERMISSIONS_COL_).setValue(stored);
    clearAccessCache_(target);
    securityLog_(normalize_(me.email),'PERMISSIONS','SUCCESS','Updated '+target+': '+(stored||'role defaults'));
    return {success:true, email:target, permissions:effectivePermissions_(role,stored), customPermissions:!!stored};
  });
}

function pruneExpiredSessions_(){
  try{
    const props=PropertiesService.getScriptProperties(), all=props.getProperties(), now=Date.now();
    Object.keys(all).forEach(function(k){
      if(k.indexOf('SESS_')!==0)return;
      let rec=null;
      try{rec=JSON.parse(all[k])}catch(_){}
      if(!rec||!rec.exp||Number(rec.exp)<now)props.deleteProperty(k);
    });
  }catch(_){}
}

function securityLog_(email,action,result,details){
  try{logAppend_(sheet_(CONFIG.SECURITY_LOG_SHEET), [new Date(),email,action,result,details||''])}catch(_){}
}

/* ---------- User Authentication ---------- */
function login_(p){
  const rawIdentifier = String(p.email || p.userId || p.identifier || '').trim();
  const email = rawIdentifier.toLowerCase();
  const password = String(p.password || '');
  if(!email || !password) throw new Error('User ID / Email and password are required.');

  const wanted = hash_(password);
  const sh = sheet_(CONFIG.USERS_SHEET);
  let values = sh.getDataRange().getValues();

  if (values.length <= 1) {
    throw new Error('No accounts exist yet. Click "Create Account" to register the first administrator.');
  }

  for(let i = 1; i < values.length; i++){
    const rowName = String(values[i][1] || '').trim().toLowerCase();
    const rowEmail = String(values[i][2] || '').trim().toLowerCase();
    const rowUsername = rowEmail.split('@')[0];

    // Check if identifier matches email, username prefix, or name
    if (rowEmail !== email && rowUsername !== email && rowName !== email) {
      continue;
    }

    const storedPass = String(values[i][3] || '').trim();
    // Stored value is normally a SHA-256 hex hash. A plain-text value is accepted only when it
    // does not look like a hash (e.g. an admin typed a temporary password into the sheet), so the
    // hash itself can never be used as a password. Comparison is exact (case-sensitive).
    const storedIsHash = /^[0-9a-f]{64}$/i.test(storedPass);
    const isPasswordMatch = storedIsHash
      ? storedPass.toLowerCase() === wanted
      : (storedPass !== '' && storedPass === password);

    if(isPasswordMatch && BLOCKED_DEFAULT_PASSWORDS.indexOf(password) !== -1){
      securityLog_(email, 'LOGIN', 'BLOCKED', 'Default password');
      throw new Error('This account still uses the old default password, which is no longer allowed. Ask an administrator to reset it, or type a new password into the Password column of the Users sheet (it is hashed on next sign-in).');
    }

    if(!isPasswordMatch){
      securityLog_(email, 'LOGIN', 'FAILED', 'Invalid password');
      throw new Error('Incorrect password. Please verify your password and Caps Lock.');
    }

    // Auto-upgrade plain-text password to SHA-256 hash in Google Sheet for future security
    if (!storedIsHash) {
      try {
        sh.getRange(i + 1, 4).setValue(wanted);
      } catch (_) {}
    }

    const rawStatus = String(values[i][5] || 'Approved').trim().toLowerCase();
    const isApproved = !rawStatus || rawStatus === 'approved' || rawStatus === 'active' || rawStatus === 'enabled' || rawStatus === 'true';
    if(!isApproved){
      securityLog_(email, 'LOGIN', 'BLOCKED', 'Account status: ' + values[i][5]);
      throw new Error('Your account is pending administrator approval (Status: ' + (values[i][5] || 'Pending') + ').');
    }

    try { if (ensureSuperAdmin_(sh, values)) clearAccessCache_(SUPER_ADMIN_BOOTSTRAP_EMAIL_); } catch (_) {}
    const role = canonicalRole_(values[i][4] || 'User');
    const user = {
      name: String(values[i][1] || 'Packing Operator'),
      email: String(values[i][2] || email),
      role: role
    };
    clearAccessCache_(user.email);
    securityLog_(user.email, 'LOGIN', 'SUCCESS', 'Authenticated');
    const out = { name: user.name, email: user.email, role: role, permissions: effectivePermissions_(role, values[i][USERS_PERMISSIONS_COL_ - 1]) };
    return { success: true, token: saveSession_(user), user: out };
  }

  securityLog_(email, 'LOGIN', 'FAILED', 'User not found: ' + rawIdentifier);
  throw new Error('Account not found for "' + rawIdentifier + '". Please verify your User ID / Email or click "Create Account" below.');
}

function signup_(p){
  const name=String(p.fullName||'').trim(), email=String(p.email||'').trim().toLowerCase(), password=String(p.password||'');
  if(!name||!email||!password)throw new Error('All fields are required.');
  if(password.length<8)throw new Error('Password must contain at least 8 characters.');
  if(BLOCKED_DEFAULT_PASSWORDS.indexOf(password)!==-1)throw new Error('Please choose a different password.');
  return withScriptLock_(function(){
    const sh=sheet_(CONFIG.USERS_SHEET), values=sh.getDataRange().getValues();
    let hasAdmin=false;
    for(let i=1;i<values.length;i++){
      if(String(values[i][2]||'').trim().toLowerCase()===email)throw new Error('An account with this email already exists.');
      if(isAdminRole_(values[i][4]))hasAdmin=true;
    }
    // Bootstrap: with no administrator yet, the first account becomes an approved Super Admin.
    // Afterwards new accounts are Pending until an administrator approves them.
    const role=hasAdmin?'User':'Super Admin';
    const status=hasAdmin?'Pending':'Approved';
    logAppend_(sh, [new Date(),name,email,hash_(password),role,status]);
    securityLog_(email,'SIGNUP','SUCCESS','Registered as '+role+' ('+status+')');
    if(status!=='Approved'){
      return {success:true, pending:true, message:'Account created. An administrator must approve it before you can sign in.'};
    }
    const user={name:name,email:email,role:role};
    const out={name:name,email:email,role:role,permissions:effectivePermissions_(role,null)};
    return {success:true, token:saveSession_(user), user:out, message:'Super Admin account created. Signed in as '+name+'.'};
  });
}

function validateSession_(p){
  try{
    const u=session_(p.token);
    let access=null;
    try{access=liveAccess_(u.email)}catch(_){access=undefined}
    if(access===null||(access&&!access.approved))return {success:false,code:'AUTH_REQUIRED',error:'Your account is no longer active.'};
    return {success:true,user:publicUser_(access||null,u)};
  }catch(err){
    return {success:false,code:'AUTH_REQUIRED',error:err.message};
  }
}

function logout_(p){
  if(p.token) {
    CacheService.getScriptCache().remove('SESSION_'+p.token);
    PropertiesService.getScriptProperties().deleteProperty('SESS_'+p.token);
    sbDropSessions_(p.token, null);
  }
  return {success:true};
}

function getUsers_(p){
  session_(p.token);
  const sh=sheet_(CONFIG.USERS_SHEET), v=sh.getDataRange().getValues(), users=[];
  try{if(ensureSuperAdmin_(sh,v))clearAccessCache_(SUPER_ADMIN_BOOTSTRAP_EMAIL_)}catch(_){}
  for(let i=1;i<v.length;i++){
    const role=canonicalRole_(v[i][4]||'User'), stored=v[i][USERS_PERMISSIONS_COL_-1];
    users.push({row:i+1,name:String(v[i][1]||''),email:String(v[i][2]||''),role:role,status:String(v[i][5]||'Pending'),
      created:v[i][0] instanceof Date?v[i][0].toISOString():String(v[i][0]||''),
      permissions:effectivePermissions_(role,stored),customPermissions:Object.keys(parseStoredPermissions_(stored)).length>0});
  }
  return {success:true,users};
}

/** The caller is a Super Admin right now (checked against the Users sheet). */
function callerIsSuperAdmin_(token){
  const a=REQ_ACCESS_&&REQ_ACCESS_.token===String(token||'').trim()?REQ_ACCESS_.access:null;
  if(a)return isSuperAdminRole_(a.role);
  const u=session_(token);
  try{const live=liveAccess_(u.email);return !!(live&&isSuperAdminRole_(live.role))}catch(_){return isSuperAdminRole_(u.role)}
}

/** Role to save for a create/edit: only a Super Admin can give or take away Super Admin. */
function requestedRole_(p, callerSuper){
  const want=canonicalRole_(p.role);
  if(want==='Super Admin'&&!callerSuper)throw new Error('Only the Super Admin can make someone a Super Admin.');
  return want;
}

function countApprovedSuperAdmins_(values){
  let n=0;
  for(let i=1;i<values.length;i++)if(isSuperAdminRole_(values[i][4])&&isApprovedStatus_(values[i][5]))n++;
  return n;
}

function adminCreateUser_(p){
  admin_(p.token);
  const name=String(p.name||p.fullName||'').trim(), email=String(p.email||'').trim().toLowerCase(), password=String(p.password||'');
  if(!name||!email||password.length<6)throw new Error('Name, valid email and password (6+) are required.');
  const role=requestedRole_(p, callerIsSuperAdmin_(p.token));
  const sh=sheet_(CONFIG.USERS_SHEET), v=sh.getDataRange().getValues();
  if(v.some((r,i)=>i>0&&String(r[2]||'').toLowerCase()===email))throw new Error('Email already exists.');
  logAppend_(sh, [new Date(),name,email,hash_(password),role,p.status||'Approved']);
  return {success:true};
}

function adminManageUser_(p){
  admin_(p.token);
  const row=Number(p.row);if(row<2)throw new Error('Invalid user row.');
  const sh=sheet_(CONFIG.USERS_SHEET), current=sh.getRange(row,1,1,6).getValues()[0];
  const expected=String(p.expectedEmail||'').toLowerCase();if(expected&&String(current[2]||'').toLowerCase()!==expected)throw new Error('User record changed. Refresh and try again.');
  const callerSuper=callerIsSuperAdmin_(p.token);
  const targetSuper=isSuperAdminRole_(current[4]);
  if(targetSuper&&!callerSuper)throw new Error('Only the Super Admin can change a Super Admin account.');
  // A missing role keeps the current one (for example a status-only change).
  const role=p.role===undefined||p.role===null||p.role===''?canonicalRole_(current[4]):requestedRole_(p, callerSuper);
  const status=String(p.status||current[5]);
  if(targetSuper&&(role!=='Super Admin'||!isApprovedStatus_(status))){
    if(countApprovedSuperAdmins_(sh.getDataRange().getValues())<=1)throw new Error('This is the only Super Admin. Make another user Super Admin first.');
  }
  sh.getRange(row,2,1,1).setValue(String(p.name||current[1]));
  sh.getRange(row,5,1,2).setValues([[role,status]]);
  clearAccessCache_(current[2]);
  // Role or approval changed: the user's fast-database sign-in is renewed from this Sheet on next use.
  if (String(current[4]||'')!==role || String(current[5]||'')!==status) sbDropSessions_(null, String(current[2]||''));
  return {success:true};
}

function adminResetPassword_(p){
  admin_(p.token);
  const row=Number(p.row),password=String(p.password||'');if(row<2||password.length<6)throw new Error('Invalid row or password.');
  const sh=sheet_(CONFIG.USERS_SHEET);
  if(isSuperAdminRole_(sh.getRange(row,5).getValue())&&!callerIsSuperAdmin_(p.token))throw new Error('Only the Super Admin can reset a Super Admin password.');
  sh.getRange(row,4).setValue(hash_(password));return {success:true};
}

function adminDeleteUser_(p){
  const me = admin_(p.token);
  const sh = sheet_(CONFIG.USERS_SHEET);
  const v = sh.getDataRange().getValues();
  let row = Number(p.row || 0);
  const targetEmail = String(p.email || p.userId || p.identifier || '').trim().toLowerCase();

  if (row < 2 && targetEmail) {
    for (let i = 1; i < v.length; i++) {
      if (String(v[i][2] || '').trim().toLowerCase() === targetEmail) {
        row = i + 1;
        break;
      }
    }
  }

  if (row < 2) throw new Error('User account not found in Google Sheet.');

  const emailInSheet = String(sh.getRange(row, 3).getValue() || '').trim().toLowerCase();
  if (emailInSheet === String(me.email || '').trim().toLowerCase()) {
    throw new Error('You cannot delete your own active administrator account.');
  }
  if (isSuperAdminRole_(sh.getRange(row, 5).getValue())) {
    if (!callerIsSuperAdmin_(p.token)) throw new Error('Only the Super Admin can delete a Super Admin account.');
    if (countApprovedSuperAdmins_(v) <= 1) throw new Error('This is the only Super Admin. Make another user Super Admin first.');
  }

  sh.deleteRow(row);
  clearAccessCache_(emailInSheet);
  sbDropSessions_(null, emailInSheet);
  return { success: true, email: emailInSheet };
}

/* ---------- Duplicate Detection & Guard ---------- */
function normalize_(v){return String(v||'').trim().toLowerCase()}
function normalizeOrderId_(v){
  if(v===null||v===undefined)return '';
  let s = String(v).trim().toLowerCase();
  // Strip leading '#' (any number of them), 'no.', 'order#', 'order ', etc.
  s = s.replace(/^(?:order\s*#*|#+|no\.?\s*)/i, '');
  s = s.replace(/^[#\s]+/, '');
  // Stray punctuation from a scanner or a paste (":408-…", "#OD-1,")
  s = s.replace(/^[^a-z0-9#]+/, '').replace(/^#+/, '').replace(/[^a-z0-9]+$/, '');
  // Strip trailing .0 or .00 from numeric cell exports
  s = s.replace(/\.0+$/, '');
  // Remove all whitespace
  return s.replace(/\s+/g, '');
}
/**
 * The one way an order ID is written to any tab.
 * - Every space is removed (leading, trailing and in the middle).
 * - D2C orders always carry exactly one leading '#': "OD-10063", "##OD-10063", " # OD-10063 " -> "#OD-10063".
 *   When the platform is unknown, an "OD-" order is treated as D2C.
 * - Other platforms keep what was typed, except a run of leading '#' becomes one.
 * Keep in step with formatOrderId in src/lib/api.ts.
 */
function canonicalOrderId_(v, platform){
  if(v===null||v===undefined)return '';
  let s = String(v).replace(/[\s\u00a0\u200b\ufeff]+/g, '');
  // Stray punctuation a scanner or paste adds around the ID (":408-3093842-5865165", "#OD-1,")
  s = s.replace(/^[^A-Za-z0-9#]+/, '').replace(/[^A-Za-z0-9]+$/, '');
  if(!s)return '';
  const hadHash = /^#/.test(s);
  const bare = s.replace(/^#+/, '').replace(/^[^A-Za-z0-9]+/, '');
  if(!bare)return '';
  const pf = String(platform||'').trim().toLowerCase();
  if(pf==='d2c' || (!pf && /^od-/i.test(bare))) return '#' + bare.toUpperCase();
  return (hadHash ? '#' : '') + bare;
}
function key_(order,platform,type){return [normalizeOrderId_(order),normalize_(platform),normalize_(type||'Forward')].join('||')}

function driveExists_(id){
  if(!id)return false;
  try{DriveApp.getFileById(String(id));return true}catch(_){return false}
}

/**
 * A log row's date, read safely. Some old rows carry a year 100 too far ahead (for example
 * 15 Oct 2126 for 15 Oct 2026), which put them above every real entry in newest-first lists.
 * A date more than 2 days in the future is moved back by whole centuries until it is not.
 */
// Text dates typed or pasted into the sheet: 24/11/2026 14:02, 24-11-2026, 24-Nov-26 14:02, 24 Nov 2026, 2:02 PM …
// (day first, the Indian order), with odd spaces from copy-paste normalised.
const MONTHS_ = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseSheetDateText_(raw) {
  const t = String(raw || '').replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return new Date(NaN);
  const time = function(rest, d) {
    const m = String(rest || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);
    if (!m) return d;
    let h = Number(m[1]);
    const ap = (m[4] || '').toLowerCase().replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    d.setHours(h, Number(m[2]), Number(m[3] || 0), 0);
    return d;
  };
  const year = function(y) { y = Number(y); return y < 100 ? 2000 + y : y; };
  let m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b,?(.*)$/);
  if (m && Number(m[2]) <= 12) return time(m[4], new Date(year(m[3]), Number(m[2]) - 1, Number(m[1])));
  m = t.match(/^(\d{1,2})[\s\/.-]([A-Za-z]{3})[A-Za-z]*[\s\/.-],?\s*(\d{2,4})\b,?(.*)$/);
  if (m && MONTHS_[m[2].toLowerCase()] !== undefined) return time(m[4], new Date(year(m[3]), MONTHS_[m[2].toLowerCase()], Number(m[1])));
  const d = new Date(t);
  return d;
}

function rowDate_(value) {
  let d = value instanceof Date ? new Date(value.getTime()) : (typeof value === 'number' ? new Date(value) : parseSheetDateText_(value));
  if (isNaN(d.getTime())) return d;
  const limit = Date.now() + 2 * 86400000;
  while (d.getTime() > limit && d.getFullYear() > 2000) {
    const back = new Date(d.getTime());
    back.setFullYear(d.getFullYear() - 100);
    if (back.getTime() <= 0) break;
    d = back;
  }
  return d;
}

/** ISO text of a log row's date (see rowDate_), or the cell's own text when it is not a date. */
function rowIso_(value) {
  const d = rowDate_(value);
  return isNaN(d.getTime()) ? String(value || '') : d.toISOString();
}

// ---------------------------------------------------------------------------
// One date format in the Google Sheet: DD-MMM-YY (time kept after it), e.g. 24-Nov-26 14:02.
// Text timestamps in the log tabs are turned into real dates (and year-2126 slips repaired) so
// the sheet sorts and filters correctly. Runs from setup, from the admin button, and quietly at
// most every 6 hours from normal traffic, so new rows keep the format.
const SHEET_DATE_FORMAT_ = 'dd-mmm-yy hh:mm';
const SHEET_DATE_FORMAT_FLAG_ = 'VMS_DATE_FORMAT_V1';

function applySheetDateFormats_(force) {
  const cache = CacheService.getScriptCache();
  if (!force && cache.get(SHEET_DATE_FORMAT_FLAG_)) return { success: true, skipped: true };
  const ss = ss_();
  const report = {};
  // Every tab the app writes, including the cleanup Archive tabs and GTINCatalog.
  ss.getSheets().forEach(function(sh) {
    const name = sh.getName();
    if (!isDateFormattedSheet_(name)) return;
    if (name === CONFIG.GTIN_CATALOG_SHEET) { try { ensureGtinCatalogHeaders_(sh); } catch (_) {} }
    const last = sh.getLastRow();
    const width = Math.max(sh.getLastColumn(), 1);
    const headers = sh.getRange(1, 1, 1, width).getValues()[0];
    const cols = sheetDateColumns_(name, headers);
    let converted = 0;
    cols.forEach(function(col) {
      if (last >= 2) {
        const range = sh.getRange(2, col, last - 1, 1);
        const vals = range.getValues();
        let changed = false;
        for (let i = 0; i < vals.length; i++) {
          const v = vals[i][0];
          if (v === '' || v === null) continue;
          if (typeof v === 'number') continue; // plain numbers are not dates here
          const d = rowDate_(v);
          if (isNaN(d.getTime())) continue;
          if (!(v instanceof Date) || v.getTime() !== d.getTime()) {
            vals[i][0] = d;
            changed = true;
            converted++;
          }
        }
        if (changed) range.setValues(vals);
      }
      try { sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat(SHEET_DATE_FORMAT_); } catch (e) {}
    });
    report[name] = converted;
  });
  try { cache.put(SHEET_DATE_FORMAT_FLAG_, '1', 3600); } catch (_) {}
  return { success: true, converted: report, format: 'DD-MMM-YY hh:mm', message: 'Sheet dates set to DD-MMM-YY in ' + Object.keys(report).length + ' tabs.' };
}

const DATE_FORMATTED_SHEETS_ = function() {
  return [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET, CONFIG.UPLOAD_LOG_SHEET, CONFIG.DOWNLOAD_LOG_SHEET,
    CONFIG.SECURITY_LOG_SHEET, CONFIG.TRASH_LOG_SHEET, CONFIG.PACK_VERIFICATION_LOG_SHEET, CONFIG.USERS_SHEET,
    CONFIG.ORDER_MANIFEST_SHEET, CONFIG.GTIN_CATALOG_SHEET, CONFIG.BRANDING_SHEET, CONFIG.PACKAGE_DETAILS_SHEET,
    CONFIG.SHOPIFY_ORDERS_SHEET, CONFIG.RETURN_DETAILS_SHEET];
};
function isDateFormattedSheet_(name) {
  return DATE_FORMATTED_SHEETS_().indexOf(name) !== -1 || / Archive$/.test(String(name || ''));
}

/** 1-based columns that hold dates: column A of every log tab plus any column headed like a time. */
function sheetDateColumns_(name, headers) {
  const cols = [];
  const h = (headers || []).map(function(x) { return String(x || '').trim().toLowerCase(); });
  if (name !== CONFIG.BRANDING_SHEET) cols.push(1);
  h.forEach(function(x, i) {
    if (i === 0) return;
    if (/^(timestamp|archived at|packed at|last updated|created|created at|updated at|date)$/.test(x)) cols.push(i + 1);
  });
  return cols;
}

/** appendRow, then show any date in the new row as DD-MMM-YY hh:mm (new rows don't inherit the column format). */
function logAppend_(sh, row) {
  sh.appendRow(row);
  try { sbTouch_(sh, sh.getLastRow()); } catch (_) {}
  try {
    const r = sh.getLastRow();
    for (let i = 0; i < row.length; i++) {
      if (row[i] instanceof Date) sh.getRange(r, i + 1).setNumberFormat(SHEET_DATE_FORMAT_);
    }
  } catch (_) {}
}

/** Format the date columns of rows just written with setValues. */
function formatDateRows_(sh, startRow, count) {
  if (!count) return;
  try {
    const width = Math.max(sh.getLastColumn(), 1);
    const headers = sh.getRange(1, 1, 1, width).getValues()[0];
    sheetDateColumns_(sh.getName(), headers).forEach(function(col) {
      sh.getRange(startRow, col, count, 1).setNumberFormat(SHEET_DATE_FORMAT_);
    });
  } catch (_) {}
}

const GTIN_CATALOG_HEADERS_ = ['Timestamp','GTIN','SKU','Product Name','Short Name','Category','Image URL','Default Quantity','Notes','Tag'];
/** Put the GTINCatalog header row back when it is blank (row 1 must never hold a product). */
function ensureGtinCatalogHeaders_(sh) {
  const row = sh.getRange(1, 1, 1, 10).getValues()[0];
  const blank = row.slice(0, 9).every(function(x) { return String(x || '').trim() === ''; });
  if (blank) sh.getRange(1, 1, 1, 10).setValues([GTIN_CATALOG_HEADERS_]);
  return blank;
}

/**
 * Rows of one order in a log tab, newest (bottom) first, as { i, v } where v[i] is the row, so
 * callers keep the v[i][col] shape. Only the Order ID column is read for the search, then just the
 * matching rows: a scan per order stays fast when the tab has tens of thousands of rows (before,
 * every check read every column of OrderLog, ReturnLog and UploadLog).
 */
function orderRowsDesc_(sh, normTarget, width) {
  const out = [];
  const last = sh.getLastRow();
  if (!normTarget || last < 2) return out;
  const ids = sh.getRange(2, 2, last - 1, 1).getValues();
  for (let k = ids.length - 1; k >= 0; k--) {
    if (normalizeOrderId_(ids[k][0]) !== normTarget) continue;
    const v = [];
    v[k + 1] = sh.getRange(k + 2, 1, 1, width).getValues()[0];
    out.push({ i: k + 1, v: v });
    if (out.length >= 20) break; // an order never has more rows than this that matter
  }
  return out;
}

function completedDuplicate_(order,platform,type){
  const normTargetOrder = normalizeOrderId_(order);
  if (!normTargetOrder) return null;

  const targetType = normalize_(type || 'Forward'); // 'forward' or 'return'

  // 1. If targetType is 'forward' or 'all': check ORDER_LOG_SHEET
  if (targetType === 'forward' || targetType === 'all') {
    try {
      const orderSheet = sheet_(CONFIG.ORDER_LOG_SHEET);
      if (orderSheet) {
        const hits = orderRowsDesc_(orderSheet, normTargetOrder, 12);
        for (let h = 0; h < hits.length; h++) {
          const i = hits[h].i, v = hits[h].v;
          const rawOrder = v[i][1];
          const normRowOrder = normalizeOrderId_(rawOrder);
          if (!normRowOrder || normRowOrder !== normTargetOrder) continue;

          const rawType = v[i][8] || 'Forward';
          const normRowType = normalize_(rawType);
          if (targetType !== 'all' && normRowType !== targetType) continue;

          const fileId = String(v[i][4] || '').trim();

          // Only count as duplicate if it has a valid Google Drive file ID
          if (fileId.length > 5 && fileId !== 'undefined' && fileId !== 'null') {
            return {
              sourceSheet: CONFIG.ORDER_LOG_SHEET,
              row: i + 1,
              orderId: String(rawOrder || ''),
              platform: String(v[i][2] || ''),
              recordingType: 'Forward',
              timestamp: rowIso_(v[i][0]),
              packerEmail: String(v[i][3] || ''),
              fileId: fileId,
              queueJobId: String(v[i][9] || ''),
              playbackUrl: String(v[i][5] || (fileId ? 'https://drive.google.com/file/d/' + fileId + '/preview' : ''))
            };
          }
        }
      }
    } catch (e) {
      console.warn('OrderLog duplicate check note:', e);
    }
  }

  // 2. If targetType is 'return' or 'inbound' or 'all': check RETURN_LOG_SHEET
  if (targetType === 'return' || targetType === 'inbound' || targetType === 'all') {
    try {
      const returnSheet = sheet_(CONFIG.RETURN_LOG_SHEET);
      if (returnSheet) {
        const hits = orderRowsDesc_(returnSheet, normTargetOrder, 12);
        for (let h = 0; h < hits.length; h++) {
          const i = hits[h].i, r = hits[h].v;
          const rawOrder = r[i][1];
          const normRowOrder = normalizeOrderId_(rawOrder);
          if (!normRowOrder || normRowOrder !== normTargetOrder) continue;

          const rawType = r[i][8] || 'Return';
          const normRowType = normalize_(rawType);
          if (targetType !== 'all' && normRowType !== targetType) continue;

          const fileId = String(r[i][4] || '').trim();

          // Only count as duplicate if it has a valid Google Drive file ID
          if (fileId.length > 5 && fileId !== 'undefined' && fileId !== 'null') {
            return {
              sourceSheet: CONFIG.RETURN_LOG_SHEET,
              row: i + 1,
              orderId: String(rawOrder || ''),
              platform: String(r[i][2] || ''),
              recordingType: 'Return',
              timestamp: rowIso_(r[i][0]),
              packerEmail: String(r[i][3] || ''),
              fileId: fileId,
              queueJobId: String(r[i][9] || ''),
              playbackUrl: String(r[i][5] || (fileId ? 'https://drive.google.com/file/d/' + fileId + '/preview' : ''))
            };
          }
        }
      }
    } catch (e) {
      console.warn('ReturnLog duplicate check note:', e);
    }
  }

  // 3. Check UPLOAD_LOG_SHEET next (ONLY completed uploads with matching recording type and valid fileId)
  try {
    const uploadSheet = sheet_(CONFIG.UPLOAD_LOG_SHEET);
    if (uploadSheet) {
      const hits = orderRowsDesc_(uploadSheet, normTargetOrder, 15);
      for (let h = 0; h < hits.length; h++) {
        const i = hits[h].i, u = hits[h].v;
        const rawOrder = u[i][1];
        const normRowOrder = normalizeOrderId_(rawOrder);
        if (!normRowOrder || normRowOrder !== normTargetOrder) continue;

        const rawType = u[i][12] || 'Forward';
        const normRowType = normalize_(rawType);
        if (targetType !== 'all' && normRowType !== targetType) continue;

        const rawStatus = normalize_(u[i][10] || '');
        const rawStage = normalize_(u[i][7] || '');
        const fileId = String(u[i][9] || '').trim();

        // IMPORTANT: NEVER treat 'in progress' or 'started' as a duplicate - only truly completed uploads with valid fileId
        if ((rawStatus === 'completed' || rawStage === 'completed' || fileId.length > 5) && fileId.length > 5 && fileId !== 'undefined' && fileId !== 'null') {
          return {
            sourceSheet: CONFIG.UPLOAD_LOG_SHEET,
            row: i + 1,
            orderId: String(rawOrder || ''),
            platform: String(u[i][2] || ''),
            recordingType: rawType || (targetType === 'return' ? 'Return' : 'Forward'),
            timestamp: rowIso_(u[i][0]),
            packerEmail: String(u[i][3] || ''),
            fileId: fileId,
            queueJobId: String(u[i][14] || ''),
            playbackUrl: fileId ? 'https://drive.google.com/file/d/' + fileId + '/preview' : ''
          };
        }
      }
    }
  } catch (e) {
    console.warn('UploadLog duplicate check note:', e);
  }

  return null;
}

function checkDuplicateOrder_(p){
  const order = canonicalOrderId_(p.orderId, p.platform);
  const platform = String(p.platform || '').trim();
  const type = String(p.recordingType || 'Forward').trim();
  if (!order) return { success: true, isDuplicate: false };

  // 1. Check completed Google Drive / Sheet recordings
  const dup = completedDuplicate_(order, platform, type);
  if (dup) {
    return {
      success: true,
      isDuplicate: true,
      existing: dup,
      message: `Order ${order} has an existing ${type} recording in Google Drive.`
    };
  }

  // 2. Check active in-progress uploads/reservations (prevents collision between 2 packers)
  const k = reservationKey_(order, platform, type);
  const activeRes = activeReservation_(k);
  if (activeRes) {
    return {
      success: true,
      isDuplicate: true,
      isInProgress: true,
      existing: {
        orderId: order,
        platform: platform,
        recordingType: type,
        packerEmail: activeRes.email,
        timestamp: new Date(activeRes.time).toISOString(),
        status: 'In Progress (Active Upload)'
      },
      message: `Order ${order} is currently being packed/uploaded by ${activeRes.email}.`
    };
  }

  return { success: true, isDuplicate: false };
}

/**
 * Robust concurrency lock helper with retry backoff.
 * Ensures exclusive execution to prevent duplicate row creation and sheet contention.
 */
function withScriptLock_(fn, timeoutMs) {
  const lock = LockService.getScriptLock();
  const waitMs = timeoutMs || 15000;
  let hasLock = false;
  try {
    hasLock = lock.tryLock(waitMs);
  } catch(e) {
    console.warn('Script lock acquisition note:', e);
  }
  if (!hasLock) {
    Utilities.sleep(400);
    try {
      hasLock = lock.tryLock(8000);
    } catch(e) {}
  }
  if (!hasLock) {
    throw new Error('Server busy: another packer operation is currently updating Google Sheets. Please retry in a moment.');
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch(_) {}
  }
}

/**
 * Safely parse a timestamp from Google Sheet whether Date, ISO, or DD/MM/YYYY HH:mm:ss
 */
function parseSheetTimestamp_(raw) {
  if (!raw) return 0;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return isNaN(t) ? 0 : t;
  }
  const str = String(raw).trim();
  if (!str) return 0;

  // Try standard JS Date parsing first
  const t = new Date(str).getTime();
  if (!isNaN(t) && t > 0) return t;

  // Try DD/MM/YYYY HH:mm:ss or DD-MM-YYYY HH:mm:ss
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = parseInt(m[3], 10);
    const hour = parseInt(m[4] || '0', 10);
    const min = parseInt(m[5] || '0', 10);
    const sec = parseInt(m[6] || '0', 10);
    const parsed = new Date(year, month, day, hour, min, sec).getTime();
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

/**
 * Clean up all orphaned/stuck 'In Progress' sessions in Google Sheet and script properties
 */
function cleanupStuckUploads_(p){
  const user = session_(p.token);
  return withScriptLock_(function() {
    let cleanedRows = 0;
    let clearedProps = 0;
    const purgeInterrupted = p.purgeInterrupted === true || String(p.purgeInterrupted) === 'true' || p.purgeStale === true || String(p.purgeStale) === 'true';

    const uploadSh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
    const data = uploadSh.getDataRange().getValues();
    const now = Date.now();

    // Cache completed orders from OrderLog and ReturnLog to prevent marking completed orders as stale
    const completedOrdersMap = {};
    try {
      [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET].forEach(function(sName) {
        const sh = sheet_(sName);
        if (sh) {
          const sVals = sh.getDataRange().getValues();
          for (let r = 1; r < sVals.length; r++) {
            const o = normalizeOrderId_(sVals[r][1]);
            const f = String(sVals[r][4] || '').trim();
            if (o && f) completedOrdersMap[o] = f;
          }
        }
      });
    } catch (_) {}

    const targetUploadId = p.uploadId ? String(p.uploadId).trim() : '';
    const targetOrderId = p.orderId ? normalizeOrderId_(p.orderId) : '';

    for (let i = data.length - 1; i >= 1; i--) {
      const rawStatus = normalize_(data[i][10] || '');
      let fileId = String(data[i][9] || '').trim();
      const rowStage = normalize_(data[i][7] || '');
      const rowOrder = normalizeOrderId_(data[i][1]);
      const rowUploadId = String(data[i][6] || '').trim();
      const rowTime = parseSheetTimestamp_(data[i][0]);

      // If this order is already recorded as completed in OrderLog / ReturnLog, attach the fileId
      if (!fileId && rowOrder && completedOrdersMap[rowOrder]) {
        fileId = completedOrdersMap[rowOrder];
        uploadSh.getRange(i + 1, 10).setValue(fileId);
        uploadSh.getRange(i + 1, 11).setValue('Completed');
        uploadSh.getRange(i + 1, 8).setValue('Uploaded to Google Drive');
        continue;
      }

      // Abandoned in-progress sessions older than 20 minutes without a Drive File ID and not in completed map
      const isAbandonedInProgress = (
        rawStatus === 'in progress' ||
        rawStatus === 'started' ||
        rawStatus === 'initiated' ||
        rawStatus === 'uploading' ||
        rawStatus === 'session created' ||
        rowStage === 'session created' ||
        rowStage.indexOf('session created') !== -1
      ) && !fileId && !completedOrdersMap[rowOrder] && (rowTime > 0 && (now - rowTime > 20 * 60 * 1000));

      const isFailedOrInterrupted = (
        rawStatus === 'failed' ||
        rawStatus === 'interrupted / stale' ||
        rawStatus === 'stale' ||
        rawStatus === 'error' ||
        rawStatus.indexOf('fail') !== -1 ||
        rawStatus.indexOf('interrupt') !== -1 ||
        rawStatus.indexOf('stale') !== -1 ||
        rawStatus.indexOf('expired') !== -1
      ) && !fileId && !completedOrdersMap[rowOrder];

      const isExplicitTarget = Boolean(
        (targetUploadId && rowUploadId === targetUploadId) ||
        (targetOrderId && rowOrder === targetOrderId && !fileId)
      );

      if (purgeInterrupted || isExplicitTarget) {
        if (isFailedOrInterrupted || isAbandonedInProgress || isExplicitTarget) {
          uploadSh.deleteRow(i + 1);
          cleanedRows++;
        }
      } else {
        if (isAbandonedInProgress) {
          uploadSh.getRange(i + 1, 11).setValue('Interrupted / Stale');
          uploadSh.getRange(i + 1, 8).setValue('Upload session timed out or reset');
          cleanedRows++;
        }
      }
    }

    // Clean up expired PropertiesService UPLOAD_* and DUPRES_* keys (older than 30 minutes)
    const props = PropertiesService.getScriptProperties();
    const allProps = props.getProperties();
    for (const k in allProps) {
      if (k.startsWith('UPLOAD_')) {
        let isStaleProp = true;
        try {
          const sObj = JSON.parse(allProps[k]);
          const cTime = Number(sObj.createdAt || 0);
          if (cTime && (now - cTime < 30 * 60 * 1000)) {
            isStaleProp = false; // keep active upload sessions under 30 minutes!
          }
        } catch(_) {}
        if (isStaleProp || purgeInterrupted) {
          props.deleteProperty(k);
          clearedProps++;
        }
      } else if (k.startsWith('DUPRES_')) {
        let isStaleRes = true;
        try {
          const rObj = JSON.parse(allProps[k]);
          const rTime = Number(rObj.time || 0);
          if (rTime && (now - rTime < CONFIG.RESERVATION_SECONDS * 1000)) {
            isStaleRes = false;
          }
        } catch(_) {}
        if (isStaleRes || purgeInterrupted) {
          props.deleteProperty(k);
          clearedProps++;
        }
      }
    }

    return {
      success: true,
      cleanedRows: cleanedRows,
      clearedProperties: clearedProps,
      purged: purgeInterrupted,
      message: purgeInterrupted
        ? `Successfully purged ${cleanedRows} interrupted/failed upload row(s) and cleared stale session locks.`
        : `Successfully resolved ${cleanedRows} stuck upload row(s) and cleared stale session locks.`
    };
  }, 10000);
}

function reservationKey_(order,platform,type){return 'DUPRES_'+Utilities.base64EncodeWebSafe(key_(order,platform,type)).replace(/=+$/,'')}

function activeReservation_(k){
  const raw=PropertiesService.getScriptProperties().getProperty(k);if(!raw)return null;
  try{
    const o=JSON.parse(raw);
    // Active reservations expire after 1 hour (3600s) if abandoned
    const maxAgeMs = Math.min(3600 * 1000, Number(CONFIG.RESERVATION_SECONDS || 3600) * 1000);
    if(Date.now() - Number(o.time || 0) > maxAgeMs){
      PropertiesService.getScriptProperties().deleteProperty(k);
      return null;
    }
    return o;
  }catch(_){
    PropertiesService.getScriptProperties().deleteProperty(k);
    return null;
  }
}

function reserve_(order,platform,type,user,currentUploadId,queueJobId){
  const props=PropertiesService.getScriptProperties(), k=reservationKey_(order,platform,type), existing=activeReservation_(k);
  const job = String(queueJobId || '');
  if(existing) {
    if (currentUploadId && existing.uploadId && existing.uploadId === currentUploadId) {
      return {allowed:true, key:k, existing:existing};
    }
    // The same station retrying the SAME video (same queue job) may take over its own reservation.
    // A different video of the same order is a duplicate, even from the same packer: before, any
    // second recording by the same packer within 10 minutes was let through.
    const sameJob = job ? existing.queueJobId === job : !existing.queueJobId;
    if (existing.email && existing.email === user.email && sameJob && (Date.now() - Number(existing.time || 0) < 600000)) {
      props.setProperty(k, JSON.stringify({time:Date.now(), email:user.email, uploadId:currentUploadId||'', queueJobId: job}));
      return {allowed:true, key:k, existing:existing};
    }
    return {allowed:false, existing:existing, key:k};
  }
  props.setProperty(k,JSON.stringify({time:Date.now(),email:user.email,uploadId:currentUploadId||'',queueJobId: job}));
  return {allowed:true,key:k};
}

/**
 * The OrderLog / ReturnLog row already written for this queue job (one recorded video), or null.
 * Makes every upload of one video idempotent: retries, recoveries and parallel attempts all end on
 * the same row and the same Drive file.
 */
function findLoggedJob_(queueJobId) {
  const job = String(queueJobId || '').trim();
  if (!job) return null;
  const names = [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET];
  for (let n = 0; n < names.length; n++) {
    const sh = sheet_(names[n]);
    if (!sh) continue;
    const v = sh.getDataRange().getValues();
    for (let i = v.length - 1; i >= 1; i--) {
      if (String(v[i][9] || '').trim() !== job) continue;
      const fid = String(v[i][4] || '').trim();
      return {
        sourceSheet: names[n], row: i + 1, orderId: String(v[i][1] || ''), platform: String(v[i][2] || ''),
        recordingType: String(v[i][8] || ''), packerEmail: String(v[i][3] || ''), fileId: fid,
        timestamp: rowIso_(v[i][0]),
        playbackUrl: String(v[i][5] || (fid ? 'https://drive.google.com/file/d/' + fid + '/preview' : '')),
        webViewLink: String(v[i][5] || (fid ? 'https://drive.google.com/file/d/' + fid + '/preview' : ''))
      };
    }
  }
  return null;
}

function releaseReservation_(k){if(k)PropertiesService.getScriptProperties().deleteProperty(k)}
function setReservationUpload_(k,id){if(!k)return;const p=PropertiesService.getScriptProperties(),raw=p.getProperty(k);if(!raw)return;const o=JSON.parse(raw);o.uploadId=id;p.setProperty(k,JSON.stringify(o))}

function cleanAlphanumeric_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ---------- Search ---------- */
function advancedSearch_(p){
  const user=session_(p.token), isAdmin=isAdminRole_(user.role), email=normalize_(user.email);
  const rawOrder = String(p.orderId || '').trim();
  const order = normalizeOrderId_(rawOrder);
  const cleanOrder = cleanAlphanumeric_(rawOrder);
  const platform = normalize_(p.platform);
  const type = normalize_(p.recordingType);
  const status = normalize_(p.status);
  const packer = normalize_(p.packer);
  const video = normalize_(p.video);
  const rawFrom = p.fromDate || p.from;
  const rawTo = p.toDate || p.to;
  const from = rawFrom ? (String(rawFrom).includes('T') ? new Date(rawFrom) : new Date(String(rawFrom) + 'T00:00:00')) : null;
  const to = rawTo ? (String(rawTo).includes('T') ? new Date(rawTo) : new Date(String(rawTo) + 'T23:59:59')) : null;

  // If specific order search is active, do not cap at 100 - scan all rows
  const hasSpecificSearch = !!(rawOrder || packer || from || to);
  const limit = hasSpecificSearch ? Math.min(10000, Math.max(1, Number(p.limit||5000))) : Math.min(1000, Math.max(1, Number(p.limit||100)));
  const rows = [];
  const seenFids = {};
  const seenJobIds = {};

  const sheetsToScan = [
    { name: CONFIG.ORDER_LOG_SHEET, defaultType: 'Forward' },
    { name: CONFIG.RETURN_LOG_SHEET, defaultType: 'Return' }
  ];

  // 1. Scan OrderLog and ReturnLog Sheets (Completed Video Records)
  sheetsToScan.forEach(target => {
    try {
      const sh = ss_().getSheetByName(target.name);
      if (!sh) return;
      const v = sh.getDataRange().getValues();
      for (let i = v.length - 1; i >= 1; i--) {
        const ts = rowDate_(v[i][0]);
        const oid = String(v[i][1] || '').trim();
        const normOid = normalizeOrderId_(oid);
        const cleanOid = cleanAlphanumeric_(oid);
        const pf = String(v[i][2] || '').trim();
        const pe = String(v[i][3] || '').trim();
        const fid = String(v[i][4] || '').trim();
        const pUrl = String(v[i][5] || '').trim();
        const st = String(v[i][7] || 'Completed').trim();
        const rt = String(v[i][8] || target.defaultType).trim();
        const jid = String(v[i][9] || '').trim();

        // Must have at least an Order ID or Drive File ID
        if (!oid && !fid) continue;

        if (!isAdmin && normalize_(pe) !== email) continue;

        if (rawOrder) {
          const isOrderMatch = normOid.includes(order) || 
                               normalize_(oid).includes(normalize_(rawOrder)) || 
                               (cleanOrder.length > 2 && cleanOid.includes(cleanOrder)) ||
                               (cleanOid.length > 2 && cleanOrder.includes(cleanOid));
          if (!isOrderMatch) continue;
        }

        if (platform && platform !== 'all' && platform !== 'custom' && normalize_(pf) !== platform) continue;
        if (platform === 'custom' && CONFIG.ALLOWED_PLATFORMS.map(normalize_).includes(normalize_(pf))) continue;
        if (type && type !== 'all' && normalize_(rt) !== type) continue;
        if (status && status !== 'all' && normalize_(st) !== status) continue;
        if (packer && !(normalize_(pe).includes(packer) || normalize_(String(v[i][3]||'')).includes(packer))) continue;
        if (from && ts < from) continue;
        if (to && ts > to) continue;

        if (fid) seenFids[fid] = true;
        if (jid) seenJobIds[jid] = true;

        const fSizeVal = String(v[i][6] || '').trim();
        rows.push({
          timestamp: ts instanceof Date && !isNaN(ts.getTime()) ? ts.toISOString() : String(v[i][0]||''),
          orderId: oid,
          platform: pf,
          packerEmail: pe,
          fileId: fid,
          fileName: oid + '_' + pf + '_' + rt + '.mp4',
          fileSize: (!fSizeVal || fSizeVal === '0' || fSizeVal === '0 B' || fSizeVal === '0 MB') ? '—' : fSizeVal,
          playbackUrl: pUrl || (fid ? 'https://drive.google.com/file/d/' + fid + '/preview' : ''),
          downloadUrl: fid ? 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fid) : '',
          driveLink: pUrl || (fid ? 'https://drive.google.com/file/d/' + fid + '/view' : ''),
          status: st || 'Completed',
          recordingType: rt,
          sheet: target.name,
          queueJobId: jid
        });

        if (rows.length >= limit) break;
      }
    } catch (e) {
      console.warn(target.name + ' search note:', e);
    }
  });

  // 2. Scan UploadLog Sheet: Only include entries that have a real Drive File ID uploaded
  try {
    if (rows.length < limit) {
      const u = sheet_(CONFIG.UPLOAD_LOG_SHEET).getDataRange().getValues();
      for (let i = u.length - 1; i >= 1; i--) {
        const ts = rowDate_(u[i][0]);
        const oid = String(u[i][1] || '').trim();
        const normOid = normalizeOrderId_(oid);
        const cleanOid = cleanAlphanumeric_(oid);
        const pf = String(u[i][2] || '').trim();
        const pe = String(u[i][3] || '').trim();
        const fn = String(u[i][4] || '').trim();
        const fsz = String(u[i][5] || '').trim();
        const upId = String(u[i][6] || '').trim();
        const fid = String(u[i][9] || '').trim();
        const st = String(u[i][10] || '').trim();
        const rt = String(u[i][12] || 'Forward').trim();
        const jid = String(u[i][14] || '').trim();

        // CRITICAL FIX: If no file ID exists (file was never actually uploaded or session abandoned),
        // do not present it as a completed video record in Search Packing Videos
        if (!fid || fid.length < 5) continue;
        if (seenFids[fid]) continue; // already recorded from OrderLog
        if (jid && seenJobIds[jid]) continue;

        if (!isAdmin && normalize_(pe) !== email) continue;

        if (rawOrder) {
          const isOrderMatch = normOid.includes(order) || 
                               normalize_(oid).includes(normalize_(rawOrder)) || 
                               normalize_(fn).includes(normalize_(rawOrder)) ||
                               (cleanOrder.length > 2 && cleanOid.includes(cleanOrder)) ||
                               (cleanOrder.length > 2 && cleanAlphanumeric_(fn).includes(cleanOrder));
          if (!isOrderMatch) continue;
        }

        if (platform && platform !== 'all' && normalize_(pf) !== platform) continue;
        if (type && type !== 'all' && normalize_(rt) !== type) continue;
        if (packer && !normalize_(pe).includes(packer)) continue;
        if (from && ts < from) continue;
        if (to && ts > to) continue;

        seenFids[fid] = true;
        if (jid) seenJobIds[jid] = true;

        rows.push({
          timestamp: ts instanceof Date && !isNaN(ts.getTime()) ? ts.toISOString() : String(u[i][0]||''),
          orderId: oid,
          platform: pf,
          packerEmail: pe,
          fileId: fid,
          fileName: fn || (oid + '_' + pf + '_' + rt + '.mp4'),
          fileSize: fsz,
          uploadId: upId,
          playbackUrl: 'https://drive.google.com/file/d/' + fid + '/preview',
          downloadUrl: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fid),
          driveLink: 'https://drive.google.com/file/d/' + fid + '/view',
          status: st || 'Completed',
          recordingType: rt,
          sheet: CONFIG.UPLOAD_LOG_SHEET,
          queueJobId: jid
        });

        if (rows.length >= limit) break;
      }
    }
  } catch (e) {
    console.warn('UploadLog search note:', e);
  }

  // 3. Fallback: If searching for a specific order and 0 rows found in sheets, search Google Drive files directly
  const sourceFilter = normalize_(p.sourceFilter || 'all');
  if (rawOrder && rows.length === 0 && sourceFilter !== 'sheets') {
    try {
      const sanitized = rawOrder.replace(/['\\]/g, '');
      const query = "title contains '" + sanitized + "' and trashed = false";
      const files = DriveApp.searchFiles(query);
      let driveFound = 0;
      while (files.hasNext() && driveFound < 10) {
        const file = files.next();
        const fName = file.getName();
        const fid = file.getId();
        if (seenFids[fid]) continue;

        // Parse orderId, platform, type from fileName (e.g. 405-1167824-670856_Amazon_Return.mp4)
        const parts = fName.replace(/\.[^/.]+$/, '').split('_');
        const parsedOrder = parts[0] || rawOrder;
        const parsedPf = parts[1] || 'Amazon';
        const parsedType = parts[2] || (fName.toLowerCase().includes('return') ? 'Return' : 'Forward');

        if (type && type !== 'all' && normalize_(parsedType) !== type) continue;
        if (platform && platform !== 'all' && platform !== 'custom' && normalize_(parsedPf) !== platform) continue;

        rows.push({
          timestamp: file.getDateCreated() ? file.getDateCreated().toISOString() : new Date().toISOString(),
          orderId: parsedOrder,
          platform: parsedPf,
          packerEmail: user.email || 'packer@vms.local',
          fileId: fid,
          fileName: fName,
          fileSize: String(file.getSize() || ''),
          playbackUrl: 'https://drive.google.com/file/d/' + fid + '/preview',
          downloadUrl: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fid),
          driveLink: 'https://drive.google.com/file/d/' + fid + '/view',
          status: 'Completed',
          recordingType: parsedType,
          sheet: 'Google Drive (Direct)'
        });
        driveFound++;
      }
    } catch(dSearchErr) {
      console.warn('Direct Drive search fallback note:', dSearchErr);
    }
  }

  if(p.sort==='oldest')rows.sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
  else if(p.sort==='orderAsc')rows.sort((a,b)=>a.orderId.localeCompare(b.orderId,undefined,{numeric:true}));
  else if(p.sort==='orderDesc')rows.sort((a,b)=>b.orderId.localeCompare(a.orderId,undefined,{numeric:true}));
  else rows.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)); // Newest first default

  return {success:true,total:rows.length,results:rows};
}

/* ---------- Drive Folder Hierarchy Helpers ---------- */
function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) {
    return it.next();
  }
  return parent.createFolder(name);
}

/**
 * Resolves the destination folder using the Monthly Hierarchy:
 * Root / <Platform> / <Type> / <MMM-YYYY> / <YYYY-MM-DD>
 * Example: VMS_Packing_Videos / Amazon / Forward / Aug-2026 / 2026-08-21 /
 */
function dateFolder_(platform, type, customDriveFolderId, targetDateStr) {
  // Strict: if the configured video folder can't be opened, fail the upload (it stays queued on the
  // station) instead of silently filing videos somewhere else.
  const root = parentFolder_(customDriveFolderId, true);
  const pf = getOrCreateFolder_(root, platform || 'Custom');
  const tf = getOrCreateFolder_(pf, type || 'Forward');
  let dateName = targetDateStr ? String(targetDateStr).trim() : '';
  let dateObj = new Date();
  if (dateName && /^\d{4}-\d{2}-\d{2}$/.test(dateName)) {
    const parts = dateName.split('-');
    dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
  } else {
    dateName = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const monthName = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'MMM-yyyy'); // e.g. "Aug-2026"
  const mf = getOrCreateFolder_(tf, monthName);
  return getOrCreateFolder_(mf, dateName);
}

/**
 * Migrates existing flat Drive structure:
 * From: Root / <Platform> / <Type> / <YYYY-MM-DD>
 * To:   Root / <Platform> / <Type> / <MMM-YYYY> / <YYYY-MM-DD>  (e.g. Aug-2026/2026-08-21)
 *
 * Also checks prior 'YYYY-MM' folders (e.g. '2026-08') and merges them into 'MMM-YYYY' (e.g. 'Aug-2026'),
 * files any loose videos inside <Platform> / <Type> into their respective month/date folder,
 * and verifies/repairs all Google Sheet links in OrderLog and ReturnLog.
 */
function migrateDriveFoldersToMonthly_(customFolderId) {
  const root = parentFolder_(customFolderId);
  let movedDateFolders = 0;
  let mergedDateFolders = 0;
  let movedFiles = 0;
  const logs = [];

  const platformFolders = root.getFolders();
  while (platformFolders.hasNext()) {
    const pf = platformFolders.next();
    const pfName = pf.getName();

    // Skip branding folder or system assets folder
    if (pfName === (CONFIG.BRANDING_FOLDER_NAME || 'VMS_Branding')) continue;

    const typeFolders = pf.getFolders();
    while (typeFolders.hasNext()) {
      const tf = typeFolders.next();
      const tfName = tf.getName(); // 'Forward', 'Return', or custom

      // 1. Inspect all child folders under Platform/Type
      const childFolders = tf.getFolders();
      const foldersToProcess = [];
      while (childFolders.hasNext()) {
        foldersToProcess.push(childFolders.next());
      }

      foldersToProcess.forEach(function(childFolder) {
        const folderName = childFolder.getName().trim();

        // Case A: Prior YYYY-MM numeric month folder (e.g. '2026-08') -> merge into 'Aug-2026'
        if (/^\d{4}-\d{2}$/.test(folderName)) {
          const parts = folderName.split('-');
          const dObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1, 12, 0, 0);
          const targetMmm = Utilities.formatDate(dObj, Session.getScriptTimeZone(), 'MMM-yyyy');
          if (folderName !== targetMmm) {
            const destMmmFolder = getOrCreateFolder_(tf, targetMmm);
            // Move/merge sub-date folders from YYYY-MM into MMM-yyyy
            const innerFolders = childFolder.getFolders();
            while (innerFolders.hasNext()) {
              const subF = innerFolders.next();
              const subName = subF.getName();
              const existingSub = destMmmFolder.getFoldersByName(subName);
              if (existingSub.hasNext()) {
                const existingDest = existingSub.next();
                const subFiles = subF.getFiles();
                while (subFiles.hasNext()) {
                  const f = subFiles.next();
                  existingDest.addFile(f);
                  subF.removeFile(f);
                  movedFiles++;
                }
                try { subF.setTrashed(true); } catch(_) {}
              } else {
                destMmmFolder.addFolder(subF);
                childFolder.removeFolder(subF);
                movedDateFolders++;
              }
            }
            // Move any direct files
            const innerFiles = childFolder.getFiles();
            while (innerFiles.hasNext()) {
              const file = innerFiles.next();
              destMmmFolder.addFile(file);
              childFolder.removeFile(file);
              movedFiles++;
            }
            try { childFolder.setTrashed(true); } catch(_) {}
            logs.push(`Re-indexed month folder ${pfName}/${tfName}/${folderName} -> ${targetMmm}`);
          }
          return;
        }

        // Case B: Unmigrated daily date folder 'YYYY-MM-DD' (e.g. 2026-08-21)
        if (/^\d{4}-\d{2}-\d{2}$/.test(folderName)) {
          const parts = folderName.split('-');
          const dObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
          const monthName = Utilities.formatDate(dObj, Session.getScriptTimeZone(), 'MMM-yyyy'); // e.g. 'Aug-2026'
          const monthFolder = getOrCreateFolder_(tf, monthName);

          // Check if monthFolder already has a date folder with this name
          const existingInMonth = monthFolder.getFoldersByName(folderName);
          if (existingInMonth.hasNext()) {
            // Merge files from outer date folder into inner date folder
            const destDateFolder = existingInMonth.next();
            const files = childFolder.getFiles();
            while (files.hasNext()) {
              const file = files.next();
              destDateFolder.addFile(file);
              childFolder.removeFile(file);
              movedFiles++;
            }
            // Remove/trash empty outer folder
            try { childFolder.setTrashed(true); } catch(_) {}
            mergedDateFolders++;
            logs.push(`Merged ${pfName}/${tfName}/${folderName} -> ${monthName}/${folderName}`);
          } else {
            // Move entire date folder into monthFolder
            try {
              monthFolder.addFolder(childFolder);
              tf.removeFolder(childFolder);
              movedDateFolders++;
              logs.push(`Moved folder ${pfName}/${tfName}/${folderName} into ${monthName}/`);
            } catch (moveErr) {
              // Fallback: create subfolder and transfer files
              const newSub = monthFolder.createFolder(folderName);
              const files = childFolder.getFiles();
              while (files.hasNext()) {
                const f = files.next();
                newSub.addFile(f);
                childFolder.removeFile(f);
                movedFiles++;
              }
              try { childFolder.setTrashed(true); } catch(_) {}
              movedDateFolders++;
              logs.push(`Transferred folder ${pfName}/${tfName}/${folderName} into ${monthName}/`);
            }
          }
        }
      });

      // 2. Check any unfiled video files directly inside Platform/Type
      const directFiles = tf.getFiles();
      const filesToMove = [];
      while (directFiles.hasNext()) {
        filesToMove.push(directFiles.next());
      }

      filesToMove.forEach(function(file) {
        const fileName = file.getName();
        if (fileName.endsWith('.mp4') || fileName.endsWith('.webm')) {
          const fileDate = file.getDateCreated ? file.getDateCreated() : file.getLastUpdated();
          const dateStr = Utilities.formatDate(fileDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
          const monthStr = Utilities.formatDate(fileDate, Session.getScriptTimeZone(), 'MMM-yyyy');
          const monthFolder = getOrCreateFolder_(tf, monthStr);
          const dateFolder = getOrCreateFolder_(monthFolder, dateStr);

          dateFolder.addFile(file);
          tf.removeFile(file);
          movedFiles++;
          logs.push(`Organized loose video ${fileName} into ${monthStr}/${dateStr}/`);
        }
      });
    }
  }

  // 3. Repair / verify all Sheet links in OrderLog and ReturnLog
  const repairRes = repairPlaybackUrls();

  const currentMonthSample = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM-yyyy');
  return {
    success: true,
    movedDateFolders: movedDateFolders,
    mergedDateFolders: mergedDateFolders,
    movedFiles: movedFiles,
    sheetLinksVerified: repairRes.fixedRows || 0,
    logs: logs,
    message: `Migration Complete! Reorganized ${movedDateFolders + mergedDateFolders} daily folders and ${movedFiles} video files into Monthly (${currentMonthSample}) folders. All Google Sheet links verified & active.`
  };
}

function safeName_(s){return String(s||'').replace(/^#+/, '').replace(/[\\/:*?"<>|#%{}\[\]]/g,'_').trim()}

function logUpload_(row){
  try {
    logAppend_(sheet_(CONFIG.UPLOAD_LOG_SHEET), row);
    SpreadsheetApp.flush();
  } catch(e) {
    console.error('Failed to log upload: ', e);
  }
}

function updateUploadLog_(uploadId, stage, progress, fileId, status, error, queueJobId, orderId, recType, createdAt){
  try {
    const sh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
    const v = sh.getDataRange().getValues();
    const normUploadId = normalize_(uploadId);
    const normJobId = normalize_(queueJobId);
    const normOrderId = normalizeOrderId_(orderId);
    const normType = normalize_(recType);
    const fallbackDate = createdAt ? new Date(Number(createdAt)) : null;

    for (let i = v.length - 1; i >= 1; i--) {
      const rUploadId = normalize_(v[i][6]);
      const rJobId = normalize_(v[i][14]);
      const rOrderId = normalizeOrderId_(v[i][1]);
      const rType = normalize_(v[i][12]);

      let match = false;
      if (normUploadId && rUploadId === normUploadId) match = true;
      else if (normJobId && rJobId && rJobId === normJobId) match = true;
      else if (normOrderId && rOrderId === normOrderId && (!normType || rType === normType)) match = true;

      if (match) {
        const existingTs = v[i][0];
        const keepTs = (existingTs instanceof Date && !isNaN(existingTs.getTime())) ? existingTs : (fallbackDate || (existingTs ? new Date(existingTs) : new Date()));
        sh.getRange(i + 1, 1).setValue(keepTs);
        sh.getRange(i + 1, 8, 1, 5).setValues([[stage || 'Uploaded to Google Drive', progress !== undefined ? progress : 100, fileId || '', status || 'Completed', error || '']]);
        sbTouch_(sh, i + 1);
        SpreadsheetApp.flush();
        return;
      }
    }
  } catch(e) {
    console.warn('updateUploadLog_ note:', e);
  }
}

/**
 * Helper to initiate a Google Drive v3 Resumable Upload Session
 */
function initDriveResumableSession_(name, mime, size, parentFolderId) {
  try {
    const oauthToken = ScriptApp.getOAuthToken();
    if (!oauthToken) {
      console.warn('initDriveResumableSession_: No OAuth token available.');
      return '';
    }
    const driveSessionResp = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: {
        Authorization: 'Bearer ' + oauthToken,
        'X-Upload-Content-Type': mime || 'video/mp4',
        'X-Upload-Content-Length': String(size)
      },
      payload: JSON.stringify({
        name: name,
        mimeType: mime || 'video/mp4',
        parents: [parentFolderId]
      }),
      muteHttpExceptions: true
    });

    const respCode = driveSessionResp.getResponseCode();
    if ((respCode >= 200 && respCode < 300) || respCode === 308) {
      const headers = driveSessionResp.getHeaders ? driveSessionResp.getHeaders() : driveSessionResp.getAllHeaders();
      for (const key in headers) {
        if (key.toLowerCase() === 'location') {
          return String(headers[key] || '').trim();
        }
      }
    } else {
      console.warn('initDriveResumableSession_ failed code: ' + respCode + ' ' + driveSessionResp.getContentText());
    }
  } catch(dErr) {
    console.warn('Drive resumable session create note:', dErr);
  }
  return '';
}

/* ---------- Shared upload slots (several stations upload at the same time) ---------- */
// Up to N stations upload in parallel; extra stations wait for a free slot. Previously only one
// station in the whole company could upload at a time, so queues grew with every extra packer.
// Change the limit with the script property MAX_PARALLEL_UPLOADS (1-10).
var UPLOAD_SLOTS_KEY_ = 'ACTIVE_UPLOAD_SLOTS';

function maxParallelUploads_() {
  var n = Number(PropertiesService.getScriptProperties().getProperty('MAX_PARALLEL_UPLOADS') || 4);
  return isNaN(n) ? 4 : Math.max(1, Math.min(10, Math.floor(n)));
}

function readUploadSlots_() {
  var props = PropertiesService.getScriptProperties();
  var slots = {};
  try { slots = JSON.parse(props.getProperty(UPLOAD_SLOTS_KEY_) || '{}') || {}; } catch (_) { slots = {}; }
  var now = Date.now();
  var changed = false;
  Object.keys(slots).forEach(function(id) {
    var l = slots[id];
    // A slot frees itself after 25 s without a chunk/heartbeat, or 15 minutes in total.
    if (!l || now - Number(l.lastHeartbeatAt || 0) > 25000 || now - Number(l.startedAt || 0) > 900000) {
      delete slots[id];
      changed = true;
    }
  });
  if (changed) writeUploadSlots_(slots);
  return slots;
}

function writeUploadSlots_(slots) {
  var props = PropertiesService.getScriptProperties();
  if (Object.keys(slots).length === 0) props.deleteProperty(UPLOAD_SLOTS_KEY_);
  else props.setProperty(UPLOAD_SLOTS_KEY_, JSON.stringify(slots));
}

function checkGlobalUploadSlot_(orderId, uploadId, userEmail) {
  var slots = readUploadSlots_();
  var ids = Object.keys(slots);
  var mine = ids.filter(function(id) {
    return id === uploadId || (slots[id].orderId === orderId && slots[id].packerEmail === userEmail);
  });
  if (mine.length > 0 || ids.length < maxParallelUploads_()) {
    return { available: true, active: ids.length, limit: maxParallelUploads_() };
  }
  var oldest = slots[ids.sort(function(a, b) { return slots[a].startedAt - slots[b].startedAt; })[0]];
  return {
    available: false,
    activeUploader: oldest.packerEmail || 'Another workstation',
    activeOrderId: oldest.orderId || 'video',
    startedAt: oldest.startedAt,
    active: ids.length,
    limit: maxParallelUploads_(),
    retryAfterMs: 3000
  };
}

function setGlobalUploadLease_(uploadId, orderId, userEmail) {
  var lease = { uploadId: uploadId, orderId: orderId, packerEmail: userEmail, startedAt: Date.now(), lastHeartbeatAt: Date.now() };
  withScriptLock_(function() {
    var slots = readUploadSlots_();
    // Same order from the same packer restarting: replace its old slot.
    Object.keys(slots).forEach(function(id) {
      if (slots[id].orderId === orderId && slots[id].packerEmail === userEmail) delete slots[id];
    });
    slots[uploadId] = lease;
    writeUploadSlots_(slots);
  });
  return lease;
}

function touchGlobalUploadSlot_(uploadId) {
  try {
    var slots = readUploadSlots_();
    if (uploadId && slots[uploadId]) {
      slots[uploadId].lastHeartbeatAt = Date.now();
      writeUploadSlots_(slots);
    }
  } catch (_) {}
}

function releaseGlobalUploadSlot_(uploadId) {
  try {
    if (!uploadId) return;
    var slots = readUploadSlots_();
    if (slots[uploadId]) {
      delete slots[uploadId];
      writeUploadSlots_(slots);
    }
  } catch (_) {}
}

/* ---------- Start Upload Session ---------- */
function startUpload_(p){
  const user = session_(p.token);
  const platform = String(p.platform||'').trim();
  const order = canonicalOrderId_(p.orderId, platform);
  const type = String(p.recordingType||'Forward').trim();
  const size = Number(p.fileSize||0);
  // The video folder is decided centrally (Admin > Drive location), never by the uploading station.
  const driveFolderId = videoRootFolderId_();

  if(!order||!platform)throw new Error('Order ID and platform are required.');
  if(!['Forward','Return'].includes(type))throw new Error('Invalid recording type.');
  if(size<=0||size>CONFIG.MAX_VIDEO_BYTES)throw new Error('Invalid video size or video exceeds the 20 GB technical limit.');
  const limitMb = maxVideoSizeMb_();
  if (limitMb > 0 && size > limitMb * 1024 * 1024) {
    return { success: false, code: 'VIDEO_TOO_LARGE', error: 'Video is ' + Math.round(size / 1048576) + ' MB, above the ' + limitMb + ' MB limit set in Admin. Raise the limit in Admin > Apps Script & Drive Settings to upload it.' };
  }

  // This exact video (queue job) is already uploaded and logged: never upload it a second time,
  // whatever the bypass flag says. The station marks it done with the existing Drive file.
  const loggedJob = findLoggedJob_(p.queueJobId);
  if (loggedJob && loggedJob.fileId) {
    return {
      success: false,
      code: 'DUPLICATE_ORDER_ID',
      isDuplicate: true,
      alreadyUploaded: true,
      error: 'This video was already uploaded to Google Drive.',
      existing: loggedJob
    };
  }

  // Check duplicate: if duplicate exists and not explicitly bypassed, prevent duplicate upload
  const isBypass = p.bypassDuplicate === true || String(p.bypassDuplicate) === 'true' || p.bypassDuplicate === 1 || p.bypassDuplicate === '1';
  const done = completedDuplicate_(order,platform,type);
  if(done && !isBypass){
    return {
      success: false,
      code: 'DUPLICATE_ORDER_ID',
      error: `Duplicate Order ID: Order "${order}" (${platform} - ${type}) has already been uploaded to Google Drive on ${done.timestamp || 'previous session'}. Duplicate upload was prevented.`,
      isDuplicate: true,
      existing: done
    };
  }

  const uploadId = Utilities.getUuid();

  // Shared upload slots: when every slot is busy, this station waits for the next free one.
  const isBypassGlobalQueue = p.bypassGlobalQueue === true || String(p.bypassGlobalQueue) === 'true';
  if (!isBypassGlobalQueue) {
    const slotStatus = checkGlobalUploadSlot_(order, uploadId, user.email);
    if (!slotStatus.available) {
      return {
        success: true,
        queuedInCloud: true,
        isDuplicate: false,
        activeUploader: slotStatus.activeUploader,
        activeOrderId: slotStatus.activeOrderId,
        retryAfterMs: slotStatus.retryAfterMs || 3000,
        message: `All ${slotStatus.limit} upload slots are busy. This station uploads as soon as one is free.`
      };
    }
  }

  const ext = String(p.fileName||'').toLowerCase().endsWith('.mp4')?'.mp4':'.webm';
  const name = safeName_(order)+'_'+safeName_(platform)+'_'+safeName_(type)+ext;
  const source = String(p.source||'Automatic Recording');
  const queueJobId = String(p.queueJobId||'');
  const mime = String(p.mimeType||'video/mp4');

  const recordingDate = p.recordingDate ? String(p.recordingDate).trim() : '';
  const folder = dateFolder_(platform, type, driveFolderId, recordingDate);

  // Acquire Global Upload Lease
  setGlobalUploadLease_(uploadId, order, user.email);

  // Initiate Google Drive Resumable Upload Session (Direct Drive v3 API) for fast direct binary uploads
  let uploadUrl = '';
  const totalChunks = Number(p.totalChunks || 1);
  if (totalChunks > 1 || size >= 2 * 1024 * 1024) {
    try {
      uploadUrl = initDriveResumableSession_(name, mime, size, folder.getId());
    } catch(initErr) {
      console.warn('initDriveResumableSession_ note:', initErr);
    }
  }

  let reservation = null;
  return withScriptLock_(function() {
    try {
      reservation = reserve_(order, platform, type, user, uploadId, p.queueJobId);
      if (!reservation.allowed && !isBypass) {
        releaseGlobalUploadSlot_(uploadId);
        return {
          success: false,
          code: 'ACTIVE_UPLOAD_IN_PROGRESS',
          isDuplicate: true,
          error: `Duplicate Order Collision: Order "${order}" (${platform} - ${type}) is currently being packed/uploaded by ${reservation.existing ? reservation.existing.email : 'another station'}. Duplicate upload was prevented.`,
          existing: reservation.existing
        };
      }

      const sessionData = {
        uploadId: uploadId,
        uploadUrl: uploadUrl,
        order: order,
        platform: platform,
        type: type,
        name: name,
        mime: mime,
        size: size,
        recordingDate: recordingDate,
        packerEmail: user.email,
        source: source,
        queueJobId: queueJobId,
        driveFolderId: driveFolderId,
        targetFolderId: folder.getId(),
        reservationKey: reservation ? reservation.key : '',
        bypassDuplicate: isBypass,
        createdAt: p.createdAt ? new Date(p.createdAt).getTime() : Date.now()
      };

      PropertiesService.getScriptProperties().setProperty('UPLOAD_' + uploadId, JSON.stringify(sessionData));
      if (reservation) setReservationUpload_(reservation.key, uploadId);

      // Reuse existing unfinished or failed row if present, otherwise log new
      const originalDate = p.createdAt ? new Date(Number(p.createdAt)) : new Date();
      const uploadSh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
      const uploadData = uploadSh.getDataRange().getValues();
      let updatedExisting = false;
      for (let i = uploadData.length - 1; i >= 1; i--) {
        const rOrder = String(uploadData[i][1] || '').trim();
        const rPlatform = String(uploadData[i][2] || '').trim();
        const rType = String(uploadData[i][12] || 'Forward').trim();
        const rStatus = normalize_(String(uploadData[i][10] || ''));
        const displaySize = formatFileSize_(size);
        if (normalize_(rOrder) === normalize_(order) && normalize_(rPlatform) === normalize_(platform) && normalize_(rType) === normalize_(type)) {
          if (rStatus === 'started' || rStatus === 'pending' || rStatus === 'in progress' || rStatus === 'failed' || rStatus.indexOf('fail') !== -1 || rStatus.indexOf('interrupt') !== -1 || rStatus.indexOf('stale') !== -1 || rStatus.indexOf('expired') !== -1) {
            const existingTs = uploadData[i][0];
            const rowTs = (existingTs instanceof Date && !isNaN(existingTs.getTime())) ? existingTs : originalDate;
            uploadSh.getRange(i + 1, 1, 1, 15).setValues([[
              rowTs, order, platform, user.email, name, displaySize, uploadId, 'Session Created', 0, '', 'Started', '', type, source, queueJobId
            ]]);
            formatDateRows_(uploadSh, i + 1, 1);
            sbTouch_(uploadSh, i + 1);
            updatedExisting = true;
            break;
          }
        }
      }
      if (!updatedExisting) {
        logUpload_([originalDate, order, platform, user.email, name, formatFileSize_(size), uploadId, 'Session Created', 0, '', 'Started', '', type, source, queueJobId]);
      }

      return {
        success: true,
        uploadId: uploadId,
        uploadUrl: uploadUrl,
        chunkSize: CONFIG.DEFAULT_CHUNK_BYTES,
        fileName: name,
        fileSize: size,
        hasResumableUrl: !!uploadUrl,
        isDuplicate: false,
        queuedInCloud: false
      };
    } catch(e) {
      releaseGlobalUploadSlot_(uploadId);
      if(reservation&&reservation.key)releaseReservation_(reservation.key);
      throw e;
    }
  }, 10000);
}

/* ---------- Upload Chunk ---------- */
function uploadChunk_(p){
  const user = session_(p.token);
  const uploadId = p.uploadId;

  // Touch the global upload slot heartbeat on each chunk transmission
  touchGlobalUploadSlot_(uploadId);

  const raw = PropertiesService.getScriptProperties().getProperty('UPLOAD_' + uploadId);
  if (raw) {
    try {
      const sParsed = JSON.parse(raw);
      if (sParsed.completed && sParsed.fileId) {
        return {
          success: true,
          complete: true,
          completed: true,
          fileId: sParsed.fileId,
          webViewLink: sParsed.webViewLink || ('https://drive.google.com/file/d/' + sParsed.fileId + '/preview'),
          playbackUrl: sParsed.playbackUrl || ('https://drive.google.com/file/d/' + sParsed.fileId + '/preview'),
          stage: 'Uploaded to Google Drive',
          status: 'Completed',
          orderId: sParsed.order,
          platform: sParsed.platform,
          recordingType: sParsed.type,
          message: 'Upload already completed and verified in Google Drive.'
        };
      }
    } catch(_) {}
  }

  if (!raw) {
    // CRITICAL: Before declaring session expired, verify if this upload has already completed!
    // This happens when final chunk completed, saved the session, and client network retried the request.
    try {
      const normOrder = normalizeOrderId_(p.orderId || '');
      const cleanJobId = String(p.queueJobId || '').trim();
      const targetSheets = [
        getTargetLogSheet_(p.recordingType || 'Forward'),
        sheet_(CONFIG.ORDER_LOG_SHEET),
        sheet_(CONFIG.RETURN_LOG_SHEET)
      ];

      for (let sIdx = 0; sIdx < targetSheets.length; sIdx++) {
        const sh = targetSheets[sIdx];
        if (!sh) continue;
        const existingData = sh.getDataRange().getValues();
        for (let i = existingData.length - 1; i >= Math.max(1, existingData.length - 50); i--) {
          const rowOrder = normalizeOrderId_(existingData[i][1]);
          const rowFid = String(existingData[i][4] || '').trim();
          const rowPlay = String(existingData[i][5] || '').trim();
          const rowJob = String(existingData[i][9] || '').trim();

          if ((cleanJobId && rowJob === cleanJobId) || (normOrder && rowOrder === normOrder && rowFid)) {
            return {
              success: true,
              complete: true,
              completed: true,
              fileId: rowFid,
              webViewLink: rowPlay || ('https://drive.google.com/file/d/' + rowFid + '/preview'),
              playbackUrl: rowPlay || ('https://drive.google.com/file/d/' + rowFid + '/preview'),
              stage: 'Uploaded to Google Drive',
              status: 'Completed',
              message: 'Upload already completed and verified in Google Drive.'
            };
          }
        }
      }
    } catch (_) {}

    return {
      success: false,
      sessionExpired: true,
      needRestart: true,
      error: 'Upload session not found or expired. Re-initiating fresh session automatically.'
    };
  }

  const s = JSON.parse(raw);
  const total = Number(p.totalSize || s.size);
  const start = Number(p.startByte || 0);
  const end = Number(p.endByte || 0);
  const chunkIndex = Number(p.chunkIndex !== undefined ? p.chunkIndex : 0);
  const totalChunks = Number(p.totalChunks || 1);
  const base64Chunk = String(p.base64 || '');
  const driveFolderId = s.driveFolderId || videoRootFolderId_();

  if(!base64Chunk) throw new Error('Missing base64 chunk data.');

  const chunkBytes = Utilities.base64Decode(base64Chunk);
  const chunkLen = chunkBytes.length;
  const inclusiveEnd = start + chunkLen - 1;
  const isFinal = (inclusiveEnd >= total - 1) || (chunkIndex === totalChunks - 1);

  // Strategy 1: Direct Google Drive Resumable Stream
  // IMPORTANT: Resumable upload URLs must NOT send Authorization header (it causes 400 Bad Request)
  if (s.uploadUrl) {
    try {
      const contentRange = 'bytes ' + start + '-' + inclusiveEnd + '/' + total;
      const resp = UrlFetchApp.fetch(s.uploadUrl, {
        method: 'put',
        contentType: s.mime || 'video/mp4',
        headers: {
          'Content-Range': contentRange
        },
        payload: chunkBytes,
        muteHttpExceptions: true
      });

      const code = resp.getResponseCode();

      if (code === 308) {
        // Chunk accepted, upload in progress
        const pct = Math.min(99, Math.round(((inclusiveEnd + 1) / total) * 100));
        try {
          s.lastHeartbeatAt = Date.now();
          PropertiesService.getScriptProperties().setProperty('UPLOAD_' + uploadId, JSON.stringify(s));
          if (chunkIndex % 4 === 0) {
            updateUploadLog_(uploadId, 'Uploading chunk ' + (chunkIndex + 1) + ' of ' + totalChunks, pct, '', 'In Progress', '', s.queueJobId, s.order, s.type);
          }
        } catch(_) {}
        return {
          success: true,
          complete: false,
          completed: false,
          chunkIndex: chunkIndex,
          percent: pct,
          received: inclusiveEnd + 1
        };
      }

      if (code === 200 || code === 201) {
        // Completed via Resumable Drive API
        let fid = '';
        try {
          const fileObj = JSON.parse(resp.getContentText());
          fid = String(fileObj.id || '');
        } catch(_) {}

        if (!fid) {
          try {
            const folder = dateFolder_(s.platform, s.type, s.driveFolderId || videoRootFolderId_(), s.recordingDate);
            const it = folder.getFilesByName(s.name);
            if (it.hasNext()) {
              fid = it.next().getId();
            }
          } catch(e) {}
        }
        return finalizeCompletedUpload_(s, uploadId, fid, user);
      }

      if (code >= 400) {
        const errText = resp.getContentText();
        console.warn('Google Drive Resumable API response code ' + code + ': ' + errText);
        if (code === 404 || code === 410) {
          return {
            success: false,
            sessionExpired: true,
            needRestart: true,
            error: 'Google Drive upload session expired. System will auto-resume upload from beginning.'
          };
        }
        throw new Error('Google Drive returned error ' + code + ': ' + (errText || 'Upload chunk rejected'));
      }
    } catch(uErr) {
      console.warn('Drive resumable chunk upload notice:', uErr);
      const errStr = String(uErr || '');
      if (errStr.indexOf('expired') !== -1 || errStr.indexOf('Google Drive') !== -1 || errStr.indexOf('404') !== -1 || errStr.indexOf('410') !== -1) {
        return {
          success: false,
          sessionExpired: true,
          needRestart: true,
          error: 'Drive upload session expired or interrupted: ' + errStr
        };
      }
    }
  }

  // Strategy 2: Single-Shot Direct File Creation or Multi-Chunk Stream
  const targetFolder = dateFolder_(s.platform, s.type, driveFolderId, s.recordingDate);

  if (totalChunks === 1) {
    // Single-shot direct file creation in target date folder
    const blob = Utilities.newBlob(chunkBytes, s.mime || 'video/mp4', s.name);
    const file = targetFolder.createFile(blob);
    const fid = file.getId();
    return finalizeCompletedUpload_(s, uploadId, fid, user);
  } else {
    // Attempt auto-initializing resumable session on chunk 0 if missing
    if (!s.uploadUrl) {
      const freshUploadUrl = initDriveResumableSession_(s.name, s.mime || 'video/mp4', total, targetFolder.getId());
      if (freshUploadUrl) {
        s.uploadUrl = freshUploadUrl;
        PropertiesService.getScriptProperties().setProperty('UPLOAD_' + uploadId, JSON.stringify(s));
        const retryResp = UrlFetchApp.fetch(freshUploadUrl, {
          method: 'put',
          contentType: s.mime || 'video/mp4',
          headers: { 'Content-Range': 'bytes ' + start + '-' + inclusiveEnd + '/' + total },
          payload: chunkBytes,
          muteHttpExceptions: true
        });
        const retryCode = retryResp.getResponseCode();
        if (retryCode === 308) {
          const pct = Math.min(99, Math.round(((inclusiveEnd + 1) / total) * 100));
          return { success: true, complete: false, completed: false, chunkIndex: chunkIndex, percent: pct, received: inclusiveEnd + 1 };
        } else if (retryCode === 200 || retryCode === 201) {
          let fid = '';
          try { fid = String(JSON.parse(retryResp.getContentText()).id || ''); } catch(_) {}
          return finalizeCompletedUpload_(s, uploadId, fid, user);
        }
      }
    }

    if (isFinal) {
      // If final chunk reached in direct mode, create file
      const blob = Utilities.newBlob(chunkBytes, s.mime || 'video/mp4', s.name);
      const file = targetFolder.createFile(blob);
      const fid = file.getId();
      return finalizeCompletedUpload_(s, uploadId, fid, user);
    }

    // Acknowledge intermediate chunk
    const pct = Math.min(99, Math.round(((inclusiveEnd + 1) / total) * 100));
    return { success: true, complete: false, completed: false, chunkIndex: chunkIndex, percent: pct, received: inclusiveEnd + 1 };
  }
}

/**
 * Resolves the appropriate Google Sheets log tab ('OrderLog' vs 'ReturnLog') based on recording type.
 */
function getTargetLogSheet_(type) {
  const norm = normalize_(type);
  if (norm === 'return' || norm === 'inbound') {
    return sheet_(CONFIG.RETURN_LOG_SHEET);
  }
  return sheet_(CONFIG.ORDER_LOG_SHEET);
}

/**
 * Finalize completed video upload:
 * Sets Drive public sharing, records row in OrderLog/ReturnLog, DownloadLog,
 * updates UploadLog status to 100% Completed, and releases reservation locks & global queue lease.
 */
function finalizeCompletedUpload_(s, uploadId, fid, user) {
  SB_DEFER_ = false; // a finished video should show up in Search straight away
  const playback = 'https://drive.google.com/file/d/' + fid + '/preview';
  try {
    DriveApp.getFileById(fid).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(_) {}

  // Immediately release Global 1-by-1 Upload Lease so next waiting station picks it up smoothly!
  releaseGlobalUploadSlot_(uploadId);

  return withScriptLock_(function() {
    const targetLogSheet = getTargetLogSheet_(s.type);
    let alreadyLogged = false;
    const normTargetOrder = normalizeOrderId_(s.order);
    const targetType = normalize_(s.type || 'Forward');

    let keptRow = null; // the row that already holds this order's video
    let duplicateOrder = false;
    let sameOrderRow = null; // the newest row holding another video of this order + type
    let replacedOlder = ''; // 'merged' / 'row' when this video replaced a smaller older one
    if (fid || s.queueJobId || normTargetOrder) {
      const existingData = targetLogSheet.getDataRange().getValues();
      for (let i = existingData.length - 1; i >= 1; i--) {
        const rowFid = String(existingData[i][4] || '').trim();
        const rowJob = String(existingData[i][9] || '').trim();
        const rowOrder = normalizeOrderId_(existingData[i][1]);
        const rowType = normalize_(existingData[i][8] || (targetType === 'return' ? 'Return' : 'Forward'));

        if ((fid && rowFid === fid) || (s.queueJobId && rowJob === s.queueJobId)) {
          alreadyLogged = true;
          keptRow = existingData[i];
          break;
        }

        // One video per order and recording type. Before, a bypassed upload ("Upload Anyway",
        // queue "Bypass", Upload Logs "Resume") was logged as a second row and kept a second video.
        if (normTargetOrder && rowOrder === normTargetOrder && rowType === targetType && rowFid && !sameOrderRow) {
          sameOrderRow = { index: i, row: existingData[i] };
        }
      }
    }

    if (!alreadyLogged && sameOrderRow) {
      // Two videos of one order: keep the bigger (complete) one, move the other to Drive's trash
      // (restorable for 30 days) and keep a single row in every log.
      const oldFid = String(sameOrderRow.row[4] || '').trim();
      let oldBytes = parseSizeBytes_(sameOrderRow.row[6]);
      if (oldBytes <= 0) oldBytes = driveFileBytes_(oldFid);
      const newBytes = Number(s.size || 0) > 0 ? Number(s.size) : driveFileBytes_(fid);
      if (!(Number(s.size) > 0) && newBytes > 0) s.size = newBytes;
      const keepNew = newBytes > oldBytes;
      alreadyLogged = true;
      if (keepNew) {
        const newDate = s.createdAt ? new Date(s.createdAt) : new Date();
        targetLogSheet.getRange(sameOrderRow.index + 1, 1, 1, 12).setValues([[
          newDate, s.order, s.platform, s.packerEmail || (user ? user.email : ''), fid, playback,
          formatFileSize_(s.size) || '', 'Completed', s.type, s.queueJobId || '', s.mime || 'video/mp4', 'READY'
        ]]);
        formatDateRows_(targetLogSheet, sameOrderRow.index + 1, 1);
        sbTouch_(targetLogSheet, sameOrderRow.index + 1);
        try { DriveApp.getFileById(oldFid).setTrashed(true); } catch (_) {}
        replacedOlder = mergeUploadLogRows_(s, uploadId, oldFid, { fileId: fid, keepNew: true }) ? 'merged' : 'row';
        bumpAnalyticsVersion_();
      } else {
        duplicateOrder = true;
        keptRow = sameOrderRow.row;
      }
    }

    if (!alreadyLogged) {
      const formattedSize = formatFileSize_(s.size);
      const originalDate = s.createdAt ? new Date(s.createdAt) : new Date();
      logAppend_(targetLogSheet, [
        originalDate,
        s.order,
        s.platform,
        s.packerEmail || (user ? user.email : ''),
        fid,
        playback,
        formattedSize || '',
        'Completed',
        s.type,
        s.queueJobId || '',
        s.mime || 'video/mp4',
        'READY'
      ]);
      try {
        logAppend_(sheet_(CONFIG.DOWNLOAD_LOG_SHEET), [
          originalDate,
          s.order,
          s.platform,
          s.packerEmail || (user ? user.email : ''),
          s.name,
          formattedSize || '',
          'Recording & Cloud Upload Complete',
          s.type
        ]);
      } catch(_) {}
    }
    // A second video of an order that is already in Drive: keep the first, move the new file to
    // Drive's trash (restorable for 30 days) and answer with the kept file.
    const keptFid = keptRow ? String(keptRow[4] || '').trim() : '';
    if (keptFid && keptFid !== fid) {
      if (duplicateOrder || (s.queueJobId && String(keptRow[9] || '').trim() === s.queueJobId)) {
        try { DriveApp.getFileById(fid).setTrashed(true); } catch (_) {}
        if (!mergeUploadLogRows_(s, uploadId, keptFid, { fileId: keptFid, keepNew: false })) {
          updateUploadLog_(uploadId, 'Duplicate removed: order already in Drive', 100, keptFid, 'Completed', '', s.queueJobId, s.order, s.type, s.createdAt);
        }
        if(s.reservationKey) releaseReservation_(s.reservationKey);
        releaseReservation_(reservationKey_(s.order, s.platform, s.type));
        const keptPlay = String(keptRow[5] || '') || ('https://drive.google.com/file/d/' + keptFid + '/preview');
        try {
          PropertiesService.getScriptProperties().setProperty('UPLOAD_' + uploadId, JSON.stringify({
            completed: true, fileId: keptFid, webViewLink: keptPlay, playbackUrl: keptPlay,
            order: s.order, platform: s.platform, type: s.type, completedAt: Date.now()
          }));
        } catch(_) {}
        return {
          success: true, complete: true, completed: true, duplicateRemoved: true,
          fileId: keptFid, webViewLink: keptPlay, playbackUrl: keptPlay,
          downloadUrl: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(keptFid),
          stage: 'Already in Google Drive (duplicate removed)', status: 'Completed',
          orderId: s.order, platform: s.platform, recordingType: s.type
        };
      }
    }
    if (replacedOlder !== 'merged') {
      updateUploadLog_(uploadId, replacedOlder ? 'Uploaded to Google Drive (replaced older video)' : 'Uploaded to Google Drive', 100, fid, 'Completed', '', s.queueJobId, s.order, s.type, s.createdAt);
    }
    if (!alreadyLogged) bumpAnalyticsVersion_();
    if(s.reservationKey) releaseReservation_(s.reservationKey);
    releaseReservation_(reservationKey_(s.order, s.platform, s.type));
    cleanupOldStartedUploads_(s.order, uploadId);

    if (uploadId) {
      try {
        // Keep completed record in PropertiesService for 30 minutes so retried requests get instant success
        PropertiesService.getScriptProperties().setProperty('UPLOAD_' + uploadId, JSON.stringify({
          completed: true,
          fileId: fid,
          webViewLink: playback,
          playbackUrl: playback,
          order: s.order,
          platform: s.platform,
          type: s.type,
          completedAt: Date.now()
        }));
      } catch(_) {}
    }

    return {
      success: true,
      complete: true,
      completed: true,
      fileId: fid,
      webViewLink: playback,
      playbackUrl: playback,
      downloadUrl: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fid),
      stage: 'Uploaded to Google Drive',
      status: 'Completed',
      replacedOlderVideo: !!replacedOlder,
      orderId: s.order,
      platform: s.platform,
      recordingType: s.type
    };
  }, 10000);
}

/** Size in bytes of a Drive file, 0 when it cannot be read. */
function driveFileBytes_(fid) {
  try { return Number(DriveApp.getFileById(fid).getSize()) || 0; } catch (_) { return 0; }
}

/**
 * Keeps ONE UploadLog row for an order + recording type when a second video of it finishes.
 * The row already holding the order's video (oldFid) is kept; when the new video wins it is
 * updated to the new file. This upload's own attempt row is then removed, so the sheet does not
 * show the order twice. Returns false when there is no older row to merge into.
 */
function mergeUploadLogRows_(s, uploadId, oldFid, keep) {
  try {
    const sh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
    const v = sh.getDataRange().getValues();
    const order = normalizeOrderId_(s.order);
    const type = normalize_(s.type || 'Forward');
    const myId = normalize_(uploadId);
    let target = -1, mine = -1;
    for (let i = v.length - 1; i >= 1; i--) {
      if (normalizeOrderId_(v[i][1]) !== order) continue;
      if (normalize_(v[i][12] || 'Forward') !== type) continue;
      if (myId && normalize_(v[i][6]) === myId) { if (mine < 0) mine = i; continue; }
      const f = String(v[i][9] || '').trim();
      if (f && (f === oldFid || f === keep.fileId) && target < 0) target = i;
    }
    if (target < 0) return false;
    if (keep.keepNew) {
      const newDate = s.createdAt ? new Date(s.createdAt) : new Date();
      sh.getRange(target + 1, 1, 1, 15).setValues([[
        newDate, s.order, s.platform, s.packerEmail || '', s.name || v[target][4], formatFileSize_(s.size) || v[target][5],
        uploadId || v[target][6], 'Uploaded to Google Drive (replaced older video)', 100, keep.fileId, 'Completed', '',
        s.type, s.source || v[target][13] || '', s.queueJobId || ''
      ]]);
      formatDateRows_(sh, target + 1, 1);
      sbTouch_(sh, target + 1);
    }
    if (mine >= 0 && mine !== target) sh.deleteRow(mine + 1);
    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    console.warn('mergeUploadLogRows_ note:', e);
    return false;
  }
}

/**
 * Direct Client Finish Upload:
 * Called by the frontend uploadWorker when binary streaming directly to Google Drive completes.
 */
function finishUpload_(p) {
  const user = session_(p.token);
  const uploadId = String(p.uploadId || '').trim();
  const fid = String(p.fileId || '').trim();
  if (!fid) throw new Error('Valid Google Drive file ID is required to finalize upload.');

  const raw = uploadId ? PropertiesService.getScriptProperties().getProperty('UPLOAD_' + uploadId) : null;
  let s = raw ? JSON.parse(raw) : null;
  if (!s) {
    s = {
      order: canonicalOrderId_(p.orderId, p.platform),
      platform: String(p.platform || '').trim(),
      type: String(p.recordingType || 'Forward').trim(),
      name: String(p.fileName || ''),
      size: Number(p.fileSize || 0),
      mime: String(p.mimeType || 'video/mp4'),
      packerEmail: user.email,
      queueJobId: String(p.queueJobId || ''),
      driveFolderId: videoRootFolderId_(),
      reservationKey: '',
      createdAt: p.createdAt ? new Date(p.createdAt).getTime() : Date.now()
    };
  } else if (p.createdAt) {
    s.createdAt = new Date(p.createdAt).getTime();
  }

  return finalizeCompletedUpload_(s, uploadId, fid, user);
}

/* ---------- Upload Logs Sheet Query ---------- */
function uploadLogs_(p){
  const user = session_(p.token);
  const filterStatus = normalize_(p.status);
  const rawOrder = String(p.orderId || '').trim();
  const filterOrder = normalizeOrderId_(rawOrder);
  const cleanFilterOrder = cleanAlphanumeric_(rawOrder);
  const filterPlatform = normalize_(p.platform);
  const filterType = normalize_(p.recordingType);
  const rawSearch = String(p.searchQuery || p.search || '').trim();
  const searchQ = normalize_(rawSearch);
  const cleanSearchQ = cleanAlphanumeric_(rawSearch);
  const normSearchQ = normalizeOrderId_(rawSearch);

  // When an orderId, search query, or date filter is present, search mode is active
  const isSearchActive = !!(rawOrder || rawSearch || (p.fromDate && p.fromDate !== '') || (p.toDate && p.toDate !== ''));
  // Default to recent 500 records for fast display, or up to 10000 records when searching
  const limit = isSearchActive ? Math.min(10000, Math.max(1, Number(p.limit || 5000))) : Math.min(2000, Math.max(1, Number(p.limit || 500)));

  const fromDate = p.fromDate ? parseDateStart_(p.fromDate) : null;
  const toDate = p.toDate ? parseDateEnd_(p.toDate) : null;

  const logs = [];
  const seenFids = {};
  const seenUploadIds = {};
  const seenJobIds = {};
  const seenOrders = {};

  let totalCount = 0;
  let completedCount = 0;
  let inProgressCount = 0;
  let pendingCount = 0;
  let failedCount = 0;

  // Flexible search matcher supporting full/partial Order IDs, dashes, packer, platform, stage, and Drive File IDs
  function matchesFilter(oid, fn, pe, upId, pf, st, rt, fid, jid, ts) {
    // 1. Date Range
    if (fromDate || toDate) {
      const d = rowDate_(ts);
      if (isNaN(d.getTime())) return false;
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
    }

    // 2. Platform Filter
    if (filterPlatform && filterPlatform !== 'all' && normalize_(pf) !== filterPlatform) return false;

    // 3. Type Filter
    if (filterType && filterType !== 'all' && normalize_(rt) !== filterType) return false;

    // 4. Status Filter
    const normSt = normalize_(st);
    if (filterStatus && filterStatus !== 'all') {
      if (filterStatus === 'completed' && normSt !== 'completed') return false;
      if ((filterStatus === 'in progress' || filterStatus === 'processing' || filterStatus === 'pending') &&
          normSt !== 'in progress' && normSt !== 'uploading' && normSt !== 'processing' && normSt !== 'pending' && normSt !== 'queued' && normSt !== 'started') return false;
      if ((filterStatus === 'failed' || filterStatus === 'paused') &&
          normSt !== 'failed' && normSt !== 'paused' && normSt !== 'error' && !normSt.includes('interrupt') && !normSt.includes('stale')) return false;
    }

    // 5. Specific Order Filter
    const normOid = normalizeOrderId_(oid);
    const cleanOid = cleanAlphanumeric_(oid);
    const cleanFn = cleanAlphanumeric_(fn);
    if (filterOrder) {
      const matchOrd = normOid.includes(filterOrder) ||
                       normalize_(oid).includes(normalize_(rawOrder)) ||
                       (cleanFilterOrder.length > 2 && cleanOid.includes(cleanFilterOrder)) ||
                       (cleanFilterOrder.length > 2 && cleanFn.includes(cleanFilterOrder));
      if (!matchOrd) return false;
    }

    // 6. Global Search Query
    if (searchQ) {
      const matchQ = normalize_(oid).includes(searchQ) ||
                     normOid.includes(normSearchQ) ||
                     (cleanSearchQ.length > 2 && (cleanOid.includes(cleanSearchQ) || cleanFn.includes(cleanSearchQ))) ||
                     normalize_(fn).includes(searchQ) ||
                     normalize_(pe).includes(searchQ) ||
                     normalize_(upId).includes(searchQ) ||
                     normalize_(pf).includes(searchQ) ||
                     normalize_(st).includes(searchQ) ||
                     normalize_(rt).includes(searchQ) ||
                     (fid && normalize_(fid).includes(searchQ)) ||
                     (jid && normalize_(jid).includes(searchQ));
      if (!matchQ) return false;
    }

    return true;
  }

  // 1. Scan OrderLog and ReturnLog (Completed permanent video logs)
  const orderSheets = [
    { name: CONFIG.ORDER_LOG_SHEET, defType: 'Forward' },
    { name: CONFIG.RETURN_LOG_SHEET, defType: 'Return' }
  ];

  for (let s = 0; s < orderSheets.length; s++) {
    try {
      const sh = sheet_(orderSheets[s].name);
      if (!sh) continue;
      const odata = sh.getDataRange().getValues();
      // Headers: [Timestamp, Order ID, Platform, Packer Email, Video Drive ID, Video Playback URL, Package Weight, Status, Recording Type, Queue Job ID, Video MIME Type, Playback Status]
      for (let i = odata.length - 1; i >= 1; i--) {
        const ts = rowDate_(odata[i][0]);
        const oid = String(odata[i][1] || '').trim();
        const pf = String(odata[i][2] || '').trim();
        const pe = String(odata[i][3] || '').trim();
        const fid = String(odata[i][4] || '').trim() || extractDriveId_(String(odata[i][5] || ''));
        const pUrl = String(odata[i][5] || '').trim();
        const rawSt = String(odata[i][7] || 'Completed').trim();
        const rt = String(odata[i][8] || orderSheets[s].defType).trim();
        const jid = String(odata[i][9] || '').trim();
        const fn = oid + '_' + pf + '_' + rt + '.mp4';

        if (!oid && !fid) continue;

        if (fid) seenFids[fid] = true;
        if (jid) seenJobIds[jid] = true;
        if (oid) seenOrders[normalizeOrderId_(oid) + '_' + normalize_(rt)] = true;

        totalCount++;
        completedCount++;

        if (!matchesFilter(oid, fn, pe, jid || oid, pf, rawSt, rt, fid, jid, ts)) {
          continue;
        }

        let fSize = String(odata[i][6] || '').trim();
        if (!fSize || fSize === '0' || fSize === '0 B' || fSize === '0 MB' || fSize === '0.0 MB') {
          fSize = '—';
        }

        logs.push({
          timestamp: ts instanceof Date && !isNaN(ts.getTime()) ? ts.toISOString() : String(odata[i][0] || ''),
          orderId: oid,
          platform: pf,
          packerEmail: pe,
          fileName: fn,
          fileSize: fSize,
          uploadId: jid || oid,
          stage: 'Completed',
          progress: '100',
          driveFileId: fid,
          status: rawSt || 'Completed',
          error: '',
          recordingType: rt,
          source: orderSheets[s].name,
          queueJobId: jid,
          playbackUrl: pUrl || (fid ? 'https://drive.google.com/file/d/' + fid + '/preview' : ''),
          downloadUrl: fid ? 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fid) : ''
        });
      }
    } catch(e) {
      console.warn('OrderSheet scan in uploadLogs_ note:', e);
    }
  }

  // 2. Scan UploadLog Sheet (Active in-progress, queued, chunked uploads, and fallback sessions)
  try {
    const uSh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
    if (uSh) {
      const v = uSh.getDataRange().getValues();
      for (let i = v.length - 1; i >= 1; i--) {
        const ts = rowDate_(v[i][0]);
        const orderId = String(v[i][1] || '').trim();
        const platform = String(v[i][2] || '').trim();
        const pe = String(v[i][3] || '').trim();
        const fileName = String(v[i][4] || '').trim();
        const fileSize = String(v[i][5] || '').trim();
        const uploadId = String(v[i][6] || '').trim();
        let stage = String(v[i][7] || '').trim();
        let progress = String(v[i][8] || '').trim();
        let driveFileId = String(v[i][9] || '').trim();
        let rawStatus = String(v[i][10] || '').trim();
        let normSt = normalize_(rawStatus);
        const error = String(v[i][11] || '').trim();
        const recordingType = String(v[i][12] || 'Forward').trim();
        const source = String(v[i][13] || CONFIG.UPLOAD_LOG_SHEET).trim();
        const queueJobId = String(v[i][14] || '').trim();

        if (!orderId && !driveFileId && !uploadId) continue;

        // If this order was already completed in OrderLog / ReturnLog, skip leftover in-progress/stale row
        const ordKey = normalizeOrderId_(orderId) + '_' + normalize_(recordingType);
        if (orderId && seenOrders[ordKey]) continue;

        // If this exact video file or job ID was already added from OrderLog, skip duplicate
        if (driveFileId && seenFids[driveFileId]) continue;
        if (queueJobId && seenJobIds[queueJobId]) continue;
        if (uploadId && seenUploadIds[uploadId]) continue;

        // Mark as completed if valid Drive file ID is attached
        if (driveFileId && driveFileId.length > 5 && normSt !== 'failed') {
          rawStatus = 'Completed';
          normSt = 'completed';
          stage = 'Uploaded to Google Drive';
          progress = '100';
        }

        // Auto-detect abandoned in-progress sessions older than 20 minutes without Drive File ID
        const rowDate = ts instanceof Date && !isNaN(ts.getTime()) ? ts.getTime() : Date.now();
        const isStale = (normSt === 'in progress' || normSt === 'uploading' || normSt === 'processing' || normSt === 'started') && !driveFileId && (Date.now() - rowDate > 20 * 60 * 1000);
        if (isStale) {
          rawStatus = 'Interrupted / Stale';
          normSt = 'failed';
          if (!stage || stage === 'In Progress' || stage.startsWith('Uploading chunk') || stage === 'Session started') {
            stage = 'Upload interrupted - Session timed out';
          }
        }

        // Aggregate stats
        totalCount++;
        if (normSt === 'completed' || (driveFileId && driveFileId.length > 5 && !isStale && normSt !== 'failed')) completedCount++;
        else if (normSt === 'failed' || normSt === 'paused' || normSt === 'error' || isStale || normSt.includes('interrupt') || normSt.includes('stale') || normSt.includes('expired') || normSt.includes('timeout')) failedCount++;
        else if (normSt === 'in progress' || normSt === 'uploading' || normSt === 'processing') inProgressCount++;
        else pendingCount++;

        if (driveFileId) seenFids[driveFileId] = true;
        if (uploadId) seenUploadIds[uploadId] = true;
        if (queueJobId) seenJobIds[queueJobId] = true;

        if (!matchesFilter(orderId, fileName, pe, uploadId, platform, rawStatus, recordingType, driveFileId, queueJobId, ts)) {
          continue;
        }

        logs.push({
          timestamp: ts instanceof Date && !isNaN(ts.getTime()) ? ts.toISOString() : String(v[i][0] || ''),
          orderId: orderId,
          platform: platform,
          packerEmail: pe,
          fileName: fileName,
          fileSize: (!fileSize || fileSize === '0' || fileSize === '0 B' || fileSize === '0 MB') ? '—' : fileSize,
          uploadId: uploadId,
          stage: stage,
          progress: progress,
          driveFileId: driveFileId,
          status: rawStatus || (driveFileId ? 'Completed' : 'In Progress'),
          error: error,
          recordingType: recordingType,
          source: source,
          queueJobId: queueJobId,
          playbackUrl: driveFileId ? 'https://drive.google.com/file/d/' + driveFileId + '/preview' : '',
          downloadUrl: driveFileId ? 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(driveFileId) : ''
        });
      }
    }
  } catch(e) {
    console.warn('UploadLog scan in uploadLogs_ note:', e);
  }

  // 3. Fallback: If user is searching a specific Order ID and 0 results found in sheets, check Google Drive directly
  const targetSearchOrder = rawOrder || rawSearch;
  if (targetSearchOrder && logs.length === 0) {
    try {
      const sanitized = targetSearchOrder.replace(/['\\]/g, '');
      const query = "title contains '" + sanitized + "' and trashed = false";
      const files = DriveApp.searchFiles(query);
      let driveFound = 0;
      while (files.hasNext() && driveFound < 10) {
        const file = files.next();
        const fName = file.getName();
        const fid = file.getId();
        if (seenFids[fid]) continue;

        const parts = fName.replace(/\.[^/.]+$/, '').split('_');
        const parsedOrder = parts[0] || targetSearchOrder;
        const parsedPf = parts[1] || 'Amazon';
        const parsedType = parts[2] || (fName.toLowerCase().includes('return') ? 'Return' : 'Forward');

        seenFids[fid] = true;
        totalCount++;
        completedCount++;

        logs.push({
          timestamp: file.getDateCreated() ? file.getDateCreated().toISOString() : new Date().toISOString(),
          orderId: parsedOrder,
          platform: parsedPf,
          packerEmail: user.email || 'packer@vms.local',
          fileName: fName,
          fileSize: String(file.getSize() || ''),
          uploadId: fid,
          stage: 'Completed',
          progress: '100',
          driveFileId: fid,
          status: 'Completed',
          error: '',
          recordingType: parsedType,
          source: 'Google Drive (Direct)',
          queueJobId: '',
          playbackUrl: 'https://drive.google.com/file/d/' + fid + '/preview',
          downloadUrl: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fid)
        });
        driveFound++;
      }
    } catch(dErr) {
      console.warn('Direct Drive search in uploadLogs_ note:', dErr);
    }
  }

  // 4. Sort all records newest first by default
  logs.sort(function(a, b) {
    const da = new Date(a.timestamp).getTime() || 0;
    const db = new Date(b.timestamp).getTime() || 0;
    return db - da;
  });

  // 5. Slice logs to requested limit (500 for normal view, or up to 10000 for search)
  const slicedLogs = logs.slice(0, limit);

  return {
    success: true,
    logs: slicedLogs,
    stats: {
      total: totalCount,
      completed: completedCount,
      inProgress: inProgressCount,
      pending: pendingCount,
      failed: failedCount
    }
  };
}

function downloadLog_(p){
  const u=session_(p.token);
  logAppend_(sheet_(CONFIG.DOWNLOAD_LOG_SHEET), [
    new Date(),
    canonicalOrderId_(p.orderId, p.platform),
    String(p.platform||''),
    u.email,
    String(p.fileName||''),
    String(p.fileSize||''),
    String(p.downloadType||''),
    String(p.recordingType||'Forward')
  ]);
  return {success: true};
}

function checkVideoStatus_(p){
  session_(p.token);
  const id=String(p.fileId||'');
  return {success: true, ready: driveExists_(id), status: driveExists_(id) ? 'READY' : 'MISSING'};
}

function deleteLogEntry_(p){
  const user = session_(p.token);
  const orderId = String(p.orderId || '').trim();
  const uploadId = String(p.uploadId || '').trim();
  let driveFileId = String(p.driveFileId || '').trim();
  const queueJobId = String(p.queueJobId || p.jobId || '').trim();
  const targetTimestampStr = String(p.timestamp || '').trim();
  const targetType = String(p.recordingType || '').trim();
  const targetPlatform = String(p.platform || '').trim();
  const targetFileName = String(p.fileName || '').trim();
  const deleteAllForOrder = p.deleteAllForOrder === true;
  const deleteFromDrive = p.deleteFromDrive !== false;
  const deleteFromSheets = p.deleteFromSheets !== false;

  if (!orderId && !uploadId && !driveFileId && !queueJobId && !targetFileName) {
    throw new Error('Order ID, Upload ID, Drive File ID, or Queue Job ID is required to remove log entries.');
  }

  return withScriptLock_(function() {
    let orderLogsRemoved = 0;
    let uploadLogsRemoved = 0;
    let downloadLogsRemoved = 0;
    const discoveredDriveIds = [];

    if (driveFileId && driveFileId.length > 5) {
      discoveredDriveIds.push(driveFileId);
    }

    // Has specific unique pointer to ONE log entry?
    const hasSpecificId = Boolean((driveFileId && driveFileId.length > 5) || (uploadId && uploadId.length > 5) || (queueJobId && queueJobId.length > 5) || (targetFileName && targetFileName.length > 5));

    try {
      if (deleteFromSheets) {
        // 1. Delete matching entry from OrderLog and ReturnLog sheets
        const logSheetsToClean = [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET];
        logSheetsToClean.forEach(function(sheetName) {
          try {
            const targetSh = sheet_(sheetName);
            if (!targetSh) return;
            const targetData = targetSh.getDataRange().getValues();
            // Headers: [Timestamp, Order ID, Platform, Packer Email, Video Drive ID, Video Playback URL, Package Weight, Status, Recording Type, Queue Job ID, Video MIME Type, Playback Status]
            for (let i = targetData.length - 1; i >= 1; i--) {
              const rowTimestamp = rowIso_(targetData[i][0]).trim();
              const rowOrderId = String(targetData[i][1] || '').trim();
              const rowPlatform = String(targetData[i][2] || '').trim();
              const rowDriveId = String(targetData[i][4] || '').trim();
              const rowPlayback = String(targetData[i][5] || '').trim();
              const rowType = String(targetData[i][8] || '').trim();
              const rowJobId = String(targetData[i][9] || '').trim();

              let match = false;
              if (hasSpecificId) {
                // Strict specific match: only match the exact Drive ID, Upload ID, or Queue Job ID
                if (driveFileId && rowDriveId && rowDriveId === driveFileId) match = true;
                else if (driveFileId && rowPlayback && rowPlayback.indexOf(driveFileId) !== -1) match = true;
                else if (uploadId && rowJobId && rowJobId === uploadId) match = true;
                else if (queueJobId && rowJobId && rowJobId === queueJobId) match = true;
              } else {
                // Fallback: match by order ID + platform + recordingType + timestamp
                if (orderId && rowOrderId && normalizeOrderId_(rowOrderId) === normalizeOrderId_(orderId)) {
                  let passFilter = true;
                  if (targetType && rowType && normalize_(targetType) !== normalize_(rowType)) passFilter = false;
                  if (targetPlatform && rowPlatform && normalize_(targetPlatform) !== normalize_(rowPlatform)) passFilter = false;
                  
                  if (passFilter && targetTimestampStr && rowTimestamp) {
                    const diffMs = Math.abs(new Date(rowTimestamp).getTime() - new Date(targetTimestampStr).getTime());
                    if (!isNaN(diffMs)) {
                      passFilter = diffMs <= 3000;
                    } else {
                      passFilter = rowTimestamp === targetTimestampStr || rowTimestamp.includes(targetTimestampStr.substring(0, 16));
                    }
                  }
                  if (passFilter) match = true;
                }
              }

              if (match) {
                if (rowDriveId && rowDriveId.length > 5 && !discoveredDriveIds.includes(rowDriveId)) {
                  discoveredDriveIds.push(rowDriveId);
                }
                targetSh.deleteRow(i + 1);
                orderLogsRemoved++;
                if (!deleteAllForOrder) {
                  break;
                }
              }
            }
          } catch(e) {
            console.warn('Note deleting from ' + sheetName + ':', e);
          }
        });

        // 2. Delete matching entry from UploadLog sheet
        try {
          const uploadSh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
          const uploadData = uploadSh.getDataRange().getValues();
          // Headers: [Timestamp, Order ID, Platform, Packer Email, File Name, File Size, Upload ID, Stage, Progress, Drive File ID, Status, Error, Recording Type, Source, Queue Job ID]
          for (let i = uploadData.length - 1; i >= 1; i--) {
            const rowTimestamp = rowIso_(uploadData[i][0]).trim();
            const rowOrderId = String(uploadData[i][1] || '').trim();
            const rowPlatform = String(uploadData[i][2] || '').trim();
            const rowFileName = String(uploadData[i][4] || '').trim();
            const rowUploadId = String(uploadData[i][6] || '').trim();
            const rowDriveId = String(uploadData[i][9] || '').trim();
            const rowType = String(uploadData[i][12] || '').trim();
            const rowJobId = String(uploadData[i][14] || '').trim();

            let match = false;
            if (hasSpecificId) {
              // Strict specific match: only match the exact Drive ID, Upload ID, Queue Job ID, or File Name
              if (driveFileId && rowDriveId && rowDriveId === driveFileId) match = true;
              else if (uploadId && rowUploadId && rowUploadId === uploadId) match = true;
              else if (uploadId && rowJobId && rowJobId === uploadId) match = true;
              else if (queueJobId && rowJobId && rowJobId === queueJobId) match = true;
              else if (queueJobId && rowUploadId && rowUploadId === queueJobId) match = true;
              else if (targetFileName && rowFileName && rowFileName === targetFileName) match = true;
            } else {
              // Fallback: match by order ID + platform + recordingType + timestamp
              if (orderId && rowOrderId && normalizeOrderId_(rowOrderId) === normalizeOrderId_(orderId)) {
                let passFilter = true;
                if (targetType && rowType && normalize_(targetType) !== normalize_(rowType)) passFilter = false;
                if (targetPlatform && rowPlatform && normalize_(targetPlatform) !== normalize_(rowPlatform)) passFilter = false;
                
                if (passFilter && targetTimestampStr && rowTimestamp) {
                  const diffMs = Math.abs(new Date(rowTimestamp).getTime() - new Date(targetTimestampStr).getTime());
                  if (!isNaN(diffMs)) {
                    passFilter = diffMs <= 3000;
                  } else {
                    passFilter = rowTimestamp === targetTimestampStr || rowTimestamp.includes(targetTimestampStr.substring(0, 16));
                  }
                }
                if (passFilter) match = true;
              }
            }

            if (match) {
              if (rowDriveId && rowDriveId.length > 5 && !discoveredDriveIds.includes(rowDriveId)) {
                discoveredDriveIds.push(rowDriveId);
              }
              uploadSh.deleteRow(i + 1);
              uploadLogsRemoved++;
              if (!deleteAllForOrder) {
                break;
              }
            }
          }
        } catch(e) {
          console.warn('Note deleting from UploadLog:', e);
        }

        // 3. Delete matching entry from DownloadLog sheet
        if (orderId) {
          try {
            const dlSh = sheet_(CONFIG.DOWNLOAD_LOG_SHEET);
            const dlData = dlSh.getDataRange().getValues();
            for (let i = dlData.length - 1; i >= 1; i--) {
              const rowOrderId = String(dlData[i][1] || '').trim();
              const rowTimestamp = rowIso_(dlData[i][0]).trim();
              let match = false;
              if (rowOrderId && normalizeOrderId_(rowOrderId) === normalizeOrderId_(orderId)) {
                if (targetTimestampStr && rowTimestamp) {
                  const diffMs = Math.abs(new Date(rowTimestamp).getTime() - new Date(targetTimestampStr).getTime());
                  if (!isNaN(diffMs) && diffMs <= 3000) match = true;
                } else if (!targetTimestampStr) {
                  match = true;
                }
              }
              if (match) {
                dlSh.deleteRow(i + 1);
                downloadLogsRemoved++;
                if (!deleteAllForOrder) break;
              }
            }
          } catch(e) {}
        }

        // 4. Force immediate flush to ensure Google Sheets commits deletions permanently
        SpreadsheetApp.flush();
      }

      // 5. Move video files in Google Drive into "Trash" folder inside the same date series folder (never permanently delete or system trash)
      let driveTrashedCount = 0;
      if (deleteFromDrive && discoveredDriveIds.length > 0) {
        discoveredDriveIds.forEach(function(dId) {
          if (dId && dId.length > 5) {
            try {
              const file = DriveApp.getFileById(dId);
              const parents = file.getParents();
              const pFolder = parents.hasNext() ? parents.next() : null;
              if (pFolder) {
                const trIt = pFolder.getFoldersByName('Trash');
                const trFolder = trIt.hasNext() ? trIt.next() : pFolder.createFolder('Trash');
                try {
                  file.moveTo(trFolder);
                } catch(_) {
                  trFolder.addFile(file);
                  pFolder.removeFile(file);
                }
              } else {
                const root = parentFolder_(p.driveFolderId);
                const trFolder = getOrCreateFolder_(root, 'Trash');
                file.moveTo(trFolder);
              }
              driveTrashedCount++;
            } catch(e) {
              console.warn('Could not move drive file ' + dId + ' to Trash folder:', e);
            }
          }
        });
      }

      // 6. Clean up active upload session properties & duplicate reservation locks
      if (uploadId) {
        try {
          PropertiesService.getScriptProperties().deleteProperty('UPLOAD_' + uploadId);
        } catch(_) {}
      }
      if (orderId) {
        try {
          ['Amazon', 'D2C', 'JioMart', 'Custom'].forEach(function(pf) {
            ['Forward', 'Return'].forEach(function(tp) {
              const k = reservationKey_(orderId, pf, tp);
              releaseReservation_(k);
            });
          });
        } catch(_) {}
      }

      // 7. Log security event for audit tracking
      try {
        logAppend_(sheet_(CONFIG.SECURITY_LOG_SHEET), [
          new Date(),
          user.email,
          'DELETE_LOG_ENTRY',
          'SUCCESS',
          `Removed logs for Order: ${orderId || 'N/A'}, UploadId: ${uploadId || 'N/A'}, DriveIds: [${discoveredDriveIds.join(', ')}]. Removed ${orderLogsRemoved} OrderLog rows, ${uploadLogsRemoved} UploadLog rows, moved ${driveTrashedCount} Drive files to Trash folder.`
        ]);
        SpreadsheetApp.flush();
      } catch(e){}

      return {
        success: true,
        message: (deleteFromSheets
          ? `Entry removed from Google Sheet logs (${orderLogsRemoved} OrderLog, ${uploadLogsRemoved} UploadLog rows deleted).`
          : 'Logs retained in Google Sheets.') +
          (driveTrashedCount > 0 ? ` ${driveTrashedCount} video file(s) safely moved to date-series "Trash" folder.` : ''),
        orderLogsRemoved: orderLogsRemoved,
        uploadLogsRemoved: uploadLogsRemoved,
        downloadLogsRemoved: downloadLogsRemoved,
        driveTrashedCount: driveTrashedCount,
        driveTrashed: driveTrashedCount > 0
      };
    } catch(err) {
      return { success: false, error: err.message || String(err) };
    }
  }, 12000);
}

/**
 * Scans ALL Google Sheets tabs (OrderLog, ReturnLog, UploadLog, DownloadLog, and any custom tabs)
 * as well as Google Drive for duplicate order recordings.
 * Groups by normalized Order ID + Recording Type (Forward vs Return are distinct).
 * Guarantees that every tab retains its 1 unique keeper record, and only surplus duplicates are cleaned.
 */
// "17.98 MB", "1.4 KB", "512 bytes" or a plain byte count -> bytes; -1 when unknown.
function parseSizeBytes_(v) {
  if (typeof v === 'number') return v > 0 ? v : -1;
  const m = String(v || '').trim().match(/^([\d.]+)\s*(bytes?|b|kb|mb|gb)?$/i);
  if (!m) return -1;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'b').toLowerCase();
  const mult = unit === 'kb' ? 1024 : unit === 'mb' ? 1048576 : unit === 'gb' ? 1073741824 : 1;
  return Math.round(n * mult);
}

function isTinyVideo_(bytes) {
  return bytes >= 0 && bytes < 64 * 1024;
}

/**
 * The old "Remove Duplicate Videos & Sheet Entries" finder is retired (26-Nov-26). It grouped every
 * tab that has an Order ID column, so two downloads of the same video in DownloadLog (or repeat
 * rows in OrderManifest / PackVerificationLog) were reported and removed as "duplicates".
 * Settings > Data & Cleanup (scanSheetCleanup / runSheetCleanup) is the one duplicate tool: it
 * only compares rows of the same order and type inside OrderLog, ReturnLog and UploadLog,
 * archives every removed row first, and never trashes a video that a kept row uses.
 */
const RETIRED_DUPLICATE_FINDER_ = 'This duplicate finder was replaced. Use Settings > Data & Cleanup > "Remove duplicate and unusable rows".';
function scanDuplicateRecords_(p) {
  session_(p.token);
  return { success: false, retired: true, error: RETIRED_DUPLICATE_FINDER_ };
}
function removeDuplicateRecords_(p) {
  session_(p.token);
  return { success: false, retired: true, error: RETIRED_DUPLICATE_FINDER_ };
}

/* ---------- Reports & Analytics ---------- */
function inRange_(value,from,to){
  const d = rowDate_(value);
  if(isNaN(d)) return false;
  return d >= from && d <= to;
}

function dateOnly_(d){
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function parseDateStart_(s){
  return new Date(String(s||'')+'T00:00:00');
}

function parseDateEnd_(s){
  return new Date(String(s||'')+'T23:59:59');
}

function getReportData_(p){
  const user=session_(p.token), isAdmin=isAdminRole_(user.role), email=normalize_(user.email);
  const from=parseDateStart_(p.fromDate), to=parseDateEnd_(p.toDate), today=dateOnly_(new Date());
  if(isNaN(from)||isNaN(to))throw new Error('Invalid report dates.');
  if(from>to)throw new Error('From Date cannot be after To Date.');
  const span=Math.floor((to-from)/86400000)+1;
  if(span>3650)throw new Error('Report range cannot exceed 10 years.');
  if(String(p.toDate||'')>today)throw new Error('Future dates are not allowed.');
  const platform=normalize_(p.platform), type=normalize_(p.recordingType), packer=normalize_(p.packer), status=normalize_(p.status);
  const video=String(p.video||'');
  const rows=[];
  const seenKeys={};
  // Box dimensions & weights: added as columns when the feature is on or any order has them.
  let boxByOrder = {};
  try { boxByOrder = packageDetailsByOrder_(); } catch (_) { boxByOrder = {}; }
  let boxOn = Object.keys(boxByOrder).length > 0;
  try { boxOn = boxOn || boxSettings_().enabled; } catch (_) {}
  // Return details (type, logistics partner, condition, customer): added when any return has them.
  let retByOrder = {};
  try { retByOrder = returnDetailsByOrder_(); } catch (_) { retByOrder = {}; }
  const retOn = Object.keys(retByOrder).length > 0;


  const sheetsToScan = [
    { name: CONFIG.ORDER_LOG_SHEET, defaultType: 'Forward', source: 'Order' },
    { name: CONFIG.RETURN_LOG_SHEET, defaultType: 'Return', source: 'Return' }
  ];

  sheetsToScan.forEach(target => {
    try {
      const sh = ss_().getSheetByName(target.name);
      if (!sh) return;
      const v = sh.getDataRange().getValues();
      for (let i = 1; i < v.length; i++) {
        const ts = rowDate_(v[i][0]);
        if (isNaN(ts) || !inRange_(ts, from, to)) continue;
        const oid = String(v[i][1] || '').trim();
        const pf = String(v[i][2] || '').trim();
        const pe = String(v[i][3] || '').trim();
        const fid = String(v[i][4] || '').trim();
        const pUrl = String(v[i][5] || '').trim();
        const st = String(v[i][7] || 'Completed').trim();
        const rawRt = String(v[i][8] || target.defaultType).trim();
        const rtNorm = normalize_(rawRt);
        const rt = (rtNorm === 'return' || rtNorm === 'inbound') ? 'Return' : 'Forward';

        if (!isAdmin && normalize_(pe) !== email) continue;
        if (platform && normalize_(pf) !== platform) continue;
        if (type && normalize_(rt) !== type) continue;
        if (packer && !(normalize_(pe).includes(packer))) continue;
        if (status && normalize_(st) !== status) continue;

        const available = !!fid && fid.length > 5 && fid !== 'undefined' && fid !== 'null';
        if (video === 'yes' && !available) continue;
        if (video === 'no' && available) continue;

        const recKey = fid && fid.length > 5 ? ('fid_' + fid) : ('ord_' + normalizeOrderId_(oid) + '_' + normalize_(pf) + '_' + rtNorm);
        if (seenKeys[recKey]) continue;
        seenKeys[recKey] = true;

        const reportRow = {
          'Timestamp': ts.toISOString(),
          'Source': target.source,
          'Order ID': oid,
          'Platform': pf,
          'Recording Type': rt,
          'User Email': pe,
          'Status': st,
          'Drive File ID': fid,
          'Video Playback URL': pUrl || (fid ? 'https://drive.google.com/file/d/' + fid + '/preview' : '')
        };
        if (boxOn) {
          const bx = boxByOrder[normalizeOrderId_(oid) + '|' + rt.toLowerCase()] || {};
          const cell = function(x) { return x === undefined || x === null ? '' : x; };
          reportRow['Box'] = cell(bx.box);
          reportRow['Length (cm)'] = cell(bx.l);
          reportRow['Breadth (cm)'] = cell(bx.b);
          reportRow['Height (cm)'] = cell(bx.h);
          reportRow['Actual Weight (kg)'] = cell(bx.actual);
          reportRow['Volumetric Weight (kg)'] = cell(bx.volumetric);
          reportRow['Chargeable Weight (kg)'] = cell(bx.chargeable);
        }
        if (retOn) {
          const rd = rt === 'Return' ? (retByOrder[normalizeOrderId_(oid)] || {}) : {};
          reportRow['Return Type'] = rd.returnType || '';
          reportRow['Logistics Partner'] = rd.partner || '';
          reportRow['Return Condition'] = rd.condition || '';
          reportRow['Return Notes'] = rd.notes || '';
          reportRow['Not Received Claim'] = rd.key ? (rd.claim ? 'Yes' : 'No') : '';
          reportRow['Pincode'] = rd.pincode || '';
          reportRow['Customer Name'] = rd.name || '';
          reportRow['Customer Phone'] = rd.phone || '';
          reportRow['Customer Email'] = rd.email || '';
        }
        rows.push(reportRow);
      }
    } catch(err) {
      console.warn('Report scan error for ' + target.name + ':', err);
    }
  });

  return {success: true, fromDate: p.fromDate, toDate: p.toDate, rows};
}

/**
 * Analytics answers are cached for 2 minutes per user scope and filter, and dropped as soon as a
 * new video is logged, so repeat views (switching presets, reopening the tab, several admins)
 * answer at once instead of re-reading every log sheet.
 */
const ANALYTICS_CACHE_SECONDS_ = 120;
function analyticsVersion_() {
  try { return CacheService.getScriptCache().get('ANALYTICS_VER') || '0'; } catch (_) { return '0'; }
}
function bumpAnalyticsVersion_() {
  try { CacheService.getScriptCache().put('ANALYTICS_VER', String(Date.now()), 21600); } catch (_) {}
}
function getAnalyticsData_(p){
  const user = session_(p.token);
  const scope = isAdminRole_(user.role) ? 'admin' : normalize_(user.email);
  const keySrc = [scope, p.fromDate, p.toDate, normalize_(p.platform), normalize_(p.recordingType), normalize_(p.packer), normalize_(p.status), analyticsVersion_()].join('|');
  const key = 'ANALYTICS_' + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, keySrc).map(function(b){ return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  const cache = CacheService.getScriptCache();
  try {
    const hit = cache.get(key);
    if (hit) {
      const out = JSON.parse(hit);
      out.cached = true;
      return out;
    }
  } catch (_) {}
  const fresh = getAnalyticsDataUncached_(p, user);
  try {
    const text = JSON.stringify(fresh);
    if (text.length < 95000) cache.put(key, text, ANALYTICS_CACHE_SECONDS_);
  } catch (_) {}
  return fresh;
}

function getAnalyticsDataUncached_(p, sessionUser){
  const user=sessionUser||session_(p.token), isAdmin=isAdminRole_(user.role), email=normalize_(user.email);
  const from=parseDateStart_(p.fromDate), to=parseDateEnd_(p.toDate), today=dateOnly_(new Date());
  if(isNaN(from)||isNaN(to))throw new Error('Invalid analytics dates.');
  if(from>to)throw new Error('From Date cannot be after To Date.');
  const span=Math.floor((to-from)/86400000)+1;
  if(span>3650)throw new Error('Analytics range cannot exceed 10 years.');
  if(String(p.toDate||'')>today)throw new Error('Future dates are not allowed.');

  const platform=normalize_(p.platform), type=normalize_(p.recordingType), packer=normalize_(p.packer), status=normalize_(p.status);
  const rows=[];
  const seenKeys = {};
  const seenFids = {};
  const seenOpKeys = {};
  let duplicateScanCount = 0;

  const sheetsToScan = [
    { name: CONFIG.ORDER_LOG_SHEET, defaultType: 'Forward' },
    { name: CONFIG.RETURN_LOG_SHEET, defaultType: 'Return' }
  ];

  sheetsToScan.forEach(target => {
    try {
      const sh = ss_().getSheetByName(target.name);
      if (!sh) return;
      const v = sh.getDataRange().getValues();
      for (let i = 1; i < v.length; i++) {
        const ts = rowDate_(v[i][0]);
        if (isNaN(ts) || !inRange_(ts, from, to)) continue;
        const oid = String(v[i][1] || '').trim();
        const pf = String(v[i][2] || '').trim();
        const pe = String(v[i][3] || '').trim();
        const fid = String(v[i][4] || '').trim();
        const st = String(v[i][7] || 'Completed').trim();
        const rawRt = String(v[i][8] || target.defaultType).trim();
        const rtNorm = normalize_(rawRt);
        const rt = (rtNorm === 'return' || rtNorm === 'inbound') ? 'Return' : 'Forward';

        if (!oid && !fid) continue;
        if (!isAdmin && normalize_(pe) !== email) continue;
        if (platform && normalize_(pf) !== platform) continue;
        if (type && normalize_(rt) !== type) continue;
        if (packer && !normalize_(pe).includes(packer)) continue;
        if (status && normalize_(st) !== status) continue;

        const opKey = normalizeOrderId_(oid) + '_' + normalize_(pf) + '_' + rtNorm;
        if (seenOpKeys[opKey]) {
          duplicateScanCount++;
        }
        seenOpKeys[opKey] = (seenOpKeys[opKey] || 0) + 1;

        const recKey = fid && fid.length > 5 ? ('fid_' + fid) : ('ord_' + opKey);
        if (seenKeys[recKey]) continue;
        seenKeys[recKey] = true;
        if (fid) seenFids[fid] = true;

        rows.push({
          date: dateOnly_(ts),
          timestamp: ts.toISOString(),
          timeMs: ts.getTime(),
          platform: pf || 'Unknown',
          type: rt,
          user: pe || 'Unknown',
          status: st || 'Completed',
          orderId: oid,
          fileId: fid
        });
      }
    } catch(err) {
      console.warn('Analytics scan error for ' + target.name + ':', err);
    }
  });

  // Also check UPLOAD_LOG_SHEET for completed records not logged in the specific sheets
  try {
    const uploadSh = ss_().getSheetByName(CONFIG.UPLOAD_LOG_SHEET);
    if (uploadSh) {
      const uv = uploadSh.getDataRange().getValues();
      for (let i = 1; i < uv.length; i++) {
        const ts = rowDate_(uv[i][0]);
        if (isNaN(ts) || !inRange_(ts, from, to)) continue;
        const oid = String(uv[i][1] || '').trim();
        const pf = String(uv[i][2] || '').trim();
        const pe = String(uv[i][3] || '').trim();
        const fid = String(uv[i][9] || '').trim();
        const st = String(uv[i][10] || '').trim();
        const rawRt = String(uv[i][12] || 'Forward').trim();
        const rtNorm = normalize_(rawRt);
        const rt = (rtNorm === 'return' || rtNorm === 'inbound') ? 'Return' : 'Forward';

        if (st !== 'Completed') continue;
        if (!oid && !fid) continue;

        if (fid && seenFids[fid]) continue;
        const opKey = normalizeOrderId_(oid) + '_' + normalize_(pf) + '_' + rtNorm;
        if (seenOpKeys[opKey]) continue;

        if (!isAdmin && normalize_(pe) !== email) continue;
        if (platform && normalize_(pf) !== platform) continue;
        if (type && normalize_(rt) !== type) continue;
        if (packer && !normalize_(pe).includes(packer)) continue;
        if (status && normalize_(st) !== status) continue;

        const recKey = fid && fid.length > 5 ? ('fid_' + fid) : ('ord_' + opKey);
        if (seenKeys[recKey]) continue;
        seenKeys[recKey] = true;
        seenOpKeys[opKey] = 1;
        if (fid) seenFids[fid] = true;

        rows.push({
          date: dateOnly_(ts),
          timestamp: ts.toISOString(),
          timeMs: ts.getTime(),
          platform: pf || 'Unknown',
          type: rt,
          user: pe || 'Unknown',
          status: st || 'Completed',
          orderId: oid,
          fileId: fid
        });
      }
    }
  } catch(err) {
    console.warn('UploadLog scan error in Analytics:', err);
  }

  const countBy = (key) => {
    const m = {};
    rows.forEach(r => { const k = r[key] || 'Unknown'; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).sort((a, b) => m[b] - m[a]).map(k => ({ label: k, count: m[k] }));
  };

  const dailyMap = {};
  rows.forEach(r => {
    if (!dailyMap[r.date]) {
      dailyMap[r.date] = {
        date: r.date,
        total: 0,
        platforms: {},
        types: {},
        users: {},
        firstTimeMs: r.timeMs,
        lastTimeMs: r.timeMs,
        firstTimestamp: r.timestamp,
        lastTimestamp: r.timestamp,
        lastOrderId: r.orderId,
        lastPlatform: r.platform,
        lastPacker: r.user
      };
    }
    const d = dailyMap[r.date];
    d.total++;
    d.platforms[r.platform] = (d.platforms[r.platform] || 0) + 1;
    d.types[r.type] = (d.types[r.type] || 0) + 1;
    d.users[r.user] = (d.users[r.user] || 0) + 1;
    if (r.timeMs && (!d.firstTimeMs || r.timeMs < d.firstTimeMs)) {
      d.firstTimeMs = r.timeMs;
      d.firstTimestamp = r.timestamp;
    }
    if (r.timeMs && (!d.lastTimeMs || r.timeMs > d.lastTimeMs)) {
      d.lastTimeMs = r.timeMs;
      d.lastTimestamp = r.timestamp;
      d.lastOrderId = r.orderId;
      d.lastPlatform = r.platform;
      d.lastPacker = r.user;
    }
  });

  const dates = [];
  const curDate = new Date(from.getTime());
  while (curDate <= to) {
    dates.push(dateOnly_(curDate));
    curDate.setDate(curDate.getDate() + 1);
  }

  const daily = dates.map(date => {
    const d = dailyMap[date] || { date, total: 0, platforms: {}, types: {}, users: {} };
    const fCount = (d.types && (d.types['Forward'] || d.types['forward'] || d.types['Outbound'])) || 0;
    const rCount = (d.types && (d.types['Return'] || d.types['return'] || d.types['Inbound'])) || 0;

    let firstRecordTime = '';
    let lastRecordTime = '';
    let operatingMinutes = 0;
    if (d.firstTimeMs && d.lastTimeMs) {
      firstRecordTime = Utilities.formatDate(new Date(d.firstTimeMs), Session.getScriptTimeZone(), 'hh:mm a');
      lastRecordTime = Utilities.formatDate(new Date(d.lastTimeMs), Session.getScriptTimeZone(), 'hh:mm a');
      operatingMinutes = Math.max(0, Math.round((d.lastTimeMs - d.firstTimeMs) / 60000));
    }

    return {
      date,
      total: d.total || 0,
      platforms: d.platforms || {},
      types: { Forward: fCount, Return: rCount },
      users: d.users || {},
      firstRecordTime: firstRecordTime,
      lastRecordTime: lastRecordTime,
      firstTimestamp: d.firstTimestamp || '',
      lastTimestamp: d.lastTimestamp || '',
      operatingMinutes: operatingMinutes,
      lastOrderId: d.lastOrderId || '',
      lastPlatform: d.lastPlatform || '',
      lastPacker: d.lastPacker || ''
    };
  });

  const forwardCount = rows.filter(r => r.type === 'Forward').length;
  const returnCount = rows.filter(r => r.type === 'Return').length;
  const uniqueOrderSet = new Set();
  rows.forEach(r => { if (r.orderId) uniqueOrderSet.add(r.orderId); });

  const typesCount = [
    { label: 'Forward', count: forwardCount },
    { label: 'Return', count: returnCount }
  ];

  const todayStr = dateOnly_(new Date());
  const todayEntry = dailyMap[todayStr];
  let latestRecordingTimeToday = '';
  if (todayEntry && todayEntry.lastTimeMs) {
    latestRecordingTimeToday = Utilities.formatDate(new Date(todayEntry.lastTimeMs), Session.getScriptTimeZone(), 'hh:mm a');
  }

  return {
    success: true,
    fromDate: p.fromDate,
    toDate: p.toDate,
    total: rows.length,
    forwardCount: forwardCount,
    returnCount: returnCount,
    uniqueOrders: uniqueOrderSet.size,
    duplicateScans: duplicateScanCount,
    platforms: countBy('platform'),
    types: typesCount,
    users: countBy('user'),
    statuses: countBy('status'),
    daily,
    latestRecordingTimeToday: latestRecordingTimeToday
  };
}

function cleanupOldStartedUploads_(order, currentUploadId) {
  try {
    const uploadSh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
    const uploadData = uploadSh.getDataRange().getValues();
    for (let i = uploadData.length - 1; i >= 1; i--) {
      const rOrder = String(uploadData[i][1] || '').trim();
      const rUploadId = String(uploadData[i][6] || '').trim();
      const rStatus = normalize_(String(uploadData[i][10] || ''));
      if (normalize_(rOrder) === normalize_(order) && rUploadId !== currentUploadId && (rStatus === 'started' || rStatus === 'pending' || rStatus === 'in progress' || rStatus === 'failed' || rStatus.indexOf('fail') !== -1 || rStatus.indexOf('interrupt') !== -1 || rStatus.indexOf('stale') !== -1 || rStatus.indexOf('expired') !== -1)) {
        uploadSh.deleteRow(i + 1);
      }
    }
  } catch(_) {}
}

/* Admin-set maximum video size in MB for every station (Branding sheet MaxVideoSizeMb). 0 = no limit. */
var DEFAULT_MAX_VIDEO_MB_ = 1024;
function maxVideoSizeMb_() {
  try {
    var data = sheet_(CONFIG.BRANDING_SHEET).getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').trim() === 'MaxVideoSizeMb') {
        var v = String(data[i][1]).trim();
        if (v === '') break;
        var n = Number(v);
        return isNaN(n) || n < 0 ? DEFAULT_MAX_VIDEO_MB_ : Math.floor(n);
      }
    }
  } catch (_) {}
  return DEFAULT_MAX_VIDEO_MB_;
}

function getBrandingConfig_() {
  const props = scriptProps_();
  let appName = 'VMS 3.0';
  let appSubtitle = 'Order Packing System';
  let logoUrl = '';
  let faviconUrl = '';
  let brandingFolderId = '';
  let videoDriveFolderId = '';

  try {
    const sh = sheet_(CONFIG.BRANDING_SHEET);
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const key = String(data[i][0] || '').trim();
      const val = String(data[i][1] || '').trim();
      if (key === 'AppName' && val) appName = val;
      if (key === 'AppSubtitle' && val) appSubtitle = val;
      if (key === 'LogoUrl' && val) logoUrl = val;
      if (key === 'FaviconUrl' && val) faviconUrl = val;
      if (key === 'BrandingFolderId' && val) brandingFolderId = val;
      if ((key === 'VideoDriveFolderId' || key === 'DriveFolderId') && val) {
        const urlMatch = val.match(/folders\/([a-zA-Z0-9_-]+)/);
        videoDriveFolderId = urlMatch ? urlMatch[1] : val;
      }
    }
  } catch (e) {
    // Fall back to script properties
    appName = props.getProperty('VMS_BRANDING_NAME') || 'VMS 3.0';
    appSubtitle = props.getProperty('VMS_BRANDING_SUBTITLE') || 'Order Packing System';
    logoUrl = props.getProperty('VMS_BRANDING_LOGO') || '';
    faviconUrl = props.getProperty('VMS_BRANDING_FAVICON') || '';
    brandingFolderId = props.getProperty('VMS_BRANDING_FOLDER_ID') || '';
  }

  if (!videoDriveFolderId) {
    videoDriveFolderId = props.getProperty('PARENT_FOLDER_ID') || CONFIG.HARDWIRED_PARENT_FOLDER_ID || '';
  }

  return {
    success: true,
    appName: appName,
    appSubtitle: appSubtitle,
    logoUrl: logoUrl,
    faviconUrl: faviconUrl,
    brandingFolderId: brandingFolderId,
    videoDriveFolderId: videoDriveFolderId,
    maxVideoSizeMb: maxVideoSizeMb_(),
    supabaseEnabled: sbPublicConfig_().supabaseEnabled,
    supabaseUrl: sbPublicConfig_().supabaseUrl,
    supabaseAnonKey: sbPublicConfig_().supabaseAnonKey
  };
}

function saveBrandingConfig_(p) {
  const props = scriptProps_();
  let sh = null;
  try {
    sh = sheet_(CONFIG.BRANDING_SHEET);
  } catch(e) {
    setupSystem();
    sh = sheet_(CONFIG.BRANDING_SHEET);
  }

  const now = new Date();
  let data = sh.getDataRange().getValues();

  function updateOrInsert(key, value, desc) {
    // Re-read: earlier steps (e.g. videoRootFolderId_) may have added rows.
    data = sh.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').trim() === key) {
        sh.getRange(i + 1, 2).setValue(value);
        sh.getRange(i + 1, 3).setValue(now);
        found = true;
      }
    }
    if (!found) {
      logAppend_(sh, [key, value, now, desc || '']);
    }
  }

  if (p.appName !== undefined) {
    const val = String(p.appName || 'VMS 3.0').trim();
    props.setProperty('VMS_BRANDING_NAME', val);
    updateOrInsert('AppName', val, 'Application Display Name');
  }
  if (p.appSubtitle !== undefined) {
    const val = String(p.appSubtitle || 'Order Packing System').trim();
    props.setProperty('VMS_BRANDING_SUBTITLE', val);
    updateOrInsert('AppSubtitle', val, 'Workstation Subtitle');
  }
  if (p.logoUrl !== undefined) {
    const val = String(p.logoUrl || '').trim();
    props.setProperty('VMS_BRANDING_LOGO', val);
    updateOrInsert('LogoUrl', val, 'Logo Image URL or Drive Direct Link');
  }
  if (p.faviconUrl !== undefined) {
    const val = String(p.faviconUrl || '').trim();
    props.setProperty('VMS_BRANDING_FAVICON', val);
    updateOrInsert('FaviconUrl', val, 'Browser Favicon URL or Drive Direct Link');
  }
  if (p.brandingFolderId !== undefined) {
    const val = String(p.brandingFolderId || '').trim();
    props.setProperty('VMS_BRANDING_FOLDER_ID', val);
    updateOrInsert('BrandingFolderId', val, 'Google Drive Folder for Brand Assets');
  }
  let folderInfo = null;
  if (p.videoDriveFolderId !== undefined || p.driveFolderId !== undefined) {
    const cleanFolderId = cleanFolderId_(p.videoDriveFolderId || p.driveFolderId);
    if (cleanFolderId && cleanFolderId !== videoRootFolderId_()) {
      // Only switch every station to a folder this account can actually write to.
      folderInfo = checkDriveFolder_({ folder: cleanFolderId });
      if (!folderInfo.success) return folderInfo;
    }
    CacheService.getScriptCache().remove(VIDEO_ROOT_CACHE_KEY);
    props.setProperty('PARENT_FOLDER_ID', cleanFolderId);
    updateOrInsert('VideoDriveFolderId', cleanFolderId, VIDEO_FOLDER_SETTING_HELP_);
  }

  if (p.maxVideoSizeMb !== undefined && p.maxVideoSizeMb !== null && p.maxVideoSizeMb !== '') {
    const mb = Number(p.maxVideoSizeMb);
    if (isNaN(mb) || mb < 0 || (mb > 0 && mb < 50) || mb > 20480) {
      return { success: false, error: 'Max video size must be 0 (no limit) or between 50 MB and 20480 MB (20 GB).' };
    }
    updateOrInsert('MaxVideoSizeMb', Math.floor(mb), 'Largest video (MB) any station may upload; 0 = no limit');
  }

  return {
    success: true,
    maxVideoSizeMb: maxVideoSizeMb_(),
    message: 'Settings saved to Google Sheet "Branding" tab and Script Properties permanently.',
    appName: p.appName,
    appSubtitle: p.appSubtitle,
    logoUrl: p.logoUrl,
    faviconUrl: p.faviconUrl,
    videoDriveFolderId: p.videoDriveFolderId || p.driveFolderId,
    folder: folderInfo
  };
}

function uploadBrandingImage_(p) {
  const type = String(p.type || 'logo').toLowerCase(); // 'logo' or 'favicon'
  const fileName = String(p.fileName || (type === 'logo' ? 'vms_logo.png' : 'vms_favicon.ico')).trim();
  const mimeType = String(p.mimeType || (type === 'favicon' ? 'image/x-icon' : 'image/png')).trim();
  const base64Data = String(p.base64 || '').replace(/^data:[^;]+;base64,/, '');

  if (!base64Data) {
    throw new Error('No image payload data provided for branding upload.');
  }

  const bytes = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(bytes, mimeType, fileName);

  // Get or create dedicated VMS_Branding folder inside the Drive parent folder
  const parent = parentFolder_();
  let brandingFolder;
  const it = parent.getFoldersByName(CONFIG.BRANDING_FOLDER_NAME || 'VMS_Branding');
  if (it.hasNext()) {
    brandingFolder = it.next();
  } else {
    brandingFolder = parent.createFolder(CONFIG.BRANDING_FOLDER_NAME || 'VMS_Branding');
  }

  const ext = fileName.indexOf('.') !== -1 ? fileName.split('.').pop() : (type === 'favicon' ? 'ico' : 'png');
  const storedName = (type === 'logo' ? 'VMS_Logo_' : 'VMS_Favicon_') + new Date().getTime() + '.' + ext;
  blob.setName(storedName);

  const file = brandingFolder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(e) {
    console.warn('Set sharing notice: ', e);
  }

  const fileId = file.getId();
  const directUrl = 'https://drive.google.com/uc?export=view&id=' + fileId;

  // Permanently save to Google Sheet cell
  const updatePayload = {
    brandingFolderId: brandingFolder.getId()
  };
  if (type === 'logo') {
    updatePayload.logoUrl = directUrl;
  } else {
    updatePayload.faviconUrl = directUrl;
  }
  saveBrandingConfig_(updatePayload);

  return {
    success: true,
    type: type,
    fileId: fileId,
    folderId: brandingFolder.getId(),
    folderName: brandingFolder.getName(),
    url: directUrl,
    message: 'Branding image uploaded to Google Drive folder "' + brandingFolder.getName() + '" and cell updated in Google Sheet.'
  };
}

/**
 * Resolves exact Google Drive file size on-demand and writes it back to Google Sheets.
 */
// ---------------------------------------------------------------------------
// Live station queues: every packing station reports its own upload queue (videos waiting,
// uploading, failed, with progress and the last error) every few seconds, so the admin sees
// real-time status from all packers instead of only what has reached the sheet. Kept in the
// script cache (fast, no sheet writes, no Properties quota); a station that stops reporting for
// more than 45 s is shown as offline, and is dropped after 6 hours.
// ---------------------------------------------------------------------------
const STATION_INDEX_KEY_ = 'STATIONQ_INDEX';
const STATION_TTL_S_ = 21600;
const STATION_MAX_ITEMS_ = 60; // script cache values are limited to 100 KB; counts carry the exact totals

function cleanQueueItem_(it) {
  const str = function(v, n) { return String(v == null ? '' : v).slice(0, n || 200); };
  return {
    id: str(it.id, 80),
    orderId: str(it.orderId, 80),
    platform: str(it.platform, 40),
    recordingType: str(it.recordingType, 20),
    fileName: str(it.fileName, 160),
    fileSize: Number(it.fileSize) || 0,
    status: str(it.status, 20),
    progress: Math.max(0, Math.min(100, Number(it.progress) || 0)),
    stage: str(it.stage, 200),
    error: str(it.error, 300),
    createdAt: Number(it.createdAt) || 0,
    uploadId: str(it.uploadId, 80),
    fileId: str(it.fileId, 80)
  };
}

/** What the user is doing right now (page, order on screen, last action): short text only. */
function cleanActivity_(a) {
  if (!a || typeof a !== 'object') return null;
  const str = function(v, n) { return String(v == null ? '' : v).slice(0, n); };
  const state = str(a.state, 20);
  return {
    page: str(a.page, 40), orderId: str(a.orderId, 80),
    state: ['scanning', 'recording', 'packing'].indexOf(state) !== -1 ? state : '',
    lastAction: str(a.lastAction, 160), lastActionAt: Number(a.lastActionAt) || 0
  };
}

/**
 * Admins: every approved user's work in a date range (default today): orders assigned, recordings,
 * uploads and packed orders, their last logged action, and their backlog whatever the range (orders still
 * assigned and Pending, uploads that never finished), each with its date so the page can show age.
 * p.from / p.to: yyyy-MM-dd, inclusive.
 */
function getTeamActivity_(p) {
  admin_(p.token);
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const isDay = function(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); };
  let from = isDay(p.from) ? String(p.from) : today;
  let to = isDay(p.to) ? String(p.to) : (isDay(p.from) ? String(p.from) : today);
  if (from > to) { const x = from; from = to; to = x; }
  const dayOf = function(d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  const asDate = function(v) { const d = rowDate_(v); return d instanceof Date && !isNaN(d.getTime()) ? d : null; };
  const inRange = function(d) { const k = dayOf(d); return k >= from && k <= to; };
  const BACKLOG_DAYS = 30;
  const backlogSince = now.getTime() - BACKLOG_DAYS * 86400000;
  const users = {};
  const userRows = ss_().getSheetByName(CONFIG.USERS_SHEET || 'Users');
  if (userRows) {
    userRows.getDataRange().getValues().slice(1).forEach(function(r) {
      const email = normalize_(r[2]);
      if (!email || String(r[5] || '').toLowerCase() !== 'approved') return;
      users[email] = { email: String(r[2]).trim(), name: String(r[1] || '').trim() || String(r[2]).trim(), role: String(r[4] || 'User'),
        today: { assigned: 0, recorded: 0, returns: 0, uploaded: 0, uploadFailed: 0, packed: 0 }, lastAction: '', lastActionAt: 0,
        pendingOrders: [], openUploads: [] };
    });
  }
  const touch = function(email, at, text) {
    const u = users[normalize_(email)];
    if (!u || !at) return null;
    const t = at.getTime();
    if (t > u.lastActionAt) { u.lastActionAt = t; u.lastAction = text; }
    return u;
  };
  // Today only needs the newest rows; an older range reads the whole log.
  const MAX_ROWS = from >= dayOf(new Date(now.getTime() - 2 * 86400000)) ? 6000 : 0;
  const scan = function(name, fn, maxRows) {
    const sh = ss_().getSheetByName(name);
    if (!sh) return;
    const last = sh.getLastRow();
    if (last < 2) return;
    const start = maxRows ? Math.max(2, last - maxRows + 1) : 2;
    const width = Math.max(1, sh.getLastColumn());
    sh.getRange(start, 1, last - start + 1, width).getValues().forEach(fn);
  };
  const recordedOrders = {};
  [['OrderLog', 'recorded'], ['ReturnLog', 'returns']].forEach(function(t) {
    scan(t[0], function(r) {
      const at = asDate(r[0]);
      if (!at) return;
      if (r[4]) recordedOrders[normalize_(r[1])] = true;
      const u = touch(r[3], at, 'Recorded ' + (t[1] === 'returns' ? 'return ' : '') + String(r[1] || ''));
      if (u && inRange(at)) u.today[t[1]]++;
    }, MAX_ROWS);
  });
  // UploadLog: counts in the range, and uploads whose newest row never reached Completed.
  const latestUpload = {};
  scan('UploadLog', function(r) {
    const at = asDate(r[0]);
    if (!at) return;
    const st = String(r[10] || '').toLowerCase();
    const u = touch(r[3], at, (st === 'completed' ? 'Uploaded ' : st === 'failed' ? 'Upload failed ' : 'Uploading ') + String(r[1] || ''));
    if (u && inRange(at)) {
      if (st === 'completed') u.today.uploaded++;
      else if (st === 'failed') u.today.uploadFailed++;
    }
    if (at.getTime() >= backlogSince && r[1]) {
      const key = normalize_(r[3]) + '|' + normalize_(r[1]) + '|' + normalize_(r[12]);
      const prev = latestUpload[key];
      if (!prev || at.getTime() >= prev.at) latestUpload[key] = { at: at.getTime(), email: normalize_(r[3]), orderId: String(r[1]), status: String(r[10] || 'Pending'), type: String(r[12] || ''), error: String(r[11] || '').slice(0, 120) };
    }
  }, MAX_ROWS ? Math.max(MAX_ROWS, 20000) : 0);
  Object.keys(latestUpload).forEach(function(k) {
    const x = latestUpload[k];
    if (/^completed$/i.test(x.status) || recordedOrders[normalize_(x.orderId)]) return;
    const u = users[x.email];
    if (u) u.openUploads.push({ orderId: x.orderId, status: x.status, type: x.type, error: x.error, at: x.at });
  });
  scan('PackVerificationLog', function(r) {
    const at = asDate(r[0]);
    if (!at) return;
    const st = String(r[7] || '').toUpperCase();
    const u = touch(r[5], at, (st === 'MATCHED' ? 'Packed ' : 'Pack check ' + st.toLowerCase() + ' ') + String(r[1] || ''));
    if (u && st === 'MATCHED' && inRange(at)) u.today.packed++;
  }, MAX_ROWS);
  scan('SecurityLog', function(r) {
    const at = asDate(r[0]);
    if (!at) return;
    if (String(r[2] || '').toUpperCase() === 'LOGIN' && String(r[3] || '').toUpperCase() === 'SUCCESS') touch(r[1], at, 'Signed in');
  }, MAX_ROWS);
  // Orders assigned to each packer in the range (column A is when the order was assigned in
  // Order Processing; cancelled orders are left out), and orders still Pending, whatever their date.
  scan('OrderManifest', function(r) {
    if (!r[1]) return;
    const u = users[normalize_(r[4])];
    if (!u) return;
    const st = String(r[9] || '').trim().toLowerCase();
    const at = asDate(r[0]);
    if (at && inRange(at) && st !== 'cancelled') u.today.assigned++;
    if (st === 'pending') u.pendingOrders.push({ orderId: String(r[1]), platform: String(r[2] || ''), at: at ? at.getTime() : 0 });
  }, 0);
  const list = Object.keys(users).map(function(k) {
    const u = users[k];
    u.pendingOrders.sort(function(a, b) { return a.at - b.at; });
    u.openUploads.sort(function(a, b) { return a.at - b.at; });
    u.pendingOrderCount = u.pendingOrders.length;
    u.openUploadCount = u.openUploads.length;
    u.pendingOrders = u.pendingOrders.slice(0, 500);
    u.openUploads = u.openUploads.slice(0, 200);
    return u;
  }).sort(function(a, b) { return String(a.name).localeCompare(String(b.name)); });
  return { success: true, date: today, from: from, to: to, users: list, serverTime: now.getTime() };
}

/** The station's own totals (whole queue), so admins see the same numbers as the packer. */
function cleanQueueCounts_(c) {
  if (!c || typeof c !== 'object') return null;
  const out = {};
  ['waiting', 'uploading', 'failed', 'duplicate', 'completed', 'total'].forEach(function(k) {
    const n = Math.floor(Number(c[k]) || 0);
    out[k] = n > 0 ? Math.min(n, 100000) : 0;
  });
  return out;
}

function reportStationQueue_(p) {
  const user = session_(p.token);
  const email = normalize_(user.email);
  const items = (Array.isArray(p.items) ? p.items : []).slice(0, STATION_MAX_ITEMS_).map(cleanQueueItem_);
  const now = Date.now();
  const rec = {
    email: user.email,
    name: user.name || user.email,
    station: String(p.station || '').slice(0, 60),
    recording: p.recording === true,
    online: p.online !== false,
    worker: String(p.worker || '').slice(0, 200),
    items: items,
    counts: cleanQueueCounts_(p.counts),
    activity: cleanActivity_(p.activity),
    reportedAt: now
  };
  const cache = CacheService.getScriptCache();
  cache.put('STATIONQ_' + email, JSON.stringify(rec), STATION_TTL_S_);
  // Index of stations (who has reported). Only written when this station is new or every 5 min.
  let index = {};
  try { index = JSON.parse(cache.get(STATION_INDEX_KEY_) || '{}') || {}; } catch (_) { index = {}; }
  if (!index[email] || now - Number(index[email]) > 300000) {
    withScriptLock_(function() {
      let fresh = {};
      try { fresh = JSON.parse(cache.get(STATION_INDEX_KEY_) || '{}') || {}; } catch (_) { fresh = {}; }
      fresh[email] = now;
      Object.keys(fresh).forEach(function(k) { if (now - Number(fresh[k]) > STATION_TTL_S_ * 1000) delete fresh[k]; });
      cache.put(STATION_INDEX_KEY_, JSON.stringify(fresh), STATION_TTL_S_);
    }, 5000);
  }
  return { success: true, reportedAt: now };
}

function getStationQueues_(p) {
  const cache = CacheService.getScriptCache();
  let index = {};
  try { index = JSON.parse(cache.get(STATION_INDEX_KEY_) || '{}') || {}; } catch (_) { index = {}; }
  const keys = Object.keys(index).map(function(e) { return 'STATIONQ_' + e; });
  const got = keys.length ? (cache.getAll ? cache.getAll(keys) : keys.reduce(function(m, k) { m[k] = cache.get(k); return m; }, {})) : {};
  const now = Date.now();
  const stations = [];
  keys.forEach(function(k) {
    if (!got[k]) return;
    try {
      const rec = JSON.parse(got[k]);
      rec.ageMs = now - Number(rec.reportedAt || 0);
      rec.live = rec.ageMs < 45000;
      stations.push(rec);
    } catch (_) {}
  });
  stations.sort(function(a, b) { return String(a.email).localeCompare(String(b.email)); });
  const totals = { uploading: 0, pending: 0, failed: 0, completed: 0 };
  stations.forEach(function(st) {
    (st.items || []).forEach(function(it) {
      if (totals[it.status] !== undefined) totals[it.status]++;
      else if (it.status === 'paused') totals.failed++;
    });
  });
  return { success: true, stations: stations, totals: totals, serverTime: now };
}

// ---------------------------------------------------------------------------
// Drive storage status for the admin panel: the Google account's quota, and how much of it the
// VMS videos take (summed from the OrderLog / ReturnLog sizes, so it is instant even with
// thousands of videos). Cached for 10 minutes; { refresh: true } recomputes.
const DRIVE_STORAGE_CACHE_KEY_ = 'VMS_DRIVE_STORAGE_V1';

function getDriveStorage_(p) {
  const cache = CacheService.getScriptCache();
  if (!(p && p.refresh)) {
    const hit = cache.get(DRIVE_STORAGE_CACHE_KEY_);
    if (hit) {
      try { const r = JSON.parse(hit); r.cached = true; return r; } catch (_) {}
    }
  }
  let used = -1, limit = -1, quotaError = '';
  try { used = Number(DriveApp.getStorageUsed()); } catch (e) { quotaError = String(e && e.message || e); }
  try { limit = Number(DriveApp.getStorageLimit()); } catch (e) { quotaError = quotaError || String(e && e.message || e); }
  // Some Workspace plans report 0 or an absurd number for pooled / unlimited storage.
  const unlimited = !(limit > 0) || limit >= Math.pow(2, 53) / 2;

  const now = new Date();
  const monthKey = now.getFullYear() + '-' + now.getMonth();
  const weekAgo = now.getTime() - 7 * 86400000;
  const videos = { count: 0, bytes: 0, monthBytes: 0, monthCount: 0, last7Bytes: 0, unknownSize: 0 };
  const byPlatform = {};
  [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET].forEach(function(name) {
    let sh = null;
    try { sh = ss_().getSheetByName(name); } catch (_) {}
    if (!sh) return;
    const v = sh.getDataRange().getValues();
    if (v.length < 2) return;
    const h = v[0].map(function(x) { return String(x || '').trim().toLowerCase(); });
    // Standard OrderLog/ReturnLog layout (E = Video Drive ID, G = size, C = platform) if headers differ.
    let idCol = h.findIndex(function(x) { return /video drive id|drive file id|file id/.test(x); });
    let sizeCol = h.findIndex(function(x) { return /file\s*size|^size$|package\s*weight/.test(x); });
    let platCol = h.indexOf('platform');
    if (idCol < 0) idCol = 4;
    if (sizeCol < 0) sizeCol = 6;
    if (platCol < 0) platCol = 2;
    for (let i = 1; i < v.length; i++) {
      const fid = idCol >= 0 ? String(v[i][idCol] || '').trim() : '';
      if (!fid) continue;
      const bytes = sizeCol >= 0 ? parseSizeBytes_(v[i][sizeCol]) : -1;
      videos.count++;
      if (bytes < 0) { videos.unknownSize++; continue; }
      videos.bytes += bytes;
      const d = rowDate_(v[i][0]);
      if (!isNaN(d.getTime())) {
        if ((d.getFullYear() + '-' + d.getMonth()) === monthKey) { videos.monthBytes += bytes; videos.monthCount++; }
        if (d.getTime() >= weekAgo) videos.last7Bytes += bytes;
      }
      const plat = platCol >= 0 ? (String(v[i][platCol] || '').trim() || 'Other') : 'Other';
      byPlatform[plat] = (byPlatform[plat] || 0) + bytes;
    }
  });

  const perDay = videos.last7Bytes / 7;
  const free = (!unlimited && used >= 0) ? Math.max(0, limit - used) : -1;
  let folder = { id: '', name: '', url: '' };
  try {
    const id = videoRootFolderId_();
    folder.id = id;
    folder.url = 'https://drive.google.com/drive/folders/' + id;
    try { folder.name = DriveApp.getFolderById(id).getName(); } catch (_) {}
  } catch (_) {}

  const out = {
    success: true,
    account: { used: used, limit: unlimited ? -1 : limit, free: free, unlimited: unlimited,
               percent: (!unlimited && used >= 0) ? Math.round(used / limit * 1000) / 10 : -1, error: quotaError },
    videos: videos,
    byPlatform: Object.keys(byPlatform).map(function(k) { return { platform: k, bytes: byPlatform[k] }; })
      .sort(function(a, b) { return b.bytes - a.bytes; }),
    perDayBytes: Math.round(perDay),
    daysLeft: (free >= 0 && perDay > 0) ? Math.floor(free / perDay) : -1,
    folder: folder,
    checkedAt: now.toISOString(),
    cached: false
  };
  try { cache.put(DRIVE_STORAGE_CACHE_KEY_, JSON.stringify(out), 600); } catch (_) {}
  return out;
}

// ---------------------------------------------------------------------------
// Full-quality playback: the panel's player downloads the ORIGINAL uploaded file in chunks
// (Drive's /preview player re-encodes to a lower resolution and is often "still processing").
// Only files that appear in the order / return / upload logs can be read this way.
// ---------------------------------------------------------------------------
const VIDEO_CHUNK_MAX_ = 8 * 1024 * 1024;

function isLoggedVideo_(fid) {
  const cache = CacheService.getScriptCache();
  const key = 'vmsvid_' + fid;
  if (cache.get(key)) return true;
  const names = [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET, CONFIG.UPLOAD_LOG_SHEET];
  for (let i = 0; i < names.length; i++) {
    const sh = ss_().getSheetByName(names[i]);
    if (!sh) continue;
    let found = false;
    if (typeof sh.createTextFinder === 'function') {
      found = !!sh.createTextFinder(fid).matchCase(true).findNext();
    } else {
      const rows = sh.getDataRange().getValues();
      found = rows.some(function(r) { return r.some(function(c) { return String(c).indexOf(fid) !== -1; }); });
    }
    if (found) {
      cache.put(key, '1', 21600);
      return true;
    }
  }
  return false;
}

/**
 * Readable message for a failed Drive REST call. A 403 that says the Drive API is disabled means
 * the Apps Script project is linked to a Google Cloud project where the Drive API is not enabled.
 */
function driveErrorText_(code, resp, what) {
  let reason = '';
  try {
    const body = JSON.parse(resp.getContentText() || '{}');
    reason = (body.error && body.error.message) || '';
  } catch (_) {}
  if (code === 403 && /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(reason)) {
    return 'The Google Drive API is turned off in the Google Cloud project this backend uses. Enable "Google Drive API" in Google Cloud Console (APIs & Services > Library) for that project, wait a minute, then try again.';
  }
  return 'Google Drive returned ' + code + ' while ' + what + (reason ? ': ' + reason : '.');
}

function getVideoChunk_(p) {
  session_(p.token);
  const fid = String(p.fileId || p.driveFileId || '').trim();
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fid)) throw new Error('Valid video file ID is required.');
  if (!isLoggedVideo_(fid)) {
    return { success: false, code: 'NOT_A_VMS_VIDEO', error: 'This file is not a recorded packing video.' };
  }
  const start = Math.max(0, Math.floor(Number(p.start) || 0));
  const want = Math.min(VIDEO_CHUNK_MAX_, Math.max(1, Math.floor(Number(p.length) || VIDEO_CHUNK_MAX_)));
  // One ranged read from Drive per call. The size and type come from Drive's reply headers, so
  // no extra DriveApp lookups slow every chunk down.
  const resp = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fid) + '?alt=media&supportsAllDrives=true', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + start + '-' + (start + want - 1) },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code === 416) {
    return { success: true, fileId: fid, size: start, start: start, length: 0, data: '' };
  }
  if (code !== 206 && code !== 200) throw new Error(driveErrorText_(code, resp, 'reading the video'));
  const headers = resp.getHeaders() || {};
  const header = function(name) {
    const k = Object.keys(headers).filter(function(h) { return h.toLowerCase() === name; })[0];
    return k ? String(headers[k]) : '';
  };
  let bytes = resp.getContent();
  let size = 0;
  const range = header('content-range').match(/\/(\d+)\s*$/);
  if (range) size = Number(range[1]);
  if (code === 200) {
    size = bytes.length; // server ignored Range and sent the whole file
    bytes = bytes.slice(start, Math.min(size, start + want));
  }
  if (!size) size = Number(DriveApp.getFileById(fid).getSize()) || start + bytes.length;
  const meta = { success: true, fileId: fid, size: size, start: start, mimeType: header('content-type').split(';')[0] || 'video/mp4' };
  meta.length = bytes.length;
  meta.data = Utilities.base64Encode(bytes);
  return meta;
}

function getDriveFileSize_(p) {
  session_(p.token);
  const fid = String(p.driveFileId || p.fileId || '').trim();
  if (!fid) throw new Error('Valid Google Drive file ID is required.');

  try {
    const file = DriveApp.getFileById(fid);
    const bytes = file.getSize();
    const name = file.getName();
    const orderId = String(p.orderId || '').trim();

    if (bytes > 0 && orderId) {
      try {
        const orderSheets = [sheet_(CONFIG.ORDER_LOG_SHEET), sheet_(CONFIG.RETURN_LOG_SHEET), sheet_(CONFIG.UPLOAD_LOG_SHEET)];
        orderSheets.forEach(function(sh) {
          if (!sh) return;
          const data = sh.getDataRange().getValues();
          for (let i = data.length - 1; i >= 1; i--) {
            const rowOid = String(data[i][1] || '').trim();
            const rowFid = String(data[i][4] || data[i][9] || '').trim();
            if (rowOid === orderId || (rowFid && rowFid === fid)) {
              if (sh.getName() === CONFIG.UPLOAD_LOG_SHEET) {
                sh.getRange(i + 1, 6).setValue(bytes);
              } else {
                sh.getRange(i + 1, 7).setValue(bytes);
              }
              sbTouch_(sh, i + 1);
            }
          }
        });
      } catch(sheetUpdateErr) {
        console.warn('Auto update sheet file size note:', sheetUpdateErr);
      }
    }

    return {
      success: true,
      fileId: fid,
      fileSize: bytes,
      fileName: name
    };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// ==========================================
// VMS 3.0 ORDER MANIFEST & GTIN SYNC ENGINE
// ==========================================

function formatDateDDMMMYYYY_(dateVal) {
  if (!dateVal) return '';
  var d = rowDate_(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var day = ('0' + d.getDate()).slice(-2);
  var month = months[d.getMonth()];
  var year = d.getFullYear();
  return day + '-' + month + '-' + year;
}

function formatDateTimeDDMMMYYYY_(dateVal) {
  if (!dateVal) return '';
  var d = rowDate_(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var day = ('0' + d.getDate()).slice(-2);
  var month = months[d.getMonth()];
  var year = d.getFullYear();
  var hours = ('0' + d.getHours()).slice(-2);
  var mins = ('0' + d.getMinutes()).slice(-2);
  var secs = ('0' + d.getSeconds()).slice(-2);
  return day + '-' + month + '-' + year + ' ' + hours + ':' + mins + ':' + secs;
}

function formatItemsList_(items) {
  if (!Array.isArray(items)) return '';
  var list = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var name = it.shortName || it.productName || it.sku || it.gtin || 'Item';
    var sku = it.sku ? '[' + it.sku + ']' : '';
    var qty = it.quantity || 1;
    list.push(name + (sku ? ' ' + sku : '') + ' x ' + qty);
  }
  return list.join('; ');
}

function getManifestSheet_() {
  return sheet_(CONFIG.ORDER_MANIFEST_SHEET);
}

function getVerificationLogSheet_() {
  return sheet_(CONFIG.PACK_VERIFICATION_LOG_SHEET);
}

function getGtinCatalogSheet_() {
  return sheet_(CONFIG.GTIN_CATALOG_SHEET);
}

function saveOrderManifest_(p) {
  var manifest = p.manifest || {};
  if (!manifest.orderId) {
    return { success: false, error: 'Order ID is required' };
  }
  var sh = getManifestSheet_();
  var orderId = canonicalOrderId_(manifest.orderId, manifest.platform).toUpperCase();
  if (!orderId) return { success: false, error: 'Order ID is required' };
  var orderKey = normalizeOrderId_(orderId);
  var data = sh.getDataRange().getValues();
  var targetRow = -1;

  // "OD-10063", "#OD-10063" and "# OD-10063" are the same order: update that row, never add a second one.
  for (var i = 1; i < data.length; i++) {
    if (normalizeOrderId_(data[i][1]) === orderKey) {
      targetRow = i + 1;
      break;
    }
  }

  var nowStr = manifest.processedAt ? formatDateTimeDDMMMYYYY_(manifest.processedAt) : formatDateTimeDDMMMYYYY_(new Date());
  var itemsStr = formatItemsList_(manifest.items || []);
  var totalItems = 0;
  if (Array.isArray(manifest.items)) {
    for (var k = 0; k < manifest.items.length; k++) {
      totalItems += Number(manifest.items[k].quantity || 1);
    }
  }

  var packedAtStr = manifest.packedAt ? formatDateTimeDDMMMYYYY_(manifest.packedAt) : '';

  var rowValues = [
    nowStr,
    orderId,
    manifest.platform || 'Amazon',
    manifest.assignedPackerName || '',
    manifest.assignedPackerEmail || '',
    manifest.processedByName || '',
    manifest.processedByEmail || '',
    totalItems,
    itemsStr,
    manifest.status || 'Pending',
    manifest.notes || '',
    packedAtStr,
    manifest.packedByName || '',
    manifest.videoDriveUrl || ''
  ];

  if (targetRow > 0) {
    sh.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
    formatDateRows_(sh, targetRow, 1);
    if (Array.isArray(manifest.items) && manifest.items.length) clearRepeatManifestItems_(sh, data, orderKey, targetRow);
  } else {
    logAppend_(sh, rowValues);
  }

  return { success: true, orderId: orderId, updated: targetRow > 0 };
}

function saveOrderManifestsBatch_(p) {
  var manifests = p.manifests || [];
  if (!Array.isArray(manifests) || manifests.length === 0) {
    return { success: false, error: 'Manifests array is required' };
  }
  var count = 0;
  for (var i = 0; i < manifests.length; i++) {
    if (manifests[i] && manifests[i].orderId) {
      saveOrderManifest_({ manifest: manifests[i] });
      count++;
    }
  }
  return { success: true, count: count };
}

function parseItemsList_(text) {
  var str = String(text || '').trim();
  if (!str) return [];
  if (str.indexOf('[') === 0 || str.indexOf('{') === 0) {
    try {
      var parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  // Items are written "Name [SKU] x 1; Name 2 [SKU2] x 1". Rows typed or pasted into the Sheet by
  // hand may put each product on its own line, or separate them with "|" or ",".
  var parts = str.split(/\s*(?:;|\r?\n|\|)\s*/);
  if (parts.length === 1 && str.indexOf(',') > 0) {
    var byComma = str.split(/\s*,\s*/);
    var allLookLikeItems = byComma.length > 1 && byComma.every(function(x) { return /\s+x\s*\d+$/i.test(x); });
    if (allLookLikeItems) parts = byComma;
  }
  var items = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (!p) continue;
    var match = p.match(/^(.*?)(?:\s+\[(.*?)\])?\s+x\s*(\d+)$/i);
    if (match) {
      items.push({
        id: 'item-' + (i + 1),
        productName: match[1].trim(),
        shortName: match[1].trim(),
        sku: match[2] ? match[2].trim() : '',
        gtin: '',
        quantity: Number(match[3]) || 1
      });
    } else {
      items.push({
        id: 'item-' + (i + 1),
        productName: p,
        shortName: p,
        sku: '',
        gtin: '',
        quantity: 1
      });
    }
  }
  return items;
}

/** Same product in a manifest: same SKU, else same GTIN, else same name. */
function manifestItemKey_(it) {
  it = it || {};
  var sku = String(it.sku || '').trim().toLowerCase();
  if (sku) return 's:' + sku;
  var gtin = String(it.gtin || '').trim().toLowerCase();
  if (gtin) return 'g:' + gtin;
  return 'n:' + String(it.productName || it.shortName || '').trim().toLowerCase();
}

/**
 * Product list of one order kept in two rows: every product from both rows. A product listed in
 * both rows is the same line written twice, so it is kept once with the larger quantity.
 */
function mergeManifestItems_(a, b) {
  var out = [];
  var at = {};
  [a || [], b || []].forEach(function(list) {
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it) continue;
      var key = manifestItemKey_(it);
      if (at[key] === undefined) {
        at[key] = out.length;
        var copy = {};
        for (var f in it) copy[f] = it[f];
        copy.id = 'item-' + (out.length + 1);
        out.push(copy);
      } else {
        var cur = out[at[key]];
        if (Number(it.quantity || 1) > Number(cur.quantity || 1)) cur.quantity = Number(it.quantity || 1);
      }
    }
  });
  return out;
}

/**
 * Items List / Total Items Count of the other rows of the same order are cleared after the full
 * list is saved into one row, so a product removed in the app does not come back from an old row.
 * The rows themselves stay.
 */
function clearRepeatManifestItems_(sh, data, orderKey, keepRow) {
  for (var i = 1; i < data.length; i++) {
    if (i + 1 === keepRow) continue;
    if (normalizeOrderId_(data[i][1]) !== orderKey) continue;
    if (String(data[i][8] || '').trim() === '' && String(data[i][7] || '').trim() === '') continue;
    sh.getRange(i + 1, 8, 1, 2).setValues([['', '']]);
  }
}

function safeIsoDate_(val) {
  if (!val) return '';
  try {
    var d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toISOString();
  } catch (e) {
    return String(val);
  }
}

/* ---------- Manifest change stamp ----------
 * Every station polls the order list. Instead of re-reading the whole OrderManifest sheet each
 * time, a station sends the stamp it already has; if nothing was written since, the answer is
 * a tiny "unchanged". (Stations still do a full read every couple of minutes, which also picks
 * up rows edited by hand in the sheet.)
 */
var MANIFEST_VERSION_KEY_ = 'MANIFEST_VERSION';

function manifestVersion_() {
  var v = PropertiesService.getScriptProperties().getProperty(MANIFEST_VERSION_KEY_);
  if (!v) {
    v = String(Date.now());
    PropertiesService.getScriptProperties().setProperty(MANIFEST_VERSION_KEY_, v);
  }
  return v;
}

function bumpManifestVersion_() {
  PropertiesService.getScriptProperties().setProperty(MANIFEST_VERSION_KEY_, String(Date.now()) + '-' + Math.floor(Math.random() * 100000));
}

function manifestWrite_(res) {
  if (!res || res.success !== false) bumpManifestVersion_();
  if (res && typeof res === 'object') res.version = manifestVersion_();
  return res;
}

function getOrderManifests_(p) {
  p = p || {};
  var version = manifestVersion_();
  if (p.sinceVersion && String(p.sinceVersion) === version) {
    return { success: true, unchanged: true, version: version };
  }
  try {
    var sh = getManifestSheet_();
    var data = sh.getDataRange().getValues();
    var manifests = [];
    var byKey = {};

    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      var orderId = canonicalOrderId_(r[1], r[2]);
      if (!orderId) continue;

      var items = parseItemsList_(r[8]);

      // Older rows may hold the same order twice ("OD-10063" and "#OD-10063"). Return it once,
      // keeping the product list and the packed details from whichever row has them.
      var okey = normalizeOrderId_(orderId);
      if (byKey[okey] !== undefined) {
        var prev = manifests[byKey[okey]];
        if (!prev.items.length && items.length) { prev.items = items; prev.processedAt = safeIsoDate_(r[0]) || prev.processedAt; }
        // A row per product (typed into the Sheet, or saved twice in the past): show every product.
        else if (items.length) prev.items = mergeManifestItems_(prev.items, items);
        if (String(r[9] || '') === 'Packed') prev.status = 'Packed';
        prev.assignedPackerName = prev.assignedPackerName || r[3] || '';
        prev.assignedPackerEmail = prev.assignedPackerEmail || r[4] || '';
        prev.packedAt = prev.packedAt || safeIsoDate_(r[11]);
        prev.packedByName = prev.packedByName || r[12] || '';
        prev.videoDriveUrl = prev.videoDriveUrl || r[13] || '';
        prev.notes = prev.notes || r[10] || '';
        continue;
      }
      byKey[okey] = manifests.length;

      manifests.push({
        id: 'm-' + i,
        orderId: orderId,
        platform: r[2] || 'Amazon',
        assignedPackerName: r[3] || '',
        assignedPackerEmail: r[4] || '',
        processedByName: r[5] || '',
        processedByEmail: r[6] || '',
        processedAt: safeIsoDate_(r[0]),
        items: items,
        status: r[9] || 'Pending',
        notes: r[10] || '',
        packedAt: safeIsoDate_(r[11]),
        packedByName: r[12] || '',
        videoDriveUrl: r[13] || ''
      });
    }

    // The Sheet keeps products as "Name [SKU] x 2" without the barcode. Give each product its
    // barcode from the GTIN catalog by SKU, so every station can scan-verify it, even one that
    // has never loaded the catalog.
    var catalog = null;
    for (var m = 0; m < manifests.length; m++) {
      var list = manifests[m].items || [];
      for (var n = 0; n < list.length; n++) {
        var it = list[n];
        if (String(it.gtin || '').trim() || !String(it.sku || '').trim()) continue;
        if (!catalog) catalog = catalogBySku_();
        var hit = catalog[String(it.sku).trim().toUpperCase()];
        if (!hit) continue;
        it.gtin = hit.gtin;
        if (!it.imageUrl && hit.imageUrl) it.imageUrl = hit.imageUrl;
      }
    }

    return { success: true, manifests: manifests, version: version };
  } catch (err) {
    return { success: false, error: 'Could not parse manifests: ' + err.message, manifests: [] };
  }
}

function isEmailLike_(v) { return /^[^\s@]+@[^\s@]+$/.test(String(v || '').trim()); }
function isUploadSourceLabel_(v) { return /^(automatic recording|manual upload|uploadlog|packer)$/i.test(String(v || '').trim()); }

function updateManifestStatus_(p) {
  var orderId = String(p.orderId || '').trim().toUpperCase();
  if (!orderId) return { success: false, error: 'Order ID is required' };
  var orderKey = normalizeOrderId_(orderId);

  var sh = getManifestSheet_();
  var data = sh.getDataRange().getValues();
  var targetRow = -1;

  // Prefer the row that holds the product list when the same order was written twice in the past.
  for (var i = 1; i < data.length; i++) {
    if (normalizeOrderId_(data[i][1]) === orderKey) {
      if (targetRow < 0) targetRow = i + 1;
      if (String(data[i][8] || '').trim()) { targetRow = i + 1; break; }
    }
  }

  if (targetRow > 0) {
    if (p.status) sh.getRange(targetRow, 10).setValue(p.status);
    if (p.items) {
      sh.getRange(targetRow, 9).setValue(formatItemsList_(p.items));
      if (Array.isArray(p.items) && p.items.length) clearRepeatManifestItems_(sh, data, orderKey, targetRow);
      var totalItems = 0;
      if (Array.isArray(p.items)) {
        for (var k = 0; k < p.items.length; k++) {
          totalItems += Number(p.items[k].quantity || 1);
        }
      }
      sh.getRange(targetRow, 8).setValue(totalItems);
    }
    if (p.assignedPackerName !== undefined) sh.getRange(targetRow, 4).setValue(p.assignedPackerName);
    if (p.assignedPackerEmail !== undefined) sh.getRange(targetRow, 5).setValue(p.assignedPackerEmail);
    if (p.processedByName !== undefined) sh.getRange(targetRow, 6).setValue(p.processedByName);
    if (p.processedByEmail !== undefined) sh.getRange(targetRow, 7).setValue(p.processedByEmail);
    if (p.platform !== undefined) sh.getRange(targetRow, 3).setValue(p.platform);
    if (p.notes !== undefined) sh.getRange(targetRow, 11).setValue(p.notes);
    if (p.packerDetails) {
      // Older app versions sent the upload source ("Automatic Recording", "Manual Upload") as the
      // packer: never save a label as a name, and only a real email address as the email.
      var pdName = String(p.packerDetails.name || '').trim();
      var pdEmail = String(p.packerDetails.email || '').trim();
      if (pdName && !isUploadSourceLabel_(pdName)) sh.getRange(targetRow, 13).setValue(pdName);
      if (isEmailLike_(pdEmail)) sh.getRange(targetRow, 5).setValue(pdEmail);
      if (p.packerDetails.videoDriveUrl) sh.getRange(targetRow, 14).setValue(p.packerDetails.videoDriveUrl);
      if (p.status === 'Packed') sh.getRange(targetRow, 12).setValue(formatDateDDMMMYYYY_(new Date()));
    }
    return { success: true, orderId: orderId };
  }

  return { success: false, error: 'Order ID not found in manifest' };
}

function deleteOrderManifest_(p) {
  var orderId = String(p.orderId || '').trim().toUpperCase();
  if (!orderId) return { success: false, error: 'Order ID required' };

  var orderKey = normalizeOrderId_(orderId);
  var sh = getManifestSheet_();
  var data = sh.getDataRange().getValues();
  // Remove every copy of this order ("OD-10063" and "#OD-10063" are the same order), bottom up.
  var removed = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    if (normalizeOrderId_(data[i][1]) === orderKey) {
      sh.deleteRow(i + 1);
      removed++;
    }
  }
  if (removed) return { success: true, orderId: orderId, removed: removed };
  return { success: false, error: 'Order not found' };
}

function logPackVerification_(p) {
  var log = p.log || {};
  if (!log.orderId) return { success: false, error: 'Order ID is required' };
  log.orderId = canonicalOrderId_(log.orderId, log.platform);

  var sh = getVerificationLogSheet_();
  var now = new Date();

  var row = [
    now,
    log.orderId,
    log.platform || 'Amazon',
    log.assignedPacker || '',
    log.verifiedByPacker || '',
    log.packerEmail || '',
    log.processedBy || '',
    log.status || 'MATCHED',
    log.totalRequired || 0,
    log.totalScanned || 0,
    log.itemsSummary || '',
    JSON.stringify(log.scannedGtinsLog || []),
    log.durationSeconds || 0,
    log.videoDriveUrl || ''
  ];

  logAppend_(sh, row);
  return { success: true, orderId: log.orderId };
}

/**
 * Order -> Drive link of its packing (Forward) video. A pack check is logged before the video is
 * recorded, so its own "Drive Video URL" cell is normally empty: the link comes from OrderLog
 * (newest recording wins), then UploadLog, then the order list. Keys ignore '#' and spaces.
 */
function packVideoLinksByOrder_() {
  var links = {};
  var ss = ss_();
  var put = function(order, url, overwrite) {
    var k = normalizeOrderId_(order);
    if (!k || !url) return;
    if (overwrite || !links[k]) links[k] = url;
  };
  var fileLink = function(fid) {
    fid = String(fid || '').trim();
    return /^[a-zA-Z0-9_-]{10,}$/.test(fid) ? 'https://drive.google.com/file/d/' + fid + '/view' : '';
  };
  try {
    var ol = ss.getSheetByName(CONFIG.ORDER_LOG_SHEET);
    if (ol && ol.getLastRow() > 1) {
      var v = ol.getDataRange().getValues();
      // Headers: Timestamp, Order ID, Platform, Packer Email, Video Drive ID, Video Playback URL, ..., Recording Type (I)
      for (var i = 1; i < v.length; i++) {
        if (String(v[i][8] || 'Forward').toLowerCase() === 'return') continue;
        put(v[i][1], fileLink(v[i][4]) || String(v[i][5] || '').trim(), true);
      }
    }
  } catch (e) { console.warn('Pack video links (OrderLog):', e); }
  try {
    var ul = ss.getSheetByName(CONFIG.UPLOAD_LOG_SHEET);
    if (ul && ul.getLastRow() > 1) {
      var u = ul.getDataRange().getValues();
      // Headers: ..., Drive File ID (J), Status (K), Error, Recording Type (M)
      for (var j = 1; j < u.length; j++) {
        if (String(u[j][12] || 'Forward').toLowerCase() === 'return') continue;
        put(u[j][1], fileLink(u[j][9]), false);
      }
    }
  } catch (e) { console.warn('Pack video links (UploadLog):', e); }
  try {
    var ms = getManifestSheet_();
    if (ms && ms.getLastRow() > 1) {
      var m = ms.getDataRange().getValues();
      for (var k = 1; k < m.length; k++) put(m[k][1], String(m[k][13] || '').trim(), false);
    }
  } catch (e) { console.warn('Pack video links (OrderManifest):', e); }
  return links;
}

function getPackVerificationLogs_(p) {
  var sh = getVerificationLogSheet_();
  var data = sh.getDataRange().getValues();
  var logs = [];
  var videoLinks = packVideoLinksByOrder_();

  for (var i = data.length - 1; i >= 1; i--) {
    var r = data[i];
    if (!r[1]) continue;
    var scannedLog = [];
    try {
      if (r[11]) scannedLog = JSON.parse(r[11]);
    } catch (_) {}

    logs.push({
      timestamp: r[0] ? new Date(r[0]).toISOString() : '',
      orderId: r[1],
      platform: r[2] || '',
      assignedPacker: r[3] || '',
      verifiedByPacker: r[4] || '',
      packerEmail: r[5] || '',
      processedBy: r[6] || '',
      status: r[7] || 'MATCHED',
      totalRequired: Number(r[8] || 0),
      totalScanned: Number(r[9] || 0),
      itemsSummary: r[10] || '',
      scannedGtinsLog: scannedLog,
      durationSeconds: Number(r[12] || 0),
      videoDriveUrl: String(r[13] || '').trim() || videoLinks[normalizeOrderId_(r[1])] || ''
    });
  }

  return { success: true, logs: logs };
}

function convertDriveImageUrl_(rawUrl) {
  if (!rawUrl) return '';
  var str = String(rawUrl).trim();
  if (!str) return '';
  if (str.indexOf('data:') === 0 || str.indexOf('blob:') === 0 || str.indexOf('lh3.googleusercontent.com') !== -1) {
    return str;
  }
  var m = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
          str.match(/(?:googleusercontent\.com|drive\.google\.com)\/d\/([a-zA-Z0-9_-]+)/) ||
          str.match(/[?&](?:id|docid)=([a-zA-Z0-9_-]+)/) ||
          str.match(/\/open\?id=([a-zA-Z0-9_-]+)/);
  if (m && m[1]) {
    return 'https://lh3.googleusercontent.com/d/' + m[1];
  }
  if (/^[a-zA-Z0-9_-]{25,55}$/.test(str)) {
    return 'https://lh3.googleusercontent.com/d/' + str;
  }
  return str;
}

/* ---------- Catalog tab reader (shared by master-sheet and external-sheet sync) ---------- */
// Column detection runs in tiers: exact header names claim columns first, then whole-word
// matches, then weak guesses. A column is never used for two fields.
var CATALOG_COLUMNS_ = [
  { key: 'gtin', exact: ['gtin', 'ean', 'barcode', 'upc', 'gtin number', 'gtin no', 'ean code', 'ean number', 'barcode number', 'gtin code'], words: ['gtin', 'barcode', 'ean', 'upc'], weak: ['code'] },
  { key: 'sku', exact: ['sku', 'seller sku', 'product sku', 'sku code', 'sku id', 'item code', 'product code', 'style code', 'article code'], words: ['sku'], phrases: ['item code', 'product code', 'style code', 'article code'], weak: ['style', 'model', 'item'] },
  { key: 'tag', exact: ['tag', 'tags', 'product tag', 'product tags', 'sku tag', 'listing tag', 'tag name'], words: ['tag', 'tags'], weak: ['label', 'status'] },
  { key: 'image', exact: ['image', 'image url', 'image link', 'images', 'photo', 'product image', 'image 1', 'main image'], words: ['image', 'images', 'img', 'photo', 'picture', 'thumbnail'], weak: ['link', 'url', 'drive'] },
  { key: 'shortName', exact: ['short name', 'display name', 'nickname'], words: ['short', 'nickname'], phrases: ['display name'] },
  { key: 'name', exact: ['product name', 'name', 'title', 'item name', 'product title', 'product', 'product description', 'description'], words: ['name', 'title'], weak: ['description', 'product'] },
  { key: 'category', exact: ['category', 'product category', 'department'], words: ['category', 'department'], weak: ['type'] },
  { key: 'cogs', exact: ['cogs', 'cost', 'price', 'mrp'], words: ['cogs', 'cost', 'price', 'mrp', 'rate'] },
  { key: 'qty', exact: ['quantity', 'qty', 'default quantity', 'pack qty', 'pack size'], words: ['quantity', 'qty'] },
  { key: 'notes', exact: ['notes', 'note', 'remarks', 'remark'], words: ['note', 'notes', 'remark', 'remarks'] }
];

function normHeader_(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function detectCatalogColumns_(headerRow) {
  var heads = headerRow.map(normHeader_);
  var idx = {};
  var taken = {};
  var tiers = ['exact', 'words', 'weak'];
  for (var t = 0; t < tiers.length; t++) {
    for (var f = 0; f < CATALOG_COLUMNS_.length; f++) {
      var def = CATALOG_COLUMNS_[f];
      if (idx[def.key] !== undefined) continue;
      for (var c = 0; c < heads.length; c++) {
        if (taken[c] || !heads[c]) continue;
        var h = heads[c];
        var words = h.split(' ');
        var hit = false;
        if (tiers[t] === 'exact') {
          hit = def.exact.indexOf(h) !== -1;
        } else if (tiers[t] === 'words') {
          hit = (def.words || []).some(function(w) { return words.indexOf(w) !== -1; }) ||
                (def.phrases || []).some(function(ph) { return h.indexOf(ph) !== -1; });
        } else {
          hit = (def.weak || []).some(function(w) { return words.indexOf(w) !== -1; });
        }
        if (hit) { idx[def.key] = c; taken[c] = true; break; }
      }
    }
  }
  return idx;
}

// "Active-online", "active online" and "ACTIVE_ONLINE" are the same tag; "inactive-online" is not.
function normTag_(t) {
  return String(t || '').toLowerCase().replace(/[\s_\-.]+/g, '');
}

function splitTags_(cell) {
  return String(cell || '').split(/[,;|\n]+/).map(function(x) { return x.trim(); }).filter(Boolean);
}

function requestedCatalogTags_(p) {
  var list = [];
  if (p.tags && Array.isArray(p.tags)) list = p.tags;
  else if (p.tag && typeof p.tag === 'string') list = String(p.tag).split(',');
  return list.map(function(t) { return String(t || '').trim(); }).filter(Boolean);
}

/**
 * Some sheets have no "Tag" header: the tag column is headed with a tag value itself
 * (e.g. a column titled "Active-online" holding Active-online / Offline). Find it from
 * the data: a column whose header equals one of its own common values or a requested tag,
 * otherwise the column of short, repeated text values that contains the requested tags.
 */
function guessTagColumn_(data, headerRow, col, requestedTags) {
  var taken = {};
  Object.keys(col).forEach(function(k) { taken[col[k]] = true; });
  var wanted = {};
  requestedTags.forEach(function(t) { wanted[normTag_(t)] = true; });
  var best = -1, bestScore = 0;
  var rows = Math.min(data.length, 2001);
  for (var c = 0; c < headerRow.length; c++) {
    if (taken[c]) continue;
    var values = {}, textRows = 0, filled = 0, hits = 0;
    for (var i = 1; i < rows; i++) {
      var v = data[i][c];
      if (v === '' || v === null || v === undefined) continue;
      filled++;
      if (v instanceof Date || typeof v === 'number') continue;
      var str = String(v).trim();
      if (!str || str.length > 40 || /^https?:/i.test(str) || /^[\d.,\s-]+$/.test(str)) continue;
      textRows++;
      splitTags_(str).forEach(function(tk) {
        var k = normTag_(tk);
        values[k] = (values[k] || 0) + 1;
        if (wanted[k]) hits++;
      });
    }
    if (filled === 0 || textRows / filled < 0.6) continue;
    var distinct = Object.keys(values).length;
    var head = normTag_(headerRow[c]);
    var score = 0;
    if (head && (wanted[head] || values[head] >= Math.max(1, textRows * 0.2))) score = 3;
    else if (distinct <= Math.max(12, textRows * 0.2)) score = hits > 0 ? 2 : 1;
    if (requestedTags.length > 0 && hits === 0 && score < 3) score = 0;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best >= 0 ? best : undefined;
}

/**
 * Turns a catalog tab (first row = headers) into products, keeping only rows whose tag
 * exactly matches one of the requested tags. Also reports which column was used for each
 * field and which tags exist in the tab, so a wrong tag or header is easy to spot.
 */
function readCatalogRows_(data, requestedTags, opts) {
  opts = opts || {};
  var headerRow = data[0] || [];
  var col = detectCatalogColumns_(headerRow);
  if (col.gtin === undefined && col.sku === undefined) {
    return { error: 'Could not find a GTIN/Barcode or SKU column. Headers found: ' + headerRow.filter(String).join(', ') };
  }
  if (col.tag === undefined) {
    var guessed = guessTagColumn_(data, headerRow, col, requestedTags);
    if (guessed !== undefined) col.tag = guessed;
  }
  var tagCol = col.tag !== undefined ? col.tag : col.category;
  var wanted = {};
  requestedTags.forEach(function(t) { wanted[normTag_(t)] = true; });
  var filtering = requestedTags.length > 0;
  if (filtering && tagCol === undefined) {
    return { error: 'This tab has no Tag column, so it cannot be filtered by tag. Headers found: ' + headerRow.filter(String).join(', ') };
  }

  var cell = function(r, key) { return col[key] !== undefined ? r[col[key]] : ''; };
  var str = function(v) { return String(v === null || v === undefined ? '' : v).trim(); };
  var tagCounts = {};
  var items = [];
  var rowsWithCode = 0;

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var gtin = str(cell(r, 'gtin'));
    var sku = str(cell(r, 'sku'));
    if (!gtin && !sku) continue;
    if (!gtin) gtin = sku;
    if (!sku) sku = gtin;
    var name = str(cell(r, 'name')) || sku;
    if (isOrderRecord_(gtin, sku, name)) continue;
    rowsWithCode++;

    var rawTag = str(cell(r, 'tag'));
    var tagSource = tagCol !== undefined ? str(r[tagCol]) : '';
    // Older GTINCatalog rows kept the tag in Category (the Tag column came later).
    if (!tagSource && opts.categoryHoldsTag && col.category !== undefined) tagSource = str(r[col.category]);
    var tokens = splitTags_(tagSource);
    tokens.forEach(function(tk) {
      var k = normTag_(tk);
      if (!tagCounts[k]) tagCounts[k] = { tag: tk, count: 0 };
      tagCounts[k].count++;
    });
    if (filtering && !tokens.some(function(tk) { return wanted[normTag_(tk)]; })) continue;

    var category = str(cell(r, 'category')) || rawTag;
    items.push({
      gtin: gtin,
      sku: sku,
      productName: name,
      shortName: str(cell(r, 'shortName')) || name,
      category: category,
      tag: rawTag || (col.tag === undefined || opts.categoryHoldsTag ? tagSource : ''),
      imageUrl: col.image !== undefined ? convertDriveImageUrl_(r[col.image]) : '',
      cogs: col.cogs !== undefined ? r[col.cogs] : '',
      defaultQuantity: col.qty !== undefined ? (Number(r[col.qty]) || 1) : 1,
      notes: str(cell(r, 'notes'))
    });
  }

  var columns = {};
  Object.keys(col).forEach(function(k) { columns[k] = str(headerRow[col[k]]); });
  var tagsFound = Object.keys(tagCounts).map(function(k) { return tagCounts[k]; })
    .sort(function(a, b) { return b.count - a.count; }).slice(0, 40);

  return {
    items: items,
    columns: columns,
    tagColumn: tagCol !== undefined ? str(headerRow[tagCol]) : '',
    tagsFound: tagsFound,
    totalRows: rowsWithCode,
    appliedTags: requestedTags
  };
}

function findTab_(spreadsheet, name) {
  var target = String(name || '').trim();
  if (!target) return null;
  var exact = spreadsheet.getSheetByName(target);
  if (exact) return exact;
  var want = target.toLowerCase().replace(/\s+/g, ' ');
  var sheets = spreadsheet.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    if (sheets[s].getName().trim().toLowerCase().replace(/\s+/g, ' ') === want) return sheets[s];
  }
  return null;
}

function tabNotFound_(spreadsheet, name) {
  var names = spreadsheet.getSheets().map(function(s) { return s.getName(); });
  return { success: false, error: 'Tab "' + name + '" was not found. Tabs in this sheet: ' + names.join(', '), tabs: names };
}

function getGtinCatalog_(p) {
  p = p || {};
  var ss = ss_();
  var targetTabName = String(p.tabName || '').trim();
  var sh;
  if (targetTabName && targetTabName.toLowerCase() !== CONFIG.GTIN_CATALOG_SHEET.toLowerCase()) {
    // An explicitly named tab (e.g. "UE") must exist: never silently read a different tab.
    sh = findTab_(ss, targetTabName);
    if (!sh) return tabNotFound_(ss, targetTabName);
  } else {
    sh = getGtinCatalogSheet_();
  }

  var data = sh.getDataRange().getValues();
  if (data.length <= 1) {
    return { success: true, catalog: [], count: 0, totalRows: 0, tagsFound: [], tabName: sh.getName() };
  }
  var isInternal = sh.getName() === CONFIG.GTIN_CATALOG_SHEET;
  var res = readCatalogRows_(data, requestedCatalogTags_(p), { categoryHoldsTag: isInternal });
  if (res.error) return { success: false, error: res.error, tabName: sh.getName() };
  return {
    success: true,
    catalog: res.items,
    count: res.items.length,
    totalRows: res.totalRows,
    columns: res.columns,
    tagColumn: res.tagColumn,
    tagsFound: res.tagsFound,
    appliedTags: res.appliedTags,
    tabName: sh.getName()
  };
}

function saveGtinProduct_(p) {
  var prod = p.product || {};
  var gtin = String(prod.gtin || '').trim();
  if (!gtin) return { success: false, error: 'GTIN / Barcode is required' };

  var sh = getGtinCatalogSheet_();
  var data = sh.getDataRange().getValues();
  var targetRow = -1;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1] || '').trim().toUpperCase() === gtin.toUpperCase()) {
      targetRow = i + 1;
      break;
    }
  }

  var now = new Date();
  var rowValues = [
    now,
    gtin,
    prod.sku || '',
    prod.productName || '',
    prod.shortName || prod.productName || '',
    prod.category || 'General',
    prod.imageUrl || '',
    prod.defaultQuantity || 1,
    prod.notes || ''
  ];

  if (targetRow > 1) {
    sh.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
    formatDateRows_(sh, targetRow, 1);
  } else {
    logAppend_(sh, rowValues);
  }

  return { success: true, gtin: gtin, product: prod };
}

function deleteGtinProduct_(p) {
  var gtin = String(p.gtin || '').trim().toUpperCase();
  if (!gtin) return { success: false, error: 'GTIN is required' };

  var sh = getGtinCatalogSheet_();
  var data = sh.getDataRange().getValues();
  var deleted = false;

  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][1] || '').trim().toUpperCase() === gtin) {
      sh.deleteRow(i + 1);
      deleted = true;
      break;
    }
  }

  return { success: true, deleted: deleted, gtin: gtin };
}

function isOrderRecord_(gtin, sku, productName) {
  var g = String(gtin || '').trim();
  var s = String(sku || '').trim().toUpperCase();
  var n = String(productName || '').trim().toUpperCase();
  if (g.indexOf('#OD-') === 0 || g.indexOf('#') === 0 || /^\d{3}-\d{7}-\d{7}$/.test(g)) return true;
  if (s === 'AMAZON' || s === 'D2C' || s === 'JIOMART' || s === 'CUSTOM') return true;
  if (n === 'AMAZON' || n === 'D2C' || n === 'JIOMART' || n === 'CUSTOM') return true;
  return false;
}

function deleteGtinProductsBatch_(p) {
  var gtins = p.gtins || [];
  if (!Array.isArray(gtins) || gtins.length === 0) {
    return { success: false, error: 'GTINs array is required' };
  }

  var set = {};
  for (var k = 0; k < gtins.length; k++) {
    var g = String(gtins[k] || '').trim().toUpperCase();
    if (g) set[g] = true;
  }

  var sh = getGtinCatalogSheet_();
  var data = sh.getDataRange().getValues();
  if (data.length <= 1) return { success: true, count: 0 };

  var newValues = [data[0]]; // keep header
  var deletedCount = 0;

  for (var i = 1; i < data.length; i++) {
    var rowGtin = String(data[i][1] || '').trim().toUpperCase();
    var rowSku = String(data[i][2] || '').trim().toUpperCase();
    var rowName = String(data[i][3] || '').trim().toUpperCase();

    if ((rowGtin && set[rowGtin]) || isOrderRecord_(rowGtin, rowSku, rowName)) {
      deletedCount++;
    } else {
      newValues.push(data[i]);
    }
  }

  sh.clearContents();
  if (newValues.length > 0 && newValues[0].length > 0) {
    sh.getRange(1, 1, newValues.length, newValues[0].length).setValues(newValues);
  }

  return { success: true, count: deletedCount };
}

function saveGtinCatalogBatch_(p) {
  var products = p.products || [];
  if (!Array.isArray(products) || products.length === 0) {
    return { success: false, error: 'Products array is required' };
  }

  var sh = getGtinCatalogSheet_();
  ensureGtinCatalogHeaders_(sh);
  var data = sh.getDataRange().getValues();
  // Column J holds the product tag so a tag-filtered sync of this tab stays exact.
  if (data.length > 0 && !String(data[0][9] || '').trim()) {
    sh.getRange(1, 10).setValue('Tag');
  }
  var existingMap = {};
  for (var i = 1; i < data.length; i++) {
    var g = String(data[i][1] || '').trim();
    if (g) existingMap[g] = i;
  }

  var now = new Date();
  var batchAdded = 0;
  var updates = {};
  var appended = [];
  var appendedMap = {};
  for (var j = 0; j < products.length; j++) {
    var prod = products[j];
    var gtin = String(prod.gtin || '').trim();
    if (!gtin || isOrderRecord_(gtin, prod.sku, prod.productName)) continue;

    var rowValues = [
      now,
      gtin,
      prod.sku || '',
      prod.productName || '',
      prod.shortName || prod.productName || '',
      prod.category || '',
      prod.imageUrl || '',
      prod.defaultQuantity || 1,
      prod.notes || '',
      prod.tag || ''
    ];

    if (existingMap[gtin] !== undefined) {
      updates[existingMap[gtin]] = rowValues;
    } else if (appendedMap[gtin] !== undefined) {
      appended[appendedMap[gtin]] = rowValues;
    } else {
      appendedMap[gtin] = appended.length;
      appended.push(rowValues);
    }
    batchAdded++;
  }

  // Write changed rows in contiguous blocks and new rows in one call (row-by-row writes
  // time out on catalogs with hundreds of products).
  var rows = Object.keys(updates).map(Number).sort(function(x, y) { return x - y; });
  var k = 0;
  while (k < rows.length) {
    var start = rows[k];
    var block = [updates[start]];
    while (k + 1 < rows.length && rows[k + 1] === rows[k] + 1) { k++; block.push(updates[rows[k]]); }
    sh.getRange(start + 1, 1, block.length, 10).setValues(block);
    formatDateRows_(sh, start + 1, block.length);
    k++;
  }
  if (appended.length > 0) {
    var firstNew = Math.max(sh.getLastRow(), 1) + 1;
    sh.getRange(firstNew, 1, appended.length, 10).setValues(appended);
    formatDateRows_(sh, firstNew, appended.length);
  }

  return { success: true, count: batchAdded };
}

/**
 * Reads from a user's separate external Google Sheet containing GTIN barcodes!
 * Automatically discovers columns: GTIN, SKU, Product Name, Short Name, Image URL.
 */
function syncExternalGtinSheet_(p) {
  var sheetInput = String(p.gtinSheetId || '').trim();
  if (!sheetInput) return { success: false, error: 'Google Sheet ID or URL is required' };

  var match = sheetInput.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  var cleanId = match ? match[1] : sheetInput;

  var extSpreadsheet;
  try {
    extSpreadsheet = SpreadsheetApp.openById(cleanId);
  } catch (err) {
    return {
      success: false,
      error: 'Cannot open Google Sheet (' + cleanId + '). Ensure the spreadsheet is shared with access or the Apps Script service account: ' + err.message
    };
  }

  var targetTabName = String(p.tabName || '').trim();
  var extSheet;
  if (targetTabName) {
    extSheet = findTab_(extSpreadsheet, targetTabName);
    if (!extSheet) return tabNotFound_(extSpreadsheet, targetTabName);
  } else {
    extSheet = extSpreadsheet.getSheets()[0];
  }
  if (!extSheet) {
    return { success: false, error: 'No sheet tabs found in spreadsheet' };
  }

  var data = extSheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { success: true, items: [], count: 0, totalRows: 0, tagsFound: [], tabName: extSheet.getName(), sheetTitle: extSpreadsheet.getName(), message: 'Google Sheet tab is empty' };
  }

  var res = readCatalogRows_(data, requestedCatalogTags_(p));
  if (res.error) return { success: false, error: res.error, tabName: extSheet.getName() };

  // Mirror into the master GTINCatalog tab so every station sees the same catalog.
  if (res.items.length > 0) {
    try {
      saveGtinCatalogBatch_({ products: res.items });
    } catch (syncErr) {
      console.warn('Could not mirror to internal GTIN catalog: ' + syncErr.message);
    }
  }

  return {
    success: true,
    items: res.items,
    count: res.items.length,
    totalRows: res.totalRows,
    columns: res.columns,
    tagColumn: res.tagColumn,
    tagsFound: res.tagsFound,
    appliedTags: res.appliedTags,
    sheetTitle: extSpreadsheet.getName(),
    tabName: extSheet.getName()
  };
}

/* ---------- Storage Retention & Older Video Purge ---------- */
// ---------------------------------------------------------------------------
// Retention: find and remove videos + log rows older than N days.
// OrderLog/ReturnLog and UploadLog have different layouts, so columns are found by header
// (with the standard positions as fallback). Deletion runs in time-boxed batches: each call
// stops after ~4 minutes and returns done:false with what is left; the app calls again.

function olderSheetCols_(sheetName, headerRow) {
  const h = (headerRow || []).map(function(x) { return String(x || '').trim().toLowerCase(); });
  const find = function(re, fallback) { const i = h.findIndex(function(x) { return re.test(x); }); return i >= 0 ? i : fallback; };
  const upload = sheetName === CONFIG.UPLOAD_LOG_SHEET;
  return {
    order: find(/^order\s*id$/, 1),
    platform: find(/^platform$/, 2),
    fileId: find(/video drive id|drive file id/, upload ? 9 : 4),
    playback: upload ? -1 : find(/playback url/, 5),
    size: find(/file\s*size|package\s*weight/, upload ? 5 : 6),
    type: find(/recording type/, upload ? 12 : 8),
    fileName: upload ? find(/file\s*name/, 4) : -1,
    // Where a row records that its video went to Drive Trash (rows themselves are never deleted).
    marker: upload ? find(/^stage$/, 7) : find(/playback status/, 11)
  };
}

function olderCutoff_(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(23, 59, 59, 999);
  return cutoff;
}

function validFileId_(fid) {
  return !!fid && fid.length > 15 && /^[A-Za-z0-9_-]+$/.test(fid);
}

/** Every row older than the cutoff that matches the filters, per sheet. */
function collectOlderRows_(p) {
  const daysThreshold = Math.max(1, Number(p.days || 90));
  const cutoff = olderCutoff_(daysThreshold);
  const platformFilter = normalize_(p.platform);
  const typeFilter = normalize_(p.recordingType);
  const ss = ss_();
  const out = { daysThreshold: daysThreshold, cutoff: cutoff, sheets: [] };
  [
    { name: CONFIG.ORDER_LOG_SHEET, defaultType: 'Forward' },
    { name: CONFIG.RETURN_LOG_SHEET, defaultType: 'Return' },
    { name: CONFIG.UPLOAD_LOG_SHEET, defaultType: 'Forward' }
  ].forEach(function(target) {
    const sh = ss.getSheetByName(target.name);
    if (!sh) return;
    const v = sh.getDataRange().getValues();
    const entry = { name: target.name, sh: sh, rows: [], markerCol: -1 };
    out.sheets.push(entry);
    if (!v || v.length <= 1) return;
    const c = olderSheetCols_(target.name, v[0]);
    entry.markerCol = c.marker;
    for (let i = 1; i < v.length; i++) {
      const rawTs = v[i][0];
      if (!rawTs) continue;
      const ts = rowDate_(rawTs);
      if (isNaN(ts.getTime()) || ts >= cutoff) continue;
      const pf = String(v[i][c.platform] || '').trim();
      const rtNorm = normalize_(v[i][c.type] || target.defaultType);
      const rt = (rtNorm === 'return' || rtNorm === 'inbound') ? 'Return' : 'Forward';
      if (platformFilter && normalize_(pf) !== platformFilter) continue;
      if (typeFilter && normalize_(rt) !== typeFilter) continue;
      const fid = String(v[i][c.fileId] || '').trim();
      if (isTrashedMarker_(v[i][c.marker])) continue; // video already moved to Trash earlier
      entry.rows.push({
        row: i + 1, ts: ts, orderId: String(v[i][c.order] || '').trim(), platform: pf, recordingType: rt,
        fileId: validFileId_(fid) ? fid : '',
        playbackUrl: c.playback >= 0 ? String(v[i][c.playback] || '').trim() : '',
        fileSizeStr: String(v[i][c.size] || '').trim(),
        fileName: c.fileName >= 0 ? String(v[i][c.fileName] || '').trim() : ''
      });
    }
  });
  return out;
}

function scanOlderVideos_(p) {
  session_(p.token);
  const found = collectOlderRows_(p);
  const items = [];
  const tabSummary = {};
  const fileIds = {};
  let bytes = 0;
  found.sheets.forEach(function(sht) {
    tabSummary[sht.name] = sht.rows.length;
    sht.rows.forEach(function(r) {
      if (r.fileId && !fileIds[r.fileId]) {
        fileIds[r.fileId] = true;
        const b = parseSizeBytes_(r.fileSizeStr);
        if (b > 0) bytes += b;
      }
      items.push({
        orderId: r.orderId || 'UNNAMED',
        platform: r.platform || 'D2C',
        recordingType: r.recordingType,
        timestamp: r.ts.toISOString(),
        dateStr: Utilities.formatDate(r.ts, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        ageDays: Math.floor((Date.now() - r.ts.getTime()) / 86400000),
        sheet: sht.name,
        row: r.row,
        fileId: r.fileId,
        fileName: r.fileName || (r.orderId ? (r.orderId + '_' + r.platform + '_' + r.recordingType + '.mp4') : ''),
        playbackUrl: r.playbackUrl || (r.fileId ? ('https://drive.google.com/file/d/' + r.fileId + '/preview') : ''),
        fileSizeStr: r.fileSizeStr
      });
    });
  });
  // Newest first, so the list starts with what is just past the cutoff.
  items.sort(function(a, b) { return a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0; });
  const cutoffStr = found.cutoff.toISOString().split('T')[0];
  return {
    success: true,
    daysThreshold: found.daysThreshold,
    cutoffDate: cutoffStr,
    totalOlderOrders: items.length,
    totalOlderSheetRows: items.length,
    totalOlderDriveVideos: Object.keys(fileIds).length,
    estimatedTotalSizeBytes: bytes,
    items: items,
    scannedTabs: found.sheets.map(function(x) { return x.name; }),
    tabSummary: tabSummary,
    message: 'Found ' + items.length + ' log row(s) and ' + Object.keys(fileIds).length + ' video(s) older than ' + found.daysThreshold + ' days.'
  };
}

/**
 * Moves Drive files to Trash, many at once. Returns { id: 'trashed' | 'gone' | 'error: …' }.
 * 'gone' = the file no longer exists (already deleted), so its log row can go too.
 */
function trashDriveFiles_(ids) {
  const result = {};
  if (!ids.length) return result;
  let token = '';
  try { token = ScriptApp.getOAuthToken(); } catch (_) {}
  if (token && UrlFetchApp.fetchAll) {
    const reqs = ids.map(function(id) {
      return {
        url: 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=id,trashed',
        method: 'patch',
        contentType: 'application/json',
        payload: JSON.stringify({ trashed: true }),
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      };
    });
    try {
      const resps = UrlFetchApp.fetchAll(reqs);
      ids.forEach(function(id, i) {
        const code = resps[i].getResponseCode();
        if (code >= 200 && code < 300) result[id] = 'trashed';
        else if (code === 404) result[id] = 'gone';
        else {
          let msg = '';
          try { msg = JSON.parse(resps[i].getContentText()).error.message; } catch (_) { msg = 'HTTP ' + code; }
          result[id] = 'error: ' + msg;
        }
      });
      return result;
    } catch (e) {
      console.warn('trashDriveFiles_: batch request failed, trying one by one: ' + e);
    }
  }
  ids.forEach(function(id) {
    try {
      DriveApp.getFileById(id).setTrashed(true);
      result[id] = 'trashed';
    } catch (e) {
      const m = String(e && e.message || e);
      result[id] = /not found|no item with the given id/i.test(m) ? 'gone' : 'error: ' + m;
    }
  });
  return result;
}

const VIDEO_TRASHED_MARK_ = 'Video moved to Drive Trash';
function isTrashedMarker_(v) {
  const t = String(v || '').trim().toLowerCase();
  return t === 'trashed' || t.indexOf('video moved to drive trash') === 0;
}

/** Writes the Trash marker into rows (1-based numbers) of one column, one read and one write. */
function markRowsTrashed_(sh, col, rowNums) {
  if (!rowNums.length || col < 0) return 0;
  const first = Math.min.apply(null, rowNums);
  const last = Math.max.apply(null, rowNums);
  const range = sh.getRange(first, col + 1, last - first + 1, 1);
  const vals = range.getValues();
  const stamp = VIDEO_TRASHED_MARK_ + ' ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yy');
  rowNums.forEach(function(r) { vals[r - first][0] = stamp; });
  range.setValues(vals);
  return rowNums.length;
}

function deleteOlderVideos_(p) {
  const user = admin_(p.token); // the request's permission (Delete Logs & Data) was checked first
  const started = Date.now();
  const budgetMs = Number(p.budgetMs) > 0 ? Number(p.budgetMs) : 240000;
  // Sheet rows are the permanent record: this tool only moves videos to Drive Trash and never
  // deletes rows (any removeSheetEntries flag from an older app is ignored).

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { success: false, error: 'Another cleanup is running. Try again in a minute.' };
  try {
    const found = collectOlderRows_(p);
    const cutoffStr = found.cutoff.toISOString().split('T')[0];

    // 1. Unique Drive files across all three logs (UploadLog repeats the OrderLog file).
    const status = {};
    const order = [];
    found.sheets.forEach(function(sht) {
      sht.rows.forEach(function(r) { if (r.fileId && !status[r.fileId]) { status[r.fileId] = 'pending'; order.push(r.fileId); } });
    });
    let trashed = 0, gone = 0, failed = 0;
    const errors = [];
    let outOfTime = false;
    for (let i = 0; i < order.length; i += 50) {
      if (i > 0 && Date.now() - started > budgetMs) { outOfTime = true; break; }
      const res = trashDriveFiles_(order.slice(i, i + 50));
      Object.keys(res).forEach(function(id) {
        status[id] = res[id];
        if (res[id] === 'trashed') trashed++;
        else if (res[id] === 'gone') gone++;
        else { failed++; if (errors.length < 5) errors.push(id + ': ' + res[id].replace(/^error: /, '')); }
      });
    }

    // 2. Keep every row; note in it that its video is now in Drive Trash (or was already gone).
    let markedRows = 0;
    const markedBySheet = {};
    found.sheets.forEach(function(sht) {
      const rowNums = sht.rows.filter(function(r) {
        return r.fileId && (status[r.fileId] === 'trashed' || status[r.fileId] === 'gone');
      }).map(function(r) { return r.row; });
      if (!rowNums.length) return;
      markedRows += markRowsTrashed_(sht.sh, sht.markerCol, rowNums);
      markedBySheet[sht.name] = rowNums.length;
    });

    const remainingVideos = order.filter(function(id) { return status[id] === 'pending'; }).length;
    if (trashed) {
      try { bumpAnalyticsVersion_(); } catch (_) {}
      try { CacheService.getScriptCache().remove(DRIVE_STORAGE_CACHE_KEY_); } catch (_) {}
    }
    try {
      securityLog_(user.email, 'DELETE_OLDER', 'OK', 'days=' + found.daysThreshold + ' trashed=' + trashed + ' rowsKept=' + markedRows + ' failed=' + failed);
    } catch (_) {}

    const done = !outOfTime;
    return {
      success: true,
      done: done,
      daysThreshold: found.daysThreshold,
      cutoffDate: cutoffStr,
      deletedOrdersCount: trashed + gone,
      removedSheetRowsCount: 0,
      keptRowsCount: markedRows,
      movedDriveVideosCount: trashed,
      alreadyGoneCount: gone,
      failedCount: failed,
      remainingVideos: remainingVideos,
      errors: errors,
      markedBySheet: markedBySheet,
      message: (done ? 'Done. ' : 'Still working. ') + trashed + ' video(s) moved to Drive Trash; all sheet rows kept' +
        (gone ? ', ' + gone + ' video(s) were already deleted' : '') + (failed ? ', ' + failed + ' could not be deleted' : '') + '.'
    };
  } finally {
    lock.releaseLock();
  }
}




/* ---------- Settings: sheet cleanup (duplicate and unusable rows) ---------- */
// Finds repeated rows for the same recording (same order ID and recording type) and rows that
// hold no usable video, in OrderLog, ReturnLog and UploadLog. One good row is kept for every
// recording. Removed rows are copied in full to an "<Sheet> Archive" tab before they are deleted,
// so nothing is lost. Rows from the last few hours are never touched (uploads may still be running).
// mode 'scan' only reports; mode 'run' archives and deletes, in time-boxed rounds (done:false = call again).

const CLEANUP_RECENT_HOURS_ = 6;
const CLEANUP_UNFINISHED_HOURS_ = 24;

function cleanupCols_(sheetName, headerRow) {
  const h = (headerRow || []).map(function(x) { return String(x || '').trim().toLowerCase(); });
  const find = function(re, fallback) { const i = h.findIndex(function(x) { return re.test(x); }); return i >= 0 ? i : fallback; };
  const upload = sheetName === CONFIG.UPLOAD_LOG_SHEET;
  const c = olderSheetCols_(sheetName, headerRow);
  c.status = find(/^status$/, upload ? 10 : 7);
  c.progress = upload ? find(/^progress$/, 8) : -1;
  return c;
}

function cleanupRowIsBlank_(row) {
  for (let j = 0; j < row.length; j++) {
    if (row[j] !== '' && row[j] !== null && row[j] !== undefined) return false;
  }
  return true;
}

function cleanupFinished_(status) {
  const st = normalize_(status);
  if (st && !/complete|success|done|uploaded|ready/.test(st)) return false;
  return true;
}

/** Works out which rows to remove. Returns { sheets: [{ name, sh, headers, values, remove: [{row, reason, orderId, fileId}] }], groups, extraVideoIds }. */
function planSheetCleanup_() {
  const ss = ss_();
  const now = Date.now();
  const recentMs = CLEANUP_RECENT_HOURS_ * 3600000;
  const unfinishedMs = CLEANUP_UNFINISHED_HOURS_ * 3600000;
  const targets = [
    { name: CONFIG.ORDER_LOG_SHEET, defaultType: 'Forward' },
    { name: CONFIG.RETURN_LOG_SHEET, defaultType: 'Return' },
    { name: CONFIG.UPLOAD_LOG_SHEET, defaultType: 'Forward' }
  ];
  const plan = { sheets: [], groups: [], extraVideoIds: [] };
  const keeperFileByRecording = {}; // order|type -> fileId kept in OrderLog/ReturnLog
  const keptFileIds = {};
  const removedFileIds = {};

  targets.forEach(function(t) {
    const sh = ss.getSheetByName(t.name);
    if (!sh) return;
    const values = sh.getDataRange().getValues();
    const entry = { name: t.name, sh: sh, headers: values[0] || [], values: values, remove: [], duplicates: 0, unusable: 0, rows: Math.max(0, values.length - 1) };
    plan.sheets.push(entry);
    if (values.length <= 1) return;
    const c = cleanupCols_(t.name, values[0]);
    const upload = t.name === CONFIG.UPLOAD_LOG_SHEET;
    const groups = {};

    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      if (cleanupRowIsBlank_(r)) {
        entry.remove.push({ row: i + 1, reason: 'Empty row', orderId: '', fileId: '' });
        entry.unusable++;
        continue;
      }
      const ts = rowDate_(r[0]);
      const tsMs = isNaN(ts.getTime()) ? 0 : ts.getTime();
      if (tsMs && now - tsMs < recentMs) { // still being written by a station
        const f = String(r[c.fileId] || '').trim();
        if (validFileId_(f)) keptFileIds[f] = true;
        continue;
      }
      const rawOrder = String(r[c.order] || '').trim();
      const order = normalizeOrderId_(rawOrder);
      const fid = String(r[c.fileId] || '').trim();
      const hasVideo = validFileId_(fid);
      const finished = upload ? cleanupFinished_(r[c.status]) : true;
      const progress = c.progress >= 0 ? Number(r[c.progress]) : 100;

      if (!order) {
        if (!hasVideo) {
          entry.remove.push({ row: i + 1, reason: 'No order ID and no video', orderId: '', fileId: '' });
          entry.unusable++;
        } else {
          keptFileIds[fid] = true;
        }
        continue;
      }
      if (upload && !hasVideo && !finished && tsMs && now - tsMs >= unfinishedMs) {
        entry.remove.push({ row: i + 1, reason: 'Upload never finished, no video', orderId: rawOrder, fileId: '' });
        entry.unusable++;
        continue;
      }
      const rt = normalize_(c.type >= 0 ? r[c.type] : '') || normalize_(t.defaultType);
      const key = order + '|' + (rt === 'return' || rt === 'inbound' ? 'return' : 'forward');
      if (!groups[key]) groups[key] = [];
      groups[key].push({
        row: i + 1, orderId: rawOrder, fileId: hasVideo ? fid : '', tsMs: tsMs,
        finished: finished, full: !(progress < 100), tiny: isTinyVideo_(parseSizeBytes_(r[c.size]))
      });
    }

    Object.keys(groups).forEach(function(key) {
      const rows = groups[key];
      const preferFile = upload ? keeperFileByRecording[key] : '';
      const score = function(x) {
        return (preferFile && x.fileId === preferFile ? 16 : 0) + (x.fileId ? 8 : 0) + (x.finished ? 4 : 0) +
          (x.full ? 2 : 0) + (x.tiny ? 0 : 1);
      };
      rows.sort(function(a, b) { return (score(b) - score(a)) || (b.tsMs - a.tsMs) || (b.row - a.row); });
      const keeper = rows[0];
      if (!upload && keeper.fileId) keeperFileByRecording[key] = keeper.fileId;
      if (keeper.fileId) keptFileIds[keeper.fileId] = true;
      if (rows.length < 2) return;
      const removed = rows.slice(1);
      removed.forEach(function(x) {
        entry.remove.push({
          row: x.row,
          reason: x.fileId && x.fileId !== keeper.fileId ? 'Duplicate (extra video copy)' : 'Duplicate row',
          orderId: x.orderId, fileId: x.fileId
        });
        entry.duplicates++;
        if (x.fileId && x.fileId !== keeper.fileId) removedFileIds[x.fileId] = true;
      });
      plan.groups.push({ sheet: t.name, orderId: keeper.orderId, recordingType: key.split('|')[1] === 'return' ? 'Return' : 'Forward', keepRow: keeper.row, removeRows: removed.length });
    });
    entry.remove.sort(function(a, b) { return a.row - b.row; });
  });

  plan.extraVideoIds = Object.keys(removedFileIds).filter(function(id) { return !keptFileIds[id]; });
  return plan;
}

function sheetCleanupSummary_(plan) {
  const sheets = plan.sheets.map(function(s) {
    return { name: s.name, rows: s.rows, duplicates: s.duplicates, unusable: s.unusable, remove: s.remove.length };
  });
  const reasons = {};
  plan.sheets.forEach(function(s) { s.remove.forEach(function(x) { reasons[x.reason] = (reasons[x.reason] || 0) + 1; }); });
  const groups = plan.groups.slice().sort(function(a, b) { return b.removeRows - a.removeRows; });
  return {
    sheets: sheets,
    reasons: reasons,
    totalRemove: sheets.reduce(function(n, s) { return n + s.remove; }, 0),
    totalDuplicates: sheets.reduce(function(n, s) { return n + s.duplicates; }, 0),
    totalUnusable: sheets.reduce(function(n, s) { return n + s.unusable; }, 0),
    duplicateRecordings: groups.length,
    extraVideos: plan.extraVideoIds.length,
    topGroups: groups.slice(0, 100)
  };
}

/* ---------- Order ID format fix (Settings) ----------
 * Rewrites the Order ID cell (column B) of every row whose ID is not in the standard format:
 * D2C orders get exactly one leading '#' and no spaces ("OD-10063", "##OD-10063", " #OD-10063 "
 * -> "#OD-10063"); other platforms only lose stray spaces and extra '#'. Only that one cell
 * changes: no row is added, moved or removed. The Supabase copy follows (SB_ACTION_TABS_).
 */
const ORDER_ID_FIX_TABS_ = ['ORDER_LOG_SHEET', 'RETURN_LOG_SHEET', 'UPLOAD_LOG_SHEET', 'DOWNLOAD_LOG_SHEET',
  'TRASH_LOG_SHEET', 'ORDER_MANIFEST_SHEET', 'PACK_VERIFICATION_LOG_SHEET'];

function planOrderIdFix_() {
  const ss = ss_();
  const plan = { tabs: [], total: 0, examples: [], manifestRepeats: 0 };
  ORDER_ID_FIX_TABS_.forEach(function(k) {
    const name = CONFIG[k];
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const values = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
    const changes = [];
    const seen = {};
    for (let i = 0; i < values.length; i++) {
      const raw = values[i][1];
      if (raw === '' || raw === null || raw === undefined || raw instanceof Date || typeof raw === 'number') continue;
      let fixed = canonicalOrderId_(raw, values[i][2]);
      if (k === 'ORDER_MANIFEST_SHEET') {
        fixed = fixed.toUpperCase();
        const key = normalizeOrderId_(fixed);
        if (key) { if (seen[key]) plan.manifestRepeats++; seen[key] = true; }
      }
      if (fixed && fixed !== String(raw)) {
        changes.push({ row: i + 2, from: String(raw), to: fixed });
        if (plan.examples.length < 10) plan.examples.push({ sheet: name, row: i + 2, from: String(raw), to: fixed });
      }
    }
    plan.tabs.push({ name: name, sh: sh, changes: changes });
    plan.total += changes.length;
  });
  planPackerFix_(plan);
  return plan;
}

/**
 * Order list rows where an older app version saved the upload source ("Automatic Recording")
 * as the packer: put back the real packer email (Assigned Packer Email, E) and name (Packed By
 * Name, M). The packer comes from the order's recording in OrderLog, else from the assigned
 * packer's name in Users. Cells that cannot be worked out are left as they are.
 */
function planPackerFix_(plan) {
  plan.packerFixes = [];
  plan.packerUnresolved = 0;
  const ss = ss_();
  const ms = ss.getSheetByName(CONFIG.ORDER_MANIFEST_SHEET);
  if (!ms || ms.getLastRow() < 2) return;
  const usersByEmail = {}, emailByName = {};
  try {
    const us = ss.getSheetByName(CONFIG.USERS_SHEET);
    const uv = us ? us.getDataRange().getValues() : [];
    for (let i = 1; i < uv.length; i++) {
      const em = String(uv[i][2] || '').trim().toLowerCase(), nm = String(uv[i][1] || '').trim();
      if (!em) continue;
      usersByEmail[em] = nm || em;
      if (nm && !emailByName[nm.toLowerCase()]) emailByName[nm.toLowerCase()] = em;
    }
  } catch (_) {}
  const packerByOrder = {};
  try {
    const ol = ss.getSheetByName(CONFIG.ORDER_LOG_SHEET);
    const ov = ol && ol.getLastRow() > 1 ? ol.getDataRange().getValues() : [];
    for (let i = 1; i < ov.length; i++) {
      const em = String(ov[i][3] || '').trim();
      if (isEmailLike_(em)) packerByOrder[normalizeOrderId_(ov[i][1])] = em.toLowerCase();
    }
  } catch (_) {}
  const mv = ms.getDataRange().getValues();
  for (let i = 1; i < mv.length; i++) {
    const row = mv[i];
    const badEmail = String(row[4] || '').trim() !== '' && !isEmailLike_(row[4]);
    const badName = isUploadSourceLabel_(row[12]) && String(row[12] || '').trim().toLowerCase() !== 'packer';
    if (!badEmail && !badName) continue;
    const email = packerByOrder[normalizeOrderId_(row[1])] || emailByName[String(row[3] || '').trim().toLowerCase()] || '';
    if (!email) { plan.packerUnresolved++; continue; }
    const add = function(col, from, to) {
      plan.packerFixes.push({ sh: ms, row: i + 1, col: col, from: String(from), to: to });
      if (plan.examples.length < 10) plan.examples.push({ sheet: CONFIG.ORDER_MANIFEST_SHEET + (col === 5 ? ' (packer email)' : ' (packed by)'), row: i + 1, from: String(from), to: to });
    };
    if (badEmail) add(5, row[4], email);
    if (badName) add(13, row[12], usersByEmail[email] || email);
  }
  plan.total += plan.packerFixes.length;
}

function fixOrderIdFormat_(p, apply) {
  admin_(p.token);
  const summary = function(plan) {
    return {
      success: true,
      total: plan.total,
      sheets: plan.tabs.map(function(t) { return { sheet: t.name, rows: t.changes.length }; })
        .concat(plan.packerFixes && plan.packerFixes.length ? [{ sheet: 'OrderManifest packer', rows: plan.packerFixes.length }] : [])
        .filter(function(t) { return t.rows > 0; }),
      packerUnresolved: plan.packerUnresolved || 0,
      examples: plan.examples,
      manifestRepeats: plan.manifestRepeats
    };
  };
  if (!apply) {
    const out = summary(planOrderIdFix_());
    out.message = out.total ? out.total + ' cell(s) need fixing.' : 'Every order ID and packer is already in the right format.';
    return out;
  }
  // Bring in app changes still waiting in Supabase first, so the fix sees every row.
  try { sbDrain_(20000); } catch (e) { console.warn('Supabase drain before order ID fix:', e); }
  return withScriptLock_(function() {
    const plan = planOrderIdFix_();
    plan.tabs.forEach(function(t) {
      // Contiguous runs of changed rows are written in one call; untouched rows are never rewritten.
      let i = 0;
      while (i < t.changes.length) {
        let j = i;
        while (j + 1 < t.changes.length && t.changes[j + 1].row === t.changes[j].row + 1) j++;
        const run = t.changes.slice(i, j + 1);
        t.sh.getRange(run[0].row, 2, run.length, 1).setValues(run.map(function(c) { return [c.to]; }));
        i = j + 1;
      }
    });
    (plan.packerFixes || []).forEach(function(f) { f.sh.getRange(f.row, f.col).setValue(f.to); });
    SpreadsheetApp.flush();
    bumpManifestVersion_();
    try { bumpAnalyticsVersion_(); } catch (_) {}
    const out = summary(plan);
    out.fixed = plan.total;
    out.message = plan.total ? 'Fixed ' + plan.total + ' cell(s). No rows were removed.' : 'Every order ID and packer is already in the right format.';
    return out;
  });
}

function scanSheetCleanup_(p) {
  session_(p.token);
  const out = sheetCleanupSummary_(planSheetCleanup_());
  out.success = true;
  out.message = out.totalRemove
    ? out.totalRemove + ' row(s) can be removed: ' + out.totalDuplicates + ' duplicate, ' + out.totalUnusable + ' unusable.'
    : 'No duplicate or unusable rows found.';
  return out;
}

function cleanupArchiveSheet_(name, headers) {
  const ss = ss_();
  const archName = name + ' Archive';
  let sh = ss.getSheetByName(archName);
  if (!sh) {
    sh = ss.insertSheet(archName);
    sh.getRange(1, 1, 1, headers.length + 2).setValues([['Archived At', 'Reason'].concat(headers)]);
    try { sh.setFrozenRows(1); } catch (_) {}
  }
  return sh;
}

// Live progress of a running cleanup round, read by the Settings page while the round runs.
const SHEET_CLEANUP_PROGRESS_KEY_ = 'VMS_SHEET_CLEANUP_PROGRESS';
function setSheetCleanupProgress_(o) {
  try { CacheService.getScriptCache().put(SHEET_CLEANUP_PROGRESS_KEY_, JSON.stringify(Object.assign({ at: Date.now() }, o)), 600); } catch (_) {}
}
function getSheetCleanupProgress_() {
  let o = null;
  try { o = JSON.parse(CacheService.getScriptCache().get(SHEET_CLEANUP_PROGRESS_KEY_) || 'null'); } catch (_) {}
  return { success: true, progress: o };
}

function runSheetCleanup_(p) {
  const user = session_(p.token);
  const budgetMs = p.budgetMs !== undefined && p.budgetMs !== '' ? Math.max(0, Number(p.budgetMs) || 0) : 240000;
  const trashVideos = p.trashExtraVideos === true;
  return withScriptLock_(function() {
    const started = Date.now();
    const plan = planSheetCleanup_();
    const before = sheetCleanupSummary_(plan);
    const removedBySheet = {};
    let removed = 0;
    let archived = 0;
    let outOfTime = false;
    const now = new Date();

    // Extra video copies first (only when asked), while their rows still exist.
    let videosTrashed = 0;
    let videosFailed = 0;
    const videosTotal = trashVideos ? plan.extraVideoIds.length : 0;
    const progress = function(phase, rowsDone) {
      setSheetCleanupProgress_({ phase: phase, videosDone: videosTrashed + videosFailed, videosTotal: videosTotal,
        rowsDone: rowsDone, rowsTotal: before.totalRemove });
    };
    progress(videosTotal ? 'videos' : 'rows', 0);
    if (trashVideos && plan.extraVideoIds.length) {
      for (let i = 0; i < plan.extraVideoIds.length; i += 50) { // 50 at a time in parallel; quick
        const res = trashDriveFiles_(plan.extraVideoIds.slice(i, i + 50));
        Object.keys(res).forEach(function(id) {
          if (res[id] === 'trashed' || res[id] === 'gone') videosTrashed++; else videosFailed++;
        });
        progress('videos', 0);
      }
      progress('rows', 0);
    }

    for (let s = 0; s < plan.sheets.length && !outOfTime; s++) {
      const entry = plan.sheets[s];
      if (!entry.remove.length) continue;
      // Contiguous runs, bottom first, so earlier row numbers stay valid.
      const runs = [];
      entry.remove.forEach(function(x) {
        const last = runs[runs.length - 1];
        if (last && x.row === last.start + last.items.length) last.items.push(x);
        else runs.push({ start: x.row, items: [x] });
      });
      runs.reverse();
      const arch = cleanupArchiveSheet_(entry.name, entry.headers);
      let done = 0;
      for (let k = 0; k < runs.length; k++) {
        if (removed + done > 0 && Date.now() - started >= budgetMs) { outOfTime = true; break; }
        const run = runs[k];
        const width = entry.headers.length || entry.values[0].length;
        const rowsOut = run.items.map(function(x) {
          const orig = entry.values[x.row - 1].slice(0, width);
          while (orig.length < width) orig.push('');
          return [now, x.reason].concat(orig);
        });
        const archRow = arch.getLastRow() + 1;
        arch.getRange(archRow, 1, rowsOut.length, width + 2).setValues(rowsOut);
        formatDateRows_(arch, archRow, rowsOut.length);
        archived += rowsOut.length;
        entry.sh.deleteRows(run.start, run.items.length);
        done += run.items.length;
        progress('rows', removed + done);
      }
      if (done) {
        removedBySheet[entry.name] = done;
        removed += done;
      }
    }

    SpreadsheetApp.flush();
    const remaining = before.totalRemove - removed;
    const done = !outOfTime && remaining <= 0;
    progress(done ? 'done' : 'rows', removed);
    try {
      logAppend_(sheet_(CONFIG.SECURITY_LOG_SHEET), [new Date(), user.email, 'SHEET_CLEANUP', 'SUCCESS',
        'rowsRemoved=' + removed + ' archived=' + archived + ' videosTrashed=' + videosTrashed + ' ' + JSON.stringify(removedBySheet)]);
    } catch (_) {}
    return {
      success: true,
      done: done,
      removedRowsCount: removed,
      archivedRowsCount: archived,
      removedBySheet: removedBySheet,
      remainingRows: Math.max(0, remaining),
      videosTrashedCount: videosTrashed,
      videosFailedCount: videosFailed,
      message: removed + ' row(s) removed and copied to the Archive tabs' +
        (trashVideos ? ', ' + videosTrashed + ' extra video copies moved to Drive Trash' : '') + '.'
    };
  });
}


// ---------------------------------------------------------------------------
// Backend self-update (Admin > Settings > Backend code).
// Pulls backend/Code.gs and backend/appsscript.json from the main branch of the GitHub repo,
// writes them into this Apps Script project with the Apps Script API, saves a new version and
// points the existing web-app deployment at it, so the /exec URL stays the same.
// The source URL is fixed here; nothing the browser sends can change which code is installed.
// One-time setup (see README "Updating the backend from the admin panel"):
//   1. Turn on "Google Apps Script API" at https://script.google.com/home/usersettings
//   2. Use the appsscript.json from the repo (it adds the script.projects and script.deployments scopes)
//   3. Paste this Code.gs, run authorizeBackendUpdater once from the editor, deploy a new version.
const BACKEND_SOURCE_ = {
  CODE_URL: 'https://raw.githubusercontent.com/roshan-054/VMS_3.0/main/backend/Code.gs',
  MANIFEST_URL: 'https://raw.githubusercontent.com/roshan-054/VMS_3.0/main/backend/appsscript.json',
  API: 'https://script.googleapis.com/v1/projects/',
  NEEDED_SCOPES: ['https://www.googleapis.com/auth/script.projects', 'https://www.googleapis.com/auth/script.deployments'],
  PROP_SHA: 'VMS_BACKEND_SHA',
  PROP_AT: 'VMS_BACKEND_UPDATED_AT',
  PROP_BY: 'VMS_BACKEND_UPDATED_BY',
  PROP_VERSION: 'VMS_BACKEND_VERSION',
  PROP_PREV_VERSION: 'VMS_BACKEND_PREV_VERSION',
  PROP_DEPLOYMENT: 'VMS_BACKEND_DEPLOYMENT'
};

/** Run once from the Apps Script editor so Google asks for the new permissions. */
function authorizeBackendUpdater() {
  const r = scriptApi_('GET', ScriptApp.getScriptId() + '/content');
  Logger.log(r.ok ? 'Backend updater is ready.' : r.error);
  return r.ok ? 'Backend updater is ready.' : r.error;
}

function backendSourceSha_(text) {
  const norm = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, norm, Utilities.Charset.UTF_8);
  return bytes.map(function(b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('').slice(0, 12);
}

function scriptApiHelp_(status, message) {
  const m = String(message || '');
  if (/has not been used|is disabled|SERVICE_DISABLED|not enabled the Apps Script API|User has not enabled/i.test(m)) {
    return 'Turn on "Google Apps Script API" at script.google.com/home/usersettings (Settings > Google Apps Script API: On). ' +
      'If it is already on, the Google Cloud project linked to this script needs the Apps Script API enabled too: open the link in the message, click Enable, wait 2 minutes and try again.';
  }
  if (status === 401 || status === 403 || /insufficient|scope|permission/i.test(m)) {
    return 'The script does not have permission yet. In the Apps Script editor use the appsscript.json from the repo, run authorizeBackendUpdater once and allow access, then deploy a new version.';
  }
  return '';
}

function scriptApi_(method, path, body) {
  let token = '';
  try { token = ScriptApp.getOAuthToken(); } catch (e) { return { ok: false, status: 0, error: 'No access token: ' + (e && e.message ? e.message : e) }; }
  const opts = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token } };
  if (body !== undefined) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  let resp;
  try { resp = UrlFetchApp.fetch(BACKEND_SOURCE_.API + path, opts); }
  catch (e) { return { ok: false, status: 0, error: String(e && e.message ? e.message : e) }; }
  const status = resp.getResponseCode();
  let data = null;
  try { data = JSON.parse(resp.getContentText() || '{}'); } catch (_) {}
  if (status >= 200 && status < 300) return { ok: true, status: status, data: data || {} };
  const msg = (data && data.error && data.error.message) || ('HTTP ' + status);
  return { ok: false, status: status, error: msg, help: scriptApiHelp_(status, msg) };
}

function fetchLatestBackend_() {
  const get = function(url) {
    const r = UrlFetchApp.fetch(url + '?t=' + Date.now(), { muteHttpExceptions: true, headers: { 'Cache-Control': 'no-cache' } });
    if (r.getResponseCode() !== 200) throw new Error('Could not download ' + url.split('/').pop() + ' from GitHub (HTTP ' + r.getResponseCode() + ').');
    return r.getContentText();
  };
  const code = get(BACKEND_SOURCE_.CODE_URL);
  const manifestText = get(BACKEND_SOURCE_.MANIFEST_URL);
  if (code.length < 20000 || code.indexOf('function doPost(') === -1 || code.indexOf('const CONFIG') === -1 || code.indexOf('function updateBackend_(') === -1) {
    throw new Error('The Code.gs on GitHub does not look like a complete VMS backend, so nothing was changed.');
  }
  let manifest;
  try { manifest = JSON.parse(manifestText); } catch (_) { throw new Error('appsscript.json on GitHub is not valid JSON, so nothing was changed.'); }
  return { code: code, manifest: manifest, sha: backendSourceSha_(code) };
}

function findBackendFiles_(files) {
  let code = null, manifest = null;
  (files || []).forEach(function(f) {
    if (f.type === 'JSON' && f.name === 'appsscript') manifest = f;
    else if (f.type === 'SERVER_JS' && String(f.source || '').indexOf('function doPost(') !== -1 && (!code || f.name === 'Code')) code = f;
  });
  return { code: code, manifest: manifest };
}

function getBackendUpdateStatus_(p) {
  const props = PropertiesService.getScriptProperties();
  const out = {
    success: true,
    live: {
      sha: props.getProperty(BACKEND_SOURCE_.PROP_SHA) || '',
      updatedAt: props.getProperty(BACKEND_SOURCE_.PROP_AT) || '',
      updatedBy: props.getProperty(BACKEND_SOURCE_.PROP_BY) || '',
      version: Number(props.getProperty(BACKEND_SOURCE_.PROP_VERSION) || 0) || null,
      previousVersion: Number(props.getProperty(BACKEND_SOURCE_.PROP_PREV_VERSION) || 0) || null,
      hasUpdater: true
    },
    latest: null,
    api: { ready: false, error: '', help: '' },
    source: BACKEND_SOURCE_.CODE_URL
  };
  try {
    const latest = fetchLatestBackend_();
    out.latest = { sha: latest.sha, bytes: latest.code.length };
  } catch (e) {
    out.latestError = e && e.message ? e.message : String(e);
  }
  const content = scriptApi_('GET', ScriptApp.getScriptId() + '/content');
  if (content.ok) {
    out.api.ready = true;
    const files = findBackendFiles_(content.data.files);
    if (files.code) out.live.sha = backendSourceSha_(files.code.source);
  } else {
    out.api.error = content.error;
    out.api.help = content.help;
  }
  out.upToDate = !!(out.latest && out.live.sha && out.latest.sha === out.live.sha);
  return out;
}

function pickWebAppDeployment_(deployments, webAppUrl) {
  const web = (deployments || []).filter(function(d) {
    return d.deploymentConfig && d.deploymentConfig.versionNumber &&
      (d.entryPoints || []).some(function(e) { return e.entryPointType === 'WEB_APP'; });
  });
  const url = String(webAppUrl || '');
  const match = web.filter(function(d) { return url && url.indexOf('/s/' + d.deploymentId + '/') !== -1; });
  if (match.length === 1) return match[0];
  const saved = PropertiesService.getScriptProperties().getProperty(BACKEND_SOURCE_.PROP_DEPLOYMENT);
  const savedMatch = web.filter(function(d) { return d.deploymentId === saved; });
  if (savedMatch.length === 1) return savedMatch[0];
  if (web.length === 1) return web[0];
  throw new Error(web.length ? 'Found ' + web.length + ' web app deployments and none matches the URL this app uses, so nothing was switched.' : 'No web app deployment found to update.');
}

function setDeploymentVersion_(scriptId, dep, versionNumber, description) {
  return scriptApi_('PUT', scriptId + '/deployments/' + encodeURIComponent(dep.deploymentId), {
    deploymentConfig: {
      scriptId: scriptId,
      versionNumber: versionNumber,
      manifestFileName: (dep.deploymentConfig && dep.deploymentConfig.manifestFileName) || 'appsscript',
      description: description
    }
  });
}

function updateBackend_(p) {
  const user = admin_(p.token);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { success: false, error: 'Another backend update is already running.' };
  try {
    const scriptId = ScriptApp.getScriptId();
    const latest = fetchLatestBackend_();
    const content = scriptApi_('GET', scriptId + '/content');
    if (!content.ok) return { success: false, error: content.error, help: content.help, step: 'read' };
    const files = content.data.files || [];
    const cur = findBackendFiles_(files);
    if (!cur.code) return { success: false, error: 'Could not find the VMS Code.gs file in this Apps Script project.', step: 'read' };
    if (backendSourceSha_(cur.code.source) === latest.sha && !p.force) {
      return { success: true, upToDate: true, sha: latest.sha, message: 'The backend already runs the latest Code.gs.' };
    }

    // Keep this project's own time zone and web-app settings; take the rest of the manifest from GitHub.
    let curManifest = {};
    try { curManifest = JSON.parse((cur.manifest && cur.manifest.source) || '{}'); } catch (_) {}
    const newManifest = latest.manifest;
    if (curManifest.timeZone) newManifest.timeZone = curManifest.timeZone;
    if (curManifest.webapp) newManifest.webapp = curManifest.webapp;
    const have = curManifest.oauthScopes || [];
    const missing = (newManifest.oauthScopes || []).filter(function(s) { return have.indexOf(s) === -1; });
    if (missing.length) {
      return { success: false, step: 'permissions', missingScopes: missing,
        error: 'The new Code.gs needs extra Google permissions (' + missing.map(function(s) { return s.split('/').pop(); }).join(', ') + ').',
        help: 'Do this update by hand once: paste the new appsscript.json and Code.gs in the Apps Script editor, run authorizeBackendUpdater, allow access, and deploy a new version.' };
    }

    // Find the deployment to move before touching any code.
    const deps = scriptApi_('GET', scriptId + '/deployments?pageSize=50');
    if (!deps.ok) return { success: false, error: deps.error, help: deps.help, step: 'deployments' };
    const dep = pickWebAppDeployment_(deps.data.deployments, p.webAppUrl);

    const before = cur.code.source;
    const updated = files.map(function(f) {
      if (f === cur.code) return { name: f.name, type: f.type, source: latest.code };
      if (f === cur.manifest) return { name: f.name, type: f.type, source: JSON.stringify(newManifest, null, 2) };
      return { name: f.name, type: f.type, source: f.source };
    });
    const put = scriptApi_('PUT', scriptId + '/content', { files: updated });
    if (!put.ok) return { success: false, error: put.error, help: put.help, step: 'write' };

    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yy HH:mm');
    const description = 'VMS update ' + stamp + ' (' + latest.sha + ') by ' + (user.email || 'admin');
    const ver = scriptApi_('POST', scriptId + '/versions', { description: description });
    if (!ver.ok || !ver.data.versionNumber) {
      // Put the old code back so the editor matches what is deployed.
      scriptApi_('PUT', scriptId + '/content', { files: files.map(function(f) { return { name: f.name, type: f.type, source: f.source }; }) });
      return { success: false, error: ver.error || 'No version number returned.', help: ver.help, step: 'version' };
    }
    const prevVersion = dep.deploymentConfig.versionNumber;
    const upd = setDeploymentVersion_(scriptId, dep, ver.data.versionNumber, description);
    if (!upd.ok) return { success: false, error: upd.error, help: upd.help, step: 'deploy', versionNumber: ver.data.versionNumber };

    PropertiesService.getScriptProperties().setProperties({
      [BACKEND_SOURCE_.PROP_SHA]: latest.sha,
      [BACKEND_SOURCE_.PROP_AT]: new Date().toISOString(),
      [BACKEND_SOURCE_.PROP_BY]: user.email || '',
      [BACKEND_SOURCE_.PROP_VERSION]: String(ver.data.versionNumber),
      [BACKEND_SOURCE_.PROP_PREV_VERSION]: String(prevVersion || ''),
      [BACKEND_SOURCE_.PROP_DEPLOYMENT]: dep.deploymentId
    });
    return {
      success: true, sha: latest.sha, previousSha: backendSourceSha_(before),
      versionNumber: ver.data.versionNumber, previousVersion: prevVersion, deploymentId: dep.deploymentId,
      message: 'Backend updated to version ' + ver.data.versionNumber + '. New requests use it within about a minute.'
    };
  } finally {
    lock.releaseLock();
  }
}

function rollbackBackend_(p) {
  const user = admin_(p.token);
  const props = PropertiesService.getScriptProperties();
  const prev = Number(props.getProperty(BACKEND_SOURCE_.PROP_PREV_VERSION) || 0);
  if (!prev) return { success: false, error: 'There is no earlier version recorded to go back to.' };
  const scriptId = ScriptApp.getScriptId();
  const deps = scriptApi_('GET', scriptId + '/deployments?pageSize=50');
  if (!deps.ok) return { success: false, error: deps.error, help: deps.help };
  const dep = pickWebAppDeployment_(deps.data.deployments, p.webAppUrl);
  const current = dep.deploymentConfig.versionNumber;
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yy HH:mm');
  const upd = setDeploymentVersion_(scriptId, dep, prev, 'VMS rollback ' + stamp + ' to version ' + prev + ' by ' + (user.email || 'admin'));
  if (!upd.ok) return { success: false, error: upd.error, help: upd.help };
  props.setProperties({
    [BACKEND_SOURCE_.PROP_VERSION]: String(prev),
    [BACKEND_SOURCE_.PROP_PREV_VERSION]: String(current || ''),
    [BACKEND_SOURCE_.PROP_AT]: new Date().toISOString(),
    [BACKEND_SOURCE_.PROP_BY]: user.email || ''
  });
  props.deleteProperty(BACKEND_SOURCE_.PROP_SHA);
  return { success: true, versionNumber: prev, previousVersion: current, message: 'The web app now runs version ' + prev + ' again.' };
}


// ---------------------------------------------------------------------------
// Archived rows (Settings > Archived rows): list what the sheet cleanup moved to the
// '<Sheet> Archive' tabs and put chosen rows back into their original tab.
const CLEANUP_ARCHIVE_SOURCES_ = function() { return [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET, CONFIG.UPLOAD_LOG_SHEET]; };

function archiveCols_(headers) {
  const h = (headers || []).map(function(x) { return String(x || '').trim().toLowerCase(); });
  const find = function(re) { return h.findIndex(function(x) { return re.test(x); }); };
  return {
    archivedAt: 0, reason: 1, timestamp: 2,
    order: find(/^order id$/), platform: find(/^platform$/), type: find(/^recording type$/),
    size: find(/^(package weight|file size)$/), fileId: find(/^(video drive id|drive file id)$/), packer: find(/^packer email$/)
  };
}

function listCleanupArchive_(p) {
  admin_(p.token);
  const ss = ss_();
  const out = [];
  CLEANUP_ARCHIVE_SOURCES_().forEach(function(src) {
    const arch = ss.getSheetByName(src + ' Archive');
    if (!arch || arch.getLastRow() < 2) return;
    const values = arch.getDataRange().getValues();
    const c = archiveCols_(values[0]);
    for (let i = 1; i < values.length && out.length < 5000; i++) {
      const r = values[i];
      if (r.every(function(x) { return x === '' || x === null; })) continue;
      const ts = rowDate_(r[c.timestamp]);
      const at = rowDate_(r[c.archivedAt]);
      const size = c.size >= 0 ? String(r[c.size] || '') : '';
      out.push({
        sheet: src, archiveRow: i + 1,
        archivedAt: isNaN(at.getTime()) ? String(r[c.archivedAt] || '') : at.toISOString(),
        reason: String(r[c.reason] || ''),
        timestamp: isNaN(ts.getTime()) ? String(r[c.timestamp] || '') : ts.toISOString(),
        orderId: c.order >= 0 ? String(r[c.order] || '') : '',
        platform: c.platform >= 0 ? String(r[c.platform] || '') : '',
        recordingType: c.type >= 0 ? String(r[c.type] || '') : '',
        size: size, sizeBytes: parseSizeBytes_(size),
        fileId: c.fileId >= 0 ? String(r[c.fileId] || '') : '',
        packer: c.packer >= 0 ? String(r[c.packer] || '') : ''
      });
    }
  });
  return { success: true, rows: out, count: out.length };
}

function restoreCleanupArchive_(p) {
  const user = admin_(p.token);
  const items = Array.isArray(p.items) ? p.items : [];
  if (!items.length) return { success: false, error: 'Choose at least one row to restore.' };
  return withScriptLock_(function() {
    const ss = ss_();
    const bySheet = {};
    items.forEach(function(x) {
      const src = String(x && x.sheet || '');
      const row = Number(x && x.archiveRow);
      if (CLEANUP_ARCHIVE_SOURCES_().indexOf(src) === -1 || !(row >= 2)) return;
      (bySheet[src] = bySheet[src] || {})[row] = true;
    });
    const restoredBySheet = {};
    let restored = 0;
    Object.keys(bySheet).forEach(function(src) {
      const arch = ss.getSheetByName(src + ' Archive');
      const dest = ss.getSheetByName(src);
      if (!arch || !dest) return;
      const values = arch.getDataRange().getValues();
      const destWidth = Math.max(dest.getLastColumn(), 1);
      const rows = Object.keys(bySheet[src]).map(Number).filter(function(r) { return r <= values.length; }).sort(function(a, b) { return a - b; });
      const back = rows.map(function(r) {
        const orig = values[r - 1].slice(2, 2 + destWidth);
        while (orig.length < destWidth) orig.push('');
        return orig;
      }).filter(function(r) { return r.some(function(x) { return x !== '' && x !== null; }); });
      if (!back.length) return;
      const first = dest.getLastRow() + 1;
      dest.getRange(first, 1, back.length, destWidth).setValues(back);
      formatDateRows_(dest, first, back.length);
      rows.slice().reverse().forEach(function(r) { arch.deleteRow(r); });
      restoredBySheet[src] = back.length;
      restored += back.length;
    });
    SpreadsheetApp.flush();
    try {
      logAppend_(sheet_(CONFIG.SECURITY_LOG_SHEET), [new Date(), user.email, 'ARCHIVE_RESTORE', 'SUCCESS', 'rowsRestored=' + restored + ' ' + JSON.stringify(restoredBySheet)]);
    } catch (_) {}
    return { success: true, restored: restored, restoredBySheet: restoredBySheet,
      message: restored + ' row(s) put back from the Archive tabs.' };
  });
}

/* =====================================================================================
 * SUPABASE (fast database) + GOOGLE SHEET BACKUP SYNC
 *
 * The web app reads and writes its data in Supabase (see supabase/vms_schema.sql). This Sheet
 * stays exactly as it is and is kept up to date as the backup:
 *   - Changes the app makes in Supabase are queued there and written into the Sheet here by
 *     sbDrain_() (a 1-minute trigger, plus a "syncSheetNow" ping the app sends after it saves).
 *   - Rows this script writes into the Sheet itself (uploads, sign-ins, admin tools) are copied
 *     into Supabase at the end of the same request (sbFlush_), so both sides match.
 *   - Once an hour sbSweep_() compares every tab and fixes any difference (for example rows
 *     typed into the Sheet by hand).
 * The service_role / secret key is kept in Script Properties and is never sent to the browser.
 * ===================================================================================== */

const SB_TABS_ = [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET, CONFIG.UPLOAD_LOG_SHEET, CONFIG.DOWNLOAD_LOG_SHEET,
  CONFIG.SECURITY_LOG_SHEET, CONFIG.TRASH_LOG_SHEET, CONFIG.PACK_VERIFICATION_LOG_SHEET, CONFIG.USERS_SHEET,
  CONFIG.ORDER_MANIFEST_SHEET, CONFIG.GTIN_CATALOG_SHEET, CONFIG.BRANDING_SHEET, CONFIG.PACKAGE_DETAILS_SHEET,
  CONFIG.SHOPIFY_ORDERS_SHEET, CONFIG.RETURN_DETAILS_SHEET];
// Tabs only this script writes: the Sheet is the source of truth, so the sweep may remove rows from Supabase.
const SB_SHEET_PRIMARY_TABS_ = [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET, CONFIG.UPLOAD_LOG_SHEET,
  CONFIG.SECURITY_LOG_SHEET, CONFIG.TRASH_LOG_SHEET, CONFIG.USERS_SHEET, CONFIG.BRANDING_SHEET, CONFIG.PACKAGE_DETAILS_SHEET,
  CONFIG.SHOPIFY_ORDERS_SHEET, CONFIG.RETURN_DETAILS_SHEET];
const SB_SWEEP_MINUTES_ = 60;
const SB_TRIGGER_HANDLER_ = 'sbSyncTick';

// Admin tools that rewrite or remove rows: the whole tab is compared with Supabase afterwards.
const SB_ACTION_TABS_ = {
  setup: SB_TABS_,
  repairPlaybackUrls: [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET],
  migrateReturns: [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET],
  migrateDriveFolders: [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET, CONFIG.UPLOAD_LOG_SHEET],
  migrateMonthlyFolders: [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET, CONFIG.UPLOAD_LOG_SHEET],
  signup: [CONFIG.USERS_SHEET],
  adminCreateUser: [CONFIG.USERS_SHEET], adminManageUser: [CONFIG.USERS_SHEET],
  adminResetPassword: [CONFIG.USERS_SHEET], adminDeleteUser: [CONFIG.USERS_SHEET],
  setUserPermissions: [CONFIG.USERS_SHEET],
  cleanupStuckUploads: [CONFIG.UPLOAD_LOG_SHEET],
  deleteLogEntry: [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET, CONFIG.UPLOAD_LOG_SHEET, CONFIG.DOWNLOAD_LOG_SHEET, CONFIG.TRASH_LOG_SHEET],
  scanDuplicates: [], scanDuplicateRecords: [],
  deleteOlder: [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET, CONFIG.UPLOAD_LOG_SHEET, CONFIG.TRASH_LOG_SHEET],
  deleteOlderVideos: [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET, CONFIG.UPLOAD_LOG_SHEET, CONFIG.TRASH_LOG_SHEET],
  saveBranding: [CONFIG.BRANDING_SHEET], uploadBrandingImage: [CONFIG.BRANDING_SHEET],
  runSheetCleanup: SB_TABS_, restoreCleanupArchive: SB_TABS_,
  fixOrderIdFormat: [CONFIG.ORDER_LOG_SHEET, CONFIG.RETURN_LOG_SHEET, CONFIG.UPLOAD_LOG_SHEET, CONFIG.DOWNLOAD_LOG_SHEET,
    CONFIG.TRASH_LOG_SHEET, CONFIG.ORDER_MANIFEST_SHEET, CONFIG.PACK_VERIFICATION_LOG_SHEET],
  saveOrderManifest: [CONFIG.ORDER_MANIFEST_SHEET], saveOrderManifestsBatch: [CONFIG.ORDER_MANIFEST_SHEET],
  updateManifestStatus: [CONFIG.ORDER_MANIFEST_SHEET], deleteOrderManifest: [CONFIG.ORDER_MANIFEST_SHEET],
  saveGtinProduct: [CONFIG.GTIN_CATALOG_SHEET], deleteGtinProduct: [CONFIG.GTIN_CATALOG_SHEET],
  deleteGtinProductsBatch: [CONFIG.GTIN_CATALOG_SHEET], saveGtinCatalogBatch: [CONFIG.GTIN_CATALOG_SHEET],
  syncExternalGtinSheet: [CONFIG.GTIN_CATALOG_SHEET],
  setBoxFeature: [CONFIG.BRANDING_SHEET], saveBoxPreset: [CONFIG.BRANDING_SHEET], deleteBoxPreset: [CONFIG.BRANDING_SHEET],
  savePackageDetails: [CONFIG.PACKAGE_DETAILS_SHEET],
  saveShopifySettings: [CONFIG.BRANDING_SHEET],
  saveLogisticsPartner: [CONFIG.BRANDING_SHEET], deleteLogisticsPartner: [CONFIG.BRANDING_SHEET],
  saveReturnDetails: [CONFIG.RETURN_DETAILS_SHEET, CONFIG.BRANDING_SHEET]
};
SB_ACTION_TABS_.removeUploadLog = SB_ACTION_TABS_.deleteLogEntry;
SB_ACTION_TABS_.deleteOrderLog = SB_ACTION_TABS_.deleteLogEntry;
SB_ACTION_TABS_.cleanDuplicates = SB_ACTION_TABS_.deleteLogEntry;
SB_ACTION_TABS_.removeDuplicates = SB_ACTION_TABS_.deleteLogEntry;
SB_ACTION_TABS_.removeDuplicateRecords = SB_ACTION_TABS_.deleteLogEntry;

var SB_TOUCH_ = null;   // rows written during this request: { rows: {tab: {row: true}}, tabs: {tab: true} }
var SB_DEFER_ = false;  // upload chunks: copy to Supabase later (next request or the trigger), not inline

function sbConfig_() {
  const props = scriptProps_();
  return {
    url: String(props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, ''),
    anonKey: String(props.getProperty('SUPABASE_ANON_KEY') || '').trim(),
    serviceKey: String(props.getProperty('SUPABASE_SERVICE_KEY') || '').trim(),
    enabled: props.getProperty('SUPABASE_ENABLED') !== 'false'
  };
}

function sbEnabled_() {
  try { const c = sbConfig_(); return !!(c.enabled && c.url && c.serviceKey); } catch (_) { return false; }
}

function sbHeaders_(key) {
  const h = { apikey: key };
  // New-style keys (sb_publishable_... / sb_secret_...) are not JWTs and go in the apikey header only.
  if (!/^sb_/.test(key)) h.Authorization = 'Bearer ' + key;
  return h;
}

function sbRpc_(fn, args, cfg) {
  const c = cfg || sbConfig_();
  if (!c.url || !c.serviceKey) throw new Error('Supabase is not set up yet.');
  const res = UrlFetchApp.fetch(c.url + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: sbHeaders_(c.serviceKey),
    payload: JSON.stringify(args || {}),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  if (code >= 300) {
    const msg = body && typeof body === 'object' ? (body.message || body.error || body.hint || text) : text;
    throw new Error('Supabase ' + fn + ' failed (HTTP ' + code + '): ' + String(msg || '').slice(0, 300));
  }
  return body;
}

/** Cell value -> JSON (dates become {"$d": iso} so they come back as dates). */
function sbEncodeCell_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : { $d: v.toISOString() };
  if (v === null || v === undefined) return '';
  return v;
}
function sbDecodeCell_(v) {
  if (v && typeof v === 'object' && v.$d) { const d = new Date(v.$d); return isNaN(d.getTime()) ? '' : d; }
  if (v === null || v === undefined) return '';
  return v;
}
function sbEncodeRow_(tab, row) {
  const out = row.map(sbEncodeCell_);
  if (tab === CONFIG.USERS_SHEET && out.length > 3) out[3] = ''; // password hashes never leave the Sheet
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function sbKeyPart_(v) {
  if (v && typeof v === 'object' && v.$d) v = new Date(v.$d);
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : String(Math.floor(v.getTime() / 1000));
  let s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  s = s.replace(/\.0+$/, '');
  if (/^\d+$/.test(s)) s = s.replace(/^0+(?=\d)/, '');
  return s;
}

/**
 * Stable identity of a Sheet row, used to find the same row in Supabase and in the Sheet.
 * The browser runs this same function, so both sides always agree. '' = blank row (skipped).
 */
function rowKey_(tab, row) {
  row = row || [];
  const has = row.some(function(c) { return sbKeyPart_(c) !== ''; });
  if (!has) return '';
  const k = sbKeyPart_;
  switch (tab) {
    case CONFIG.USERS_SHEET: if (k(row[2])) return 'u:' + k(row[2]); break;
    case CONFIG.BRANDING_SHEET: if (k(row[0])) return 'b:' + k(row[0]); break;
    case CONFIG.ORDER_MANIFEST_SHEET: if (k(row[1])) return 'o:' + k(row[1]); break;
    case CONFIG.GTIN_CATALOG_SHEET: if (k(row[1])) return 'g:' + k(row[1]); break;
    case CONFIG.UPLOAD_LOG_SHEET: if (k(row[6])) return 'up:' + k(row[6]); break;
    case CONFIG.PACKAGE_DETAILS_SHEET: if (k(row[1])) return 'pk:' + k(row[1]) + '|' + k(row[3]); break;
    case CONFIG.SHOPIFY_ORDERS_SHEET: if (k(row[1])) return 'sp:' + k(row[1]); break;
    case CONFIG.RETURN_DETAILS_SHEET: if (k(row[1])) return 'rd:' + k(row[1]); break;
  }
  return 'r:' + [k(row[0]), k(row[1]), k(row[2]), k(row[3])].join('|');
}

/** Keys for every data row of a tab (index = position in values; header -> ''). Repeats get #2, #3... */
function sheetKeys_(tab, values) {
  const seen = {};
  const keys = [''];
  for (let i = 1; i < values.length; i++) {
    let key = rowKey_(tab, values[i]);
    if (key) {
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) key = key + '#' + seen[key];
    }
    keys.push(key);
  }
  return keys;
}

function sbHeaderRow_(values) {
  const h = (values && values[0]) ? values[0].map(function(c) { return String(c === null || c === undefined ? '' : c); }) : [];
  while (h.length && h[h.length - 1] === '') h.pop();
  return h;
}

function sbStatePut_(key, value) {
  try { sbRpc_('vms_state_put', { p_key: key, p_value: value }); } catch (e) { console.warn('Supabase state note:', e); }
}

/* ---------- Sheet -> Supabase ---------- */

function sbTouch_(sh, row) {
  try {
    if (!sh || !row || row < 2) return;
    const name = sh.getName();
    if (SB_TABS_.indexOf(name) === -1) return;
    SB_TOUCH_ = SB_TOUCH_ || { rows: {}, tabs: {} };
    (SB_TOUCH_.rows[name] = SB_TOUCH_.rows[name] || {})[row] = true;
  } catch (_) {}
}

function sbTouchTabs_(tabs) {
  if (!tabs || !tabs.length) return;
  SB_TOUCH_ = SB_TOUCH_ || { rows: {}, tabs: {} };
  tabs.forEach(function(t) { SB_TOUCH_.tabs[t] = true; });
}

function sbMergeTouch_(a, b) {
  const out = { rows: {}, tabs: {} };
  [a, b].forEach(function(t) {
    if (!t) return;
    Object.keys(t.tabs || {}).forEach(function(n) { out.tabs[n] = true; });
    Object.keys(t.rows || {}).forEach(function(n) {
      out.rows[n] = out.rows[n] || {};
      Object.keys(t.rows[n]).forEach(function(r) { out.rows[n][r] = true; });
    });
  });
  return out;
}

function sbLoadPending_() {
  try { const raw = CacheService.getScriptCache().get('SB_PENDING'); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
}
function sbSavePending_(t) {
  try {
    if (!t) { CacheService.getScriptCache().remove('SB_PENDING'); return; }
    let text = JSON.stringify(t);
    if (text.length > 90000) { // too many rows: compare the whole tabs instead
      Object.keys(t.rows).forEach(function(n) { t.tabs[n] = true; });
      t.rows = {};
      text = JSON.stringify(t);
    }
    CacheService.getScriptCache().put('SB_PENDING', text, 21600);
  } catch (_) {}
}

/** Copy the rows written during this request into Supabase (called from output_). */
function sbFlush_(defer) {
  if (!SB_TOUCH_) return;
  if (!sbEnabled_()) { SB_TOUCH_ = null; return; }
  let work = SB_TOUCH_;
  SB_TOUCH_ = null;
  if (defer) { sbSavePending_(sbMergeTouch_(sbLoadPending_(), work)); return; }
  const pending = sbLoadPending_();
  if (pending) { work = sbMergeTouch_(pending, work); sbSavePending_(null); }
  try {
    sbPush_(work);
  } catch (e) {
    console.warn('Supabase copy postponed:', e);
    sbSavePending_(sbMergeTouch_(sbLoadPending_(), work));
  }
}

function sbPush_(work) {
  const ss = ss_();
  const failed = { rows: {}, tabs: {} };
  let anyFailed = false;
  Object.keys(work.tabs || {}).forEach(function(name) {
    // A tool changed or removed rows here: remove them in Supabase too (app changes not yet in
    // the Sheet are protected by vms_reconcile_tab).
    try { sbReconcileTab_(name, true); }
    catch (e) { console.warn('Supabase reconcile ' + name + ':', e); failed.tabs[name] = true; anyFailed = true; }
  });
  Object.keys(work.rows || {}).forEach(function(name) {
    if (work.tabs && work.tabs[name]) return;
    try {
      const sh = ss.getSheetByName(name);
      if (!sh) return;
      const lastRow = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), 1);
      const header = sbHeaderRow_(sh.getRange(1, 1, 1, lastCol).getValues());
      const rows = [];
      Object.keys(work.rows[name]).map(Number).sort(function(a, b) { return a - b; }).forEach(function(r) {
        if (r < 2 || r > lastRow) return;
        const vals = sh.getRange(r, 1, 1, lastCol).getValues()[0];
        const key = rowKey_(name, vals);
        if (key) rows.push({ key: key, vals: sbEncodeRow_(name, vals) });
      });
      if (rows.length) sbRpc_('vms_mirror_rows', { p_tab: name, p_headers: header, p_rows: rows });
    } catch (e) {
      console.warn('Supabase copy ' + name + ':', e);
      failed.rows[name] = work.rows[name]; anyFailed = true;
    }
  });
  if (anyFailed) throw new Error('Some rows could not be copied to Supabase yet.');
}

/** Make Supabase match one whole Sheet tab. allowDelete null = only for tabs this script owns. */
function sbReconcileTab_(name, allowDelete, startedAt) {
  const sh = ss_().getSheetByName(name);
  if (!sh) return { tab: name, skipped: true };
  const started = startedAt || sbRpc_('vms_now', {});
  const values = sh.getDataRange().getValues();
  const keys = sheetKeys_(name, values);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (keys[i]) rows.push({ key: keys[i], vals: sbEncodeRow_(name, values[i]) });
  }
  const del = allowDelete === null || allowDelete === undefined ? SB_SHEET_PRIMARY_TABS_.indexOf(name) !== -1 : !!allowDelete;
  const res = sbRpc_('vms_reconcile_tab', { p_tab: name, p_headers: sbHeaderRow_(values), p_rows: rows, p_started_at: started, p_allow_delete: del });
  try { scriptProps_().setProperty('SB_FP_' + name, sbFingerprint_(values)); } catch (_) {}
  return res;
}

function sbFingerprint_(values) {
  const text = JSON.stringify(values);
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text).map(function(b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('') + ':' + text.length;
}

/** Hourly safety sweep: compare every tab that changed since the last comparison. */
function sbSweep_(force) {
  const ss = ss_();
  const out = [];
  const started = sbRpc_('vms_now', {});
  SB_TABS_.forEach(function(name) {
    try {
      const sh = ss.getSheetByName(name);
      if (!sh) return;
      if (!force) {
        const fp = sbFingerprint_(sh.getDataRange().getValues());
        if (scriptProps_().getProperty('SB_FP_' + name) === fp) return;
      }
      out.push(sbReconcileTab_(name, null, started));
    } catch (e) {
      out.push({ tab: name, error: e.message });
    }
  });
  scriptProps_().setProperty('SB_LAST_SWEEP', String(Date.now()));
  sbStatePut_('lastSweep', { at: new Date().toISOString(), tabs: out.length });
  return out;
}

/* ---------- Supabase -> Sheet ---------- */

function sbWriteRow_(sh, r, vals, width) {
  const row = vals.map(sbDecodeCell_);
  const w = Math.max(width, row.length, 1);
  while (row.length < w) row.push('');
  sh.getRange(r, 1, 1, w).setValues([row]);
}

/** Write the changes the app made in Supabase into the Sheet. */
function sbDrain_(maxMs) {
  if (!sbEnabled_()) return { success: true, skipped: 'Supabase is not set up' };
  const lock = LockService.getUserLock();
  if (!lock.tryLock(3000)) return { success: true, skipped: 'busy' };
  const startedMs = Date.now();
  const limitMs = maxMs || 25000;
  let written = 0, appended = 0, removed = 0, rounds = 0;
  try {
    while (Date.now() - startedMs < limitMs && rounds < 20) {
      rounds++;
      const claim = sbRpc_('vms_sync_claim', { p_limit: 400 });
      const items = (claim && claim.items) || [];
      if (!items.length) break;
      const byTab = {};
      items.forEach(function(it) { (byTab[it.tab] = byTab[it.tab] || []).push(it); });
      Object.keys(byTab).forEach(function(tab) {
        if (!tab || tab === 'null') return;
        const list = byTab[tab];
        let sh = ss_().getSheetByName(tab);
        if (!sh) {
          sh = ss_().insertSheet(tab);
          const h = (claim.headers && claim.headers[tab]) || [];
          if (h.length) sh.getRange(1, 1, 1, h.length).setValues([h]);
        }
        const values = sh.getLastRow() > 0 ? sh.getDataRange().getValues() : [];
        if (values.length === 0 || values[0].every(function(c) { return c === '' || c === null; })) {
          const h = (claim.headers && claim.headers[tab]) || [];
          if (h.length) { sh.getRange(1, 1, 1, h.length).setValues([h]); values[0] = h.slice(); }
        }
        const keys = sheetKeys_(tab, values);
        const where = {};
        keys.forEach(function(k, i) { if (k && !where[k]) where[k] = i + 1; });
        const width = Math.max(sh.getLastColumn(), (values[0] || []).length, 1);
        const appends = [];
        const updates = {};
        const deletes = {};
        // Removals first, so a row deleted and re-added under the same key ends up present.
        list.slice().sort(function(a, b) { return (a.live ? 1 : 0) - (b.live ? 1 : 0); }).forEach(function(it) {
          let r = 0;
          const cand = [it.key].concat(it.keys || []);
          for (let c = 0; c < cand.length && !r; c++) if (cand[c] && where[cand[c]]) r = where[cand[c]];
          if (it.live) {
            if (r) { updates[r] = it.vals || []; delete deletes[r]; }
            else appends.push(it);
          } else if (r) {
            deletes[r] = true; delete updates[r];
          }
        });
        appends.sort(function(a, b) { return Number(a.seq) - Number(b.seq); });
        const updRows = Object.keys(updates).map(Number);
        const delRows = Object.keys(deletes).map(Number);
        const decodeRow = function(vals, w) {
          const row = (vals || []).map(sbDecodeCell_);
          while (row.length < w) row.push('');
          return row.slice(0, Math.max(w, row.length));
        };
        if (updRows.length + delRows.length > 20) {
          // Many changes (for example a catalog sync): rewrite the tab in one go instead of row by row.
          const w = Math.max(width, appends.reduce(function(m, it) { return Math.max(m, (it.vals || []).length); }, 1),
            updRows.reduce(function(m, r) { return Math.max(m, updates[r].length); }, 1));
          const finalRows = [];
          for (let i = 0; i < values.length; i++) {
            const r = i + 1;
            if (deletes[r]) continue;
            if (updates[r]) finalRows.push(decodeRow(updates[r], w));
            else { const row = values[i].slice(); while (row.length < w) row.push(''); finalRows.push(row.slice(0, w)); }
          }
          appends.forEach(function(it) { finalRows.push(decodeRow(it.vals, w)); });
          if (finalRows.length) sh.getRange(1, 1, finalRows.length, w).setValues(finalRows);
          if (values.length > finalRows.length) sh.deleteRows(finalRows.length + 1, values.length - finalRows.length);
          if (finalRows.length > 1) formatDateRows_(sh, 2, finalRows.length - 1);
          written += updRows.length; appended += appends.length; removed += delRows.length;
        } else {
          updRows.forEach(function(r) { sbWriteRow_(sh, r, updates[r], width); formatDateRows_(sh, r, 1); written++; });
          if (appends.length) {
            const w = Math.max(width, appends.reduce(function(m, it) { return Math.max(m, (it.vals || []).length); }, 1));
            const block = appends.map(function(it) { return decodeRow(it.vals, w); });
            const first = sh.getLastRow() + 1;
            sh.getRange(first, 1, block.length, w).setValues(block);
            formatDateRows_(sh, first, block.length);
            appended += block.length;
          }
          delRows.sort(function(a, b) { return b - a; }).forEach(function(r) { sh.deleteRow(r); removed++; });
        }
      });
      SpreadsheetApp.flush();
      sbRpc_('vms_sync_ack', { p_items: items.map(function(it) { return { row_id: it.row_id, last_id: it.last_id }; }) });
      if (items.length < 400) break;
    }
    if (written || appended || removed) {
      bumpAnalyticsVersion_();
      sbStatePut_('lastSheetSync', { at: new Date().toISOString(), updated: written, appended: appended, removed: removed });
    }
    return { success: true, updated: written, appended: appended, removed: removed };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ---------- trigger ---------- */

function sbEnsureTrigger_() {
  const all = ScriptApp.getProjectTriggers();
  for (let i = 0; i < all.length; i++) if (all[i].getHandlerFunction() === SB_TRIGGER_HANDLER_) return true;
  ScriptApp.newTrigger(SB_TRIGGER_HANDLER_).timeBased().everyMinutes(1).create();
  return true;
}

function sbRemoveTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === SB_TRIGGER_HANDLER_) ScriptApp.deleteTrigger(t);
  });
}

function sbHasTrigger_() {
  try { return ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === SB_TRIGGER_HANDLER_; }); }
  catch (_) { return false; }
}

/** Runs every minute: write app changes into the Sheet, copy postponed rows, hourly sweep. */
function sbSyncTick() {
  if (!sbEnabled_()) return;
  try {
    const pending = sbLoadPending_();
    if (pending) { sbSavePending_(null); SB_TOUCH_ = sbMergeTouch_(SB_TOUCH_, pending); sbFlush_(false); }
  } catch (e) { console.warn('Supabase pending copy:', e); }
  try { sbDrain_(30000); } catch (e) { console.warn('Supabase drain:', e); }
  try {
    const last = Number(scriptProps_().getProperty('SB_LAST_SWEEP') || 0);
    if (Date.now() - last > SB_SWEEP_MINUTES_ * 60000) sbSweep_(false);
  } catch (e) { console.warn('Supabase sweep:', e); }
}

/* ---------- sessions ---------- */

function sbPutSession_(token, rec) {
  if (!sbEnabled_() || !token || !rec || !rec.user) return false;
  try {
    sbRpc_('vms_session_put', {
      p_token_hash: hash_(token), p_email: String(rec.user.email || ''), p_name: String(rec.user.name || ''),
      p_role: String(rec.user.role || 'User'), p_expires_at: new Date(Number(rec.exp)).toISOString()
    });
    return true;
  } catch (e) { console.warn('Supabase session copy:', e); return false; }
}

function sbDropSessions_(token, email) {
  if (!sbEnabled_()) return;
  try { sbRpc_('vms_session_drop', { p_token_hash: token ? hash_(token) : null, p_email: email || null }); }
  catch (e) { console.warn('Supabase session drop:', e); }
}

/** The app found no Supabase copy of its sign-in (for example it signed in before Supabase was set up). */
function supabaseSession_(p) {
  const token = String(p.token || '').trim();
  let raw = CacheService.getScriptCache().get('SESSION_' + token) || PropertiesService.getScriptProperties().getProperty('SESS_' + token);
  const rec = raw ? JSON.parse(raw) : null;
  if (!rec) throw authError_();
  const ok = sbPutSession_(token, rec);
  return { success: ok, error: ok ? undefined : 'Supabase is not reachable right now.' };
}

/* ---------- admin actions ---------- */

function sbPublicConfig_() {
  const c = sbConfig_();
  const on = !!(c.enabled && c.url && c.anonKey && c.serviceKey);
  return { supabaseEnabled: on, supabaseUrl: on ? c.url : '', supabaseAnonKey: on ? c.anonKey : '' };
}

function getSupabaseConfig_() {
  const c = sbConfig_();
  const out = {
    success: true, url: c.url, anonKey: c.anonKey, hasServiceKey: !!c.serviceKey, enabled: c.enabled,
    triggerInstalled: sbHasTrigger_(), lastSweep: Number(scriptProps_().getProperty('SB_LAST_SWEEP') || 0) || null,
    importedAt: scriptProps_().getProperty('SB_IMPORTED_AT') || null
  };
  if (c.url && c.serviceKey) {
    try { out.status = sbRpc_('vms_service_status', {}, c); out.connected = true; }
    catch (e) { out.connected = false; out.connectionError = e.message; }
  }
  return out;
}

/**
 * Accepts the Project URL in the forms people paste: with or without https://, a trailing slash,
 * /rest/v1, spaces or quotes, a dashboard link (supabase.com/dashboard/project/<ref>/...), or just
 * the project ref. Returns https://<host> or '' when nothing usable is found.
 */
function sbNormalizeUrl_(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\s"'<>]/g, '');
  if (!s) return '';
  const dash = s.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{10,40})/i);
  if (dash) return 'https://' + dash[1].toLowerCase() + '.supabase.co';
  if (/^[a-z0-9]{10,40}$/i.test(s) && !/\./.test(s)) return 'https://' + s.toLowerCase() + '.supabase.co';
  s = s.replace(/^[a-z]+:\/\//i, '');
  const host = s.split(/[\/?#]/)[0].replace(/:443$/, '').toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return '';
  return 'https://' + host;
}

function saveSupabaseConfig_(p) {
  const props = scriptProps_();
  const old = sbConfig_();
  const url = p.url !== undefined ? sbNormalizeUrl_(p.url) : old.url;
  const anonKey = String(p.anonKey !== undefined ? p.anonKey : old.anonKey).trim();
  const serviceKey = String(p.serviceKey || '').trim() || old.serviceKey;
  const enabled = p.enabled === undefined ? true : !!p.enabled;
  if (enabled) {
    if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) throw new Error('Enter the Project URL, for example https://abcd1234.supabase.co');
    if (!anonKey) throw new Error('Enter the anon / publishable key.');
    if (!serviceKey) throw new Error('Enter the service_role / secret key.');
    if (anonKey === serviceKey) throw new Error('The anon key and the service key must be different keys.');
    // Prove the keys and the database script work before saving anything.
    let status;
    try { status = sbRpc_('vms_service_status', {}, { url: url, serviceKey: serviceKey }); }
    catch (e) {
      throw new Error('Could not reach Supabase with these details. Check the URL and service key, and that you ran supabase/vms_schema.sql in the SQL Editor. (' + e.message + ')');
    }
    if (!status || !status.schemaVersion) throw new Error('The Supabase database script has not been run yet.');
  }
  props.setProperty('SUPABASE_URL', url);
  props.setProperty('SUPABASE_ANON_KEY', anonKey);
  if (serviceKey) props.setProperty('SUPABASE_SERVICE_KEY', serviceKey);
  props.setProperty('SUPABASE_ENABLED', enabled ? 'true' : 'false');
  if (enabled) sbEnsureTrigger_(); else sbRemoveTrigger_();
  return getSupabaseConfig_();
}

/** First copy of the whole Sheet into Supabase (safe to run again: it only fixes differences). */
function supabaseImport_(p) {
  if (!sbEnabled_()) throw new Error('Save the Supabase settings first.');
  const started = sbRpc_('vms_now', {});
  try { sbDrain_(60000); } catch (e) { console.warn('Drain before import:', e); }
  const tabs = (p && Array.isArray(p.tabs) && p.tabs.length) ? p.tabs : SB_TABS_;
  const results = [];
  tabs.forEach(function(name) {
    try { results.push(sbReconcileTab_(name, null, started)); }
    catch (e) { results.push({ tab: name, error: e.message }); }
  });
  const failed = results.filter(function(r) { return r && r.error; });
  if (!failed.length) {
    scriptProps_().setProperty('SB_IMPORTED_AT', new Date().toISOString());
    scriptProps_().setProperty('SB_LAST_SWEEP', String(Date.now()));
    sbStatePut_('importedAt', new Date().toISOString());
  }
  try { sbEnsureTrigger_(); } catch (e) { console.warn('Trigger note:', e); }
  return { success: failed.length === 0, results: results, error: failed.length ? failed.map(function(f) { return f.tab + ': ' + f.error; }).join('; ') : undefined };
}

function syncSheetNow_() {
  if (!sbEnabled_()) return { success: true, skipped: 'Supabase is not set up' };
  return sbDrain_(20000);
}

/* =====================================================================================
 * BOX DIMENSIONS & VOLUMETRIC WEIGHT
 * While packing, a station records the box used (a saved preset such as "Box-1 10x10x3" or
 * custom L x B x H in cm) and the actual weight in kg. Volumetric weight = L x B x H / divisor
 * (5000 by default, the usual courier divisor for cm and kg); chargeable weight is the larger
 * of the two. One row per order and recording type in the PackageDetails tab, and the values
 * are added to the downloadable report.
 * Settings (Branding tab): BoxDimensionsEnabled (Super Admin only), VolumetricDivisor
 * (Super Admin only), BoxPresets (JSON list, any member can add; creator or admin can remove).
 * ===================================================================================== */
const PACKAGE_DETAILS_HEADERS_ = ['Timestamp', 'Order ID', 'Platform', 'Recording Type', 'Box', 'Length (cm)', 'Breadth (cm)',
  'Height (cm)', 'Actual Weight (kg)', 'Volumetric Weight (kg)', 'Chargeable Weight (kg)', 'Volumetric Divisor', 'Packer Email'];
const DEFAULT_VOLUMETRIC_DIVISOR_ = 5000;
const MAX_BOX_PRESETS_ = 100;

function brandingValues_() {
  // getSheetByName (not sheet_): reading must never run setup (the browser engine cannot).
  try {
    const sh = ss_().getSheetByName(CONFIG.BRANDING_SHEET);
    return sh ? sh.getDataRange().getValues() : [];
  } catch (_) { return []; }
}

function brandingValue_(values, key) {
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === key) return values[i][1];
  }
  return undefined;
}

function brandingSet_(key, value, desc) {
  const sh = sheet_(CONFIG.BRANDING_SHEET);
  const data = sh.getDataRange().getValues();
  const now = new Date();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === key) {
      sh.getRange(i + 1, 2, 1, 2).setValues([[value, now]]);
      return;
    }
  }
  logAppend_(sh, [key, value, now, desc || '']);
}

function boxNumber_(v, max) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.').trim());
  if (!isFinite(n) || n <= 0 || n > max) return NaN;
  return Math.round(n * 100) / 100;
}

function round2_(n) { return Math.round(n * 100) / 100; }

function parseBoxPresets_(raw) {
  let list = [];
  try { list = JSON.parse(String(raw || '[]')); } catch (_) { list = []; }
  if (!Array.isArray(list)) return [];
  return list.filter(function(x) { return x && x.name && Number(x.l) > 0 && Number(x.b) > 0 && Number(x.h) > 0; })
    .map(function(x) {
      return { id: String(x.id || ''), name: String(x.name), l: Number(x.l), b: Number(x.b), h: Number(x.h), by: String(x.by || '') };
    });
}

function boxSettingsFrom_(values) {
  const rawEnabled = brandingValue_(values, 'BoxDimensionsEnabled');
  const enabled = rawEnabled === true || /^(true|yes|1|on)$/i.test(String(rawEnabled || '').trim());
  const d = Number(brandingValue_(values, 'VolumetricDivisor'));
  return {
    enabled: enabled,
    divisor: isFinite(d) && d >= 1000 && d <= 10000 ? d : DEFAULT_VOLUMETRIC_DIVISOR_,
    presets: parseBoxPresets_(brandingValue_(values, 'BoxPresets'))
  };
}

function boxSettings_() { return boxSettingsFrom_(brandingValues_()); }

/** Any signed-in member: is the feature on, the divisor and the saved box sizes. */
function getBoxSettings_(p) {
  session_(p.token);
  const s = boxSettings_();
  return { success: true, enabled: s.enabled, divisor: s.divisor, presets: s.presets };
}

/** Super Admin only: switch the feature on or off and set the volumetric divisor. */
function setBoxFeature_(p) {
  const user = session_(p.token);
  if (p.enabled !== undefined) {
    const on = p.enabled === true || String(p.enabled) === 'true';
    brandingSet_('BoxDimensionsEnabled', on ? 'TRUE' : 'FALSE', 'Box dimensions & volumetric weight while packing (Super Admin only)');
    securityLog_(user.email, 'BOX_FEATURE', 'SUCCESS', on ? 'Enabled' : 'Disabled');
  }
  if (p.divisor !== undefined && p.divisor !== null && p.divisor !== '') {
    const d = Number(p.divisor);
    if (!isFinite(d) || d < 1000 || d > 10000) throw new Error('Volumetric divisor must be between 1000 and 10000 (5000 is the usual courier value).');
    brandingSet_('VolumetricDivisor', Math.round(d), 'Volumetric weight (kg) = L x B x H (cm) / this number');
  }
  return getBoxSettings_(p);
}

/** Any member (feature on): add a box size, or update one with the same name. */
function saveBoxPreset_(p) {
  const user = session_(p.token);
  return withScriptLock_(function() {
    const s = boxSettings_();
    if (!s.enabled) throw new Error('Box dimensions are switched off. The Super Admin can switch them on in Settings.');
    const name = String(p.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const l = boxNumber_(p.l, 1000), b = boxNumber_(p.b, 1000), h = boxNumber_(p.h, 1000);
    if (!name) throw new Error('Give the box a name, for example Box-1.');
    if (!(l > 0) || !(b > 0) || !(h > 0)) throw new Error('Length, breadth and height must be numbers above 0 (cm, up to 1000).');
    const list = s.presets;
    const at = list.findIndex(function(x) { return normalize_(x.name) === normalize_(name); });
    const item = { id: at >= 0 ? list[at].id : Utilities.getUuid().slice(0, 8), name: name, l: l, b: b, h: h, by: at >= 0 ? list[at].by : normalize_(user.email) };
    if (at >= 0) list[at] = item;
    else {
      if (list.length >= MAX_BOX_PRESETS_) throw new Error('Up to ' + MAX_BOX_PRESETS_ + ' box sizes can be saved. Remove one first.');
      list.push(item);
    }
    brandingSet_('BoxPresets', JSON.stringify(list), 'Saved box sizes (cm) for packing');
    return { success: true, preset: item, enabled: s.enabled, divisor: s.divisor, presets: list };
  });
}

/** Remove a saved box size: the member who added it, or an Admin. */
function deleteBoxPreset_(p) {
  const user = session_(p.token);
  const access = REQ_ACCESS_ && REQ_ACCESS_.access;
  const isAdmin = isAdminRole_(access ? access.role : user.role);
  return withScriptLock_(function() {
    const s = boxSettings_();
    const id = String(p.id || '').trim();
    const at = s.presets.findIndex(function(x) { return x.id === id; });
    if (at < 0) throw new Error('That box size was already removed.');
    if (!isAdmin && s.presets[at].by && s.presets[at].by !== normalize_(user.email)) {
      throw new Error('Only the member who added this box size or an Admin can remove it.');
    }
    s.presets.splice(at, 1);
    brandingSet_('BoxPresets', JSON.stringify(s.presets), 'Saved box sizes (cm) for packing');
    return { success: true, enabled: s.enabled, divisor: s.divisor, presets: s.presets };
  });
}

function packageDetailsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(CONFIG.PACKAGE_DETAILS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.PACKAGE_DETAILS_SHEET);
    sh.getRange(1, 1, 1, PACKAGE_DETAILS_HEADERS_.length).setValues([PACKAGE_DETAILS_HEADERS_]);
    try { sh.setFrozenRows(1); sh.getRange(1, 1, 1, PACKAGE_DETAILS_HEADERS_.length).setFontWeight('bold'); } catch (_) {}
  }
  return sh;
}

/** Volumetric and chargeable weight from the box size and actual weight. */
function packageWeights_(l, b, h, actual, divisor) {
  const vol = (l > 0 && b > 0 && h > 0) ? round2_(l * b * h / divisor) : null;
  let charge = null;
  if (vol !== null && actual > 0) charge = Math.max(vol, actual);
  else if (vol !== null) charge = vol;
  else if (actual > 0) charge = actual;
  return { volumetric: vol, chargeable: charge === null ? null : round2_(charge) };
}

/**
 * Save the box and weight of one packed order (one row per order and recording type; saving
 * again replaces it). The server works out volumetric and chargeable weight.
 */
function savePackageDetails_(p) {
  const user = session_(p.token);
  const s = boxSettings_();
  if (!s.enabled) throw new Error('Box dimensions are switched off. The Super Admin can switch them on in Settings.');
  const platform = String(p.platform || '').trim();
  const order = canonicalOrderId_(p.orderId, platform);
  const rawType = normalize_(p.recordingType || 'Forward');
  const type = rawType === 'return' ? 'Return' : 'Forward';
  if (!order) throw new Error('Order ID is required to save box details.');
  const l = boxNumber_(p.l, 1000), b = boxNumber_(p.b, 1000), h = boxNumber_(p.h, 1000);
  const actual = boxNumber_(p.actualWeight, 1000);
  if ([l, b, h, actual].some(function(x) { return x !== null && isNaN(x); })) {
    throw new Error('Box sizes and weight must be numbers above 0 (cm and kg, up to 1000).');
  }
  const dims = [l, b, h].filter(function(x) { return x !== null; }).length;
  if (dims > 0 && dims < 3) throw new Error('Enter all three: length, breadth and height.');
  if (!dims && actual === null) throw new Error('Enter the box size or the actual weight.');
  const box = String(p.boxName || '').trim().slice(0, 40) || (dims ? 'Custom' : '');
  const w = packageWeights_(l, b, h, actual, s.divisor);
  const row = [new Date(), order, platform, type, box, l === null ? '' : l, b === null ? '' : b, h === null ? '' : h,
    actual === null ? '' : actual, w.volumetric === null ? '' : w.volumetric, w.chargeable === null ? '' : w.chargeable,
    s.divisor, normalize_(user.email)];
  return withScriptLock_(function() {
    const sh = packageDetailsSheet_();
    const values = sh.getDataRange().getValues();
    const key = normalizeOrderId_(order) + '|' + type.toLowerCase();
    let replaced = false;
    for (let i = values.length - 1; i >= 1; i--) {
      const rowType = normalize_(values[i][3]) === 'return' ? 'return' : 'forward';
      if (normalizeOrderId_(values[i][1]) + '|' + rowType !== key) continue;
      if (!replaced) {
        sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
        try { sh.getRange(i + 1, 1).setNumberFormat('dd-mmm-yy hh:mm'); } catch (_) {}
        replaced = true;
      } else {
        sh.deleteRow(i + 1); // an older second row of the same order and type
      }
    }
    if (!replaced) logAppend_(sh, row);
    return {
      success: true, replaced: replaced, orderId: order, platform: platform, recordingType: type, box: box,
      l: l, b: b, h: h, actualWeight: actual, volumetricWeight: w.volumetric, chargeableWeight: w.chargeable, divisor: s.divisor
    };
  });
}

/** Box details by order and type, for reports: key = normalized order id + '|' + forward/return. */
function packageDetailsByOrder_() {
  const out = {};
  let sh = null;
  try { sh = ss_().getSheetByName(CONFIG.PACKAGE_DETAILS_SHEET); } catch (_) { sh = null; }
  if (!sh) return out;
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    const order = normalizeOrderId_(v[i][1]);
    if (!order) continue;
    const t = normalize_(v[i][3]) === 'return' ? 'return' : 'forward';
    out[order + '|' + t] = {
      box: v[i][4], l: v[i][5], b: v[i][6], h: v[i][7], actual: v[i][8], volumetric: v[i][9], chargeable: v[i][10]
    };
  }
  return out;
}

/* =====================================================================================
 * SHOPIFY ORDERS (Super Admin switch)
 * Every 5 minutes (and on "Sync now") the backend asks Shopify for orders created or changed
 * since the last run and keeps one row per order in the ShopifyOrders tab, which is copied to
 * Supabase like every other tab. Order Processing reads these rows: when a team member types or
 * picks a Shopify order, its products, SKUs and quantities fill in by themselves, and each SKU
 * gets its barcode from the GTIN catalog. Nothing about customers (names, addresses, phones)
 * is stored.
 * Credentials live in Script Properties only and are never sent back to the browser:
 *   SHOPIFY_SHOP (xxxx.myshopify.com), and either SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET
 *   (Dev Dashboard app, client credentials grant, token renewed every 24 h) or
 *   SHOPIFY_ADMIN_TOKEN (an older custom app's Admin API token, shpat_...).
 * Branding tab: ShopifyOrdersEnabled (Super Admin only).
 * ===================================================================================== */
const SHOPIFY_ORDERS_SHEET_ = CONFIG.SHOPIFY_ORDERS_SHEET;
const SHOPIFY_ORDERS_HEADERS_ = ['Synced At', 'Order ID', 'Order Date', 'Payment Status', 'Fulfillment Status', 'Order Status',
  'Total Items Count', 'Items List', 'Items JSON', 'Shopify Order ID', 'Shopify Updated At',
  'COD / Prepaid', 'Payment Gateway', 'Tags', 'Customer Name', 'Customer Phone', 'Customer Email',
  'Shipping Pincode', 'Shipping City', 'Shipping State', 'Courier', 'Tracking Number'];
const SHOPIFY_API_VERSION_ = '2026-10';
const SHOPIFY_TRIGGER_HANDLER_ = 'shopifySyncTick';
const SHOPIFY_PAGE_SIZE_ = 50;
const SHOPIFY_MAX_PAGES_ = 20;          // up to 1000 orders per run; the next run carries on
const SHOPIFY_RUN_BUDGET_MS_ = 240000;  // stay well inside the 6-minute Apps Script limit
const SHOPIFY_DEFAULT_BACKFILL_DAYS_ = 3;
// Customer fields need the read_customers scope and Shopify's protected customer data access
// (name, email, phone, address). Without them the sync carries on with the order fields only.
const SHOPIFY_CUSTOMER_FIELDS_ = 'email phone customer{displayName} shippingAddress{name phone zip city province} ';
function shopifyOrdersQuery_(withCustomer) {
  return 'query($q:String!,$after:String){orders(first:' + SHOPIFY_PAGE_SIZE_ +
    ',after:$after,sortKey:UPDATED_AT,query:$q){pageInfo{hasNextPage endCursor}nodes{id name createdAt updatedAt cancelledAt ' +
    'displayFinancialStatus displayFulfillmentStatus paymentGatewayNames tags ' + (withCustomer ? SHOPIFY_CUSTOMER_FIELDS_ : '') +
    'fulfillments(first:5){trackingInfo(first:3){company number}} ' +
    'lineItems(first:100){nodes{id sku name title variantTitle quantity currentQuantity requiresShipping image{url}}}}}}';
}

/** "COD" when paid on delivery, otherwise "Prepaid". */
function shopifyPaymentMode_(o) {
  const gw = (o.paymentGatewayNames || []).join(' | ');
  if (/cash on delivery|\bcod\b/i.test(gw)) return 'COD';
  if (!gw && String(o.displayFinancialStatus || '').toUpperCase() === 'PENDING') return 'COD';
  return 'Prepaid';
}

function shopifyTracking_(o) {
  const out = { company: [], number: [] };
  (o.fulfillments || []).forEach(function(f) {
    ((f && f.trackingInfo) || []).forEach(function(t) {
      if (t && t.company && out.company.indexOf(t.company) === -1) out.company.push(String(t.company));
      if (t && t.number && out.number.indexOf(t.number) === -1) out.number.push(String(t.number));
    });
  });
  return { company: out.company.join(', '), number: out.number.join(', ') };
}

function shopifyConfig_() {
  const props = scriptProps_();
  const days = Number(props.getProperty('SHOPIFY_BACKFILL_DAYS'));
  return {
    shop: String(props.getProperty('SHOPIFY_SHOP') || '').trim(),
    clientId: String(props.getProperty('SHOPIFY_CLIENT_ID') || '').trim(),
    clientSecret: String(props.getProperty('SHOPIFY_CLIENT_SECRET') || '').trim(),
    adminToken: String(props.getProperty('SHOPIFY_ADMIN_TOKEN') || '').trim(),
    apiVersion: String(props.getProperty('SHOPIFY_API_VERSION') || SHOPIFY_API_VERSION_).trim(),
    backfillDays: isFinite(days) && days >= 1 && days <= 60 ? Math.round(days) : SHOPIFY_DEFAULT_BACKFILL_DAYS_
  };
}

/** "ewkjt0-20", "ewkjt0-20.myshopify.com" or "https://ewkjt0-20.myshopify.com/admin" -> "ewkjt0-20.myshopify.com". */
function normalizeShopDomain_(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const adminStore = String(raw || '').match(/admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/i);
  if (adminStore) s = adminStore[1].toLowerCase();
  if (/^[a-z0-9][a-z0-9-]*$/.test(s)) s += '.myshopify.com';
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) {
    throw new Error('Use the store\'s myshopify.com address (for example yourstore.myshopify.com). You can see it in Shopify under Settings > Domains.');
  }
  return s;
}

function shopifyEnabled_(values) {
  const raw = brandingValue_(values || brandingValues_(), 'ShopifyOrdersEnabled');
  return raw === true || /^(true|yes|1|on)$/i.test(String(raw || '').trim());
}

function shopifyHasCredentials_(c) {
  return !!(c.shop && (c.adminToken || (c.clientId && c.clientSecret)));
}

function shopifyLastResult_() {
  try { return JSON.parse(scriptProps_().getProperty('SHOPIFY_LAST_RESULT') || 'null'); } catch (_) { return null; }
}

/** An Admin API access token: the saved one, or a 24-hour one from the client credentials grant. */
function shopifyAccessToken_(c, forceNew) {
  if (c.adminToken) return c.adminToken;
  if (!c.clientId || !c.clientSecret) throw new Error('Shopify is not connected yet. The Super Admin can add the app\'s client ID and secret in Settings > Shopify orders.');
  const props = scriptProps_();
  if (!forceNew) {
    try {
      const hit = JSON.parse(props.getProperty('SHOPIFY_TOKEN_CACHE') || 'null');
      if (hit && hit.t && hit.shop === c.shop && hit.id === c.clientId && Number(hit.exp) > Date.now() + 10 * 60000) return hit.t;
    } catch (_) {}
  }
  const res = UrlFetchApp.fetch('https://' + c.shop + '/admin/oauth/access_token', {
    method: 'post',
    payload: { client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'client_credentials' },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  let body = null;
  try { body = JSON.parse(text); } catch (_) { body = null; }
  if (code >= 300 || !body || !body.access_token) {
    const why = body ? String(body.error_description || body.error || '') : String(text || '').slice(0, 200);
    if (/shop_not_permitted/i.test(why + text)) {
      throw new Error('Shopify refused the app for this store. Create the app in the Dev Dashboard of the same Shopify organization as the store, install it on the store, then try again.');
    }
    if (code === 400 || code === 401 || /invalid_client|client/i.test(why)) {
      throw new Error('Shopify did not accept the client ID and secret (HTTP ' + code + '). Copy them again from the Dev Dashboard > your app > Settings.');
    }
    throw new Error('Could not get a Shopify access token (HTTP ' + code + ')' + (why ? ': ' + why : '.'));
  }
  const exp = Date.now() + Math.max(600, Number(body.expires_in) || 86399) * 1000;
  try { props.setProperty('SHOPIFY_TOKEN_CACHE', JSON.stringify({ t: body.access_token, exp: exp, shop: c.shop, id: c.clientId })); } catch (_) {}
  return body.access_token;
}

/** One Admin GraphQL call with token renewal and throttle retries. */
function shopifyGraphql_(c, query, variables) {
  let token = shopifyAccessToken_(c, false);
  let renewed = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = UrlFetchApp.fetch('https://' + c.shop + '/admin/api/' + c.apiVersion + '/graphql.json', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Shopify-Access-Token': token },
      payload: JSON.stringify({ query: query, variables: variables || {} }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    const text = res.getContentText();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { body = null; }
    if (code === 401 && !c.adminToken && !renewed) { token = shopifyAccessToken_(c, true); renewed = true; continue; }
    if (code === 401 || code === 403) {
      throw new Error('Shopify refused the request (HTTP ' + code + '). Check that the app is installed on the store and has the read_orders and read_products access scopes.');
    }
    const throttled = code === 429 || (body && body.errors && JSON.stringify(body.errors).indexOf('THROTTLED') !== -1);
    if (throttled || code >= 500) { Utilities.sleep(1500 * (attempt + 1)); continue; }
    if (code >= 300) throw new Error('Shopify request failed (HTTP ' + code + '): ' + String(text || '').slice(0, 200));
    if (body && body.errors && body.errors.length) {
      const msg = body.errors.map(function(e) { return e && e.message ? e.message : String(e); }).join('; ');
      if (/access denied|access scope|read_orders/i.test(msg)) {
        throw new Error('The Shopify app needs the read_orders and read_products access scopes: ' + msg.slice(0, 200));
      }
      throw new Error('Shopify: ' + msg.slice(0, 300));
    }
    return body ? body.data : null;
  }
  throw new Error('Shopify is busy right now. The next sync will try again.');
}

function shopifyOrderStatus_(o) {
  if (o.cancelledAt) return 'Cancelled';
  const f = String(o.displayFulfillmentStatus || '').toUpperCase();
  if (f === 'FULFILLED') return 'Fulfilled';
  return 'Open';
}

/** Line items that need packing: shippable, with the quantity left after edits and refunds. */
function shopifyItems_(o) {
  const nodes = (o.lineItems && o.lineItems.nodes) || [];
  const items = [];
  nodes.forEach(function(li) {
    if (!li || li.requiresShipping === false) return;
    const qty = Number(li.currentQuantity !== undefined && li.currentQuantity !== null ? li.currentQuantity : li.quantity);
    if (!(qty > 0)) return;
    items.push({
      sku: String(li.sku || '').trim(),
      name: String(li.name || li.title || '').trim(),
      variant: String(li.variantTitle || '').trim(),
      quantity: Math.round(qty),
      imageUrl: li.image && li.image.url ? String(li.image.url) : ''
    });
  });
  return items;
}

function shopifyOrdersSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHOPIFY_ORDERS_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(SHOPIFY_ORDERS_SHEET_);
    sh.getRange(1, 1, 1, SHOPIFY_ORDERS_HEADERS_.length).setValues([SHOPIFY_ORDERS_HEADERS_]);
    try { sh.setFrozenRows(1); sh.getRange(1, 1, 1, SHOPIFY_ORDERS_HEADERS_.length).setFontWeight('bold'); } catch (_) {}
  } else {
    // Columns added in later versions go on the right; existing columns never move.
    const head = sh.getRange(1, 1, 1, SHOPIFY_ORDERS_HEADERS_.length).getValues()[0];
    if (head.some(function(h, i) { return String(h || '') !== SHOPIFY_ORDERS_HEADERS_[i]; })) {
      sh.getRange(1, 1, 1, SHOPIFY_ORDERS_HEADERS_.length).setValues([SHOPIFY_ORDERS_HEADERS_]);
      try { sbTouchTabs_([SHOPIFY_ORDERS_SHEET_]); } catch (_) {}
    }
  }
  return sh;
}

function shopifyRowValues_(o, items) {
  const total = items.reduce(function(s, it) { return s + it.quantity; }, 0);
  const listed = items.map(function(it) { return { shortName: it.name, sku: it.sku, quantity: it.quantity }; });
  const ship = o.shippingAddress || null;
  const track = shopifyTracking_(o);
  return [
    new Date(),
    canonicalOrderId_(o.name, 'D2C'),
    o.createdAt ? new Date(o.createdAt) : '',
    String(o.displayFinancialStatus || ''),
    String(o.displayFulfillmentStatus || ''),
    shopifyOrderStatus_(o),
    total,
    formatItemsList_(listed),
    JSON.stringify(items),
    String(o.id || ''),
    o.updatedAt ? new Date(o.updatedAt) : '',
    shopifyPaymentMode_(o),
    (o.paymentGatewayNames || []).join(', '),
    (o.tags || []).join(', '),
    String((ship && ship.name) || (o.customer && o.customer.displayName) || ''),
    String((ship && ship.phone) || o.phone || ''),
    String(o.email || ''),
    String((ship && ship.zip) || ''),
    String((ship && ship.city) || ''),
    String((ship && ship.province) || ''),
    track.company,
    track.number
  ];
}

/**
 * A Shopify order was cancelled: an order already assigned in Order Processing and not packed yet
 * is marked Cancelled there too, so the packer is stopped at scan time.
 */
function shopifyCancelManifests_(orderKeys) {
  if (!orderKeys.length) return 0;
  const sh = ss_().getSheetByName(CONFIG.ORDER_MANIFEST_SHEET);
  if (!sh) return 0;
  const data = sh.getDataRange().getValues();
  const want = {};
  orderKeys.forEach(function(k) { want[k] = true; });
  let n = 0;
  for (let i = 1; i < data.length; i++) {
    if (!want[normalizeOrderId_(data[i][1])]) continue;
    const st = String(data[i][9] || 'Pending').trim();
    if (st !== 'Pending' && st !== 'In Progress') continue;
    const note = String(data[i][10] || '');
    sh.getRange(i + 1, 10, 1, 2).setValues([['Cancelled', (note ? note + ' | ' : '') + 'Cancelled in Shopify']]);
    try { sbTouch_(sh, i + 1); } catch (_) {}
    n++;
  }
  if (n) { try { bumpManifestVersion_(); } catch (_) {} }
  return n;
}

/** Fetch new and changed Shopify orders into the ShopifyOrders tab. */
function shopifySync_(opts) {
  opts = opts || {};
  const started = Date.now();
  const c = shopifyConfig_();
  if (!shopifyHasCredentials_(c)) throw new Error('Shopify is not connected yet. The Super Admin can connect it in Settings > Shopify orders.');
  const props = scriptProps_();
  return withScriptLock_(function() {
    const cursor = String(props.getProperty('SHOPIFY_SYNC_CURSOR') || '');
    let q;
    const firstRun = !cursor;
    if (firstRun) {
      const from = new Date(Date.now() - c.backfillDays * 86400000);
      q = "created_at:>='" + from.toISOString() + "'";
    } else {
      // Look back two minutes so an order saved while the last run was reading is not missed.
      q = "updated_at:>='" + new Date(new Date(cursor).getTime() - 120000).toISOString() + "'";
    }
    const sh = shopifyOrdersSheet_();
    const data = sh.getDataRange().getValues();
    const rowOf = {};
    for (let i = 1; i < data.length; i++) {
      const k = normalizeOrderId_(data[i][1]);
      if (k && !rowOf[k]) rowOf[k] = i + 1;
    }
    let after = null, pages = 0, fetched = 0, added = 0, updated = 0, unchanged = 0, skipped = 0;
    let withCustomer = true, customerNote = '';
    let maxUpdated = cursor, more = false;
    const cancelledKeys = [];
    do {
      let d;
      try {
        d = shopifyGraphql_(c, shopifyOrdersQuery_(withCustomer), { q: q, after: after });
      } catch (e) {
        // No access to customer data yet: keep importing orders without it.
        if (!withCustomer || !/customer|protected|access denied|scope|shippingAddress|email|phone/i.test(String(e && e.message))) throw e;
        withCustomer = false;
        customerNote = 'Customer name, phone, email and address were not saved: ' + String(e.message).slice(0, 200);
        d = shopifyGraphql_(c, shopifyOrdersQuery_(false), { q: q, after: after });
      }
      const conn = d && d.orders;
      if (!conn) break;
      pages++;
      (conn.nodes || []).forEach(function(o) {
        if (!o || !o.name) return;
        fetched++;
        if (o.updatedAt && (!maxUpdated || o.updatedAt > maxUpdated)) maxUpdated = o.updatedAt;
        const key = normalizeOrderId_(canonicalOrderId_(o.name, 'D2C'));
        const items = shopifyItems_(o);
        const vals = shopifyRowValues_(o, items);
        const at = rowOf[key];
        if (at) {
          const old = data[at - 1] || [];
          if (!withCustomer) for (let j = 14; j <= 19; j++) vals[j] = old[j] === undefined ? '' : old[j]; // keep what was saved
          const cell = function(v) { return v instanceof Date ? String(v.getTime()) : String(v === null || v === undefined ? '' : v); };
          let same = true;
          for (let j = 1; j < vals.length; j++) if (cell(old[j]) !== cell(vals[j])) { same = false; break; }
          if (same) { unchanged++; return; }
          vals[0] = old[0] instanceof Date ? old[0] : vals[0]; // keep when the order first arrived
          sh.getRange(at, 1, 1, vals.length).setValues([vals]);
          formatDateRows_(sh, at, 1);
          try { sbTouch_(sh, at); } catch (_) {}
          if (vals[5] === 'Cancelled' && String(old[5] || '') !== 'Cancelled') cancelledKeys.push(key);
          data[at - 1] = vals;
          updated++;
        } else {
          // Orders that are already cancelled or shipped before they ever reached VMS are not added.
          if (vals[5] !== 'Open' || !items.length) { skipped++; return; }
          logAppend_(sh, vals);
          rowOf[key] = sh.getLastRow();
          data[rowOf[key] - 1] = vals;
          added++;
        }
      });
      more = !!(conn.pageInfo && conn.pageInfo.hasNextPage);
      after = more ? conn.pageInfo.endCursor : null;
    } while (more && pages < SHOPIFY_MAX_PAGES_ && Date.now() - started < SHOPIFY_RUN_BUDGET_MS_);
    let cancelledManifests = 0;
    try { cancelledManifests = shopifyCancelManifests_(cancelledKeys); } catch (e) { console.warn('Shopify cancel manifests:', e); }
    // Orders come sorted by update time, so the cursor only moves past what was really read.
    if (maxUpdated) props.setProperty('SHOPIFY_SYNC_CURSOR', maxUpdated);
    else if (firstRun) props.setProperty('SHOPIFY_SYNC_CURSOR', new Date(started).toISOString());
    const result = {
      success: true, at: new Date().toISOString(), fetched: fetched, added: added, updated: updated, unchanged: unchanged,
      skipped: skipped, cancelledManifests: cancelledManifests, pages: pages, more: more, firstRun: firstRun,
      ms: Date.now() - started, source: opts.source || 'manual', customerData: withCustomer, note: customerNote
    };
    try { props.setProperty('SHOPIFY_LAST_RESULT', JSON.stringify(result)); } catch (_) {}
    return result;
  }, 30000);
}

function shopifyRecordFailure_(e, source) {
  const result = { success: false, at: new Date().toISOString(), error: e && e.message ? e.message : String(e), source: source };
  try { scriptProps_().setProperty('SHOPIFY_LAST_RESULT', JSON.stringify(result)); } catch (_) {}
  return result;
}

/** Time trigger, every 5 minutes. */
function shopifySyncTick() {
  if (!shopifyEnabled_()) return;
  if (!shopifyHasCredentials_(shopifyConfig_())) return;
  try { shopifySync_({ source: 'auto' }); }
  catch (e) { console.warn('Shopify sync:', e); shopifyRecordFailure_(e, 'auto'); }
  try { sbFlush_(false); } catch (e) { console.warn('Supabase copy after Shopify sync:', e); }
}

function shopifyEnsureTrigger_() {
  const all = ScriptApp.getProjectTriggers();
  for (let i = 0; i < all.length; i++) if (all[i].getHandlerFunction() === SHOPIFY_TRIGGER_HANDLER_) return true;
  ScriptApp.newTrigger(SHOPIFY_TRIGGER_HANDLER_).timeBased().everyMinutes(5).create();
  return true;
}

function shopifyRemoveTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === SHOPIFY_TRIGGER_HANDLER_) ScriptApp.deleteTrigger(t);
  });
}

function shopifyHasTrigger_() {
  try { return ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === SHOPIFY_TRIGGER_HANDLER_; }); }
  catch (_) { return false; }
}

/** Super Admin: what is set up (secrets are only reported as saved / not saved). */
function getShopifySettings_(p) {
  session_(p.token);
  const c = shopifyConfig_();
  const tokenMode = c.adminToken ? 'adminToken' : (c.clientId && c.clientSecret ? 'clientCredentials' : '');
  return {
    success: true,
    enabled: shopifyEnabled_(),
    shop: c.shop,
    clientId: c.clientId,
    hasClientSecret: !!c.clientSecret,
    hasAdminToken: !!c.adminToken,
    connectedWith: tokenMode,
    backfillDays: c.backfillDays,
    autoSync: shopifyHasTrigger_(),
    cursor: String(scriptProps_().getProperty('SHOPIFY_SYNC_CURSOR') || ''),
    lastResult: shopifyLastResult_()
  };
}

/** Super Admin: save the store address / credentials and switch the feature on or off. */
function saveShopifySettings_(p) {
  const user = session_(p.token);
  const props = scriptProps_();
  if (p.shop !== undefined) {
    const shop = normalizeShopDomain_(p.shop);
    if (shop !== String(props.getProperty('SHOPIFY_SHOP') || '')) {
      props.deleteProperty('SHOPIFY_TOKEN_CACHE');
      props.deleteProperty('SHOPIFY_SYNC_CURSOR'); // a different store starts with a fresh first import
    }
    if (shop) props.setProperty('SHOPIFY_SHOP', shop); else props.deleteProperty('SHOPIFY_SHOP');
  }
  if (p.clientId !== undefined) {
    const id = String(p.clientId || '').trim();
    if (id) props.setProperty('SHOPIFY_CLIENT_ID', id); else props.deleteProperty('SHOPIFY_CLIENT_ID');
    props.deleteProperty('SHOPIFY_TOKEN_CACHE');
  }
  if (p.clientSecret) { props.setProperty('SHOPIFY_CLIENT_SECRET', String(p.clientSecret).trim()); props.deleteProperty('SHOPIFY_TOKEN_CACHE'); }
  if (p.clearClientSecret === true) { props.deleteProperty('SHOPIFY_CLIENT_SECRET'); props.deleteProperty('SHOPIFY_TOKEN_CACHE'); }
  if (p.adminToken) props.setProperty('SHOPIFY_ADMIN_TOKEN', String(p.adminToken).trim());
  if (p.clearAdminToken === true) props.deleteProperty('SHOPIFY_ADMIN_TOKEN');
  if (p.backfillDays !== undefined && p.backfillDays !== null && p.backfillDays !== '') {
    const d = Number(p.backfillDays);
    if (!isFinite(d) || d < 1 || d > 60) throw new Error('First import can go back 1 to 60 days.');
    props.setProperty('SHOPIFY_BACKFILL_DAYS', String(Math.round(d)));
  }
  if (p.enabled !== undefined) {
    const on = p.enabled === true || String(p.enabled) === 'true';
    if (on && !shopifyHasCredentials_(shopifyConfig_())) {
      throw new Error('Add the store address and the app\'s client ID and secret (or an Admin API token) before switching Shopify orders on.');
    }
    brandingSet_('ShopifyOrdersEnabled', on ? 'TRUE' : 'FALSE', 'Fetch Shopify orders into VMS every 5 minutes (Super Admin only)');
    try { if (on) shopifyEnsureTrigger_(); else shopifyRemoveTrigger_(); } catch (e) { console.warn('Shopify trigger:', e); }
    if (on) shopifyOrdersSheet_();
    securityLog_(user.email, 'SHOPIFY_FEATURE', 'SUCCESS', on ? 'Enabled' : 'Disabled');
  } else {
    securityLog_(user.email, 'SHOPIFY_SETTINGS', 'SUCCESS', 'Connection details updated');
  }
  return getShopifySettings_(p);
}

/** Super Admin: check the connection without importing anything. */
function testShopifyConnection_(p) {
  session_(p.token);
  const c = shopifyConfig_();
  if (!shopifyHasCredentials_(c)) throw new Error('Add the store address and the app\'s client ID and secret (or an Admin API token) first.');
  const d = shopifyGraphql_(c, '{shop{name myshopifyDomain}orders(first:1,sortKey:CREATED_AT,reverse:true){nodes{name createdAt}}}', {});
  const last = d && d.orders && d.orders.nodes && d.orders.nodes[0];
  return {
    success: true,
    shopName: d && d.shop ? d.shop.name : '',
    shop: d && d.shop ? d.shop.myshopifyDomain : c.shop,
    latestOrder: last ? canonicalOrderId_(last.name, 'D2C') : '',
    latestOrderAt: last ? last.createdAt : ''
  };
}

/** Any signed-in member: fetch new orders now (at most once every 20 seconds). */
function shopifySyncNow_(p) {
  session_(p.token);
  if (!shopifyEnabled_()) throw new Error('Shopify orders are switched off. The Super Admin can switch them on in Settings.');
  const last = shopifyLastResult_();
  if (!p.force && last && last.success && Date.now() - new Date(last.at).getTime() < 20000) return last;
  try { return shopifySync_({ source: 'manual' }); }
  catch (e) { return shopifyRecordFailure_(e, 'manual'); }
}

/** GTIN catalog rows by SKU (upper case), from the GTINCatalog tab. */
function catalogBySku_() {
  const out = {};
  let sh = null;
  try { sh = ss_().getSheetByName(CONFIG.GTIN_CATALOG_SHEET); } catch (_) { sh = null; }
  if (!sh) return out;
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return out;
  const col = detectCatalogColumns_(v[0]);
  const gi = col.gtin !== undefined ? col.gtin : 1, si = col.sku !== undefined ? col.sku : 2;
  const ni = col.name !== undefined ? col.name : 3, shi = col.shortName !== undefined ? col.shortName : 4;
  const ii = col.image !== undefined ? col.image : 6;
  for (let i = 1; i < v.length; i++) {
    const sku = String(v[i][si] || '').trim().toUpperCase();
    const gtin = String(v[i][gi] || '').trim().replace(/\.0+$/, '');
    if (!sku || !gtin || out[sku]) continue;
    out[sku] = { gtin: gtin, productName: String(v[i][ni] || ''), shortName: String(v[i][shi] || ''), imageUrl: String(v[i][ii] || '') };
  }
  return out;
}

/**
 * Any signed-in member: Shopify orders with their products, each matched to its barcode in the
 * GTIN catalog by SKU. status: 'open' (default), 'all'.
 */
function getShopifyOrders_(p) {
  p = p || {};
  session_(p.token);
  const enabled = shopifyEnabled_();
  if (!enabled) return { success: true, enabled: false, orders: [] };
  let sh = null;
  try { sh = ss_().getSheetByName(SHOPIFY_ORDERS_SHEET_); } catch (_) { sh = null; }
  if (!sh) return { success: true, enabled: true, orders: [], lastSync: null };
  const v = sh.getDataRange().getValues();
  const catalog = catalogBySku_();
  const want = String(p.status || 'open').toLowerCase();
  const only = p.orderId ? normalizeOrderId_(p.orderId) : '';
  const limit = Math.min(Math.max(Number(p.limit) || 1000, 1), 5000);
  const iso = function(x) { return x instanceof Date ? (isNaN(x.getTime()) ? '' : x.toISOString()) : String(x || ''); };
  const orders = [];
  let lastSync = '';
  for (let i = v.length - 1; i >= 1; i--) {
    const r = v[i];
    const orderId = String(r[1] || '').trim();
    if (!orderId) continue;
    const synced = iso(r[0]);
    if (synced > lastSync) lastSync = synced;
    if (only && normalizeOrderId_(orderId) !== only) continue;
    const status = String(r[5] || 'Open');
    if (!only && want === 'open' && status !== 'Open') continue;
    let raw = [];
    try { raw = JSON.parse(String(r[8] || '[]')); } catch (_) { raw = []; }
    if (!Array.isArray(raw)) raw = [];
    let missing = 0;
    const items = raw.map(function(it, n) {
      const sku = String(it.sku || '').trim();
      const hit = sku ? catalog[sku.toUpperCase()] : null;
      if (!hit) missing++;
      return {
        id: 'shopify-' + (n + 1),
        sku: sku,
        productName: (hit && hit.productName) || String(it.name || ''),
        shortName: (hit && (hit.shortName || hit.productName)) || String(it.name || ''),
        shopifyName: String(it.name || ''),
        gtin: hit ? hit.gtin : '',
        quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
        imageUrl: (hit && hit.imageUrl) || String(it.imageUrl || ''),
        inCatalog: !!hit
      };
    });
    orders.push({
      orderId: orderId, orderDate: iso(r[2]), payment: String(r[3] || ''), fulfillment: String(r[4] || ''), status: status,
      paymentMode: String(r[11] || ''), tags: String(r[13] || ''),
      totalItems: Number(r[6]) || items.reduce(function(s, it) { return s + it.quantity; }, 0),
      items: items, missingGtin: missing, syncedAt: synced
    });
    if (orders.length >= limit) break;
  }
  orders.sort(function(a, b) { return String(b.orderDate).localeCompare(String(a.orderDate)); });
  return { success: true, enabled: true, orders: orders, lastSync: lastSync || null };
}

/* =====================================================================================
 * RETURN DETAILS & RTO ANALYTICS
 * When a Return video is recorded, the station also notes what kind of return it is (RTO =
 * the courier brought back an order that was never delivered, or a customer return), which
 * logistics partner brought it back, the condition it came back in, notes, whether the
 * customer said they never received it, and the customer's pincode / name / phone (filled in
 * from the Shopify order when that data is there). One row per order in the ReturnDetails tab.
 * Logistics partners are a shared list in the Branding tab (LogisticsPartners, JSON): any
 * member can add one; the member who added it or an Admin can remove it.
 * getReturnAnalytics_ turns this into return / RTO counts and rates by logistics partner,
 * pincode, condition and customer, plus repeat and suspicious customers.
 * ===================================================================================== */
const RETURN_DETAILS_HEADERS_ = ['Timestamp', 'Order ID', 'Platform', 'Return Type', 'Logistics Partner', 'Return Condition',
  'Notes', 'Pincode', 'Customer Name', 'Customer Phone', 'Customer Email', 'Not Received Claim', 'Recorded By'];
const RETURN_TYPES_ = ['RTO', 'Customer Return'];
const RETURN_CONDITIONS_ = ['Good / resellable', 'Opened / used', 'Damaged', 'Missing items', 'Wrong item', 'Empty box'];
const DEFAULT_LOGISTICS_PARTNERS_ = ['Delhivery', 'Blue Dart', 'DTDC', 'Ekart', 'Xpressbees', 'Shadowfax', 'Ecom Express', 'India Post'];
const MAX_LOGISTICS_PARTNERS_ = 100;
const SHOPIFY_ORDERS_TAB_ = 'ShopifyOrders';

function parseLogisticsPartners_(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_LOGISTICS_PARTNERS_.map(function(n, i) { return { id: 'd' + (i + 1), name: n, by: '' }; });
  }
  let list = [];
  try { list = JSON.parse(String(raw)); } catch (_) { list = []; }
  if (!Array.isArray(list)) return [];
  return list.filter(function(x) { return x && String(x.name || '').trim(); })
    .map(function(x) { return { id: String(x.id || ''), name: String(x.name).trim(), by: String(x.by || '') }; });
}

function returnSettings_() {
  return {
    partners: parseLogisticsPartners_(brandingValue_(brandingValues_(), 'LogisticsPartners')),
    conditions: RETURN_CONDITIONS_.slice(),
    returnTypes: RETURN_TYPES_.slice()
  };
}

/** Any signed-in member: the logistics partner list and the return conditions. */
function getReturnSettings_(p) {
  session_(p.token);
  const s = returnSettings_();
  return { success: true, partners: s.partners, conditions: s.conditions, returnTypes: s.returnTypes };
}

/** Any member: add a logistics partner (kept for everyone). Same name again returns the existing one. */
function saveLogisticsPartner_(p) {
  const user = session_(p.token);
  return withScriptLock_(function() {
    const s = returnSettings_();
    const name = String(p.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name) throw new Error('Type the logistics partner name, for example Delhivery.');
    const list = s.partners;
    let item = list.find(function(x) { return normalize_(x.name) === normalize_(name); });
    if (!item) {
      if (list.length >= MAX_LOGISTICS_PARTNERS_) throw new Error('Up to ' + MAX_LOGISTICS_PARTNERS_ + ' logistics partners can be saved. Remove one first.');
      item = { id: Utilities.getUuid().slice(0, 8), name: name, by: normalize_(user.email) };
      list.push(item);
      brandingSet_('LogisticsPartners', JSON.stringify(list), 'Logistics partners that bring back returns (shared list)');
    }
    return { success: true, partner: item, partners: list, conditions: s.conditions, returnTypes: s.returnTypes };
  });
}

/** Remove a logistics partner: the member who added it, or an Admin. Saved returns keep their name. */
function deleteLogisticsPartner_(p) {
  const user = session_(p.token);
  const access = REQ_ACCESS_ && REQ_ACCESS_.access;
  const isAdmin = isAdminRole_(access ? access.role : user.role);
  return withScriptLock_(function() {
    const s = returnSettings_();
    const id = String(p.id || '').trim();
    const at = s.partners.findIndex(function(x) { return x.id === id; });
    if (at < 0) throw new Error('That logistics partner was already removed.');
    const by = s.partners[at].by;
    if (!isAdmin && (!by || by !== normalize_(user.email))) {
      throw new Error('Only the member who added this logistics partner or an Admin can remove it.');
    }
    s.partners.splice(at, 1);
    brandingSet_('LogisticsPartners', JSON.stringify(s.partners), 'Logistics partners that bring back returns (shared list)');
    return { success: true, partners: s.partners, conditions: s.conditions, returnTypes: s.returnTypes };
  });
}

function returnDetailsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(CONFIG.RETURN_DETAILS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.RETURN_DETAILS_SHEET);
    sh.getRange(1, 1, 1, RETURN_DETAILS_HEADERS_.length).setValues([RETURN_DETAILS_HEADERS_]);
    try { sh.setFrozenRows(1); sh.getRange(1, 1, 1, RETURN_DETAILS_HEADERS_.length).setFontWeight('bold'); } catch (_) {}
  }
  return sh;
}

/** Indian mobile numbers compare on the last 10 digits (+91 / 0 prefixes dropped). */
function normalizePhone_(v) {
  const d = String(v || '').replace(/\D+/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

function normalizePincode_(v) {
  const d = String(v || '').replace(/\D+/g, '');
  return d.length >= 6 ? d.slice(0, 6) : d;
}

function returnTypeOf_(v) {
  const t = normalize_(v);
  if (!t) return '';
  if (t === 'rto' || t.indexOf('rto') === 0 || t.indexOf('not delivered') >= 0 || t.indexOf('undelivered') >= 0) return 'RTO';
  return 'Customer Return';
}

function truthy_(v) {
  return v === true || /^(true|yes|1|y)$/i.test(String(v || '').trim());
}

/** Save the return details of one order (one row per order; saving again replaces it). */
function saveReturnDetails_(p) {
  const user = session_(p.token);
  const platform = String(p.platform || '').trim();
  const order = canonicalOrderId_(p.orderId, platform);
  if (!order) throw new Error('Order ID is required to save return details.');
  const type = returnTypeOf_(p.returnType);
  const partner = String(p.logisticsPartner || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const condition = String(p.condition || '').trim().slice(0, 40);
  const notes = String(p.notes || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 500);
  const rawPin = String(p.pincode || '').trim();
  const pin = normalizePincode_(rawPin);
  if (rawPin && !/^\d{6}$/.test(pin)) throw new Error('Pincode must be 6 digits.');
  const name = String(p.customerName || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const phone = normalizePhone_(p.customerPhone);
  if (p.customerPhone && String(p.customerPhone).trim() && phone.length < 10) throw new Error('Customer phone must have 10 digits.');
  const email = normalize_(p.customerEmail).slice(0, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Customer email does not look right.');
  const claim = truthy_(p.notReceivedClaim);
  if (!type && !partner && !condition && !notes && !pin && !name && !phone && !claim) {
    throw new Error('Fill in at least one return detail.');
  }
  // Partner names typed here that are not on the list yet are added for everyone.
  if (partner) {
    try {
      const s = returnSettings_();
      if (!s.partners.some(function(x) { return normalize_(x.name) === normalize_(partner); })) saveLogisticsPartner_({ token: p.token, name: partner });
    } catch (_) {}
  }
  const row = [new Date(), order, platform, type, partner, condition, notes, pin, name, phone, email, claim ? 'Yes' : 'No', normalize_(user.email)];
  return withScriptLock_(function() {
    const sh = returnDetailsSheet_();
    const values = sh.getDataRange().getValues();
    const key = normalizeOrderId_(order);
    let replaced = false;
    for (let i = values.length - 1; i >= 1; i--) {
      if (normalizeOrderId_(values[i][1]) !== key) continue;
      if (!replaced) {
        sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
        try { sh.getRange(i + 1, 1).setNumberFormat(SHEET_DATE_FORMAT_); } catch (_) {}
        replaced = true;
      } else {
        sh.deleteRow(i + 1);
      }
    }
    if (!replaced) logAppend_(sh, row);
    try { bumpAnalyticsVersion_(); } catch (_) {}
    return {
      success: true, replaced: replaced, orderId: order, platform: platform, returnType: type, logisticsPartner: partner,
      condition: condition, notes: notes, pincode: pin, customerName: name, customerPhone: phone, customerEmail: email,
      notReceivedClaim: claim
    };
  });
}

function returnDetailsRows_() {
  const out = [];
  let sh = null;
  try { sh = ss_().getSheetByName(CONFIG.RETURN_DETAILS_SHEET); } catch (_) { sh = null; }
  if (!sh) return out;
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    const order = String(v[i][1] || '').trim();
    if (!order) continue;
    out.push({
      ts: rowDate_(v[i][0]), orderId: order, key: normalizeOrderId_(order), platform: String(v[i][2] || '').trim(),
      returnType: returnTypeOf_(v[i][3]), partner: String(v[i][4] || '').trim(), condition: String(v[i][5] || '').trim(),
      notes: String(v[i][6] || '').trim(), pincode: normalizePincode_(v[i][7]), name: String(v[i][8] || '').trim(),
      phone: normalizePhone_(v[i][9]), email: normalize_(v[i][10]), claim: truthy_(v[i][11]), by: String(v[i][12] || '').trim()
    });
  }
  return out;
}

function returnDetailsByOrder_() {
  const out = {};
  returnDetailsRows_().forEach(function(r) { out[r.key] = r; });
  return out;
}

/**
 * Orders with customer data, read from the ShopifyOrders tab by header name (so it keeps working
 * as columns are added). Returns { available, hasCustomer, hasPincode, hasCourier, byOrder, list }.
 */
function orderDirectory_() {
  const out = { available: false, hasCustomer: false, hasPincode: false, hasCourier: false, byOrder: {}, list: [] };
  let sh = null;
  try { sh = ss_().getSheetByName(SHOPIFY_ORDERS_TAB_); } catch (_) { sh = null; }
  if (!sh) return out;
  const v = sh.getDataRange().getValues();
  if (v.length < 1) return out;
  const h = v[0].map(function(x) { return String(x || '').trim().toLowerCase(); });
  const find = function(res) {
    for (let r = 0; r < res.length; r++) for (let i = 0; i < h.length; i++) if (res[r].test(h[i])) return i;
    return -1;
  };
  const c = {
    order: find([/^order\s*(id|no|number|name)$/, /^order$/]),
    date: find([/^order\s*date/, /^created/, /^synced\s*at/]),
    name: find([/^customer\s*name$/, /^shipping\s*name$/, /^customer$/, /^name$/]),
    phone: find([/phone|mobile/]),
    email: find([/e-?mail/]),
    pin: find([/pin\s*code|pincode|zip|postal/]),
    city: find([/city/]),
    state: find([/^(shipping\s*)?state$|province/]),
    courier: find([/courier|carrier|tracking\s*company|logistic/]),
    status: find([/^order\s*status$/, /^fulfil?ment(\s*status)?$/]),
    tags: find([/^tags?$/, /^order\s*tags?$/]),
    payMode: find([/^cod\s*\/\s*prepaid$/, /^payment\s*mode$/, /^payment\s*method$/])
  };
  if (c.order < 0) return out;
  out.available = true;
  out.hasCustomer = c.phone >= 0 || c.email >= 0 || c.name >= 0;
  out.hasPincode = c.pin >= 0;
  out.hasCourier = c.courier >= 0;
  out.hasTags = c.tags >= 0;
  out.hasPayMode = c.payMode >= 0;
  const cell = function(row, i) { return i >= 0 ? row[i] : ''; };
  for (let i = 1; i < v.length; i++) {
    const order = String(cell(v[i], c.order) || '').trim();
    if (!order) continue;
    const o = {
      orderId: order, key: normalizeOrderId_(order), date: rowDate_(cell(v[i], c.date)),
      name: String(cell(v[i], c.name) || '').trim(), phone: normalizePhone_(cell(v[i], c.phone)),
      email: normalize_(cell(v[i], c.email)), pincode: normalizePincode_(cell(v[i], c.pin)),
      city: String(cell(v[i], c.city) || '').trim(), state: String(cell(v[i], c.state) || '').trim(),
      courier: String(cell(v[i], c.courier) || '').trim(), status: String(cell(v[i], c.status) || '').trim(),
      tags: String(cell(v[i], c.tags) || '').split(',').map(function(t) { return t.trim(); }).filter(String),
      payMode: String(cell(v[i], c.payMode) || '').trim()
    };
    out.byOrder[o.key] = o;
    out.list.push(o);
  }
  return out;
}

/** Return details already saved for an order, and the customer from the order data (if any). */
function getReturnOrderInfo_(p) {
  session_(p.token);
  const key = normalizeOrderId_(canonicalOrderId_(p.orderId, p.platform));
  if (!key) throw new Error('Order ID is required.');
  const saved = returnDetailsByOrder_()[key] || null;
  let order = null;
  try { order = orderDirectory_().byOrder[key] || null; } catch (_) { order = null; }
  const pub = function(r) {
    return r ? {
      returnType: r.returnType || '', logisticsPartner: r.partner || r.courier || '', condition: r.condition || '', notes: r.notes || '',
      pincode: r.pincode || '', customerName: r.name || '', customerPhone: r.phone || '', customerEmail: r.email || '',
      notReceivedClaim: !!r.claim, city: r.city || '', state: r.state || ''
    } : null;
  };
  return { success: true, saved: pub(saved), order: pub(order) };
}

/** Who a customer is across orders: phone first, then email, then name + pincode. */
function customerKey_(r) {
  if (r.phone && r.phone.length >= 10) return 'p:' + r.phone;
  if (r.email) return 'e:' + r.email;
  if (r.name && r.pincode) return 'n:' + normalize_(r.name).replace(/\s+/g, ' ') + '|' + r.pincode;
  return '';
}

function maskPhone_(ph) {
  return ph && ph.length >= 10 ? ph.slice(0, 2) + 'xxxxxx' + ph.slice(-2) : ph || '';
}

/**
 * Return & RTO analytics for a date range (by return date; order counts by order date).
 * Rates use the order data when it has the field (pincode, courier, customer); otherwise
 * the forward videos recorded in the same range are the denominator for the overall rate.
 */
function getReturnAnalytics_(p) {
  const user = session_(p.token);
  const from = parseDateStart_(p.fromDate), to = parseDateEnd_(p.toDate);
  if (isNaN(from) || isNaN(to)) throw new Error('Invalid dates.');
  if (from > to) throw new Error('From Date cannot be after To Date.');
  const minFlags = Math.max(2, Number(p.suspiciousThreshold) || 2);
  const platform = normalize_(p.platform);
  const dir = orderDirectory_();
  const details = returnDetailsByOrder_();
  // Optional Shopify tag filter: an exact tag, or "AiSensy*" for every tag starting with AiSensy.
  const tagF = String(p.tag || '').trim().toLowerCase();
  const tagOk = function(key) {
    if (!tagF) return true;
    const o = dir.byOrder[key];
    if (!o) return false;
    return o.tags.some(function(t) {
      const x = t.toLowerCase();
      return tagF.slice(-1) === '*' ? x.indexOf(tagF.slice(0, -1)) === 0 : x === tagF;
    });
  };

  // Every Return video in range (ReturnLog), with its details if saved.
  const returns = [];
  const seen = {};
  const addReturn = function(key, orderId, pf, ts, by) {
    if (!key || seen[key]) return;
    if (platform && normalize_(pf) !== platform) return;
    if (!tagOk(key)) return;
    seen[key] = true;
    const d = details[key] || {};
    const o = dir.byOrder[key] || {};
    returns.push({
      key: key, orderId: orderId, platform: pf, ts: ts, by: by,
      returnType: d.returnType || '', partner: d.partner || o.courier || '', condition: d.condition || '', notes: d.notes || '',
      claim: !!d.claim, pincode: d.pincode || o.pincode || '', name: d.name || o.name || '', phone: d.phone || o.phone || '',
      email: d.email || o.email || '', city: o.city || '', state: o.state || '', hasDetails: !!details[key]
    });
  };
  try {
    const sh = ss_().getSheetByName(CONFIG.RETURN_LOG_SHEET);
    const v = sh ? sh.getDataRange().getValues() : [];
    for (let i = 1; i < v.length; i++) {
      const ts = rowDate_(v[i][0]);
      if (isNaN(ts) || !inRange_(ts, from, to)) continue;
      addReturn(normalizeOrderId_(v[i][1]), String(v[i][1] || '').trim(), String(v[i][2] || '').trim(), ts, String(v[i][3] || '').trim());
    }
  } catch (_) {}
  // Details saved without a video row (yet) still count.
  Object.keys(details).forEach(function(k) {
    const d = details[k];
    if (!isNaN(d.ts) && inRange_(d.ts, from, to)) addReturn(k, d.orderId, d.platform, d.ts, d.by);
  });

  // Forward videos packed in range (denominator when there is no order data).
  let forwardCount = 0;
  const packedAll = {}; // every order with a packing video (any date), for 'packed' per tag
  try {
    const sh = ss_().getSheetByName(CONFIG.ORDER_LOG_SHEET);
    const v = sh ? sh.getDataRange().getValues() : [];
    const fseen = {};
    for (let i = 1; i < v.length; i++) {
      const k0 = normalizeOrderId_(v[i][1]);
      if (k0) packedAll[k0] = true;
      const ts = rowDate_(v[i][0]);
      if (isNaN(ts) || !inRange_(ts, from, to)) continue;
      if (platform && normalize_(v[i][2]) !== platform) continue;
      const k = k0;
      if (!k || fseen[k] || !tagOk(k)) continue;
      fseen[k] = true;
      forwardCount++;
    }
  } catch (_) {}

  // Orders in range from the order data (by order date).
  const ordersInRange = dir.list.filter(function(o) { return !isNaN(o.date) && o.date >= from && o.date <= to && tagOk(o.key); });

  const totals = { returns: returns.length, rto: 0, customerReturns: 0, untyped: 0, notReceivedClaims: 0, damaged: 0,
    withDetails: 0, forwardPacked: forwardCount, ordersInData: ordersInRange.length };
  const bump = function(map, k, fn) { if (!map[k]) map[k] = fn(); return map[k]; };
  const byPartner = {}, byPin = {}, byCondition = {}, customers = {};
  const newGroup = function() { return { returns: 0, rto: 0, customerReturns: 0, claims: 0, damaged: 0, orders: 0 }; };
  returns.forEach(function(r) {
    if (r.returnType === 'RTO') totals.rto++;
    else if (r.returnType === 'Customer Return') totals.customerReturns++;
    else totals.untyped++;
    if (r.claim) totals.notReceivedClaims++;
    const bad = /damag|missing|wrong|empty|used|opened/i.test(r.condition);
    if (/damag/i.test(r.condition)) totals.damaged++;
    if (r.hasDetails) totals.withDetails++;
    const groups = [bump(byPartner, r.partner || 'Not recorded', newGroup), bump(byPin, r.pincode || 'Not recorded', newGroup)];
    groups.forEach(function(g) {
      g.returns++;
      if (r.returnType === 'RTO') g.rto++;
      if (r.returnType === 'Customer Return') g.customerReturns++;
      if (r.claim) g.claims++;
      if (bad) g.damaged++;
    });
    byPin[r.pincode || 'Not recorded'].city = byPin[r.pincode || 'Not recorded'].city || r.city;
    const c = bump(byCondition, r.condition || 'Not recorded', function() { return { count: 0 }; });
    c.count++;
  });
  ordersInRange.forEach(function(o) {
    if (dir.hasPincode && o.pincode) { const g = bump(byPin, o.pincode, newGroup); g.orders++; g.city = g.city || o.city; }
    if (dir.hasCourier && o.courier) bump(byPartner, o.courier, newGroup).orders++;
  });

  // Customers: everyone with a return in range, plus all their orders in the order data.
  const custOf = function(k, r) {
    return bump(customers, k, function() {
      return { key: k, name: '', phone: '', email: '', pincode: '', city: '', orders: 0, orderIds: [], returns: 0, rto: 0,
        customerReturns: 0, claims: 0, damaged: 0, lastReturn: null, returnOrders: [] };
    });
  };
  returns.forEach(function(r) {
    const k = customerKey_(r);
    if (!k) return;
    const c = custOf(k, r);
    c.name = c.name || r.name; c.phone = c.phone || r.phone; c.email = c.email || r.email; c.pincode = c.pincode || r.pincode; c.city = c.city || r.city;
    c.returns++;
    if (r.returnType === 'RTO') c.rto++;
    if (r.returnType === 'Customer Return') c.customerReturns++;
    if (r.claim) c.claims++;
    if (/damag|missing|wrong|empty/i.test(r.condition)) c.damaged++;
    if (!c.lastReturn || r.ts > c.lastReturn) c.lastReturn = r.ts;
    c.returnOrders.push({ orderId: r.orderId, date: r.ts.toISOString(), type: r.returnType, partner: r.partner, condition: r.condition, claim: r.claim });
  });
  // Order counts per customer: all orders in the data (history matters for repeat / suspicious).
  if (dir.hasCustomer) {
    dir.list.forEach(function(o) {
      const k = customerKey_(o);
      if (!k) return;
      const c = customers[k];
      if (c) { c.orders++; if (c.orderIds.length < 50) c.orderIds.push(o.orderId); }
    });
  }
  const custList = Object.keys(customers).map(function(k) {
    const c = customers[k];
    const flags = c.rto + c.claims;
    const reasons = [];
    if (c.rto >= 2) reasons.push(c.rto + ' RTOs');
    if (c.claims >= 1) reasons.push(c.claims + (c.claims === 1 ? ' not-received claim' : ' not-received claims'));
    if (c.damaged >= 2) reasons.push(c.damaged + ' bad-condition returns');
    if (c.orders >= 2 && c.returns / c.orders >= 0.5) reasons.push(Math.round(100 * c.returns / c.orders) + '% of orders returned');
    const suspicious = flags >= minFlags || (c.orders >= 2 && (c.rto + c.claims) / c.orders >= 0.5 && flags >= 1) || c.damaged >= minFlags;
    return {
      name: c.name, phone: maskPhone_(c.phone), phoneFull: isAdminRole_(user.role) ? c.phone : '', email: c.email, pincode: c.pincode,
      city: c.city, orders: c.orders || c.returns, returns: c.returns, rto: c.rto, customerReturns: c.customerReturns, claims: c.claims,
      damaged: c.damaged, returnRate: c.orders ? Math.round(1000 * c.returns / c.orders) / 10 : null,
      lastReturn: c.lastReturn ? c.lastReturn.toISOString() : '', suspicious: suspicious, reasons: reasons,
      score: c.rto * 2 + c.claims * 3 + c.damaged, returnOrders: c.returnOrders.slice(-20)
    };
  });
  custList.sort(function(a, b) { return b.score - a.score || b.returns - a.returns; });

  // Repeat buyers from the order data (2+ orders in range), with how many came back.
  const repeat = [];
  if (dir.hasCustomer) {
    const buyers = {};
    ordersInRange.forEach(function(o) {
      const k = customerKey_(o);
      if (!k) return;
      const b = bump(buyers, k, function() { return { name: o.name, phone: o.phone, email: o.email, pincode: o.pincode, city: o.city, orders: 0 }; });
      b.orders++;
    });
    Object.keys(buyers).forEach(function(k) {
      const b = buyers[k];
      if (b.orders < 2) return;
      const c = customers[k];
      repeat.push({ name: b.name, phone: maskPhone_(b.phone), phoneFull: isAdminRole_(user.role) ? b.phone : '', email: b.email,
        pincode: b.pincode, city: b.city, orders: b.orders, returns: c ? c.returns : 0, rto: c ? c.rto : 0 });
    });
    repeat.sort(function(a, b) { return b.orders - a.orders; });
  } else {
    custList.filter(function(c) { return c.returns >= 2; }).forEach(function(c) {
      repeat.push({ name: c.name, phone: c.phone, phoneFull: c.phoneFull, email: c.email, pincode: c.pincode, city: c.city,
        orders: c.orders, returns: c.returns, rto: c.rto });
    });
  }

  const rate = function(n, d) { return d ? Math.round(1000 * n / d) / 10 : null; };
  const groupList = function(map, useOrders) {
    return Object.keys(map).map(function(k) {
      const g = map[k];
      return { name: k, city: g.city || '', returns: g.returns, rto: g.rto, customerReturns: g.customerReturns, claims: g.claims,
        damaged: g.damaged, orders: useOrders ? g.orders : null, returnRate: useOrders ? rate(g.returns, g.orders) : null,
        rtoRate: useOrders ? rate(g.rto, g.orders) : null, share: rate(g.returns, totals.returns) };
    }).filter(function(g) { return g.returns > 0 || g.orders > 0; })
      .sort(function(a, b) { return b.returns - a.returns || (b.orders || 0) - (a.orders || 0); });
  };
  // Shopify tags and payment mode: orders in range, how many were packed, and how many came back.
  // A tag like AiSensy_COD_Confirmed also counts under "AiSensy (all)".
  const byTag = {}, byPay = {}, allTags = {};
  const tagGroup = function() { return { orders: 0, packed: 0, returns: 0, rto: 0, customerReturns: 0, claims: 0 }; };
  const tagNames = function(o) {
    const out = {};
    (o.tags || []).forEach(function(t) {
      out[t] = true;
      const fam = t.indexOf('_') > 0 ? t.slice(0, t.indexOf('_')) : '';
      if (fam) out[fam + ' (all)'] = true;
    });
    if (!Object.keys(out).length) out['No tag'] = true;
    return Object.keys(out);
  };
  dir.list.forEach(function(o) { tagNames(o).forEach(function(t) { if (t !== 'No tag') allTags[t] = true; }); });
  if (dir.hasTags || dir.hasPayMode) {
    ordersInRange.forEach(function(o) {
      const groups = [];
      if (dir.hasTags) tagNames(o).forEach(function(t) { groups.push(bump(byTag, t, tagGroup)); });
      if (dir.hasPayMode) groups.push(bump(byPay, o.payMode || 'Not set', tagGroup));
      groups.forEach(function(g) { g.orders++; if (packedAll[o.key]) g.packed++; });
    });
    returns.forEach(function(r) {
      const o = dir.byOrder[r.key];
      if (!o) return;
      const groups = [];
      if (dir.hasTags) tagNames(o).forEach(function(t) { groups.push(bump(byTag, t, tagGroup)); });
      if (dir.hasPayMode) groups.push(bump(byPay, o.payMode || 'Not set', tagGroup));
      groups.forEach(function(g) {
        g.returns++;
        if (r.returnType === 'RTO') g.rto++;
        if (r.returnType === 'Customer Return') g.customerReturns++;
        if (r.claim) g.claims++;
      });
    });
  }
  const tagList = function(map) {
    return Object.keys(map).map(function(k) {
      const g = map[k];
      return { name: k, orders: g.orders, packed: g.packed, returns: g.returns, rto: g.rto, customerReturns: g.customerReturns,
        claims: g.claims, returnRate: rate(g.returns, g.packed || g.orders), rtoRate: rate(g.rto, g.packed || g.orders) };
    }).sort(function(a, b) {
      const rank = function(x) { return /\(all\)$/.test(x.name) ? 0 : x.name === 'No tag' || x.name === 'Not set' ? 2 : 1; };
      return rank(a) - rank(b) || b.orders - a.orders || b.returns - a.returns;
    });
  };

  const denom = ordersInRange.length || forwardCount;
  return {
    success: true, fromDate: p.fromDate, toDate: p.toDate,
    orderData: { available: dir.available, hasCustomer: dir.hasCustomer, hasPincode: dir.hasPincode, hasCourier: dir.hasCourier,
      hasTags: !!dir.hasTags, hasPayMode: !!dir.hasPayMode },
    tag: String(p.tag || '').trim(), tags: Object.keys(allTags).sort(),
    byTag: tagList(byTag).slice(0, 200), byPayment: tagList(byPay),
    totals: totals,
    returnRate: rate(totals.returns, denom), rtoRate: rate(totals.rto, denom), rateBase: ordersInRange.length ? 'orders' : 'packed',
    byPartner: groupList(byPartner, dir.hasCourier).slice(0, 100),
    byPincode: groupList(byPin, dir.hasPincode).slice(0, 300),
    byCondition: Object.keys(byCondition).map(function(k) { return { name: k, count: byCondition[k].count }; })
      .sort(function(a, b) { return b.count - a.count; }),
    customers: custList.slice(0, 500),
    suspicious: custList.filter(function(c) { return c.suspicious; }).slice(0, 200),
    repeatCustomers: repeat.slice(0, 300),
    recent: returns.sort(function(a, b) { return b.ts - a.ts; }).slice(0, 300).map(function(r) {
      return { orderId: r.orderId, platform: r.platform, date: r.ts.toISOString(), returnType: r.returnType, partner: r.partner,
        condition: r.condition, notes: r.notes, claim: r.claim, pincode: r.pincode, name: r.name, phone: maskPhone_(r.phone) };
    })
  };
}
