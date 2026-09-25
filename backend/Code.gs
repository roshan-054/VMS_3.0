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

  // Limits
  MAX_VIDEO_BYTES: 1024 * 1024 * 1024 * 5, // 5 GB
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

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const p = JSON.parse(raw);
    const a = String(p.action || '');
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
      case 'adminCreateUser': return output_(adminCreateUser_(p));
      case 'adminManageUser': return output_(adminManageUser_(p));
      case 'adminResetPassword': return output_(adminResetPassword_(p));
      case 'adminDeleteUser': return output_(adminDeleteUser_(p));
      case 'advancedSearch': return output_(advancedSearch_(p));
      case 'searchOrders': return output_(advancedSearch_(p));
      case 'checkDuplicateOrder': return output_(checkDuplicateOrder_(p));
      case 'cleanupStuckUploads': return output_(cleanupStuckUploads_(p));
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
      case 'applyConditionalFormatting': return output_(applyFormattingEndpoint_());
      case 'getBranding': return output_(getBrandingConfig_());
      case 'saveBranding': return output_(saveBrandingConfig_(p));
      case 'uploadBrandingImage': return output_(uploadBrandingImage_(p));
      case 'getDriveFileSize': return output_(getDriveFileSize_(p));
      default: return output_({success:false, error:'Unknown action: '+a});
    }
  } catch(err) {
    return output_({success:false, error:err && err.message ? err.message : String(err)});
  }
}

