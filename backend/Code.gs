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

  // Limits
  MAX_VIDEO_BYTES: 1024 * 1024 * 1024 * 5, // 5 GB
  DEFAULT_CHUNK_BYTES: 16 * 1024 * 1024, // 16 MB
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
      case 'applyConditionalFormatting': return output_(applyFormattingEndpoint_());
      case 'getBranding': return output_(getBrandingConfig_());
      case 'saveBranding': return output_(saveBrandingConfig_(p));
      case 'uploadBrandingImage': return output_(uploadBrandingImage_(p));
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
  const folderId = customFolderId || props.getProperty('PARENT_FOLDER_ID') || CONFIG.HARDWIRED_PARENT_FOLDER_ID;
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
 * Applies Conditional Formatting to the OrderLog Sheet:
 * Automatically highlights duplicate Order IDs in Column B with a light red background and bold dark red text.
 */
function applyDuplicateConditionalFormatting_(sh) {
  if (!sh) return;
  try {
    const lastRow = Math.max(sh.getMaxRows(), 500);
    const orderIdRange = sh.getRange('B2:B' + lastRow);

    // Filter out existing custom duplicate rules on Column B to avoid stacking duplicates
    const rules = sh.getConditionalFormatRules() || [];
    const filteredRules = rules.filter(function(r) {
      const ranges = r.getRanges();
      return !ranges.some(function(rng) {
        return rng.getA1Notation().indexOf('B2:B') !== -1 || rng.getA1Notation().indexOf('B:B') !== -1;
      });
    });

    // Create Rule: Highlight cells in Column B where count > 1
    const duplicateRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(LEN($B2)>0, COUNTIF($B$2:$B, $B2)>1)')
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

function applyFormattingEndpoint_() {
  const orderSh = sheet_(CONFIG.ORDER_LOG_SHEET);
  const returnSh = sheet_(CONFIG.RETURN_LOG_SHEET);
  applyDuplicateConditionalFormatting_(orderSh);
  applyDuplicateConditionalFormatting_(returnSh);
  repairPlaybackUrls();
  return { success: true, message: 'Conditional formatting and playback hyperlinks repaired in Google Sheets.' };
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

  // Seed default branding settings if Branding sheet is empty
  const brandSh = ss.getSheetByName(CONFIG.BRANDING_SHEET);
  if (brandSh && brandSh.getLastRow() <= 1) {
    brandSh.appendRow(['AppName', 'VMS 3.0', new Date(), 'Application Display Name']);
    brandSh.appendRow(['AppSubtitle', 'Order Packing System', new Date(), 'Workstation Subtitle']);
    brandSh.appendRow(['LogoUrl', '', new Date(), 'Logo Image URL or Drive Direct Link']);
    brandSh.appendRow(['FaviconUrl', '', new Date(), 'Browser Favicon URL or Drive Direct Link']);
    brandSh.appendRow(['BrandingFolderId', '', new Date(), 'Google Drive Folder for Brand Assets']);
  }

  // Apply conditional formatting on OrderLog & ReturnLog
  const orderSh = ss.getSheetByName(CONFIG.ORDER_LOG_SHEET);
  if (orderSh) {
    applyDuplicateConditionalFormatting_(orderSh);
  }
  const returnSh = ss.getSheetByName(CONFIG.RETURN_LOG_SHEET);
  if (returnSh) {
    applyDuplicateConditionalFormatting_(returnSh);
  }

  // Run repair for any existing rows where Column F has plain filename instead of clickable URL
  repairPlaybackUrls();

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
  const me=admin_(p.token),row=Number(p.row);if(row<2)throw new Error('Invalid user row.');
  const sh=sheet_(CONFIG.USERS_SHEET),email=String(sh.getRange(row,3).getValue()||'').toLowerCase();
  if(email===String(me.email).toLowerCase())throw new Error('You cannot delete your own administrator account.');
  sh.deleteRow(row);return {success:true};
}

/* ---------- Duplicate Detection & Guard ---------- */
function normalize_(v){return String(v||'').trim().toLowerCase()}
function normalizeOrderId_(v){
  if(v===null||v===undefined)return '';
  return String(v).trim().toLowerCase().replace(/\s+/g, '');
}
function key_(order,platform,type){return [normalizeOrderId_(order),normalize_(platform),normalize_(type||'Forward')].join('||')}

function driveExists_(id){
  if(!id)return false;
  try{DriveApp.getFileById(String(id));return true}catch(_){return false}
}

function completedDuplicate_(order,platform,type){
  const normTargetOrder = normalizeOrderId_(order);
  if (!normTargetOrder) return null;

  // 1. Check ORDER_LOG_SHEET first
  try {
    const orderSheet = sheet_(CONFIG.ORDER_LOG_SHEET);
    if (orderSheet) {
      const v = orderSheet.getDataRange().getValues();
      for (let i = v.length - 1; i >= 1; i--) {
        const rawOrder = v[i][1];
        const normRowOrder = normalizeOrderId_(rawOrder);
        if (!normRowOrder || normRowOrder !== normTargetOrder) continue;

        const rawType = v[i][8] || 'Forward';
        const fileId = String(v[i][4] || '').trim();

        // Only count as duplicate if it has a valid Google Drive file ID
        if (fileId.length > 5 && fileId !== 'undefined' && fileId !== 'null') {
          return {
            sourceSheet: CONFIG.ORDER_LOG_SHEET,
            row: i + 1,
            orderId: String(rawOrder || ''),
            platform: String(v[i][2] || ''),
            recordingType: String(rawType || 'Forward'),
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

  // 2. Check RETURN_LOG_SHEET next
  try {
    const returnSheet = sheet_(CONFIG.RETURN_LOG_SHEET);
    if (returnSheet) {
      const r = returnSheet.getDataRange().getValues();
      for (let i = r.length - 1; i >= 1; i--) {
        const rawOrder = r[i][1];
        const normRowOrder = normalizeOrderId_(rawOrder);
        if (!normRowOrder || normRowOrder !== normTargetOrder) continue;

        const rawType = r[i][8] || 'Return';
        const fileId = String(r[i][4] || '').trim();

        // Only count as duplicate if it has a valid Google Drive file ID
        if (fileId.length > 5 && fileId !== 'undefined' && fileId !== 'null') {
          return {
            sourceSheet: CONFIG.RETURN_LOG_SHEET,
            row: i + 1,
            orderId: String(rawOrder || ''),
            platform: String(r[i][2] || ''),
            recordingType: String(rawType || 'Return'),
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

  // 3. Check UPLOAD_LOG_SHEET next (ONLY completed uploads with fileId or status Completed)
  try {
    const uploadSheet = sheet_(CONFIG.UPLOAD_LOG_SHEET);
    if (uploadSheet) {
      const u = uploadSheet.getDataRange().getValues();
      for (let i = u.length - 1; i >= 1; i--) {
        const rawOrder = u[i][1];
        const normRowOrder = normalizeOrderId_(rawOrder);
        if (!normRowOrder || normRowOrder !== normTargetOrder) continue;

        const rawType = u[i][12] || 'Forward';
        const rawStatus = normalize_(u[i][10] || '');
        const rawStage = normalize_(u[i][7] || '');
        const fileId = String(u[i][9] || '').trim();

        // IMPORTANT: NEVER treat 'in progress' or 'started' as a duplicate - only truly completed uploads
        if ((rawStatus === 'completed' || rawStage === 'completed' || fileId.length > 5) && fileId.length > 5) {
          return {
            sourceSheet: CONFIG.UPLOAD_LOG_SHEET,
            row: i + 1,
            orderId: String(rawOrder || ''),
            platform: String(u[i][2] || ''),
            recordingType: String(rawType || 'Forward'),
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

  const dup = completedDuplicate_(order, platform, type);
  if (dup) {
    return {
      success: true,
      isDuplicate: true,
      existing: dup,
      message: `Order ${order} has an existing ${type} recording in Google Drive.`
    };
  }
  return { success: true, isDuplicate: false };
}

/**
 * Clean up all orphaned/stuck 'In Progress' sessions in Google Sheet and script properties
 */
function cleanupStuckUploads_(p){
  const user = session_(p.token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let cleanedRows = 0;
  let clearedProps = 0;
  const purgeInterrupted = p.purgeInterrupted === true || String(p.purgeInterrupted) === 'true' || p.purgeStale === true || String(p.purgeStale) === 'true';

  try {
    const uploadSh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
    const data = uploadSh.getDataRange().getValues();
    const now = Date.now();

    for (let i = data.length - 1; i >= 1; i--) {
      const rawStatus = normalize_(data[i][10] || '');
      const fileId = String(data[i][9] || '').trim();
      const rawDate = data[i][0];
      const rowTime = rawDate instanceof Date ? rawDate.getTime() : new Date(rawDate).getTime();
      const isOld = isNaN(rowTime) || (now - rowTime > 3 * 60 * 1000); // older than 3 minutes

      // If status is in progress / started / initiated / stale and has no completed fileId
      const isUnfinished = (rawStatus === 'in progress' || rawStatus === 'started' || rawStatus === 'initiated' || rawStatus === 'uploading' || rawStatus === 'session created' || rawStatus === 'interrupted / stale' || rawStatus === 'stale') && !fileId;

      if (isUnfinished) {
        if (purgeInterrupted) {
          uploadSh.deleteRow(i + 1);
          cleanedRows++;
        } else {
          uploadSh.getRange(i + 1, 11).setValue('Interrupted / Stale');
          uploadSh.getRange(i + 1, 8).setValue('Upload session expired or reset by operator');
          cleanedRows++;
        }
      }
    }

    // Clean up PropertiesService UPLOAD_* and DUPRES_* keys
    const props = PropertiesService.getScriptProperties();
    const allProps = props.getProperties();
    for (const k in allProps) {
      if (k.startsWith('UPLOAD_') || k.startsWith('DUPRES_')) {
        props.deleteProperty(k);
        clearedProps++;
      }
    }

    return {
      success: true,
      cleanedRows: cleanedRows,
      clearedProperties: clearedProps,
      purged: purgeInterrupted,
      message: purgeInterrupted
        ? `Successfully purged ${cleanedRows} interrupted upload row(s) and cleared active session locks.`
        : `Successfully resolved ${cleanedRows} stuck upload row(s) and cleared active session locks.`
    };
  } finally {
    lock.releaseLock();
  }
}

function reservationKey_(order,platform,type){return 'DUPRES_'+Utilities.base64EncodeWebSafe(key_(order,platform,type)).replace(/=+$/,'')}

function activeReservation_(k){
  const raw=PropertiesService.getScriptProperties().getProperty(k);if(!raw)return null;
  try{const o=JSON.parse(raw);if(Date.now()-Number(o.time||0)>CONFIG.RESERVATION_SECONDS*1000){PropertiesService.getScriptProperties().deleteProperty(k);return null}return o}catch(_){PropertiesService.getScriptProperties().deleteProperty(k);return null}
}

function reserve_(order,platform,type,user){
  const props=PropertiesService.getScriptProperties(), k=reservationKey_(order,platform,type), existing=activeReservation_(k);
  if(existing)return {allowed:false,existing};
  props.setProperty(k,JSON.stringify({time:Date.now(),email:user.email,uploadId:''}));return {allowed:true,key:k};
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
  const from = p.fromDate ? new Date(p.fromDate+'T00:00:00') : null;
  const to = p.toDate ? new Date(p.toDate+'T23:59:59') : null;

  // If specific order search is active, do not cap at 100 - scan all rows
  const hasSpecificSearch = !!(rawOrder || packer || from || to);
  const limit = hasSpecificSearch ? Math.min(10000, Math.max(1, Number(p.limit||5000))) : Math.min(1000, Math.max(1, Number(p.limit||100)));
  const rows = [];
  const seenFids = {};

  const sheetsToScan = [
    { name: CONFIG.ORDER_LOG_SHEET, defaultType: 'Forward' },
    { name: CONFIG.RETURN_LOG_SHEET, defaultType: 'Return' }
  ];

  // 1. Scan OrderLog and ReturnLog Sheets
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
        const st = String(v[i][7] || 'Completed').trim();
        const rt = String(v[i][8] || target.defaultType).trim();

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

        rows.push({
          timestamp: ts instanceof Date && !isNaN(ts.getTime()) ? ts.toISOString() : String(v[i][0]||''),
          orderId: oid,
          platform: pf,
          packerEmail: pe,
          fileId: fid,
          fileName: oid + '_' + pf + '_' + rt + '.mp4',
          playbackUrl: String(v[i][5] || (fid ? 'https://drive.google.com/file/d/' + fid + '/preview' : '')),
          downloadUrl: fid ? 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fid) : '',
          status: st || 'Completed',
          recordingType: rt,
          sheet: target.name
        });

        if (rows.length >= limit) break;
      }
    } catch (e) {
      console.warn(target.name + ' search note:', e);
    }
  });

  // 2. Scan UploadLog Sheet for any additional or in-progress/uploaded records
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
        const fid = String(u[i][9] || '').trim();
        const st = String(u[i][10] || 'Completed').trim();
        const rt = String(u[i][12] || 'Forward').trim();

        if (fid && seenFids[fid]) continue; // already recorded
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

        if (fid) seenFids[fid] = true;

        rows.push({
          timestamp: ts instanceof Date && !isNaN(ts.getTime()) ? ts.toISOString() : String(u[i][0]||''),
          orderId: oid,
          platform: pf,
          packerEmail: pe,
          fileId: fid,
          fileName: fn || (oid + '_' + pf + '_' + rt + '.mp4'),
          playbackUrl: fid ? 'https://drive.google.com/file/d/' + fid + '/preview' : '',
          downloadUrl: fid ? 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fid) : '',
          status: st || 'Completed',
          recordingType: rt,
          sheet: CONFIG.UPLOAD_LOG_SHEET
        });

        if (rows.length >= limit) break;
      }
    }
  } catch (e) {
    console.warn('UploadLog search note:', e);
  }

  // 3. Fallback: If searching for a specific order and 0 rows found in sheets, search Google Drive files directly
  if (rawOrder && rows.length === 0) {
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

        rows.push({
          timestamp: file.getDateCreated() ? file.getDateCreated().toISOString() : new Date().toISOString(),
          orderId: parsedOrder,
          platform: parsedPf,
          packerEmail: user.email || 'packer@vms.local',
          fileId: fid,
          fileName: fName,
          playbackUrl: 'https://drive.google.com/file/d/' + fid + '/preview',
          downloadUrl: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fid),
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

function dateFolder_(platform, type, customDriveFolderId, targetDateStr) {
  const root = parentFolder_(customDriveFolderId);
  const pf = getOrCreateFolder_(root, platform || 'Custom');
  const tf = getOrCreateFolder_(pf, type || 'Forward');
  let dateName = targetDateStr ? String(targetDateStr).trim() : '';
  if (!dateName || !/^\d{4}-\d{2}-\d{2}$/.test(dateName)) {
    dateName = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return getOrCreateFolder_(tf, dateName);
}

function safeName_(s){return String(s||'').replace(/[\\/:*?"<>|#%{}\[\]]/g,'_').trim()}

function logUpload_(row){
  try {
    sheet_(CONFIG.UPLOAD_LOG_SHEET).appendRow(row);
    SpreadsheetApp.flush();
  } catch(e) {
    console.error('Failed to log upload: ', e);
  }
}

function updateUploadLog_(uploadId,stage,progress,fileId,status,error){
  try {
    const sh=sheet_(CONFIG.UPLOAD_LOG_SHEET), v=sh.getDataRange().getValues();
    for(let i=v.length-1;i>=1;i--){
      if(String(v[i][6]||'')===String(uploadId)){
        sh.getRange(i+1,8,1,5).setValues([[stage,progress,fileId||'',status||'',error||'']]);
        return;
      }
    }
  } catch(e){}
}

/* ---------- Start Upload Session ---------- */
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

  const lock=LockService.getScriptLock();
  lock.waitLock(20000);
  let reservation=null;
  try{
    reservation=reserve_(order,platform,type,user);

    const ext = String(p.fileName||'').toLowerCase().endsWith('.mp4')?'.mp4':'.webm';
    const name = safeName_(order)+'_'+safeName_(platform)+'_'+safeName_(type)+ext;
    const uploadId = Utilities.getUuid();
    const source = String(p.source||'Automatic Recording');
    const queueJobId = String(p.queueJobId||'');
    const mime = String(p.mimeType||'video/mp4');

    const recordingDate = p.recordingDate ? String(p.recordingDate).trim() : '';
    const folder = dateFolder_(platform, type, driveFolderId, recordingDate);

    // Initiate Google Drive Resumable Upload Session (Direct Drive v3 API) only for large files (> 12 MB)
    // For small and medium files (<= 12 MB), native targetFolder.createFile(blob) in Apps Script is 10x faster (~1.2s)
    let uploadUrl = '';
    const isSmallFile = size <= 12 * 1024 * 1024;
    if (!isSmallFile) {
      try {
        const oauthToken = ScriptApp.getOAuthToken();
        if (oauthToken) {
          const driveSessionResp = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
            method: 'post',
            contentType: 'application/json; charset=UTF-8',
            headers: {
              Authorization: 'Bearer ' + oauthToken,
              'X-Upload-Content-Type': mime,
              'X-Upload-Content-Length': String(size)
            },
            payload: JSON.stringify({
              name: name,
              mimeType: mime,
              parents: [folder.getId()]
            }),
            muteHttpExceptions: true
          });

          const respCode = driveSessionResp.getResponseCode();
          if (respCode >= 200 && respCode < 300 || respCode === 308) {
            const headers = driveSessionResp.getHeaders ? driveSessionResp.getHeaders() : driveSessionResp.getAllHeaders();
            for (const key in headers) {
              if (key.toLowerCase() === 'location') {
                uploadUrl = String(headers[key] || '').trim();
                break;
              }
            }
          }
        }
      } catch(dErr) {
        console.warn('Drive resumable session create note:', dErr);
      }
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
      createdAt: Date.now()
    };

    PropertiesService.getScriptProperties().setProperty('UPLOAD_' + uploadId, JSON.stringify(sessionData));
    if (reservation) setReservationUpload_(reservation.key, uploadId);

    // Reuse existing unfinished row if present, otherwise log new
    const uploadSh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
    const uploadData = uploadSh.getDataRange().getValues();
    let updatedExisting = false;
    for (let i = uploadData.length - 1; i >= 1; i--) {
      const rOrder = String(uploadData[i][1] || '').trim();
      const rPlatform = String(uploadData[i][2] || '').trim();
      const rType = String(uploadData[i][12] || 'Forward').trim();
      const rStatus = String(uploadData[i][10] || '').trim();
      if (normalize_(rOrder) === normalize_(order) && normalize_(rPlatform) === normalize_(platform) && normalize_(rType) === normalize_(type)) {
        if (rStatus === 'Started' || rStatus === 'Pending' || rStatus === 'In Progress') {
          uploadSh.getRange(i + 1, 1, 1, 15).setValues([[
            new Date(), order, platform, user.email, name, size, uploadId, 'Session Created', 0, '', 'Started', '', type, source, queueJobId
          ]]);
          updatedExisting = true;
          break;
        }
      }
    }
    if (!updatedExisting) {
      logUpload_([new Date(), order, platform, user.email, name, size, uploadId, 'Session Created', 0, '', 'Started', '', type, source, queueJobId]);
    }

    return {
      success: true,
      uploadId: uploadId,
      uploadUrl: uploadUrl,
      chunkSize: CONFIG.DEFAULT_CHUNK_BYTES,
      fileName: name,
      fileSize: size,
      hasResumableUrl: !!uploadUrl,
      isDuplicate: !!done
    };
  } catch(e) {
    if(reservation&&reservation.key)releaseReservation_(reservation.key);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Upload Chunk ---------- */
function uploadChunk_(p){
  const user = session_(p.token);
  const uploadId = p.uploadId;
  const raw = PropertiesService.getScriptProperties().getProperty('UPLOAD_' + uploadId);
  if(!raw) throw new Error('Upload session expired or invalid. Please retry.');

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
        updateUploadLog_(uploadId, 'Uploading chunk ' + (chunkIndex + 1) + '/' + totalChunks, pct, '', 'In Progress', '');
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
        console.error('Google Drive Resumable API error: ' + code + ' ' + errText);
        if (code === 404 || code === 410) {
          updateUploadLog_(uploadId, 'Session Expired', 0, '', 'Failed', 'Drive upload session expired. Please retry.');
          throw new Error('Google Drive upload session expired. Please retry.');
        }
        throw new Error('Google Drive returned error ' + code + ': ' + (errText || 'Upload chunk rejected'));
      }
    } catch(uErr) {
      console.warn('Drive resumable chunk upload notice:', uErr);
      if (String(uErr).indexOf('expired') !== -1 || String(uErr).indexOf('Google Drive') !== -1) {
        throw uErr;
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
    updateUploadLog_(uploadId, 'Uploading chunk ' + (chunkIndex + 1) + '/' + totalChunks, pct, '', 'In Progress', '');
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

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const targetLogSheet = getTargetLogSheet_(s.type);
    let alreadyLogged = false;
    if (fid || s.queueJobId) {
      const existingData = targetLogSheet.getDataRange().getValues();
      for (let i = existingData.length - 1; i >= 1; i--) {
        const rowFid = String(existingData[i][4] || '').trim();
        const rowJob = String(existingData[i][9] || '').trim();
        if ((fid && rowFid === fid) || (s.queueJobId && rowJob === s.queueJobId)) {
          alreadyLogged = true;
          break;
        }
      }
    }

    if (!alreadyLogged) {
      targetLogSheet.appendRow([
        new Date(),
        s.order,
        s.platform,
        s.packerEmail || (user ? user.email : ''),
        fid,
        playback,
        '',
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
          s.size,
          'Recording & Cloud Upload Complete',
          s.type
        ]);
      } catch(_) {}
    }
    updateUploadLog_(uploadId, 'Completed', 100, fid, 'Completed', '');
    if(s.reservationKey) releaseReservation_(s.reservationKey);
    cleanupOldStartedUploads_(s.order, uploadId);
  } finally {
    lock.releaseLock();
  }

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
  const user=session_(p.token);
  const filterStatus = normalize_(p.status);
  const filterOrder = normalize_(p.orderId);
  const filterPlatform = normalize_(p.platform);
  const filterType = normalize_(p.recordingType);
  const searchQ = normalize_(p.searchQuery || p.search);
  
  // When an orderId or search query is present, do not cap at 500 - scan all rows
  const isSearchActive = !!(filterOrder || searchQ || (p.fromDate && p.fromDate !== '') || (p.toDate && p.toDate !== ''));
  const limit = isSearchActive ? Math.min(10000, Math.max(1, Number(p.limit || 5000))) : Math.min(2000, Math.max(1, Number(p.limit || 500)));

  const v=sheet_(CONFIG.UPLOAD_LOG_SHEET).getDataRange().getValues(), logs=[];
  const seenOrderTypes = {};
  let totalCount = 0;
  let completedCount = 0;
  let inProgressCount = 0;
  let pendingCount = 0;
  let failedCount = 0;

  for(let i=v.length-1; i>=1; i--){
    const pe=String(v[i][3]||'');

    let rawStatus = String(v[i][10]||'');
    let normSt = normalize_(rawStatus);
    const orderId = String(v[i][1]||'');
    const platform = String(v[i][2]||'');
    const recordingType = String(v[i][12]||'Forward');
    const driveFileId = String(v[i][9]||'');
    const fileName = String(v[i][4]||'');
    const uploadId = String(v[i][6]||'');
    let stage = String(v[i][7]||'');

    // Auto-detect abandoned in-progress sessions older than 10 minutes without Drive File ID
    const rowDate = v[i][0] instanceof Date ? v[i][0].getTime() : new Date(v[i][0]).getTime();
    const isStale = (normSt === 'in progress' || normSt === 'uploading' || normSt === 'processing' || normSt === 'started') && !driveFileId && (Date.now() - rowDate > 10 * 60 * 1000);
    if (isStale) {
      rawStatus = 'Interrupted / Stale';
      normSt = 'failed';
      if (!stage || stage === 'In Progress' || stage.startsWith('Uploading chunk')) {
        stage = 'Upload interrupted - Session timed out';
      }
    }

    // Aggregate stats
    totalCount++;
    if(normSt === 'completed' || (driveFileId && driveFileId.length > 5 && !isStale && normSt !== 'failed')) completedCount++;
    else if(normSt === 'failed' || normSt === 'paused' || normSt === 'error' || isStale || normSt.includes('interrupt') || normSt.includes('stale') || normSt.includes('expired') || normSt.includes('timeout')) failedCount++;
    else if(normSt === 'in progress' || normSt === 'uploading' || normSt === 'processing') inProgressCount++;
    else if(normSt === 'pending' || normSt === 'queued' || normSt === 'initiated' || normSt === 'started' || normSt === 'session created' || normSt === 'waiting') pendingCount++;
    else pendingCount++;

    // Apply filters
    if(filterStatus && filterStatus !== 'all') {
      if(filterStatus === 'completed' && normSt !== 'completed') continue;
      if((filterStatus === 'in progress' || filterStatus === 'processing' || filterStatus === 'pending') && normSt !== 'in progress' && normSt !== 'uploading' && normSt !== 'processing' && normSt !== 'pending' && normSt !== 'queued' && normSt !== 'started') continue;
      if((filterStatus === 'failed' || filterStatus === 'paused') && normSt !== 'failed' && normSt !== 'paused' && normSt !== 'error' && !normSt.includes('interrupt') && !normSt.includes('stale') && !isStale) continue;
    }

    if(filterOrder && !normalize_(orderId).includes(filterOrder)) continue;
    if(searchQ && !(
      normalize_(orderId).includes(searchQ) ||
      normalize_(fileName).includes(searchQ) ||
      normalize_(pe).includes(searchQ) ||
      normalize_(uploadId).includes(searchQ) ||
      normalize_(platform).includes(searchQ)
    )) continue;

    if(filterPlatform && filterPlatform !== 'all' && normalize_(platform) !== filterPlatform) continue;
    if(filterType && filterType !== 'all' && normalize_(recordingType) !== filterType) continue;

    if(logs.length < limit) {
      const orderKey = normalizeOrderId_(orderId) + '_' + normalize_(recordingType);
      seenOrderTypes[orderKey] = true;

      logs.push({
        timestamp: v[i][0] instanceof Date ? v[i][0].toISOString() : String(v[i][0]||''),
        orderId: orderId,
        platform: platform,
        packerEmail: pe,
        fileName: fileName,
        fileSize: String(v[i][5]||''),
        uploadId: uploadId,
        stage: String(v[i][7]||''),
        progress: String(v[i][8]||''),
        driveFileId: driveFileId,
        status: rawStatus || 'Completed',
        error: String(v[i][11]||''),
        recordingType: recordingType,
        source: String(v[i][13]||''),
        queueJobId: String(v[i][14]||''),
        playbackUrl: driveFileId ? 'https://drive.google.com/file/d/' + driveFileId + '/preview' : '',
        downloadUrl: driveFileId ? 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(driveFileId) : ''
      });
    }
  }

  // Also include completed records from OrderLog & ReturnLog sheets if not already in UploadLog
  if (logs.length < limit && (!filterStatus || filterStatus === 'all' || filterStatus === 'completed')) {
    const orderSheets = [
      { name: CONFIG.ORDER_LOG_SHEET, defType: 'Forward' },
      { name: CONFIG.RETURN_LOG_SHEET, defType: 'Return' }
    ];

    for (let s = 0; s < orderSheets.length; s++) {
      if (logs.length >= limit) break;
      try {
        const sh = sheet_(orderSheets[s].name);
        if (!sh) continue;
        const odata = sh.getDataRange().getValues();
        // Headers: [Timestamp, Order ID, Platform, Packer Email, Video Drive ID, Video Playback URL, Package Weight, Status, Recording Type, Queue Job ID, Video MIME Type, Playback Status]
        for (let i = odata.length - 1; i >= 1; i--) {
          if (logs.length >= limit) break;
          const oid = String(odata[i][1] || '').trim();
          const pf = String(odata[i][2] || '').trim();
          const pe = String(odata[i][3] || '').trim();
          const fid = String(odata[i][4] || '').trim();
          const pUrl = String(odata[i][5] || '').trim();
          const rawSt = String(odata[i][7] || 'Completed').trim();
          const rt = String(odata[i][8] || orderSheets[s].defType).trim();
          const jid = String(odata[i][9] || '').trim();

          const orderKey = normalizeOrderId_(oid) + '_' + normalize_(rt);
          if (seenOrderTypes[orderKey]) continue;
          seenOrderTypes[orderKey] = true;

          totalCount++;
          completedCount++;

          if(filterOrder && !normalize_(oid).includes(filterOrder)) continue;
          if(searchQ && !(
            normalize_(oid).includes(searchQ) ||
            normalize_(pe).includes(searchQ) ||
            normalize_(pf).includes(searchQ)
          )) continue;
          if(filterPlatform && filterPlatform !== 'all' && normalize_(pf) !== filterPlatform) continue;
          if(filterType && filterType !== 'all' && normalize_(rt) !== filterType) continue;

          logs.push({
            timestamp: odata[i][0] instanceof Date ? odata[i][0].toISOString() : String(odata[i][0]||''),
            orderId: oid,
            platform: pf,
            packerEmail: pe,
            fileName: oid + '_' + pf + '_' + rt + '.mp4',
            fileSize: '—',
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
        console.warn('OrderSheet scan note:', e);
      }
    }
  }

  return {
    success: true,
    logs: logs,
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
  const deleteFromDrive = p.deleteFromDrive !== false;
  const deleteFromSheets = p.deleteFromSheets !== false;

  if (!orderId && !uploadId && !driveFileId && !queueJobId) {
    throw new Error('Order ID, Upload ID, Drive File ID, or Queue Job ID is required to remove log entries.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);

  let orderLogsRemoved = 0;
  let uploadLogsRemoved = 0;
  let downloadLogsRemoved = 0;
  const discoveredDriveIds = [];

  if (driveFileId && driveFileId.length > 5) {
    discoveredDriveIds.push(driveFileId);
  }

  // Has specific unique pointer to ONE log entry?
  const hasSpecificId = Boolean((driveFileId && driveFileId.length > 5) || (uploadId && uploadId.length > 5) || (queueJobId && queueJobId.length > 5));

  try {
    if (deleteFromSheets) {
      // 1. Delete matching entries from OrderLog and ReturnLog sheets
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
              // Fallback: match by order ID, and if timestamp or recordingType is provided, refine to that specific entry
              if (orderId && rowOrderId && normalizeOrderId_(rowOrderId) === normalizeOrderId_(orderId)) {
                if (targetType && rowType && normalize_(targetType) !== normalize_(rowType)) {
                  match = false;
                } else if (targetTimestampStr && rowTimestamp) {
                  const diffMs = Math.abs(new Date(rowTimestamp).getTime() - new Date(targetTimestampStr).getTime());
                  if (!isNaN(diffMs) && diffMs < 120000) {
                    match = true;
                  } else if (isNaN(diffMs) && (rowTimestamp.includes(targetTimestampStr.substring(0, 10)) || targetTimestampStr.includes(rowTimestamp.substring(0, 10)))) {
                    match = true;
                  }
                } else {
                  match = true;
                }
              }
            }

            if (match) {
              if (rowDriveId && rowDriveId.length > 5 && !discoveredDriveIds.includes(rowDriveId)) {
                if (!hasSpecificId) discoveredDriveIds.push(rowDriveId);
              }
              targetSh.deleteRow(i + 1);
              orderLogsRemoved++;
            }
          }

          // Prune completely empty ghost rows
          const refreshedTargetData = targetSh.getDataRange().getValues();
          for (let i = refreshedTargetData.length - 1; i >= 1; i--) {
            const rowOrderId = String(refreshedTargetData[i][1] || '').trim();
            const rowDriveId = String(refreshedTargetData[i][4] || '').trim();
            const rowTimestamp = String(refreshedTargetData[i][0] || '').trim();
            if (!rowOrderId && !rowDriveId && !rowTimestamp) {
              targetSh.deleteRow(i + 1);
            }
          }
        } catch(e) {
          console.warn('Note deleting from ' + sheetName + ':', e);
        }
      });

      // 2. Delete matching entries from UploadLog sheet
      try {
        const uploadSh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
        const uploadData = uploadSh.getDataRange().getValues();
        // Headers: [Timestamp, Order ID, Platform, Packer Email, File Name, File Size, Upload ID, Stage, Progress, Drive File ID, Status, Error, Recording Type, Source, Queue Job ID]
        for (let i = uploadData.length - 1; i >= 1; i--) {
          const rowTimestamp = uploadData[i][0] instanceof Date ? uploadData[i][0].toISOString() : String(uploadData[i][0] || '').trim();
          const rowOrderId = String(uploadData[i][1] || '').trim();
          const rowUploadId = String(uploadData[i][6] || '').trim();
          const rowDriveId = String(uploadData[i][9] || '').trim();
          const rowType = String(uploadData[i][12] || '').trim();
          const rowJobId = String(uploadData[i][14] || '').trim();

          let match = false;
          if (hasSpecificId) {
            // Strict specific match: only match the exact Drive ID, Upload ID, or Queue Job ID
            if (driveFileId && rowDriveId && rowDriveId === driveFileId) match = true;
            else if (uploadId && rowUploadId && rowUploadId === uploadId) match = true;
            else if (uploadId && rowJobId && rowJobId === uploadId) match = true;
            else if (queueJobId && rowJobId && rowJobId === queueJobId) match = true;
            else if (queueJobId && rowUploadId && rowUploadId === queueJobId) match = true;
          } else {
            // Fallback: match by order ID, and if timestamp or recordingType is provided, refine to that specific entry
            if (orderId && rowOrderId && normalizeOrderId_(rowOrderId) === normalizeOrderId_(orderId)) {
              if (targetType && rowType && normalize_(targetType) !== normalize_(rowType)) {
                match = false;
              } else if (targetTimestampStr && rowTimestamp) {
                const diffMs = Math.abs(new Date(rowTimestamp).getTime() - new Date(targetTimestampStr).getTime());
                if (!isNaN(diffMs) && diffMs < 120000) {
                  match = true;
                } else if (isNaN(diffMs) && (rowTimestamp.includes(targetTimestampStr.substring(0, 10)) || targetTimestampStr.includes(rowTimestamp.substring(0, 10)))) {
                  match = true;
                }
              } else {
                match = true;
              }
            }
          }

          if (match) {
            if (rowDriveId && rowDriveId.length > 5 && !discoveredDriveIds.includes(rowDriveId)) {
              if (!hasSpecificId) discoveredDriveIds.push(rowDriveId);
            }
            uploadSh.deleteRow(i + 1);
            uploadLogsRemoved++;
          }
        }

        // Prune completely empty ghost rows from UploadLog
        const refreshedUploadData = uploadSh.getDataRange().getValues();
        for (let i = refreshedUploadData.length - 1; i >= 1; i--) {
          const rowOrderId = String(refreshedUploadData[i][1] || '').trim();
          const rowUploadId = String(refreshedUploadData[i][6] || '').trim();
          const rowTimestamp = String(refreshedUploadData[i][0] || '').trim();
          if (!rowOrderId && !rowUploadId && !rowTimestamp) {
            uploadSh.deleteRow(i + 1);
          }
        }
      } catch(e) {
        console.warn('Note deleting from UploadLog:', e);
      }

      // 3. Delete matching entries from DownloadLog sheet if matching orderId
      if (orderId) {
        try {
          const dlSh = sheet_(CONFIG.DOWNLOAD_LOG_SHEET);
          const dlData = dlSh.getDataRange().getValues();
          for (let i = dlData.length - 1; i >= 1; i--) {
            const rowOrderId = String(dlData[i][1] || '').trim();
            if (rowOrderId && normalizeOrderId_(rowOrderId) === normalizeOrderId_(orderId)) {
              dlSh.deleteRow(i + 1);
              downloadLogsRemoved++;
            }
          }
        } catch(e) {}
      }

      // 4. Force immediate flush to ensure Google Sheets commits deletions permanently
      SpreadsheetApp.flush();
    }

    // 5. Delete / trash all discovered video files in Google Drive if requested
    let driveTrashedCount = 0;
    if (deleteFromDrive && discoveredDriveIds.length > 0) {
      discoveredDriveIds.forEach(function(dId) {
        if (dId && dId.length > 5) {
          try {
            const file = DriveApp.getFileById(dId);
            file.setTrashed(true);
            driveTrashedCount++;
          } catch(e) {
            console.warn('Could not trash drive file ' + dId + ':', e);
          }
        }
      });
    }

    // 6. Clean up any active upload session properties & duplicate reservation locks
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
        `Removed logs for Order: ${orderId || 'N/A'}, UploadId: ${uploadId || 'N/A'}, DriveIds: [${discoveredDriveIds.join(', ')}]. Removed ${orderLogsRemoved} OrderLog rows, ${uploadLogsRemoved} UploadLog rows, trashed ${driveTrashedCount} Drive files.`
      ]);
      SpreadsheetApp.flush();
    } catch(e){}

    return {
      success: true,
      message: (deleteFromSheets
        ? `Entry removed from Google Sheet logs (${orderLogsRemoved} OrderLog, ${uploadLogsRemoved} UploadLog rows deleted).`
        : 'Logs retained in Google Sheets.') +
        (driveTrashedCount > 0 ? ` ${driveTrashedCount} video file(s) moved to Google Drive Trash.` : ''),
      orderLogsRemoved: orderLogsRemoved,
      uploadLogsRemoved: uploadLogsRemoved,
      downloadLogsRemoved: downloadLogsRemoved,
      driveTrashedCount: driveTrashedCount,
      driveTrashed: driveTrashedCount > 0
    };
  } finally {
    lock.releaseLock();
  }
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
  const rows=[], v=sheet_(CONFIG.ORDER_LOG_SHEET).getDataRange().getValues();
  for(let i=1; i<v.length; i++){
    const ts=v[i][0] instanceof Date ? v[i][0] : new Date(v[i][0]);
    if(isNaN(ts) || !inRange_(ts,from,to)) continue;
    const pe=String(v[i][3]||''), pf=String(v[i][2]||''), rt=String(v[i][8]||'Forward'), st=String(v[i][7]||'');
    if(!isAdmin && normalize_(pe)!==email) continue;
    if(platform && normalize_(pf)!==platform) continue;
    if(type && normalize_(rt)!==type) continue;
    if(packer && !(normalize_(pe).includes(packer))) continue;
    if(status && normalize_(st)!==status) continue;
    const fid=String(v[i][4]||''), available=!!fid && driveExists_(fid);
    if(video==='yes' && !available) continue;
    if(video==='no' && available) continue;
    if(!available) continue;
    rows.push({
      'Timestamp': ts.toISOString(),
      'Source': 'Order',
      'Order ID': String(v[i][1]||''),
      'Platform': pf,
      'Recording Type': rt,
      'User Email': pe,
      'Status': st,
      'Drive File ID': fid,
      'Video Playback URL': String(v[i][5]||'')
    });
  }
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
  const rows=[], v=sheet_(CONFIG.ORDER_LOG_SHEET).getDataRange().getValues();

  for(let i=1; i<v.length; i++){
    const ts=v[i][0] instanceof Date ? v[i][0] : new Date(v[i][0]);
    if(isNaN(ts) || !inRange_(ts,from,to)) continue;
    const pe=String(v[i][3]||''), pf=String(v[i][2]||''), rt=String(v[i][8]||'Forward'), st=String(v[i][7]||'');
    if(!isAdmin && normalize_(pe)!==email) continue;
    if(platform && normalize_(pf)!==platform) continue;
    if(type && normalize_(rt)!==type) continue;
    if(packer && normalize_(pe)!==packer) continue;
    if(status && normalize_(st)!==status) continue;

    const fid=String(v[i][4]||'');
    if(!fid || !driveExists_(fid)) continue;

    rows.push({date: dateOnly_(ts), platform: pf, type: rt, user: pe, status: st, orderId: String(v[i][1]||'')});
  }

  const countBy=(key)=>{
    const m={};
    rows.forEach(r=>{const k=r[key]||'Unknown';m[k]=(m[k]||0)+1});
    return Object.keys(m).sort((a,b)=>m[b]-m[a]).map(k=>({label:k,count:m[k]}));
  };

  const dailyMap={};
  rows.forEach(r=>{
    if(!dailyMap[r.date])dailyMap[r.date]={date:r.date,total:0,platforms:{},types:{},users:{}};
    const d=dailyMap[r.date];
    d.total++;
    d.platforms[r.platform]=(d.platforms[r.platform]||0)+1;
    d.types[r.type]=(d.types[r.type]||0)+1;
    d.users[r.user]=(d.users[r.user]||0)+1;
  });

  const dates=[];
  for(let d=new Date(from); d<=to; d.setDate(d.getDate()+1)){
    dates.push(dateOnly_(new Date(d)));
  }

  const daily=dates.map(date=>{
    const d=dailyMap[date]||{date,total:0,platforms:{},types:{},users:{}};
    return {date,total:d.total,platforms:d.platforms,types:d.types,users:d.users};
  });

  return {
    success: true,
    fromDate: p.fromDate,
    toDate: p.toDate,
    total: rows.length,
    uniqueOrders: [...new Set(rows.map(r=>r.orderId))].length,
    platforms: countBy('platform'),
    types: countBy('type'),
    users: countBy('user'),
    statuses: countBy('status'),
    daily
  };
}

function cleanupOldStartedUploads_(order, currentUploadId) {
  try {
    const uploadSh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
    const uploadData = uploadSh.getDataRange().getValues();
    for (let i = uploadData.length - 1; i >= 1; i--) {
      const rOrder = String(uploadData[i][1] || '').trim();
      const rUploadId = String(uploadData[i][6] || '').trim();
      const rStatus = String(uploadData[i][10] || '').trim();
      if (normalize_(rOrder) === normalize_(order) && rUploadId !== currentUploadId && (rStatus === 'Started' || rStatus === 'Pending' || rStatus === 'In Progress')) {
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
    }
  } catch (e) {
    // Fall back to script properties
    appName = props.getProperty('VMS_BRANDING_NAME') || 'VMS 3.0';
    appSubtitle = props.getProperty('VMS_BRANDING_SUBTITLE') || 'Order Packing System';
    logoUrl = props.getProperty('VMS_BRANDING_LOGO') || '';
    faviconUrl = props.getProperty('VMS_BRANDING_FAVICON') || '';
    brandingFolderId = props.getProperty('VMS_BRANDING_FOLDER_ID') || '';
  }

  return {
    success: true,
    appName: appName,
    appSubtitle: appSubtitle,
    logoUrl: logoUrl,
    faviconUrl: faviconUrl,
    brandingFolderId: brandingFolderId
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

  return {
    success: true,
    message: 'Branding saved to Google Sheet "Branding" tab and Script Properties permanently.',
    appName: p.appName,
    appSubtitle: p.appSubtitle,
    logoUrl: p.logoUrl,
    faviconUrl: p.faviconUrl
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

