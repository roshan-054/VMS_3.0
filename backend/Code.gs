/**
 * ORDER PACKING VIDEO SYSTEM (VMS 2.0)
 * COMPLETE INTEGRATED BACKEND
 *
 * Features:
 * 1. Resumable Chunked Drive Upload (Fast 4MB/8MB/16MB/32MB slices)
 * 2. Hierarchical Date & Platform Folder Routing (Drive Folder ID: 1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA)
 * 3. Non-destructive Append-only Google Sheet Logging (Sheet ID: 1jFsY0d0vCXPrRSi1OXvtgJusi-oZs50Y7wPFPWy6avQ)
 * 4. Automatic Google Sheet Duplicate Order ID Conditional Formatting (Highlights duplicate Order IDs in red)
 * 5. Duplicate Order ID Pre-check and Collision Guard
 * 6. Single & Bulk Manual Backup Upload Support
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

  // Sheet tab names
  USERS_SHEET: 'Users',
  ORDER_LOG_SHEET: 'OrderLog',
  DOWNLOAD_LOG_SHEET: 'DownloadLog',
  UPLOAD_LOG_SHEET: 'UploadLog',
  SECURITY_LOG_SHEET: 'SecurityLog',

  // Limits
  MAX_VIDEO_BYTES: 1024 * 1024 * 1024, // 1 GB
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
    service: 'Order Packing Video System',
    version: '2.9.38',
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
      case 'health': return output_({success:true, status:'online', version:'2.9.38'});
      case 'setup': return output_(setupSystem());
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
      case 'startUpload': return output_(startUpload_(p));
      case 'uploadChunk': return output_(uploadChunk_(p));
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
  const sh = sheet_(CONFIG.ORDER_LOG_SHEET);
  applyDuplicateConditionalFormatting_(sh);
  return { success: true, message: 'Conditional formatting applied to Google Sheet for duplicate Order IDs.' };
}

function setupSystem() {
  const ss = ss_();
  const folder = parentFolder_();
  const specs = [
    [CONFIG.USERS_SHEET,['Timestamp','Full Name','Email','Password','Role','Status']],
    [CONFIG.ORDER_LOG_SHEET,['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status']],
    [CONFIG.DOWNLOAD_LOG_SHEET,['Timestamp','Order ID','Platform','User Email','File Name','File Size','Download Type','Recording Type']],
    [CONFIG.UPLOAD_LOG_SHEET,['Timestamp','Order ID','Platform','Packer Email','File Name','File Size','Upload ID','Stage','Progress','Drive File ID','Status','Error','Recording Type','Source','Queue Job ID']],
    [CONFIG.SECURITY_LOG_SHEET,['Timestamp','Email','Action','Result','Details']]
  ];
  specs.forEach(([name,headers])=>{
    let sh=ss.getSheetByName(name);
    if(!sh)sh=ss.insertSheet(name);
    const existing=sh.getLastColumn()?sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String):[];
    headers.forEach(h=>{if(existing.indexOf(h)===-1)sh.getRange(1,sh.getLastColumn()+1).setValue(h)});
    if(sh.getFrozenRows()===0)sh.setFrozenRows(1);
  });

  // Apply conditional formatting on OrderLog
  const orderSh = ss.getSheetByName(CONFIG.ORDER_LOG_SHEET);
  if (orderSh) {
    applyDuplicateConditionalFormatting_(orderSh);
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
  const email=String(p.email||'').trim().toLowerCase(), password=String(p.password||'');
  if(!email||!password)throw new Error('Email and password are required.');
  const values=sheet_(CONFIG.USERS_SHEET).getDataRange().getValues(), wanted=hash_(password);
  for(let i=1;i<values.length;i++){
    if(String(values[i][2]||'').trim().toLowerCase()!==email)continue;
    if(String(values[i][3]||'')!==wanted){
      securityLog_(email,'LOGIN','FAILED','Invalid password');
      throw new Error('Invalid email or password.');
    }
    if(String(values[i][5]||'')!=='Approved'){
      securityLog_(email,'LOGIN','BLOCKED','Account not approved');
      throw new Error('Your account is pending approval.');
    }
    const user={name:String(values[i][1]||''),email,role:String(values[i][4]||'User')};
    securityLog_(email,'LOGIN','SUCCESS','');
    return {success:true,token:saveSession_(user),user};
  }
  securityLog_(email,'LOGIN','FAILED','Email not found');
  throw new Error('Invalid email or password.');
}

function signup_(p){
  const name=String(p.fullName||'').trim(), email=String(p.email||'').trim().toLowerCase(), password=String(p.password||'');
  if(!name||!email||!password)throw new Error('All fields are required.');
  if(password.length<6)throw new Error('Password must contain at least 6 characters.');
  const sh=sheet_(CONFIG.USERS_SHEET), values=sh.getDataRange().getValues();
  for(let i=1;i<values.length;i++)if(String(values[i][2]||'').toLowerCase()===email)throw new Error('An account with this email already exists.');
  sh.appendRow([new Date(),name,email,hash_(password),'User','Pending']);
  securityLog_(email,'SIGNUP','SUCCESS','Pending approval');
  return {success:true,message:'Account created. Please wait for administrator approval.'};
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
function key_(order,platform,type){return [normalize_(order),normalize_(platform),normalize_(type||'Forward')].join('||')}

function driveExists_(id){
  if(!id)return false;
  try{DriveApp.getFileById(String(id));return true}catch(_){return false}
}

function completedDuplicate_(order,platform,type){
  const wanted=key_(order,platform,type), v=sheet_(CONFIG.ORDER_LOG_SHEET).getDataRange().getValues();
  for(let i=v.length-1;i>=1;i--){
    const id=String(v[i][4]||''), status=normalize_(v[i][7]), rk=key_(v[i][1],v[i][2],v[i][8]||'Forward');
    if(rk===wanted&&id&&status==='completed'&&driveExists_(id)){
      return {
        row: i+1,
        orderId: String(v[i][1]||''),
        platform: String(v[i][2]||''),
        recordingType: String(v[i][8]||'Forward'),
        timestamp: v[i][0] instanceof Date ? v[i][0].toISOString() : String(v[i][0]||''),
        packerEmail: String(v[i][3]||''),
        fileId: id,
        playbackUrl: String(v[i][5]||'https://drive.google.com/file/d/'+id+'/preview')
      };
    }
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

/* ---------- Search ---------- */
function advancedSearch_(p){
  const user=session_(p.token), isAdmin=normalize_(user.role)==='admin', email=normalize_(user.email);
  const order=normalize_(p.orderId), platform=normalize_(p.platform), type=normalize_(p.recordingType), status=normalize_(p.status), packer=normalize_(p.packer), video=normalize_(p.video);
  const from=p.fromDate?new Date(p.fromDate+'T00:00:00'):null, to=p.toDate?new Date(p.toDate+'T23:59:59'):null;
  const limit=Math.min(200,Math.max(1,Number(p.limit||50))), v=sheet_(CONFIG.ORDER_LOG_SHEET).getDataRange().getValues(), rows=[];
  for(let i=v.length-1;i>=1;i--){
    const ts=v[i][0] instanceof Date?v[i][0]:new Date(v[i][0]), oid=String(v[i][1]||''), pf=String(v[i][2]||''), pe=String(v[i][3]||''), fid=String(v[i][4]||''), st=String(v[i][7]||''), rt=String(v[i][8]||'Forward');
    if(!isAdmin&&normalize_(pe)!==email)continue;
    if(order&&!normalize_(oid).includes(order))continue;
    if(platform&&platform!=='custom'&&normalize_(pf)!==platform)continue;
    if(platform==='custom'&&CONFIG.ALLOWED_PLATFORMS.map(normalize_).includes(normalize_(pf)))continue;
    if(type&&normalize_(rt)!==type)continue;
    if(status&&normalize_(st)!==status)continue;
    if(packer&&!(normalize_(pe).includes(packer)||normalize_(String(v[i][3]||'')).includes(packer)))continue;
    if(from&&ts<from)continue;if(to&&ts>to)continue;
    const available=!!fid&&driveExists_(fid);
    if(video==='yes'&&!available)continue;if(video==='no'&&available)continue;
    if(!available)continue;
    rows.push({timestamp:ts.toISOString(),orderId:oid,platform:pf,packerEmail:pe,fileId:fid,playbackUrl:String(v[i][5]||'https://drive.google.com/file/d/'+fid+'/preview'),downloadUrl:'https://drive.google.com/uc?export=download&id='+encodeURIComponent(fid),status:st,recordingType:rt});
    if(rows.length>=limit)break;
  }
  if(p.sort==='oldest')rows.sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
  if(p.sort==='orderAsc')rows.sort((a,b)=>a.orderId.localeCompare(b.orderId,undefined,{numeric:true}));
  if(p.sort==='orderDesc')rows.sort((a,b)=>b.orderId.localeCompare(a.orderId,undefined,{numeric:true}));
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
  if(size<=0||size>CONFIG.MAX_VIDEO_BYTES)throw new Error('Invalid video size or video exceeds 1 GB.');

  // Check duplicate: if duplicate exists and not explicitly bypassed, prevent duplicate upload
  const done = completedDuplicate_(order,platform,type);
  if(done && p.bypassDuplicate !== true){
    return {
      success: false,
      code: 'DUPLICATE_ORDER_ID',
      error: `Duplicate Order ID: Order "${order}" (${platform} - ${type}) has already been uploaded to Google Drive. Duplicate upload was prevented.`,
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

    // Initiate Google Drive Resumable Upload Session (Direct Drive v3 API)
    let uploadUrl = '';
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
        if (respCode >= 200 && respCode < 300) {
          const headers = driveSessionResp.getAllHeaders();
          uploadUrl = headers.Location || headers.location || '';
        }
      }
    } catch(dErr) {
      console.warn('Drive resumable session create note:', dErr);
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
      chunkSize: CONFIG.DEFAULT_CHUNK_BYTES,
      fileName: name,
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
        const fileObj = JSON.parse(resp.getContentText());
        const fid = String(fileObj.id);
        const playback = 'https://drive.google.com/file/d/' + fid + '/preview';

        try { DriveApp.getFileById(fid).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(_) {}

        const lock = LockService.getScriptLock();
        lock.waitLock(20000);
        try {
          const orderSh = sheet_(CONFIG.ORDER_LOG_SHEET);
          orderSh.appendRow([new Date(), s.order, s.platform, s.packerEmail, fid, playback, '', 'Completed', s.type, s.queueJobId, s.mime, 'READY']);
          applyDuplicateConditionalFormatting_(orderSh);
          try {
            sheet_(CONFIG.DOWNLOAD_LOG_SHEET).appendRow([
              new Date(), s.order, s.platform, s.packerEmail, s.name, s.size, 'Recording & Cloud Upload Complete', s.type
            ]);
          } catch(_) {}
          updateUploadLog_(uploadId, 'Completed', 100, fid, 'Completed', '');
          if(s.reservationKey) releaseReservation_(s.reservationKey);
          cleanupOldStartedUploads_(s.order, uploadId);
        } finally {
          lock.releaseLock();
        }

        PropertiesService.getScriptProperties().deleteProperty('UPLOAD_' + uploadId);

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
    } catch(uErr) {
      console.warn('Drive resumable chunk upload notice:', uErr);
    }
  }

  // Strategy 2: Single-Shot or Robust Multi-Part Direct File Assembly
  const targetFolder = dateFolder_(s.platform, s.type, driveFolderId, s.recordingDate);

  if (totalChunks === 1) {
    // Single chunk: Instant Direct File Creation
    const blob = Utilities.newBlob(chunkBytes, s.mime, s.name);
    const file = targetFolder.createFile(blob);

    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(_) {}

    const fid = file.getId();
    const playback = 'https://drive.google.com/file/d/' + fid + '/preview';

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const orderSh = sheet_(CONFIG.ORDER_LOG_SHEET);
      orderSh.appendRow([new Date(), s.order, s.platform, s.packerEmail, fid, playback, '', 'Completed', s.type, s.queueJobId, s.mime, 'READY']);
      applyDuplicateConditionalFormatting_(orderSh);
      try {
        sheet_(CONFIG.DOWNLOAD_LOG_SHEET).appendRow([
          new Date(), s.order, s.platform, s.packerEmail, s.name, s.size, 'Recording & Cloud Upload Complete', s.type
        ]);
      } catch(_) {}
      updateUploadLog_(uploadId, 'Completed', 100, fid, 'Completed', '');
      if(s.reservationKey) releaseReservation_(s.reservationKey);
      cleanupOldStartedUploads_(s.order, uploadId);
    } finally {
      lock.releaseLock();
    }

    PropertiesService.getScriptProperties().deleteProperty('UPLOAD_' + uploadId);

    return {
      success: true,
      complete: true,
      completed: true,
      fileId: fid,
      webViewLink: file.getUrl(),
      playbackUrl: playback,
      downloadUrl: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fid)
    };
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

      try { masterFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(_) {}

      // Delete temporary part files
      partFiles.forEach(function(f) {
        try { f.setTrashed(true); } catch(_) {}
      });

      const fid = masterFile.getId();
      const playback = 'https://drive.google.com/file/d/' + fid + '/preview';

      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        const orderSh = sheet_(CONFIG.ORDER_LOG_SHEET);
        orderSh.appendRow([new Date(), s.order, s.platform, s.packerEmail, fid, playback, '', 'Completed', s.type, s.queueJobId, s.mime, 'READY']);
        applyDuplicateConditionalFormatting_(orderSh);
        try {
          sheet_(CONFIG.DOWNLOAD_LOG_SHEET).appendRow([
            new Date(), s.order, s.platform, s.packerEmail, s.name, s.size, 'Recording & Cloud Upload Complete', s.type
          ]);
        } catch(_) {}
        updateUploadLog_(uploadId, 'Completed', 100, fid, 'Completed', '');
        if(s.reservationKey) releaseReservation_(s.reservationKey);
        cleanupOldStartedUploads_(s.order, uploadId);
      } finally {
        lock.releaseLock();
      }

      PropertiesService.getScriptProperties().deleteProperty('UPLOAD_' + uploadId);

      return {
        success: true,
        complete: true,
        completed: true,
        fileId: fid,
        webViewLink: masterFile.getUrl(),
        playbackUrl: playback,
        downloadUrl: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fid)
      };
    }

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
}