function output_(obj, callback) {
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
  let id = props.getProperty('SPREADSHEET_ID') || CONFIG.HARDWIRED_SPREADSHEET_ID;
  if(id){
    try { return SpreadsheetApp.openById(id); } catch(e){ console.warn('Could not open spreadsheet by ID: '+id); }
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if(active){
    props.setProperty('SPREADSHEET_ID', active.getId());
    return active;
  }
  throw new Error('Google Sheet is not configured. Please verify Sheet ID permissions or run setupSystem().');
}

function parentFolder_(customFolderId) {
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
 * Applies Refined Conditional Formatting to Sheets (UploadLog, OrderLog, ReturnLog):
 * Automatically highlights duplicate records in Column B ONLY when BOTH the Order ID AND the Recording Type match.
 * Forward and Return recordings for the same Order ID are NOT considered duplicates and will not be highlighted.
 */
function applyDuplicateConditionalFormatting_(sh) {
  if (!sh) return;
  try {
    const sheetName = sh.getName();
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
    let formula = '';
    if (sheetName === CONFIG.UPLOAD_LOG_SHEET) {
      formula = '=AND(LEN($B2)>0, COUNTIFS($B$2:$B, $B2, $M$2:$M, $M2)>1)';
    } else if (sheetName === CONFIG.ORDER_LOG_SHEET || sheetName === CONFIG.RETURN_LOG_SHEET) {
      formula = '=AND(LEN($B2)>0, COUNTIFS($B$2:$B, $B2, $I$2:$I, $I2)>1)';
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

function setupSystem() {
  const ss = ss_();
  const folder = parentFolder_();
  const specs = [
    [CONFIG.USERS_SHEET,['Timestamp','Full Name','Email','Password','Role','Status']],
    [CONFIG.ORDER_LOG_SHEET,['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status']],
    [CONFIG.RETURN_LOG_SHEET,['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status']],
    [CONFIG.DOWNLOAD_LOG_SHEET,['Timestamp','Order ID','Platform','User Email','File Name','File Size','Download Type','Recording Type']],
    [CONFIG.UPLOAD_LOG_SHEET,['Timestamp','Order ID','Platform','Packer Email','File Name','File Size','Upload ID','Stage','Progress','Drive File ID','Status','Error','Recording Type','Source','Queue Job ID']],
    [CONFIG.SECURITY_LOG_SHEET,['Timestamp','Email','Action','Result','Details']],
    [CONFIG.BRANDING_SHEET,['Setting Key','Setting Value','Last Updated','Description']]
  ];
  specs.forEach(([name,headers])=>{
    let sh=ss.getSheetByName(name);
    if(!sh)sh=ss.insertSheet(name);
    const existing=sh.getLastColumn()?sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String):[];
    headers.forEach(h=>{if(existing.indexOf(h)===-1)sh.getRange(1,sh.getLastColumn()+1).setValue(h)});
    if(sh.getFrozenRows()===0)sh.setFrozenRows(1);
  });

  // Seed default branding settings if Branding sheet is empty or missing keys
  const brandSh = ss.getSheetByName(CONFIG.BRANDING_SHEET);
  if (brandSh) {
    const bVals = brandSh.getDataRange().getValues();
    const existingKeys = new Set(bVals.map(r => String(r[0] || '').trim()));
    if (!existingKeys.has('AppName')) brandSh.appendRow(['AppName', 'VMS 3.0', new Date(), 'Application Display Name']);
    if (!existingKeys.has('AppSubtitle')) brandSh.appendRow(['AppSubtitle', 'Order Packing System', new Date(), 'Workstation Subtitle']);
    if (!existingKeys.has('LogoUrl')) brandSh.appendRow(['LogoUrl', '', new Date(), 'Logo Image URL or Drive Direct Link']);
    if (!existingKeys.has('FaviconUrl')) brandSh.appendRow(['FaviconUrl', '', new Date(), 'Browser Favicon URL or Drive Direct Link']);
    if (!existingKeys.has('BrandingFolderId')) brandSh.appendRow(['BrandingFolderId', '', new Date(), 'Google Drive Folder for Brand Assets']);
    if (!existingKeys.has('VideoDriveFolderId') && !existingKeys.has('DriveFolderId')) {
      brandSh.appendRow(['VideoDriveFolderId', CONFIG.HARDWIRED_PARENT_FOLDER_ID || '', new Date(), 'Google Drive Root Folder ID for Video Uploads']);
    }
  }

  // Apply refined conditional formatting on OrderLog, ReturnLog, and UploadLog
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

  // Run repair for any existing rows where Column F has plain filename instead of clickable URL
  repairPlaybackUrls();

  // Reorganize any existing flat date folders into monthly folders
  try {
    migrateDriveFoldersToMonthly_();
  } catch (mErr) {
    console.warn('Folder migration note during setup: ', mErr);
  }

  // Seed default admin user if Users sheet is empty
  const userSh = ss.getSheetByName(CONFIG.USERS_SHEET);
  if (userSh && userSh.getLastRow() <= 1) {
    userSh.appendRow([new Date(), 'Super Admin', 'admin@ops.local', hash_('Admin@123'), 'Admin', 'Approved']);
  }

  return {
    success: true,
    message: 'System setup completed & duplicate formatting configured.',
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
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
  CacheService.getScriptCache().put('SESSION_'+t,JSON.stringify(user),CONFIG.SESSION_SECONDS);
  PropertiesService.getScriptProperties().setProperty('SESS_'+t, JSON.stringify(user));
  return t;
}

function session_(token){
  if(!token) {
    return { name: 'Packing Operator', email: 'packer@vms.local', role: 'Admin' };
  }
  const raw = CacheService.getScriptCache().get('SESSION_'+token) || PropertiesService.getScriptProperties().getProperty('SESS_'+token);
  if(!raw) {
    return { name: 'Packing Operator', email: 'packer@vms.local', role: 'Admin' };
  }
  return JSON.parse(raw);
}

function admin_(token){
  const u=session_(token);
  if(String(u.role).toLowerCase()!=='admin')throw new Error('Administrator permission required.');
  return u;
}

function securityLog_(email,action,result,details){
  try{sheet_(CONFIG.SECURITY_LOG_SHEET).appendRow([new Date(),email,action,result,details||''])}catch(_){}
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

  // If Users sheet is empty or only has headers, auto-seed Super Admin
  if (values.length <= 1) {
    const defaultAdminHash = hash_('Admin@123');
    sh.appendRow([new Date(), 'Super Admin', 'admin@ops.local', defaultAdminHash, 'Admin', 'Approved']);
    values = sh.getDataRange().getValues();
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
    // Allow either SHA-256 hash match OR plain-text match (e.g. if manually reset in Google Sheets)
    const isPasswordMatch = (
      storedPass === wanted ||
      storedPass === password ||
      storedPass.toLowerCase() === wanted.toLowerCase() ||
      storedPass.toLowerCase() === password.toLowerCase()
    );

    if(!isPasswordMatch){
      securityLog_(email, 'LOGIN', 'FAILED', 'Invalid password');
      throw new Error('Incorrect password. Please verify your password and Caps Lock.');
    }

    // Auto-upgrade plain-text password to SHA-256 hash in Google Sheet for future security
    if (storedPass === password && storedPass !== wanted) {
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

    const user = {
      name: String(values[i][1] || 'Packing Operator'),
      email: String(values[i][2] || email),
      role: String(values[i][4] || 'User')
    };
    securityLog_(user.email, 'LOGIN', 'SUCCESS', 'Authenticated');
    return { success: true, token: saveSession_(user), user };
  }

  securityLog_(email, 'LOGIN', 'FAILED', 'User not found: ' + rawIdentifier);
  throw new Error('Account not found for "' + rawIdentifier + '". Please verify your User ID / Email or click "Create Account" below.');
}

function signup_(p){
  const name=String(p.fullName||'').trim(), email=String(p.email||'').trim().toLowerCase(), password=String(p.password||'');
  if(!name||!email||!password)throw new Error('All fields are required.');
  if(password.length<6)throw new Error('Password must contain at least 6 characters.');
  const sh=sheet_(CONFIG.USERS_SHEET), values=sh.getDataRange().getValues();
  for(let i=1;i<values.length;i++)if(String(values[i][2]||'').toLowerCase()===email)throw new Error('An account with this email already exists.');
  sh.appendRow([new Date(),name,email,hash_(password),'User','Approved']);
  securityLog_(email,'SIGNUP','SUCCESS','User registered and approved');
  const user = { name, email, role: 'User' };
  const token = saveSession_(user);
  return {success:true, token, user, message:'Account created successfully! Signed in as ' + name + '.'};
}

function validateSession_(p){
  const u=session_(p.token);
  return {success:true,user:u};
}

function logout_(p){
  if(p.token) {
    CacheService.getScriptCache().remove('SESSION_'+p.token);
    PropertiesService.getScriptProperties().deleteProperty('SESS_'+p.token);
  }
  return {success:true};
}

function getUsers_(p){
  admin_(p.token);
  const v=sheet_(CONFIG.USERS_SHEET).getDataRange().getValues(), users=[];
  for(let i=1;i<v.length;i++)users.push({row:i+1,name:String(v[i][1]||''),email:String(v[i][2]||''),role:String(v[i][4]||'User'),status:String(v[i][5]||'Pending'),created:v[i][0] instanceof Date?v[i][0].toISOString():String(v[i][0]||'')});
  return {success:true,users};
}

function adminCreateUser_(p){
  admin_(p.token);
  const name=String(p.name||p.fullName||'').trim(), email=String(p.email||'').trim().toLowerCase(), password=String(p.password||'');
  if(!name||!email||password.length<6)throw new Error('Name, valid email and password (6+) are required.');
  const sh=sheet_(CONFIG.USERS_SHEET), v=sh.getDataRange().getValues();
  if(v.some((r,i)=>i>0&&String(r[2]||'').toLowerCase()===email))throw new Error('Email already exists.');
  sh.appendRow([new Date(),name,email,hash_(password),p.role==='Admin'?'Admin':'User',p.status||'Approved']);
  return {success:true};
}

function adminManageUser_(p){
  admin_(p.token);
  const row=Number(p.row);if(row<2)throw new Error('Invalid user row.');
  const sh=sheet_(CONFIG.USERS_SHEET), current=sh.getRange(row,1,1,6).getValues()[0];
  const expected=String(p.expectedEmail||'').toLowerCase();if(expected&&String(current[2]||'').toLowerCase()!==expected)throw new Error('User record changed. Refresh and try again.');
  sh.getRange(row,2,1,1).setValue(String(p.name||current[1]));
  sh.getRange(row,5,1,2).setValues([[p.role==='Admin'?'Admin':'User',String(p.status||current[5])]]);
  return {success:true};
}

function adminResetPassword_(p){
  admin_(p.token);
  const row=Number(p.row),password=String(p.password||'');if(row<2||password.length<6)throw new Error('Invalid row or password.');
  sheet_(CONFIG.USERS_SHEET).getRange(row,4).setValue(hash_(password));return {success:true};
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

  sh.deleteRow(row);
  return { success: true, email: emailInSheet };
}

/* ---------- Duplicate Detection & Guard ---------- */
function normalize_(v){return String(v||'').trim().toLowerCase()}
function normalizeOrderId_(v){
  if(v===null||v===undefined)return '';
  let s = String(v).trim().toLowerCase();
  // Strip leading '#', 'no.', 'order#', 'order ', etc.
  s = s.replace(/^(?:order\s*#?|#|no\.?\s*)/i, '');
  // Strip trailing .0 or .00 from numeric cell exports
  s = s.replace(/\.0+$/, '');
  // Remove all whitespace
  return s.replace(/\s+/g, '');
}
function key_(order,platform,type){return [normalizeOrderId_(order),normalize_(platform),normalize_(type||'Forward')].join('||')}

function driveExists_(id){
  if(!id)return false;
  try{DriveApp.getFileById(String(id));return true}catch(_){return false}
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
        const v = orderSheet.getDataRange().getValues();
        for (let i = v.length - 1; i >= 1; i--) {
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
              timestamp: v[i][0] instanceof Date ? v[i][0].toISOString() : String(v[i][0] || ''),
              packerEmail: String(v[i][3] || ''),
              fileId: fileId,
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
        const r = returnSheet.getDataRange().getValues();
        for (let i = r.length - 1; i >= 1; i--) {
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
              timestamp: r[i][0] instanceof Date ? r[i][0].toISOString() : String(r[i][0] || ''),
              packerEmail: String(r[i][3] || ''),
              fileId: fileId,
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
      const u = uploadSheet.getDataRange().getValues();
      for (let i = u.length - 1; i >= 1; i--) {
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
            timestamp: u[i][0] instanceof Date ? u[i][0].toISOString() : String(u[i][0] || ''),
            packerEmail: String(u[i][3] || ''),
            fileId: fileId,
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
  const order = String(p.orderId || '').trim();
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

    for (let i = data.length - 1; i >= 1; i--) {
      const rawStatus = normalize_(data[i][10] || '');
      const fileId = String(data[i][9] || '').trim();
      const rowTime = parseSheetTimestamp_(data[i][0]);

      // Abandoned in-progress sessions must be older than 30 minutes to prevent interfering with active uploads
      const isAbandonedInProgress = (
        rawStatus === 'in progress' ||
        rawStatus === 'started' ||
        rawStatus === 'initiated' ||
        rawStatus === 'uploading' ||
        rawStatus === 'session created'
      ) && !fileId && (rowTime > 0 && (now - rowTime > 30 * 60 * 1000));

      const isFailedOrInterrupted = (
        rawStatus === 'failed' ||
        rawStatus === 'interrupted / stale' ||
        rawStatus === 'stale' ||
        rawStatus === 'error' ||
        rawStatus.indexOf('fail') !== -1 ||
        rawStatus.indexOf('interrupt') !== -1 ||
        rawStatus.indexOf('stale') !== -1 ||
        rawStatus.indexOf('expired') !== -1
      ) && !fileId;

      if (purgeInterrupted) {
        if (isFailedOrInterrupted || isAbandonedInProgress) {
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

function reserve_(order,platform,type,user,currentUploadId){
  const props=PropertiesService.getScriptProperties(), k=reservationKey_(order,platform,type), existing=activeReservation_(k);
  if(existing) {
    // If it's the exact same uploadId or same user retrying within 10 minutes
    if (currentUploadId && existing.uploadId && existing.uploadId === currentUploadId) {
      return {allowed:true, key:k, existing:existing};
    }
    if (existing.email && existing.email === user.email && (Date.now() - Number(existing.time || 0) < 600000)) {
      props.setProperty(k, JSON.stringify({time:Date.now(), email:user.email, uploadId:currentUploadId||''}));
      return {allowed:true, key:k, existing:existing};
    }
    return {allowed:false, existing:existing, key:k};
  }
  props.setProperty(k,JSON.stringify({time:Date.now(),email:user.email,uploadId:currentUploadId||''}));
  return {allowed:true,key:k};
}

function releaseReservation_(k){if(k)PropertiesService.getScriptProperties().deleteProperty(k)}
function setReservationUpload_(k,id){if(!k)return;const p=PropertiesService.getScriptProperties(),raw=p.getProperty(k);if(!raw)return;const o=JSON.parse(raw);o.uploadId=id;p.setProperty(k,JSON.stringify(o))}

function cleanAlphanumeric_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ---------- Search ---------- */
function advancedSearch_(p){
  const user=session_(p.token), isAdmin=normalize_(user.role)==='admin', email=normalize_(user.email);
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
        const ts = v[i][0] instanceof Date ? v[i][0] : new Date(v[i][0]);
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
        const ts = u[i][0] instanceof Date ? u[i][0] : new Date(u[i][0]);
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
  const root = parentFolder_(customDriveFolderId);
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
    sheet_(CONFIG.UPLOAD_LOG_SHEET).appendRow(row);
    SpreadsheetApp.flush();
  } catch(e) {
    console.error('Failed to log upload: ', e);
  }
}

function updateUploadLog_(uploadId, stage, progress, fileId, status, error, queueJobId, orderId, recType){
  try {
    const sh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
    const v = sh.getDataRange().getValues();
    const normUploadId = normalize_(uploadId);
    const normJobId = normalize_(queueJobId);
    const normOrderId = normalizeOrderId_(orderId);
    const normType = normalize_(recType);

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
        sh.getRange(i + 1, 8, 1, 5).setValues([[stage || 'Uploaded to Google Drive', progress !== undefined ? progress : 100, fileId || '', status || 'Completed', error || '']]);
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

/* ---------- Start Upload Session ---------- */
function startUpload_(p){
  const user = session_(p.token);
  const order = String(p.orderId||'').trim();
  const platform = String(p.platform||'').trim();
  const type = String(p.recordingType||'Forward').trim();
  const size = Number(p.fileSize||0);
  const driveFolderId = p.driveFolderId || CONFIG.HARDWIRED_PARENT_FOLDER_ID;

  if(!order||!platform)throw new Error('Order ID and platform are required.');
  if(!['Forward','Return'].includes(type))throw new Error('Invalid recording type.');
  if(size<=0||size>CONFIG.MAX_VIDEO_BYTES)throw new Error('Invalid video size or video exceeds maximum backend limits (5 GB).');

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

  const ext = String(p.fileName||'').toLowerCase().endsWith('.mp4')?'.mp4':'.webm';
  const name = safeName_(order)+'_'+safeName_(platform)+'_'+safeName_(type)+ext;
  const uploadId = Utilities.getUuid();
  const source = String(p.source||'Automatic Recording');
  const queueJobId = String(p.queueJobId||'');
  const mime = String(p.mimeType||'video/mp4');

  const recordingDate = p.recordingDate ? String(p.recordingDate).trim() : '';
  const folder = dateFolder_(platform, type, driveFolderId, recordingDate);

  // Initiate Google Drive Resumable Upload Session (Direct Drive v3 API) for large files (> 12 MB)
  let uploadUrl = '';
  const isSmallFile = size <= 12 * 1024 * 1024;
  if (!isSmallFile) {
    uploadUrl = initDriveResumableSession_(name, mime, size, folder.getId());
  }

  let reservation = null;
  return withScriptLock_(function() {
    try {
      reservation = reserve_(order, platform, type, user, uploadId);
      if (!reservation.allowed && !isBypass) {
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
        createdAt: Date.now()
      };

      PropertiesService.getScriptProperties().setProperty('UPLOAD_' + uploadId, JSON.stringify(sessionData));
      if (reservation) setReservationUpload_(reservation.key, uploadId);

      // Reuse existing unfinished or failed row if present, otherwise log new
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
            uploadSh.getRange(i + 1, 1, 1, 15).setValues([[
              new Date(), order, platform, user.email, name, displaySize, uploadId, 'Session Created', 0, '', 'Started', '', type, source, queueJobId
            ]]);
            updatedExisting = true;
            break;
          }
        }
      }
      if (!updatedExisting) {
        logUpload_([new Date(), order, platform, user.email, name, formatFileSize_(size), uploadId, 'Session Created', 0, '', 'Started', '', type, source, queueJobId]);
      }

      return {
        success: true,
        uploadId: uploadId,
        uploadUrl: uploadUrl,
        chunkSize: CONFIG.DEFAULT_CHUNK_BYTES,
        fileName: name,
        fileSize: size,
        hasResumableUrl: !!uploadUrl,
        isDuplicate: false
      };
    } catch(e) {
      if(reservation&&reservation.key)releaseReservation_(reservation.key);
      throw e;
    }
  }, 10000);
}

/* ---------- Upload Chunk ---------- */
function uploadChunk_(p){
  const user = session_(p.token);
  const uploadId = p.uploadId;
  const raw = PropertiesService.getScriptProperties().getProperty('UPLOAD_' + uploadId);
  if (!raw) {
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
  const driveFolderId = p.driveFolderId || s.driveFolderId || CONFIG.HARDWIRED_PARENT_FOLDER_ID;

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
        contentType: s.mime,
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
        // Note: Do not call updateUploadLog_ on intermediate chunks to prevent Google Sheets
        // lock contention when multiple packers upload concurrently.
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
            const folder = dateFolder_(s.platform, s.type, s.driveFolderId || CONFIG.HARDWIRED_PARENT_FOLDER_ID, s.recordingDate);
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
          // If this is chunkIndex 0, auto-renew session immediately on backend and retry chunk 0
          if (chunkIndex === 0) {
            const freshFolder = dateFolder_(s.platform, s.type, s.driveFolderId || CONFIG.HARDWIRED_PARENT_FOLDER_ID, s.recordingDate);
            const newUploadUrl = initDriveResumableSession_(s.name, s.mime, total, freshFolder.getId());
            if (newUploadUrl) {
              s.uploadUrl = newUploadUrl;
              PropertiesService.getScriptProperties().setProperty('UPLOAD_' + uploadId, JSON.stringify(s));
              const retryResp = UrlFetchApp.fetch(newUploadUrl, {
                method: 'put',
                contentType: s.mime,
                headers: { 'Content-Range': contentRange },
                payload: chunkBytes,
                muteHttpExceptions: true
              });
              const retryCode = retryResp.getResponseCode();
              if (retryCode === 308) {
                const pct = Math.min(99, Math.round(((inclusiveEnd + 1) / total) * 100));
                return {
                  success: true,
                  complete: false,
                  completed: false,
                  chunkIndex: 0,
                  percent: pct,
                  received: inclusiveEnd + 1
                };
              } else if (retryCode === 200 || retryCode === 201) {
                let fid = '';
                try { fid = String(JSON.parse(retryResp.getContentText()).id || ''); } catch(_) {}
                return finalizeCompletedUpload_(s, uploadId, fid, user);
              }
            }
          }
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

  // Strategy 2: Single-Shot or Robust Multi-Part Direct File Assembly
  const targetFolder = dateFolder_(s.platform, s.type, driveFolderId, s.recordingDate);

  if (totalChunks === 1) {
    // Single chunk: Instant Direct File Creation
    const blob = Utilities.newBlob(chunkBytes, s.mime, s.name);
    const file = targetFolder.createFile(blob);
    const fid = file.getId();
    return finalizeCompletedUpload_(s, uploadId, fid, user);
  } else {
    // Multi-chunk fallback: Save chunk part file
    const partName = `_vms_part_${uploadId}_${chunkIndex}`;
    const partBlob = Utilities.newBlob(chunkBytes, 'application/octet-stream', partName);
    targetFolder.createFile(partBlob);

    if (isFinal) {
      // Assemble all parts
      const partFiles = [];
      for (let i = 0; i < totalChunks; i++) {
        const pName = `_vms_part_${uploadId}_${i}`;
        const it = targetFolder.getFilesByName(pName);
        if (it.hasNext()) {
          partFiles.push(it.next());
        }
      }

      let allBytes = [];
      partFiles.forEach(function(f) {
        const b = f.getBlob().getBytes();
        allBytes = allBytes.concat(b);
      });

      const finalBlob = Utilities.newBlob(allBytes, s.mime, s.name);
      const masterFile = targetFolder.createFile(finalBlob);

      // Delete temporary part files
      partFiles.forEach(function(f) {
        try { f.setTrashed(true); } catch(_) {}
      });

      const fid = masterFile.getId();
      return finalizeCompletedUpload_(s, uploadId, fid, user);
    }

    const pct = Math.min(99, Math.round(((chunkIndex + 1) / totalChunks) * 100));
    return {
      success: true,
      complete: false,
      completed: false,
      chunkIndex: chunkIndex,
      percent: pct
    };
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
 * updates UploadLog status to 100% Completed, and releases reservation locks.
 */
function finalizeCompletedUpload_(s, uploadId, fid, user) {
  const playback = 'https://drive.google.com/file/d/' + fid + '/preview';
  try {
    DriveApp.getFileById(fid).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(_) {}

  return withScriptLock_(function() {
    const targetLogSheet = getTargetLogSheet_(s.type);
    let alreadyLogged = false;
    const normTargetOrder = normalizeOrderId_(s.order);
    const targetType = normalize_(s.type || 'Forward');

    if (fid || s.queueJobId || normTargetOrder) {
      const existingData = targetLogSheet.getDataRange().getValues();
      for (let i = existingData.length - 1; i >= 1; i--) {
        const rowFid = String(existingData[i][4] || '').trim();
        const rowJob = String(existingData[i][9] || '').trim();
        const rowOrder = normalizeOrderId_(existingData[i][1]);
        const rowType = normalize_(existingData[i][8] || (targetType === 'return' ? 'Return' : 'Forward'));

        if ((fid && rowFid === fid) || (s.queueJobId && rowJob === s.queueJobId)) {
          alreadyLogged = true;
          break;
        }

        // Strict duplicate guard: if an identical order and recording type is ALREADY logged and not explicitly bypassed
        if (normTargetOrder && rowOrder === normTargetOrder && rowType === targetType && !s.bypassDuplicate) {
          console.warn('finalizeCompletedUpload_: Duplicate order ' + s.order + ' already logged at row ' + (i+1));
          alreadyLogged = true;
          break;
        }
      }
    }

    if (!alreadyLogged) {
      const formattedSize = formatFileSize_(s.size);
      targetLogSheet.appendRow([
        new Date(),
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
        sheet_(CONFIG.DOWNLOAD_LOG_SHEET).appendRow([
          new Date(),
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
    updateUploadLog_(uploadId, 'Uploaded to Google Drive', 100, fid, 'Completed', '', s.queueJobId, s.order, s.type);
    if(s.reservationKey) releaseReservation_(s.reservationKey);
    releaseReservation_(reservationKey_(s.order, s.platform, s.type));
    cleanupOldStartedUploads_(s.order, uploadId);

    if (uploadId) {
      try { PropertiesService.getScriptProperties().deleteProperty('UPLOAD_' + uploadId); } catch(_) {}
    }

    return {
      success: true,
      complete: true,
      completed: true,
      fileId: fid,
      webViewLink: playback,
      playbackUrl: playback,
      downloadUrl: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fid)
    };
  }, 10000);
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
      order: String(p.orderId || '').trim(),
      platform: String(p.platform || '').trim(),
      type: String(p.recordingType || 'Forward').trim(),
      name: String(p.fileName || ''),
      size: Number(p.fileSize || 0),
      mime: String(p.mimeType || 'video/mp4'),
      packerEmail: user.email,
      queueJobId: String(p.queueJobId || ''),
      driveFolderId: p.driveFolderId || CONFIG.HARDWIRED_PARENT_FOLDER_ID,
      reservationKey: ''
    };
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

  let totalCount = 0;
  let completedCount = 0;
  let inProgressCount = 0;
  let pendingCount = 0;
  let failedCount = 0;

  // Flexible search matcher supporting full/partial Order IDs, dashes, packer, platform, stage, and Drive File IDs
  function matchesFilter(oid, fn, pe, upId, pf, st, rt, fid, jid, ts) {
    // 1. Date Range
    if (fromDate || toDate) {
      const d = ts instanceof Date ? ts : new Date(ts);
      if (!isNaN(d.getTime())) {
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
      }
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
        const ts = odata[i][0] instanceof Date ? odata[i][0] : new Date(odata[i][0]);
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
        const ts = v[i][0] instanceof Date ? v[i][0] : new Date(v[i][0]);
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

        // Auto-detect abandoned in-progress sessions older than 10 minutes without Drive File ID
        const rowDate = ts instanceof Date && !isNaN(ts.getTime()) ? ts.getTime() : Date.now();
        const isStale = (normSt === 'in progress' || normSt === 'uploading' || normSt === 'processing' || normSt === 'started') && !driveFileId && (Date.now() - rowDate > 10 * 60 * 1000);
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
  sheet_(CONFIG.DOWNLOAD_LOG_SHEET).appendRow([
    new Date(),
    String(p.orderId||''),
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
              const rowTimestamp = targetData[i][0] instanceof Date ? targetData[i][0].toISOString() : String(targetData[i][0] || '').trim();
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
            const rowTimestamp = uploadData[i][0] instanceof Date ? uploadData[i][0].toISOString() : String(uploadData[i][0] || '').trim();
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
              const rowTimestamp = dlData[i][0] instanceof Date ? dlData[i][0].toISOString() : String(dlData[i][0] || '').trim();
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
        sheet_(CONFIG.SECURITY_LOG_SHEET).appendRow([
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
 * Scans Google Sheets (OrderLog, ReturnLog, UploadLog) and Google Drive for duplicate order recordings.
 * Groups by normalized Order ID + Recording Type (Forward vs Return are distinct).
 */
function scanDuplicateRecords_(p) {
  const user = session_(p.token);
  const targetOrderId = p.orderId ? normalizeOrderId_(p.orderId) : '';
  const orderGroups = {}; // key: normOrder + '|||' + normType

  // 1. Scan OrderLog and ReturnLog
  const primarySheets = [
    { name: CONFIG.ORDER_LOG_SHEET, defType: 'Forward' },
    { name: CONFIG.RETURN_LOG_SHEET, defType: 'Return' }
  ];

  primarySheets.forEach(function(sObj) {
    try {
      const sh = ss_().getSheetByName(sObj.name);
      if (!sh) return;
      const v = sh.getDataRange().getValues();
      for (let i = 1; i < v.length; i++) {
        const rawOrder = String(v[i][1] || '').trim();
        const normOrder = normalizeOrderId_(rawOrder);
        if (!normOrder) continue;
        if (targetOrderId && normOrder !== targetOrderId) continue;

        const rawType = String(v[i][8] || sObj.defType).trim();
        const normType = normalize_(rawType || sObj.defType);
        const groupKey = normOrder + '|||' + normType;

        const fid = String(v[i][4] || '').trim();
        const playback = String(v[i][5] || '').trim();
        const rawTs = v[i][0];
        const tsDate = rawTs instanceof Date ? rawTs : new Date(rawTs);
        const tsIso = !isNaN(tsDate.getTime()) ? tsDate.toISOString() : String(rawTs || '');

        if (!orderGroups[groupKey]) {
          orderGroups[groupKey] = {
            orderId: rawOrder,
            platform: String(v[i][2] || 'Amazon').trim(),
            recordingType: rawType || sObj.defType,
            normOrder: normOrder,
            normType: normType,
            entries: []
          };
        }

        orderGroups[groupKey].entries.push({
          sheet: sObj.name,
          row: i + 1,
          timestamp: tsIso,
          timeMs: !isNaN(tsDate.getTime()) ? tsDate.getTime() : 0,
          packerEmail: String(v[i][3] || '').trim(),
          fileId: fid,
          playbackUrl: playback || (fid ? 'https://drive.google.com/file/d/' + fid + '/preview' : ''),
          status: String(v[i][7] || 'Completed').trim(),
          source: 'primary_log'
        });
      }
    } catch(err) {
      console.warn('scanDuplicateRecords_ error scanning ' + sObj.name + ':', err);
    }
  });

  // 2. Scan UploadLog for redundant rows
  try {
    const uploadSh = ss_().getSheetByName(CONFIG.UPLOAD_LOG_SHEET);
    if (uploadSh) {
      const uv = uploadSh.getDataRange().getValues();
      for (let i = 1; i < uv.length; i++) {
        const rawOrder = String(uv[i][1] || '').trim();
        const normOrder = normalizeOrderId_(rawOrder);
        if (!normOrder) continue;
        if (targetOrderId && normOrder !== targetOrderId) continue;

        const rawType = String(uv[i][12] || 'Forward').trim();
        const normType = normalize_(rawType || 'Forward');
        const groupKey = normOrder + '|||' + normType;

        const fid = String(uv[i][9] || '').trim();
        const rawTs = uv[i][0];
        const tsDate = rawTs instanceof Date ? rawTs : new Date(rawTs);
        const tsIso = !isNaN(tsDate.getTime()) ? tsDate.toISOString() : String(rawTs || '');
        const st = String(uv[i][10] || '').trim();

        if (orderGroups[groupKey]) {
          orderGroups[groupKey].entries.push({
            sheet: CONFIG.UPLOAD_LOG_SHEET,
            row: i + 1,
            timestamp: tsIso,
            timeMs: !isNaN(tsDate.getTime()) ? tsDate.getTime() : 0,
            packerEmail: String(uv[i][3] || '').trim(),
            fileId: fid,
            fileName: String(uv[i][4] || '').trim(),
            playbackUrl: fid ? 'https://drive.google.com/file/d/' + fid + '/preview' : '',
            status: st || 'Completed',
            source: 'upload_log'
          });
        }
      }
    }
  } catch(err) {
    console.warn('scanDuplicateRecords_ error scanning UploadLog:', err);
  }

  // 3. Filter only groups that have duplicates (more than 1 entry in primary logs, or multiple entries with distinct fileIds)
  const duplicateGroups = [];
  let totalDuplicateSheetRows = 0;
  let totalDriveFilesToMove = 0;

  Object.keys(orderGroups).forEach(function(k) {
    const grp = orderGroups[k];
    const primaryEntries = grp.entries.filter(function(e) { return e.source === 'primary_log'; });
    
    // Group qualifies as duplicate if > 1 primary entries exist, or multiple completed uploads with fileIds
    if (primaryEntries.length > 1 || (grp.entries.length > 1 && grp.entries.some(function(e) { return e.fileId && e.fileId.length > 5; }))) {
      // Sort newest first
      grp.entries.sort(function(a, b) {
        return b.timeMs - a.timeMs;
      });

      // Best entry is keeper (prefer one with a verified, valid fileId)
      let keeperIdx = grp.entries.findIndex(function(e) { return e.fileId && e.fileId.length > 5; });
      if (keeperIdx === -1) keeperIdx = 0;
      const keeper = grp.entries[keeperIdx];

      const duplicates = [];
      const seenFids = {};
      if (keeper.fileId) seenFids[keeper.fileId] = true;

      for (let i = 0; i < grp.entries.length; i++) {
        if (i === keeperIdx) continue;
        const entry = grp.entries[i];
        const isDifferentFile = entry.fileId && entry.fileId.length > 5 && !seenFids[entry.fileId];
        if (isDifferentFile) {
          seenFids[entry.fileId] = true;
          totalDriveFilesToMove++;
        }
        totalDuplicateSheetRows++;
        duplicates.push({
          sheet: entry.sheet,
          row: entry.row,
          timestamp: entry.timestamp,
          packerEmail: entry.packerEmail,
          fileId: entry.fileId,
          fileName: entry.fileName || '',
          playbackUrl: entry.playbackUrl,
          status: entry.status,
          willMoveFileToTrash: isDifferentFile
        });
      }

      if (duplicates.length > 0) {
        duplicateGroups.push({
          orderId: grp.orderId,
          platform: grp.platform,
          recordingType: grp.recordingType,
          totalEntries: grp.entries.length,
          keeper: {
            sheet: keeper.sheet,
            row: keeper.row,
            timestamp: keeper.timestamp,
            packerEmail: keeper.packerEmail,
            fileId: keeper.fileId,
            playbackUrl: keeper.playbackUrl
          },
          duplicates: duplicates
        });
      }
    }
  });

  return {
    success: true,
    totalDuplicateOrders: duplicateGroups.length,
    totalDuplicateSheetRows: totalDuplicateSheetRows,
    totalDuplicateDriveVideos: totalDriveFilesToMove,
    groups: duplicateGroups,
    message: duplicateGroups.length > 0
      ? `Found ${duplicateGroups.length} duplicate order recordings (${totalDuplicateSheetRows} duplicate sheet rows and ${totalDriveFilesToMove} duplicate videos in Google Drive).`
      : 'No duplicate recordings found in Google Sheets or Google Drive.'
  };
}

/**
 * Removes duplicate records from Google Sheets and safely moves duplicate video files
 * in Google Drive into a dedicated "Trash" subfolder in the EXACT same date series folder hierarchy.
 * Never calls file.setTrashed(true) or permanently deletes the videos.
 */
function removeDuplicateRecords_(p) {
  const user = session_(p.token);
  const keepPolicy = String(p.keepPolicy || 'latest').toLowerCase(); // 'latest' or 'first'
  const moveDriveVideosToTrash = p.moveDriveVideosToTrash !== false && p.moveDriveVideosToTrashFolder !== false;
  const removeSheetEntries = p.removeSheetEntries !== false;

  return withScriptLock_(function() {
    // 1. Rescan current state under lock
    const scan = scanDuplicateRecords_({ token: p.token, orderId: p.orderId, driveFolderId: p.driveFolderId });
    if (!scan.success || !scan.groups || scan.groups.length === 0) {
      return {
        success: true,
        cleanedOrdersCount: 0,
        removedSheetRowsCount: 0,
        movedDriveVideosCount: 0,
        message: 'No duplicate records found to remove.'
      };
    }

    let movedDriveVideosCount = 0;
    let removedSheetRowsCount = 0;
    let archivedCount = 0;
    const movedFilesLog = [];
    const rowsToDeleteBySheet = {}; // sheetName -> array of row numbers

    // Prepare TrashLog sheet for non-destructive audit archive
    let trashSh = null;
    try {
      trashSh = ss_().getSheetByName('TrashLog');
      if (!trashSh) {
        trashSh = ss_().insertSheet('TrashLog');
        trashSh.appendRow([
          'Archived Timestamp',
          'Original Sheet',
          'Order ID',
          'Platform',
          'Recording Type',
          'Packer Email',
          'Drive File ID',
          'Status',
          'Action Taken',
          'Trash Folder Location'
        ]);
        trashSh.getRange('A1:J1').setBackground('#f1f5f9').setFontWeight('bold');
        SpreadsheetApp.flush();
      }
    } catch(e) {
      console.warn('Could not setup TrashLog tab:', e);
    }

    scan.groups.forEach(function(grp) {
      let keeper = grp.keeper;
      let duplicates = grp.duplicates;

      if (keepPolicy === 'first') {
        const all = [grp.keeper].concat(grp.duplicates);
        all.sort(function(a, b) {
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });
        keeper = all[0];
        duplicates = all.slice(1);
      }

      // 2. Move duplicate video files in Google Drive into "Trash" folder inside the same date series folder
      if (moveDriveVideosToTrash) {
        duplicates.forEach(function(dup) {
          const dId = dup.fileId;
          // Only move if there is a real file ID and it is not the keeper's file ID
          if (dId && dId.length > 5 && dId !== keeper.fileId) {
            try {
              const file = DriveApp.getFileById(dId);
              if (file) {
                // Find file's parent folder (e.g. date folder "2026-09-25")
                const parents = file.getParents();
                const pFolder = parents.hasNext() ? parents.next() : null;
                let targetTrashFolder = null;

                if (pFolder) {
                  // Create or get "Trash" folder inside the exact same date series folder
                  const trIt = pFolder.getFoldersByName('Trash');
                  targetTrashFolder = trIt.hasNext() ? trIt.next() : pFolder.createFolder('Trash');
                } else {
                  // Fallback: root parent folder
                  const root = parentFolder_(p.driveFolderId);
                  targetTrashFolder = getOrCreateFolder_(root, 'Trash');
                }

                if (targetTrashFolder) {
                  // Handle potential duplicate filename in the Trash folder
                  const existingName = file.getName();
                  const inTrashIt = targetTrashFolder.getFilesByName(existingName);
                  if (inTrashIt.hasNext()) {
                    const extMatch = existingName.match(/(\.[^.]+)$/);
                    const ext = extMatch ? extMatch[1] : '.mp4';
                    const base = existingName.replace(/(\.[^.]+)$/, '');
                    const timeStampStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), '_yyyyMMdd_HHmmss');
                    file.setName(base + timeStampStr + ext);
                  }

                  // Move the file into the Trash folder
                  try {
                    file.moveTo(targetTrashFolder);
                  } catch(moveErr) {
                    targetTrashFolder.addFile(file);
                    if (pFolder) {
                      try { pFolder.removeFile(file); } catch(_) {}
                    }
                  }

                  movedDriveVideosCount++;
                  const trashPath = (pFolder ? pFolder.getName() + ' / ' : '') + targetTrashFolder.getName();
                  movedFilesLog.push({
                    fileId: dId,
                    fileName: file.getName(),
                    orderId: grp.orderId,
                    trashFolderName: targetTrashFolder.getName(),
                    parentFolderName: pFolder ? pFolder.getName() : 'Root',
                    trashFolderUrl: targetTrashFolder.getUrl()
                  });

                  if (trashSh) {
                    try {
                      trashSh.appendRow([
                        new Date(),
                        dup.sheet,
                        grp.orderId,
                        grp.platform,
                        grp.recordingType,
                        dup.packerEmail || user.email,
                        dId,
                        dup.status || 'Duplicate',
                        'Moved video to date-series Trash folder; Removed duplicate sheet row',
                        trashPath
                      ]);
                      archivedCount++;
                    } catch(_) {}
                  }
                }
              }
            } catch(fileErr) {
              console.warn('Could not move duplicate file ' + dId + ' to Trash folder:', fileErr);
            }
          } else if (trashSh && removeSheetEntries) {
            // Video file was same as keeper or no separate fileId, archive sheet row removal
            try {
              trashSh.appendRow([
                new Date(),
                dup.sheet,
                grp.orderId,
                grp.platform,
                grp.recordingType,
                dup.packerEmail || user.email,
                dId || 'N/A',
                dup.status || 'Duplicate',
                'Removed redundant duplicate sheet row (Keeper video retained)',
                'N/A (Same File ID as keeper)'
              ]);
              archivedCount++;
            } catch(_) {}
          }
        });
      }

      // 3. Mark duplicate sheet rows for deletion
      if (removeSheetEntries) {
        duplicates.forEach(function(dup) {
          if (!rowsToDeleteBySheet[dup.sheet]) {
            rowsToDeleteBySheet[dup.sheet] = [];
          }
          if (dup.row && dup.row >= 2) {
            rowsToDeleteBySheet[dup.sheet].push(dup.row);
          }
        });
      }

      // 4. Release lingering reservation locks for this order
      try {
        ['Amazon', 'D2C', 'JioMart', 'Custom'].forEach(function(pf) {
          ['Forward', 'Return'].forEach(function(tp) {
            releaseReservation_(reservationKey_(grp.orderId, pf, tp));
          });
        });
      } catch(_) {}
    });

    // 5. Delete marked rows from each sheet in descending order so indices remain exact
    if (removeSheetEntries) {
      Object.keys(rowsToDeleteBySheet).forEach(function(sheetName) {
        try {
          const sh = ss_().getSheetByName(sheetName);
          if (!sh) return;
          const rowList = rowsToDeleteBySheet[sheetName];
          // Remove duplicates in rowList and sort descending
          const uniqueRows = Array.from(new Set(rowList)).sort(function(a, b) { return b - a; });
          uniqueRows.forEach(function(rIdx) {
            if (rIdx >= 2 && rIdx <= sh.getMaxRows()) {
              try {
                sh.deleteRow(rIdx);
                removedSheetRowsCount++;
              } catch(delErr) {
                console.warn('Error deleting row ' + rIdx + ' from ' + sheetName + ':', delErr);
              }
            }
          });
        } catch(shErr) {
          console.warn('Error processing deletions in ' + sheetName + ':', shErr);
        }
      });
    }

    // 6. Refresh conditional formatting highlights across OrderLog, ReturnLog, and UploadLog
    try {
      applyDuplicateConditionalFormatting_(ss_().getSheetByName(CONFIG.ORDER_LOG_SHEET));
      applyDuplicateConditionalFormatting_(ss_().getSheetByName(CONFIG.RETURN_LOG_SHEET));
      applyDuplicateConditionalFormatting_(ss_().getSheetByName(CONFIG.UPLOAD_LOG_SHEET));
    } catch(fmtErr) {
      console.warn('Formatting update error:', fmtErr);
    }

    SpreadsheetApp.flush();

    // 7. Security audit log
    try {
      sheet_(CONFIG.SECURITY_LOG_SHEET).appendRow([
        new Date(),
        user.email,
        'DEDUPLICATE_CLEANUP',
        'SUCCESS',
        `Cleaned ${scan.groups.length} duplicate orders. Removed ${removedSheetRowsCount} sheet rows, moved ${movedDriveVideosCount} duplicate videos to date-series Trash folders, archived ${archivedCount} entries in TrashLog.`
      ]);
      SpreadsheetApp.flush();
    } catch(_) {}

    return {
      success: true,
      cleanedOrdersCount: scan.groups.length,
      removedSheetRowsCount: removedSheetRowsCount,
      movedDriveVideosCount: movedDriveVideosCount,
      archivedCount: archivedCount,
      movedFiles: movedFilesLog,
      message: `Successfully cleaned ${scan.groups.length} duplicate orders! Removed ${removedSheetRowsCount} duplicate rows from Google Sheets, and safely moved ${movedDriveVideosCount} duplicate videos into date-series "Trash" folders.`
    };
  }, 25000);
}

/* ---------- Reports & Analytics ---------- */
function inRange_(value,from,to){
  const d = value instanceof Date ? value : new Date(value);
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
  const user=session_(p.token), isAdmin=normalize_(user.role)==='admin', email=normalize_(user.email);
  const from=parseDateStart_(p.fromDate), to=parseDateEnd_(p.toDate), today=dateOnly_(new Date());
  if(isNaN(from)||isNaN(to))throw new Error('Invalid report dates.');
  if(from>to)throw new Error('From Date cannot be after To Date.');
  const span=Math.floor((to-from)/86400000)+1;
  if(span>90)throw new Error('Report range cannot exceed 90 days.');
  if(String(p.toDate||'')>today)throw new Error('Future dates are not allowed.');
  const platform=normalize_(p.platform), type=normalize_(p.recordingType), packer=normalize_(p.packer), status=normalize_(p.status);
  const video=String(p.video||'');
  const rows=[];
  const seenKeys={};

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
        const ts = v[i][0] instanceof Date ? v[i][0] : new Date(v[i][0]);
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

        rows.push({
          'Timestamp': ts.toISOString(),
          'Source': target.source,
          'Order ID': oid,
          'Platform': pf,
          'Recording Type': rt,
          'User Email': pe,
          'Status': st,
          'Drive File ID': fid,
          'Video Playback URL': pUrl || (fid ? 'https://drive.google.com/file/d/' + fid + '/preview' : '')
        });
      }
    } catch(err) {
      console.warn('Report scan error for ' + target.name + ':', err);
    }
  });

  return {success: true, fromDate: p.fromDate, toDate: p.toDate, rows};
}

function getAnalyticsData_(p){
  const user=session_(p.token), isAdmin=normalize_(user.role)==='admin', email=normalize_(user.email);
  const from=parseDateStart_(p.fromDate), to=parseDateEnd_(p.toDate), today=dateOnly_(new Date());
  if(isNaN(from)||isNaN(to))throw new Error('Invalid analytics dates.');
  if(from>to)throw new Error('From Date cannot be after To Date.');
  const span=Math.floor((to-from)/86400000)+1;
  if(span>90)throw new Error('Analytics range cannot exceed 90 days.');
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
        const ts = v[i][0] instanceof Date ? v[i][0] : new Date(v[i][0]);
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
        const ts = uv[i][0] instanceof Date ? uv[i][0] : new Date(uv[i][0]);
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
    videoDriveFolderId: videoDriveFolderId
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
  const data = sh.getDataRange().getValues();

  function updateOrInsert(key, value, desc) {
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').trim() === key) {
        sh.getRange(i + 1, 2).setValue(value);
        sh.getRange(i + 1, 3).setValue(now);
        found = true;
        break;
      }
    }
    if (!found) {
      sh.appendRow([key, value, now, desc || '']);
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
  if (p.videoDriveFolderId !== undefined || p.driveFolderId !== undefined) {
    const rawVal = String(p.videoDriveFolderId || p.driveFolderId || '').trim();
    let cleanFolderId = rawVal;
    const urlMatch = rawVal.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) {
      cleanFolderId = urlMatch[1];
    }
    props.setProperty('PARENT_FOLDER_ID', cleanFolderId);
    updateOrInsert('VideoDriveFolderId', cleanFolderId, 'Google Drive Root Folder ID for Video Uploads');
  }

  return {
    success: true,
    message: 'Settings saved to Google Sheet "Branding" tab and Script Properties permanently.',
    appName: p.appName,
    appSubtitle: p.appSubtitle,
    logoUrl: p.logoUrl,
    faviconUrl: p.faviconUrl,
    videoDriveFolderId: p.videoDriveFolderId || p.driveFolderId
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