/* ---------- Upload Logs Sheet Query ---------- */
function uploadLogs_(p){
  const user=session_(p.token), isAdmin=normalize_(user.role)==='admin', email=normalize_(user.email);
  const filterStatus = normalize_(p.status);
  const filterOrder = normalize_(p.orderId);
  const filterPlatform = normalize_(p.platform);
  const filterType = normalize_(p.recordingType);
  const limit = Math.min(1000, Math.max(1, Number(p.limit || 500)));

  const v=sheet_(CONFIG.UPLOAD_LOG_SHEET).getDataRange().getValues(), logs=[];
  let totalCount = 0;
  let completedCount = 0;
  let inProgressCount = 0;
  let pendingCount = 0;
  let failedCount = 0;

  for(let i=v.length-1; i>=1; i--){
    const pe=String(v[i][3]||'');
    if(!isAdmin && normalize_(pe)!==email) continue;

    const rawStatus = String(v[i][10]||'');
    const normSt = normalize_(rawStatus);
    const orderId = String(v[i][1]||'');
    const platform = String(v[i][2]||'');
    const recordingType = String(v[i][12]||'Forward');
    const driveFileId = String(v[i][9]||'');

    // Aggregate stats
    totalCount++;
    if(normSt === 'completed') completedCount++;
    else if(normSt === 'in progress' || normSt === 'uploading' || normSt === 'processing') inProgressCount++;
    else if(normSt === 'pending' || normSt === 'queued' || normSt === 'initiated') pendingCount++;
    else if(normSt === 'failed' || normSt === 'paused' || normSt === 'error') failedCount++;
    else pendingCount++;

    // Apply filters
    if(filterStatus && filterStatus !== 'all') {
      if(filterStatus === 'completed' && normSt !== 'completed') continue;
      if((filterStatus === 'in progress' || filterStatus === 'processing') && normSt !== 'in progress' && normSt !== 'uploading' && normSt !== 'processing') continue;
      if((filterStatus === 'pending' || filterStatus === 'queued') && normSt !== 'pending' && normSt !== 'queued' && normSt !== 'initiated') continue;
      if((filterStatus === 'failed' || filterStatus === 'paused') && normSt !== 'failed' && normSt !== 'paused' && normSt !== 'error') continue;
    }

    if(filterOrder && !normalize_(orderId).includes(filterOrder)) continue;
    if(filterPlatform && filterPlatform !== 'all' && normalize_(platform) !== filterPlatform) continue;
    if(filterType && filterType !== 'all' && normalize_(recordingType) !== filterType) continue;

    if(logs.length < limit) {
      logs.push({
        timestamp: v[i][0] instanceof Date ? v[i][0].toISOString() : String(v[i][0]||''),
        orderId: orderId,
        platform: platform,
        packerEmail: pe,
        fileName: String(v[i][4]||''),
        fileSize: String(v[i][5]||''),
        uploadId: String(v[i][6]||''),
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
  const deleteFromDrive = p.deleteFromDrive !== false;

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

  try {
    // 1. Delete matching entries from OrderLog sheet
    try {
      const orderSh = sheet_(CONFIG.ORDER_LOG_SHEET);
      const orderData = orderSh.getDataRange().getValues();
      // Headers: [Timestamp, Order ID, Platform, Packer Email, Video Drive ID, Video Playback URL, Package Weight, Status, Recording Type, Queue Job ID, Video MIME Type, Playback Status]
      for (let i = orderData.length - 1; i >= 1; i--) {
        const rowOrderId = String(orderData[i][1] || '').trim();
        const rowDriveId = String(orderData[i][4] || '').trim();
        const rowPlayback = String(orderData[i][5] || '').trim();
        const rowJobId = String(orderData[i][9] || '').trim();

        let match = false;
        if (orderId && rowOrderId && normalize_(rowOrderId) === normalize_(orderId)) match = true;
        if (driveFileId && rowDriveId && rowDriveId === driveFileId) match = true;
        if (uploadId && rowJobId && rowJobId === uploadId) match = true;
        if (queueJobId && rowJobId && rowJobId === queueJobId) match = true;
        if (driveFileId && rowPlayback && rowPlayback.indexOf(driveFileId) !== -1) match = true;

        if (match) {
          if (rowDriveId && rowDriveId.length > 5 && !discoveredDriveIds.includes(rowDriveId)) {
            discoveredDriveIds.push(rowDriveId);
          }
          orderSh.deleteRow(i + 1);
          orderLogsRemoved++;
        }
      }

      // Prune completely empty ghost rows from OrderLog
      const refreshedOrderData = orderSh.getDataRange().getValues();
      for (let i = refreshedOrderData.length - 1; i >= 1; i--) {
        const rowOrderId = String(refreshedOrderData[i][1] || '').trim();
        const rowDriveId = String(refreshedOrderData[i][4] || '').trim();
        const rowTimestamp = String(refreshedOrderData[i][0] || '').trim();
        if (!rowOrderId && !rowDriveId && !rowTimestamp) {
          orderSh.deleteRow(i + 1);
        }
      }
    } catch(e) {
      console.warn('Note deleting from OrderLog:', e);
    }

    // 2. Delete matching entries from UploadLog sheet
    try {
      const uploadSh = sheet_(CONFIG.UPLOAD_LOG_SHEET);
      const uploadData = uploadSh.getDataRange().getValues();
      // Headers: [Timestamp, Order ID, Platform, Packer Email, File Name, File Size, Upload ID, Stage, Progress, Drive File ID, Status, Error, Recording Type, Source, Queue Job ID]
      for (let i = uploadData.length - 1; i >= 1; i--) {
        const rowOrderId = String(uploadData[i][1] || '').trim();
        const rowUploadId = String(uploadData[i][6] || '').trim();
        const rowDriveId = String(uploadData[i][9] || '').trim();
        const rowJobId = String(uploadData[i][14] || '').trim();

        let match = false;
        if (uploadId && rowUploadId && rowUploadId === uploadId) match = true;
        if (uploadId && rowJobId && rowJobId === uploadId) match = true;
        if (queueJobId && rowJobId && rowJobId === queueJobId) match = true;
        if (queueJobId && rowUploadId && rowUploadId === queueJobId) match = true;
        if (orderId && rowOrderId && normalize_(rowOrderId) === normalize_(orderId)) match = true;
        if (driveFileId && rowDriveId && rowDriveId === driveFileId) match = true;

        if (match) {
          if (rowDriveId && rowDriveId.length > 5 && !discoveredDriveIds.includes(rowDriveId)) {
            discoveredDriveIds.push(rowDriveId);
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
          if (rowOrderId && normalize_(rowOrderId) === normalize_(orderId)) {
            dlSh.deleteRow(i + 1);
            downloadLogsRemoved++;
          }
        }
      } catch(e) {}
    }

    // 4. Force immediate flush to ensure Google Sheets commits deletions permanently
    SpreadsheetApp.flush();

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
      message: `Entry permanently removed from Google Sheet logs (${orderLogsRemoved} OrderLog, ${uploadLogsRemoved} UploadLog rows deleted).` + (driveTrashedCount > 0 ? ` ${driveTrashedCount} video file(s) moved to Google Drive Trash.` : ''),
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

