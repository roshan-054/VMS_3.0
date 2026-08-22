
/* Order Packing Video System v2.9.36 — clean GitHub Pages frontend */
(() => {
"use strict";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let token = localStorage.getItem(APP_CONFIG.sessionStorageKey) || "";
let currentUser = null;
let stream = null, recorder = null, chunks = [], timerId = null, recSeconds = 0, activeRecordMeta = null;
let playbackRecord = null;
const DB_NAME = "OrderPackingVideoSystemCleanDB";
const DB_VERSION = 1;
const STORE = "queue";

function toast(message,type="info"){
  const e=document.createElement("div");
  e.className="toast "+type;
  e.textContent=message;
  $("#toast").appendChild(e);
  setTimeout(()=>e.remove(),4200);
}
window.toast=toast;
function msg(sel,text,type=""){const e=$(sel);if(e){e.textContent=text;e.className="msg "+type}}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function safe(v){return String(v||"").replace(/[^a-zA-Z0-9._-]/g,"_")||"video"}
function platformValue(){return $("#platform").value==="Custom"?$("#customPlatform").value.trim():$("#platform").value}
function manualPlatform(){return $("#manualPlatform").value==="Custom"?$("#manualCustomPlatform").value.trim():$("#manualPlatform").value}
function typeValue(){return $("#recordingType").value}
function api(action,payload={}){
  return fetch(APP_CONFIG.apiUrl,{
    method:"POST",
    redirect:"follow",
    credentials:"omit",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({action,...payload})
  }).then(async r=>{
    const t=await r.text(); let d;
    try{d=JSON.parse(t)}catch{throw Error("Invalid Apps Script response. Check the Web App deployment URL and access setting.")}
    if(!d.success) throw Error(d.error||"Request failed.");
    return d;
  });
}
window.api=api;

async function health(){
  try{
    const r=await fetch(APP_CONFIG.apiUrl,{redirect:"follow",cache:"no-store",credentials:"omit"});
    const d=JSON.parse(await r.text());
    $("#backendStatus").textContent=d.success?"Backend status: online":"Backend status: unavailable";
    $("#backendStatus").style.color=d.success?"#15803d":"#b91c1c";
  }catch(e){
    $("#backendStatus").textContent="Backend status: unavailable";
    $("#backendStatus").style.color="#b91c1c";
  }
}

function show(view){
  ["loginView","signupView","setupView","appView"].forEach(id=>$("#"+id)?.classList.add("hidden"));
  $("#"+view)?.classList.remove("hidden");
}
function isAdmin(){return String(currentUser?.role||"").toLowerCase()==="admin"}
function activateTab(name){
  if((name==="reports" || name==="analytics" || name==="search") && !isAdmin()) name="record";
  $$(".nav[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  $$(".tab").forEach(t=>t.classList.toggle("hidden",t.id!==name+"Tab"));
  const titles={
    record:["Scan & Record","Record a packing process and store it in Google Drive."],
    search:["Search Orders","Find and play completed packing videos."],
    logs:["Upload Logs","Review upload sessions, progress and errors."],
    reports:["Reports","Download consolidated order/video activity reports."],
    queue:["Upload Queue","Automatic uploads continue while the page remains open."],
    analytics:["Analytics","Analyze recordings by platform, user and type."],
    health:["System Health","Check the services required by the system."],
    admin:["Admin Panel","Manage user accounts."]
  };
  if(titles[name]){$("#pageTitle").textContent=titles[name][0];$("#pageSubtitle").textContent=titles[name][1]}
  if(name==="logs")loadLogs();
  if(name==="queue")loadQueue();
  if(name==="reports")initReportDates();
  if(name==="analytics")loadAnalytics();
  if(name==="health")loadHealth();
  if(name==="admin")loadUsers();
}
function renderApp(){
  show("appView");
  $("#roleLabel").textContent=`${currentUser.name||""} • ${currentUser.role||"User"}`;
  $("#userLabel").textContent=currentUser.email||"";
  $$(".admin-only").forEach(e=>e.classList.toggle("hidden",!isAdmin()));
  activateTab("record");
}
function setupApiUrl(){return (localStorage.getItem("ops_api_url")||APP_CONFIG.apiUrl||"").trim()}
function validApiUrl(v){return /^https:\/\/script\.google\.com\/macros\/s\/[^\s]+\/exec(?:\?.*)?$/.test(v)}
async function testAndSaveSetup(){
  const input=$("#setupApiUrl"),btn=$("#testSetup");
  const url=input.value.trim();
  if(!validApiUrl(url)){msg("#setupMsg","Enter a valid Google Apps Script /exec Web App URL.","error");return}
  btn.disabled=true;btn.textContent="Testing connection…";msg("#setupMsg","Connecting…");
  try{
    const r=await fetch(url,{redirect:"follow",cache:"no-store",credentials:"omit"});
    const text=await r.text(); let d; try{d=JSON.parse(text)}catch{throw Error("The Web App did not return valid JSON. Check that you deployed the /exec Web App URL.")}
    if(!d.success||d.status!=="online")throw Error("Apps Script is reachable but did not report an online status.");
    localStorage.setItem("ops_api_url",url); APP_CONFIG.apiUrl=url;
    msg("#setupMsg", `Connected successfully. Backend ${d.version?"v"+d.version:""} is online.`, "success");
    $("#backendStatus").textContent="Backend status: online"; $("#backendStatus").style.color="#15803d";
  }catch(e){msg("#setupMsg",e.message||"Unable to connect to Apps Script.","error")}
  finally{btn.disabled=false;btn.textContent="🔗 Test & Save Connection"}
}

async function login(email,password){
  const d=await api("login",{email,password});
  token=d.token; currentUser=d.user;
  localStorage.setItem(APP_CONFIG.sessionStorageKey,token);
  window.currentUser=currentUser;
  renderApp();
}
async function restore(){
  if(!token)return;
  try{const d=await api("validateSession",{token});currentUser=d.user;window.currentUser=currentUser;renderApp();processQueue()}catch{token="";localStorage.removeItem(APP_CONFIG.sessionStorageKey)}
}
async function logout(){
  try{await api("logout",{token})}catch(_){}
  token="";currentUser=null;localStorage.removeItem(APP_CONFIG.sessionStorageKey);location.reload();
}

/* IndexedDB queue */
function db(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE)){const s=d.createObjectStore(STORE,{keyPath:"id"});s.createIndex("status","status");s.createIndex("createdAt","createdAt")}};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
async function queuePut(item){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(STORE,"readwrite").objectStore(STORE).put(item);r.onsuccess=()=>res(item);r.onerror=()=>rej(r.error)})}
async function queueGetAll(){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(STORE,"readonly").objectStore(STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
async function queueGet(id){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(STORE,"readonly").objectStore(STORE).get(id);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)})}
async function queueDelete(id){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(STORE,"readwrite").objectStore(STORE).delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}

function bytesBase64(bytes){
  let out="",step=0x8000;
  for(let i=0;i<bytes.length;i+=step)out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+step,bytes.length)));
  return btoa(out);
}
function chooseMime(){
  const types=["video/mp4;codecs=avc1.42E01E,mp4a.40.2","video/mp4","video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"];
  return types.find(t=>{try{return MediaRecorder.isTypeSupported(t)}catch{return false}})||"video/webm";
}
function extFor(mime){return String(mime).includes("mp4")?".mp4":".webm"}
function fileName(order,platform,type,mime){return `${safe(order)}_${safe(platform)}_${safe(type)}${extFor(mime)}`}

async function downloadBlob(blob,name,meta){
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  try{await api("downloadLog",{token,orderId:meta.orderId,platform:meta.platform,recordingType:meta.recordingType,fileName:name,fileSize:`${(blob.size/1048576).toFixed(2)} MB`,downloadType:"Automatic Recording"})}catch(e){console.warn("Download log:",e)}
}

async function duplicateCheck(meta){
  if(!token) return null;
  try{
    const d=await api("advancedSearch",{token,orderId:meta.orderId,platform:meta.platform,recordingType:meta.recordingType,limit:10});
    return Array.isArray(d.results)&&d.results.length?d.results[0]:null;
  }catch(err){
    console.warn("Duplicate check non-blocking warning:", err);
    if(String(err.message).toLowerCase().includes("authentication") || String(err.message).toLowerCase().includes("session")){
      toast("Session verification notice: recording will save locally to queue.","info");
    }
    return null;
  }
}

async function openCamera(){
  const orderId=$("#orderId").value.trim(),platform=platformValue(),type=typeValue();
  if(!orderId)return msg("#recordMsg","Enter Order ID first.","error");
  if(!platform)return msg("#recordMsg","Select or enter a platform.","error");
  
  msg("#recordMsg","","");
  activeRecordMeta={orderId,platform,recordingType:type};
  $("#cameraOrderInfo").textContent=`Order: ${orderId} • ${platform} • ${type}`;
  $("#cameraModal").classList.remove("hidden");
  
  // Non-blocking duplicate check in background
  duplicateCheck({orderId,platform,recordingType:type}).then(existing=>{
    if(existing){
      toast(`Notice: A video for ${orderId} (${platform} / ${type}) is already recorded in Google Drive.`,"info");
    }
  }).catch(()=>{});

  await enableCamera();
}

async function enableCamera(){
  msg("#cameraStatus","Accessing camera…","");
  try{
    if(stream)stream.getTracks().forEach(t=>t.stop());
    
    // First attempt: High resolution video + audio
    try {
      stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:"environment"},width:{ideal:1920,max:1920},height:{ideal:1080,max:1080},frameRate:{ideal:30,max:30}},
        audio:true
      });
    } catch(errAudio) {
      console.warn("Camera with audio failed, retrying video-only fallback:", errAudio);
      // Fallback: Video only
      stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}
      });
    }

    const videoEl=$("#cameraPreview");
    videoEl.srcObject=stream;
    videoEl.muted=true;
    await videoEl.play().catch(e=>console.warn("Video play notice:", e));
    
    $("#startRecord").disabled=false;
    try{
      const track=stream.getVideoTracks()[0],caps=track.getCapabilities?.()||{};
      if(caps.focusMode?.includes("continuous")){
        await track.applyConstraints({advanced:[{focusMode:"continuous"}]});
        $("#focusBadge")?.classList.remove("hidden");
      }
    }catch(_){}
    msg("#cameraStatus","Camera ready. Click Start Recording.","success");
  }catch(e){
    console.error("Camera access error:", e);
    msg("#cameraStatus","Camera access failed: "+e.message,"error");
    toast("Camera access error: "+e.message,"error");
  }
}
function startRecording(){
  if(!stream)return;
  chunks=[];
  const mime=chooseMime();
  try{recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8000000,audioBitsPerSecond:128000})}catch{recorder=new MediaRecorder(stream)}
  recorder.ondataavailable=e=>{if(!e.data?.size)return;chunks.push(e.data);const total=chunks.reduce((n,c)=>n+c.size,0);if(recorder&&recorder.state!=="inactive"&&total>=MAX_VIDEO_BYTES-5*1024*1024){msg("#cameraStatus","1 GB safety limit reached. Finalizing recording…","error");stopRecording();}};
  recorder.onstop=finishRecording;
  recorder.start(250);
  recSeconds=0;
  $("#startRecord").disabled=true;$("#stopRecord").disabled=false;
  timerId=setInterval(()=>{recSeconds++;$("#timer").textContent=`${String(Math.floor(recSeconds/60)).padStart(2,"0")}:${String(recSeconds%60).padStart(2,"0")}`},1000);
  msg("#cameraStatus","Recording…","success");
}
async function stopRecording(){
  if(!recorder||recorder.state==="inactive")return;
  $("#stopRecord").disabled=true;
  recorder.stop();
  clearInterval(timerId);
}
async function finishRecording(){
  try{
    const mime=recorder.mimeType||"video/webm",blob=new Blob(chunks,{type:mime});
    if(blob.size>APP_CONFIG.maxVideoBytes)throw Error("Video exceeds the 1 GB limit.");
    $("#sizeMetric").textContent=(blob.size/1048576).toFixed(2)+" MB";
    const meta={...activeRecordMeta,mimeType:mime,size:blob.size,fileName:fileName(activeRecordMeta.orderId,activeRecordMeta.platform,activeRecordMeta.recordingType,mime),source:"Automatic Recording"};
    await downloadBlob(blob,meta.fileName,meta);
    const existing=await duplicateCheck(meta);
    if(existing)throw Error(`Duplicate blocked: ${meta.orderId} already has a ${meta.recordingType} video on ${meta.platform}.`);
    const item={id:crypto.randomUUID(),createdAt:Date.now(),...meta,blob,status:"pending",progress:0,error:"",token};
    await queuePut(item);
    msg("#cameraStatus","Recording downloaded and queued for upload.","success");
    $("#uploadMetric").textContent="Queued";
    toast("Recording downloaded and added to upload queue.","success");
    clearOrderForm();
    closeCamera();
    processQueue();
  }catch(e){msg("#cameraStatus",e.message,"error");toast(e.message,"error")}
}
function clearOrderForm(){
  $("#orderId").value="";$("#recordingType").value="Forward";$("#platform").value="Amazon";$("#customPlatform").value="";$("#customPlatformWrap").classList.add("hidden");
  msg("#recordMsg","Order details cleared. Ready for next order.","success");
}
function closeCamera(){
  clearInterval(timerId);
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
  $("#cameraPreview").srcObject=null;
  $("#cameraModal").classList.add("hidden");
  $("#startRecord").disabled=true;$("#stopRecord").disabled=true;
  $("#timer").textContent="00:00";$("#progressBar").style.width="0%";$("#uploadMetric").textContent="Queued";
}

async function startDriveSession(item){
  const d=await api("startUpload",{token,orderId:item.orderId,platform:item.platform,recordingType:item.recordingType,fileSize:item.size,mimeType:item.mimeType,fileName:item.fileName,source:item.source,queueJobId:item.id});
  item.uploadId=d.uploadId;item.chunkSize=Number(d.chunkSize)||APP_CONFIG.uploadChunkBytes;item.status="uploading";item.stage="Uploading";item.progress=0;await queuePut(item);return item;
}
async function uploadItem(item){
  if(item.size>APP_CONFIG.maxVideoBytes)throw Error("Video exceeds 1 GB.");
  if(!item.uploadId)await startDriveSession(item);
  let offset=Number(item.offset||0),chunkSize=Number(item.chunkSize||APP_CONFIG.uploadChunkBytes);
  while(offset<item.size){
    const end=Math.min(offset+chunkSize,item.size)-1;
    const buf=await item.blob.slice(offset,end+1).arrayBuffer();
    const d=await api("uploadChunk",{token,uploadId:item.uploadId,totalSize:item.size,startByte:offset,endByte:end,base64:bytesBase64(new Uint8Array(buf))});
    offset=end+1;item.offset=offset;item.progress=Math.round(offset/item.size*100);item.status=d.complete?"completed":"uploading";item.stage=d.complete?"Completed":"Uploading";await queuePut(item);
    $("#progressBar").style.width=item.progress+"%";$("#uploadMetric").textContent=item.progress+"%";
    if(d.complete){item.driveFileId=d.fileId;item.playbackUrl=d.playbackUrl;break}
  }
  return item;
}
let queueBusy=false;
async function processQueue(){
  if(queueBusy||!token)return;queueBusy=true;
  try{
    const items=(await queueGetAll()).sort((a,b)=>a.createdAt-b.createdAt);
    for(const item of items){
      if(item.status==="completed")continue;
      try{
        item.token=token;await queuePut(item);
        await uploadItem(item);
        toast(`Upload completed: ${item.orderId}`,"success");
      }catch(e){
        item.status="failed";item.error=e.message;await queuePut(item);toast(`Upload failed: ${item.orderId}: ${e.message}`,"error");
      }
    }
  }finally{queueBusy=false;loadQueue()}
}
async function loadQueue(){
  const box=$("#queueList"),items=(await queueGetAll()).sort((a,b)=>b.createdAt-a.createdAt);
  const pending=items.filter(x=>["pending","uploading"].includes(x.status)).length,failed=items.filter(x=>x.status==="failed").length,done=items.filter(x=>x.status==="completed").length;
  $("#queueSummary").textContent=`Pending/Uploading: ${pending} • Failed: ${failed} • Completed: ${done}`;
  if(!items.length){box.innerHTML='<div class="empty">No local upload queue items.</div>';return}
  box.innerHTML=`<table class="table"><thead><tr><th>Time</th><th>Order</th><th>Platform</th><th>Type</th><th>File</th><th>Size</th><th>Status</th><th>Progress</th><th>Action</th></tr></thead><tbody>${items.map(i=>`<tr><td>${esc(new Date(i.createdAt).toLocaleString())}</td><td>${esc(i.orderId)}</td><td>${esc(i.platform)}</td><td>${esc(i.recordingType)}</td><td>${esc(i.fileName)}</td><td>${(i.size/1048576).toFixed(2)} MB</td><td>${esc(i.status)}${i.error?`<div class="msg error">${esc(i.error)}</div>`:""}</td><td>${i.progress||0}%</td><td>${i.status==="failed"?`<button class="admin-action" data-retry="${i.id}">Retry</button>`:""}${["failed","completed"].includes(i.status)?`<button class="admin-action delete" data-remove="${i.id}">Remove</button>`:""}</td></tr>`).join("")}</tbody></table>`;
  box.querySelectorAll("[data-retry]").forEach(b=>b.onclick=async()=>{const i=await queueGet(b.dataset.retry);i.status="pending";i.error="";i.uploadId="";i.offset=0;i.progress=0;await queuePut(i);processQueue()});
  box.querySelectorAll("[data-remove]").forEach(b=>b.onclick=async()=>{await queueDelete(b.dataset.remove);loadQueue()});
}
async function addManualUpload(){
  const file=$("#manualFile").files[0],orderId=$("#manualOrderId").value.trim(),platform=manualPlatform(),type=$("#manualType").value;
  if(!orderId||!platform||!file)return msg("#manualMsg","Order ID, platform and video file are required.","error");
  if(file.size>APP_CONFIG.maxVideoBytes)return msg("#manualMsg","Video exceeds 1 GB.","error");
  try{
    const existing=await duplicateCheck({orderId,platform,recordingType:type});
    if(existing)return msg("#manualMsg",`Duplicate blocked: ${orderId} / ${platform} / ${type} already exists.`,"error");
    const item={id:crypto.randomUUID(),createdAt:Date.now(),orderId,platform,recordingType:type,mimeType:file.type||"video/webm",size:file.size,fileName:file.name,source:"Manual Upload",blob:file,status:"pending",progress:0,error:"",token};
    await queuePut(item);$("#manualFile").value="";$("#manualOrderId").value="";$("#manualCustomPlatform").value="";toast("Manual video added to queue.","success");msg("#manualMsg","Added to upload queue.","success");processQueue();
  }catch(e){msg("#manualMsg",e.message,"error")}
}
function parseCsv(text){
  const lines=text.split(/\r?\n/).filter(x=>x.trim());if(!lines.length)return [];
  const headers=lines.shift().split(",").map(x=>x.trim().toLowerCase());
  return lines.map(line=>{const vals=line.split(",");const o={};headers.forEach((h,i)=>o[h]=(vals[i]||"").trim());return o});
}
async function previewBulk(){
  const csv=$("#bulkCsv").files[0],files=[...$("#bulkFiles").files];if(!files.length)return msg("#bulkPreview","Select video files.","error");
  let rows=[];
  if(csv)rows=parseCsv(await csv.text());
  const map=new Map(rows.map(r=>[r.filename,r]));
  const mapped=files.map(f=>{const r=map.get(f.name);if(r)return {...r,file:f};const parts=f.name.replace(/\.(mp4|webm|mov)$/i,"").split("__");return {file:f,filename:f.name,orderid:parts[0]||"",platform:parts[1]||"",recordingtype:parts[2]||"Forward"}});
  $("#bulkPreview").innerHTML=`${mapped.length} file(s) mapped. <br>${mapped.map(x=>`${esc(x.file.name)} → ${esc(x.orderid)} / ${esc(x.platform)} / ${esc(x.recordingtype)}`).join("<br>")}`;
  window.__bulkMapped=mapped;
}
async function addBulkUpload(){
  if(!window.__bulkMapped)await previewBulk();
  const mapped=window.__bulkMapped||[];if(!mapped.length)return;
  let added=0,blocked=0;
  for(const x of mapped){
    const orderId=String(x.orderid||x.orderId||"").trim(),platform=String(x.platform||"").trim(),type=String(x.recordingtype||x.recordingType||"Forward").trim(),file=x.file;
    if(!orderId||!platform||!file||file.size>APP_CONFIG.maxVideoBytes)continue;
    try{
      const existing=await duplicateCheck({orderId,platform,recordingType:type});
      if(existing){blocked++;continue}
      await queuePut({id:crypto.randomUUID(),createdAt:Date.now(),orderId,platform,recordingType:type,mimeType:file.type||"video/webm",size:file.size,fileName:file.name,source:"Bulk Upload",blob:file,status:"pending",progress:0,error:"",token});added++;
    }catch(_){}
  }
  msg("#bulkMsg",`Added ${added} video(s). ${blocked} duplicate(s) blocked.`,"success");processQueue();
}
function downloadBulkTemplate(){
  const csv="fileName,orderId,platform,recordingType\n123456__Amazon__Forward.webm,123456,Amazon,Forward\n123457__D2C__Return.mp4,123457,D2C,Return\n";
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="bulk_upload_template.csv";a.click();
}

/* Search */
function searchPayload(){
  return {token,orderId:$("#fOrderId").value.trim(),platform:$("#fPlatform").value,recordingType:$("#fType").value,status:$("#fStatus").value,packer:$("#fPacker").value.trim(),video:$("#fVideo").value,fromDate:$("#fFrom").value,toDate:$("#fTo").value,sort:$("#fSort").value,limit:Number($("#fLimit").value)};
}
async function searchOrders(){
  const p=searchPayload(),has=Object.entries(p).some(([k,v])=>!["token","sort","limit"].includes(k)&&String(v||"")!=="");
  if(!has)return msg("#filterSummary","Enter an Order ID or choose at least one filter.","error");
  if(p.fromDate&&p.toDate&&p.fromDate>p.toDate)return msg("#filterSummary","From Date cannot be after To Date.","error");
  $("#searchResults").innerHTML='<div class="card">Searching…</div>';
  try{
    const d=await api("advancedSearch",p),rows=d.results||[];$("#filterSummary").textContent=`${d.total??rows.length} matching records found`;
    $("#searchResults").innerHTML=rows.length?rows.map((r,i)=>`<div class="card result-card"><div><h3>${esc(r.orderId)}</h3><p class="muted">${esc(r.platform)} • ${esc(r.recordingType)} • ${esc(r.packerEmail)}</p><p class="muted">${esc(new Date(r.timestamp).toLocaleString())} • ${esc(r.status)} • ${r.fileId?"Video Available":"Video Missing"}</p></div><div class="actions">${r.fileId?`<button class="primary" data-play="${i}">▶ Watch Video</button><button class="secondary" data-dl="${i}">⬇ Download Video</button>`:"<span class='badge'>Video unavailable</span>"}</div></div>`).join(""):'<div class="card empty">No matching videos found.</div>';
    rows.forEach((r,i)=>{$(`[data-play="${i}"]`)?.addEventListener("click",()=>openPlayback(r));$(`[data-dl="${i}"]`)?.addEventListener("click",()=>downloadSearch(r))});
  }catch(e){$("#searchResults").innerHTML=`<div class="card error">${esc(e.message)}</div>`}
}
function clearFilters(){$$("[id^=f]").forEach(e=>{if(e.tagName==="SELECT")e.value="";else e.value=""});$("#fSort").value="newest";$("#fLimit").value="50";$("#searchResults").innerHTML="";$("#filterSummary").textContent=""}

/* Playback/download */
function openPlayback(r){playbackRecord=r;$("#playbackTitle").textContent=`Order ${r.orderId}`;$("#playbackMeta").textContent=`${r.platform} • ${r.recordingType} • ${r.packerEmail}`;$("#playbackFrame").src=r.playbackUrl||`https://drive.google.com/file/d/${r.fileId}/preview`;$("#playbackModal").classList.remove("hidden")}
async function downloadSearch(r){
  const url=r.downloadUrl||`https://drive.google.com/uc?export=download&id=${encodeURIComponent(r.fileId)}`,name=`${safe(r.orderId)}_${safe(r.platform)}_${safe(r.recordingType)}.mp4`;
  try{await api("downloadLog",{token,orderId:r.orderId,platform:r.platform,recordingType:r.recordingType,fileName:name,fileSize:"",downloadType:"Search Download"})}catch(_){}
  const a=document.createElement("a");a.href=url;a.download=name;a.target="_blank";document.body.appendChild(a);a.click();a.remove();
}

/* Logs */
async function loadLogs(){
  try{
    const d=await api("uploadLogs",{token});
    $("#uploadLogs").innerHTML=d.logs?.length?`<table class="table"><thead><tr><th>Time</th><th>Order</th><th>Platform</th><th>Type</th><th>Source</th><th>File</th><th>Stage</th><th>Progress</th><th>Status</th><th>Error</th></tr></thead><tbody>${d.logs.map(l=>`<tr><td>${esc(new Date(l.timestamp).toLocaleString())}</td><td>${esc(l.orderId)}</td><td>${esc(l.platform)}</td><td>${esc(l.recordingType)}</td><td>${esc(l.source)}</td><td>${esc(l.fileName)}</td><td>${esc(l.stage)}</td><td>${esc(l.progress)}%</td><td><span class="badge ${String(l.status).toLowerCase()}">${esc(l.status)}</span></td><td>${esc(l.error)}</td></tr>`).join("")}</tbody></table>`:'<div class="empty">No upload logs.</div>';
  }catch(e){$("#uploadLogs").innerHTML=`<div class="error">${esc(e.message)}</div>`}
}

/* Reports */
function localDate(d){return d.toISOString().slice(0,10)}
function initReportDates(){const now=new Date(),back=new Date(now);back.setDate(back.getDate()-89);$("#reportFrom").value ||= localDate(back);$("#reportTo").value ||= localDate(now)}
async function reportData(){
  const from=$("#reportFrom").value,to=$("#reportTo").value;
  if(!from||!to)throw Error("Select both dates.");
  if(from>to)throw Error("From Date cannot be after To Date.");
  return api("getReportData",{
    token,fromDate:from,toDate:to,
    platform:$("#reportPlatform").value,
    recordingType:$("#reportType").value,
    status:$("#reportStatus").value,
    packer:$("#reportPacker").value.trim(),
    video:$("#reportVideo").value
  });
}
function csv(rows){if(!rows.length)return "";const h=Object.keys(rows[0]);return "\uFEFF"+[h.join(","),...rows.map(r=>h.map(k=>`"${String(r[k]??"").replace(/"/g,'""')}"`).join(","))].join("\r\n")}
async function previewReport(){try{const d=await reportData(),rows=d.rows||[];$("#reportMsg").textContent=`${rows.length} records`;$("#reportPreview").innerHTML=rows.length?`<table class="table"><thead><tr>${Object.keys(rows[0]).map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.slice(0,200).map(r=>`<tr>${Object.keys(rows[0]).map(h=>`<td>${esc(r[h])}</td>`).join("")}</tr>`).join("")}</tbody></table>`:'<div class="empty">No data.</div>';$("#reportSummary").innerHTML=`<div class="stats"><div class="stat"><b>${rows.length}</b><span>Records</span></div><div class="stat"><b>${new Set(rows.map(r=>r["Order ID"])).size}</b><span>Orders</span></div></div>`}catch(e){msg("#reportMsg",e.message,"error")}}
async function downloadReport(){try{const d=await reportData(),rows=d.rows||[];if(!rows.length)throw Error("No data for selected range.");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv(rows)],{type:"text/csv;charset=utf-8"}));a.download=`Order_Packing_Report_${$("#reportFrom").value}_${$("#reportTo").value}.csv`;a.click()}catch(e){msg("#reportMsg",e.message,"error")}}

/* Analytics */
function initAnalyticsDates(){
  const now=new Date(),back=new Date(now);
  back.setDate(back.getDate()-29);
  $("#analyticsFrom").value ||= localDate(back);
  $("#analyticsTo").value ||= localDate(now);
}
function analyticsPayload(){
  return {
    token,
    fromDate:$("#analyticsFrom").value,
    toDate:$("#analyticsTo").value,
    platform:$("#analyticsPlatform").value,
    recordingType:$("#analyticsType").value,
    packer:$("#analyticsPacker").value.trim(),
    status:$("#analyticsStatus").value
  };
}
async function loadAnalytics(){
  initAnalyticsDates();
  $("#analyticsRoot").innerHTML='<div class="empty">Loading analytics…</div>';
  try{
    const p=analyticsPayload();
    const d=await api("getAnalyticsData",p);
    renderAnalytics(d);
  }catch(e){
    $("#analyticsRoot").innerHTML=`<div class="error">${esc(e.message)}</div>`;
  }
}
function renderAnalytics(d){
  const topPlatform=d.platforms?.[0]?.label||"—";
  const topType=d.types?.[0]?.label||"—";
  const topUser=d.users?.[0]?.label||"—";
  const avg=d.daily?.length?(d.total/d.daily.length).toFixed(1):"0";
  const platforms=[...new Set((d.daily||[]).flatMap(x=>Object.keys(x.platforms||{})))];
  const maxDaily=Math.max(1,...(d.daily||[]).map(x=>x.total||0));

  const dailyRows=(d.daily||[]).map(x=>{
    const cells=platforms.map(p=>`<td class="analytics-click" data-filter-platform="${escAttr(p)}">${x.platforms?.[p]||0}</td>`).join("");
    return `<tr><td class="analytics-click" data-filter-date="${escAttr(x.date)}">${esc(formatDateShort(x.date))}</td><td><b>${x.total||0}</b></td>${cells}<td>${sumMap(x.types)}</td><td>${sumMap(x.users)}</td></tr>`;
  }).join("");

  const selectedPlatform=analyticsPayload().platform;
  const lineData=(d.daily||[]).map(x=>({date:x.date,value:selectedPlatform?(x.platforms?.[selectedPlatform]||0):(x.total||0)}));

  const platformRows=(d.platforms||[]).map(x=>`<button class="analytics-row interactive-row ${selectedPlatform===x.label?'selected':''}" data-filter-platform="${escAttr(x.label)}"><span>${esc(x.label)}</span><b>${x.count}</b></button>`).join("");
  const typeRows=(d.types||[]).map(x=>`<button class="analytics-row interactive-row" data-filter-type="${escAttr(x.label)}"><span>${esc(x.label)}</span><b>${x.count}</b></button>`).join("");
  const userRows=(d.users||[]).map(x=>`<button class="analytics-row interactive-row" data-filter-packer="${escAttr(x.label)}"><span>${esc(x.label)}</span><b>${x.count}</b></button>`).join("");
  const statusRows=(d.statuses||[]).map(x=>`<button class="analytics-row interactive-row" data-filter-status="${escAttr(x.label)}"><span>${esc(x.label)}</span><b>${x.count}</b></button>`).join("");

  const svg=analyticsLineChart(lineData);
  const activeText=[selectedPlatform,analyticsPayload().recordingType,analyticsPayload().packer,analyticsPayload().status].filter(Boolean).join(" • ")||"All recordings";

  $("#analyticsRoot").innerHTML=`
    <div class="analytics-activebar"><span><b>Live view:</b> ${esc(activeText)}</span><span>${esc(formatDateShort(analyticsPayload().fromDate))} → ${esc(formatDateShort(analyticsPayload().toDate))}</span></div>
    <div class="stats analytics-stats">
      <div class="stat"><b>${d.total||0}</b><span>Total recordings</span></div>
      <div class="stat"><b>${d.uniqueOrders||0}</b><span>Unique orders</span></div>
      <div class="stat"><b>${esc(topPlatform)}</b><span>Top platform</span></div>
      <div class="stat"><b>${esc(topType)}</b><span>Top recording type</span></div>
      <div class="stat"><b>${esc(topUser)}</b><span>Top user</span></div>
      <div class="stat"><b>${avg}</b><span>Average recordings / day</span></div>
    </div>

    <div class="analytics-grid analytics-main-grid">
      <div class="card analytics-chart-card">
        <div class="card-head"><div><h3>Daily Recording Trend</h3><p class="muted">Curved interactive trend. Click any point/date to filter that day.</p></div><span class="chart-badge">${esc(selectedPlatform||"All Platforms")}</span></div>
        <div class="line-chart-wrap">${svg}</div>
        <div class="chart-help">Hover a point for details • Click a point to filter the dashboard • Current filter updates automatically</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Platform Breakdown</h3><span class="muted">Click to filter</span></div>
        <div class="analytics-list">${platformRows||'<div class="empty">No data</div>'}</div>
      </div>
    </div>

    <div class="analytics-grid">
      <div class="card">
        <div class="card-head"><h3>Daily Platform Recording</h3><span class="muted">Click a date</span></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Total</th>${platforms.map(p=>`<th>${esc(p)}</th>`).join("")}<th>Types</th><th>Users</th></tr></thead><tbody>${dailyRows||'<tr><td colspan="10">No data</td></tr>'}</tbody></table></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Interactive Breakdowns</h3><span class="muted">Click any item</span></div>
        <h4>Recording Type</h4><div class="analytics-list">${typeRows||'<div class="empty">No data</div>'}</div>
        <h4 class="analytics-subhead">User / Packer</h4><div class="analytics-list">${userRows||'<div class="empty">No data</div>'}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Status Breakdown</h3><span class="muted">Click to filter</span></div>
      <div class="analytics-list analytics-status-grid">${statusRows||'<div class="empty">No data</div>'}</div>
    </div>`;

  $$("[data-filter-platform]").forEach(el=>el.onclick=()=>{ $("#analyticsPlatform").value=el.dataset.filterPlatform; loadAnalytics(); });
  $$("[data-filter-type]").forEach(el=>el.onclick=()=>{ $("#analyticsType").value=el.dataset.filterType; loadAnalytics(); });
  $$("[data-filter-packer]").forEach(el=>el.onclick=()=>{ $("#analyticsPacker").value=el.dataset.filterPacker; loadAnalytics(); });
  $$("[data-filter-status]").forEach(el=>el.onclick=()=>{ $("#analyticsStatus").value=el.dataset.filterStatus; loadAnalytics(); });
  $$("[data-filter-date]").forEach(el=>el.onclick=()=>{ const day=el.dataset.filterDate; $("#analyticsFrom").value=day; $("#analyticsTo").value=day; loadAnalytics(); });
  $$("[data-chart-date]").forEach(el=>el.onclick=()=>{ const day=el.dataset.chartDate; $("#analyticsFrom").value=day; $("#analyticsTo").value=day; loadAnalytics(); });
}

function escAttr(v){return esc(String(v??"")).replace(/'/g,"&#39;")}
function analyticsLineChart(points){
  if(!points.length) return '<div class="empty">No data for the selected filters.</div>';
  const W=900,H=300,P=42, usableW=W-P*2, usableH=H-P*1.6;
  const max=Math.max(1,...points.map(p=>Number(p.value)||0));
  const min=0;
  const coords=points.map((p,i)=>({x:P+(points.length===1?usableW/2:(i/(points.length-1))*usableW),y:P+usableH-(((Number(p.value)||0)-min)/(max-min||1))*usableH,...p}));
  const path=coords.map((c,i)=>{
    if(i===0)return `M ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
    const prev=coords[i-1],mx=(prev.x+c.x)/2;
    return `C ${mx.toFixed(1)} ${prev.y.toFixed(1)}, ${mx.toFixed(1)} ${c.y.toFixed(1)}, ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
  }).join(' ');
  const area=`${path} L ${coords.at(-1).x.toFixed(1)} ${(H-P).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(H-P).toFixed(1)} Z`;
  const grid=[0,.25,.5,.75,1].map(t=>{const y=P+usableH-t*usableH;const val=Math.round(max*t);return `<line x1="${P}" y1="${y}" x2="${W-P}" y2="${y}" class="chart-grid"/><text x="8" y="${y+4}" class="chart-axis">${val}</text>`}).join('');
  const pointsSvg=coords.map((c,i)=>`<g class="chart-point" tabindex="0" data-chart-date="${escAttr(c.date)}"><circle cx="${c.x}" cy="${c.y}" r="6"></circle><circle cx="${c.x}" cy="${c.y}" r="15" class="chart-hit"></circle><title>${esc(formatDateShort(c.date))}: ${c.value}</title></g>`).join('');
  const labels=coords.filter((_,i)=>points.length<=14 || i%Math.ceil(points.length/12)===0 || i===points.length-1).map(c=>`<text x="${c.x}" y="${H-8}" text-anchor="middle" class="chart-axis">${esc(String(c.date).slice(5))}</text>`).join('');
  return `<svg class="analytics-line-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily recording trend">${grid}<path d="${area}" class="chart-area"></path><path d="${path}" class="chart-line"></path>${pointsSvg}${labels}</svg>`;
}


function applyAnalyticsPreset(preset){
  const now=new Date();
  let from=new Date(now), to=new Date(now);
  if(preset==="yesterday"){from.setDate(from.getDate()-1);to.setDate(to.getDate()-1)}
  else if(preset!=="today"){from.setDate(from.getDate()-Number(preset)+1)}
  $("#analyticsFrom").value=localDate(from);$("#analyticsTo").value=localDate(to);loadAnalytics();
}
function resetAnalyticsFilters(){
  const now=new Date(),from=new Date(now);from.setDate(from.getDate()-29);
  $("#analyticsFrom").value=localDate(from);$("#analyticsTo").value=localDate(now);
  $("#analyticsPlatform").value="";$("#analyticsType").value="";$("#analyticsPacker").value="";$("#analyticsStatus").value="";
  loadAnalytics();
}
function formatDateShort(s){
  const p=String(s||"").split("-");
  return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:s;
}
function sumMap(o){return Object.values(o||{}).reduce((a,b)=>a+Number(b||0),0)}
function analyticsList(items){
  return `<div class="analytics-list">${(items||[]).map(x=>`<div class="analytics-row"><span>${esc(x.label)}</span><b>${x.count}</b></div>`).join("")||'<div class="empty">No data</div>'}</div>`;
}

function simpleTable(a){return `<table class="table"><tbody>${a.map(x=>`<tr><td>${esc(x[0])}</td><td><b>${x[1]}</b></td></tr>`).join("")||"<tr><td>No data</td></tr>"}</tbody></table>`}

/* Health */
async function loadHealth(){
  const checks=[];$("#healthRoot").innerHTML="Running diagnostics…";
  try{const d=await fetch(APP_CONFIG.apiUrl,{redirect:"follow"});checks.push(["Apps Script Web App",d.ok?"Online":"HTTP "+d.status,d.ok])}catch(e){checks.push(["Apps Script Web App","Unavailable",false])}
  try{await api("validateSession",{token});checks.push(["Authenticated API","Online",true])}catch(e){checks.push(["Authenticated API","Unavailable",false])}
  checks.push(["Camera API",navigator.mediaDevices?.getUserMedia?"Available":"Unavailable",!!navigator.mediaDevices?.getUserMedia]);
  checks.push(["Secure Context",window.isSecureContext?"Yes":"No",window.isSecureContext]);
  $("#healthRoot").innerHTML=`<table class="table"><thead><tr><th>Component</th><th>Status</th></tr></thead><tbody>${checks.map(c=>`<tr><td>${esc(c[0])}</td><td><span class="badge ${c[2]?"completed":"failed"}">${esc(c[1])}</span></td></tr>`).join("")}</tbody></table>`;
}

/* Admin */
let users=[];
async function loadUsers(){
  if(!isAdmin())return;
  try{const d=await api("getUsers",{token});users=d.users||[];renderUsers()}catch(e){$("#usersTable").innerHTML=`<div class="error">${esc(e.message)}</div>`}
}
function renderUsers(){
  const q=$("#userSearch").value.trim().toLowerCase(),st=$("#userStatus").value,role=$("#userRole").value;
  const list=users.filter(u=>(!q||String(u.name).toLowerCase().includes(q)||String(u.email).toLowerCase().includes(q))&&(!st||u.status===st)&&(!role||u.role===role));
  $("#userStats").innerHTML=`<div class="stat"><b>${users.length}</b><span>Total</span></div><div class="stat"><b>${users.filter(u=>u.status==="Approved").length}</b><span>Approved</span></div><div class="stat"><b>${users.filter(u=>u.status==="Pending").length}</b><span>Pending</span></div><div class="stat"><b>${users.filter(u=>u.status==="Disabled").length}</b><span>Disabled</span></div>`;
  $("#usersTable").innerHTML=`<table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${list.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(u.status)}</td><td>${esc(u.created)}</td><td><button class="admin-action" data-edit="${u.row}">Edit</button><button class="admin-action" data-reset="${u.row}">Reset Password</button>${u.email!==currentUser.email?`<button class="admin-action" data-toggle="${u.row}" data-status="${u.status==="Disabled"?"Approved":"Disabled"}">${u.status==="Disabled"?"Enable":"Disable"}</button><button class="admin-action delete" data-delete="${u.row}">Delete</button>`:""}</td></tr>`).join("")}</tbody></table>`;
  $("#usersTable").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editUser(users.find(u=>u.row==b.dataset.edit)));
  $("#usersTable").querySelectorAll("[data-reset]").forEach(b=>b.onclick=()=>resetPassword(users.find(u=>u.row==b.dataset.reset)));
  $("#usersTable").querySelectorAll("[data-toggle]").forEach(b=>b.onclick=()=>changeUser(users.find(u=>u.row==b.dataset.toggle),{status:b.dataset.status}));
  $("#usersTable").querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>deleteUser(users.find(u=>u.row==b.dataset.delete)));
}
function openCreateUser(){
  const modal=$("#createUserModal");
  if(!modal)return;
  $("#createUserForm").reset();
  $("#newUserRole").value="User";
  $("#newUserStatus").value="Approved";
  $("#newUserPassword").type="password";
  $("#newUserConfirmPassword").type="password";
  $("#toggleNewUserPassword").textContent="Show";
  $("#createUserMsg").className="user-form-msg";
  $("#createUserMsg").textContent="";
  modal.classList.remove("hidden");
  setTimeout(()=>$("#newUserName").focus(),30);
}
function closeCreateUser(){
  const modal=$("#createUserModal");
  if(modal)modal.classList.add("hidden");
}
async function submitCreateUser(e){
  e.preventDefault();
  const name=$("#newUserName").value.trim();
  const email=$("#newUserEmail").value.trim().toLowerCase();
  const password=$("#newUserPassword").value;
  const confirmPassword=$("#newUserConfirmPassword").value;
  const role=$("#newUserRole").value;
  const status=$("#newUserStatus").value;
  const out=$("#createUserMsg");
  const submit=$("#submitCreateUser");
  out.className="user-form-msg";
  out.textContent="";
  if(name.length<2){out.className="user-form-msg error";out.textContent="Please enter a valid full name.";return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){out.className="user-form-msg error";out.textContent="Please enter a valid email address.";return;}
  if(password.length<6){out.className="user-form-msg error";out.textContent="Password must be at least 6 characters.";return;}
  if(password!==confirmPassword){out.className="user-form-msg error";out.textContent="Passwords do not match.";return;}
  submit.disabled=true;
  submit.innerHTML='<span class="submit-icon">⏳</span> Creating…';
  try{
    await api("adminCreateUser",{token,name,email,password,role,status});
    toast("User created.","success");
    closeCreateUser();
    await loadUsers();
  }catch(err){
    out.className="user-form-msg error";
    out.textContent=err.message||"Unable to create user.";
  }finally{
    submit.disabled=false;
    submit.innerHTML='<span class="submit-icon">＋</span> Create User';
  }
}
async function createUser(){openCreateUser()}
async function editUser(u){if(!u)return;const name=prompt("Full name:",u.name);if(name===null)return;const role=prompt("Role (User/Admin):",u.role);if(role===null)return;const status=prompt("Status (Approved/Pending/Rejected/Disabled):",u.status);if(status===null)return;await api("adminManageUser",{token,row:u.row,name,role,status,expectedEmail:u.email});toast("User updated.","success");loadUsers()}
async function resetPassword(u){const p=prompt("New password (6+):");if(!p)return;await api("adminResetPassword",{token,row:u.row,password:p});toast("Password reset.","success")}
async function changeUser(u,p){if(!u)return;if(!confirm(`Change ${u.email} status to ${p.status}?`))return;await api("adminManageUser",{token,row:u.row,name:u.name,role:u.role,status:p.status,expectedEmail:u.email});loadUsers()}
async function deleteUser(u){if(!u||!confirm(`Delete ${u.email}?`))return;await api("adminDeleteUser",{token,row:u.row,expectedEmail:u.email});toast("User deleted.","success");loadUsers()}

/* init */
document.addEventListener("DOMContentLoaded",()=>{
  health();
  $("#setupApiUrl").value=setupApiUrl();
  $("#showSetup").onclick=()=>{$("#setupApiUrl").value=setupApiUrl();show("setupView")};
  $("#backToLoginFromSetup").onclick=()=>show("loginView");
  $("#testSetup").onclick=testAndSaveSetup;
  $("#setupGuide").onclick=()=>alert(`Setup:

1. Create/open your Google Sheet.
2. Extensions → Apps Script.
3. Replace Code.gs with the supplied backend/Code.gs.
4. Run setupSystem() and approve Google permissions.
5. Deploy → New deployment → Web app.
6. Execute as: Me. Who has access: Anyone.
7. Copy the /exec URL and paste it here.

Drive storage is created automatically by the backend; no Drive ID is required for the standard setup.`);
  $("#loginForm").onsubmit=async e=>{e.preventDefault();try{msg("#loginMsg","Signing in…");await login($("#loginEmail").value.trim(),$("#loginPassword").value)}catch(err){msg("#loginMsg",err.message,"error")}};
  $("#signupForm").onsubmit=async e=>{e.preventDefault();try{const d=await api("signup",{fullName:$("#signupName").value.trim(),email:$("#signupEmail").value.trim(),password:$("#signupPassword").value});msg("#signupMsg",d.message||"Account created. Await administrator approval.","success");setTimeout(()=>show("loginView"),1200)}catch(err){msg("#signupMsg",err.message,"error")}};
  $("#showSignup").onclick=()=>show("signupView");$("#showLogin").onclick=()=>show("loginView");$("#logoutBtn").onclick=logout;
  $$(".nav[data-tab]").forEach(b=>b.onclick=()=>activateTab(b.dataset.tab));
  $("#platform").onchange=()=>$("#customPlatformWrap").classList.toggle("hidden",$("#platform").value!=="Custom");
  $("#manualPlatform").onchange=()=>$("#manualCustomWrap").classList.toggle("hidden",$("#manualPlatform").value!=="Custom");
  $("#openCamera").onclick=openCamera;$("#closeCamera").onclick=closeCamera;$("#enableCamera").onclick=enableCamera;$("#startRecord").onclick=startRecording;$("#stopRecord").onclick=stopRecording;
  $("#clearFilters").onclick=clearFilters;$("#searchBtn").onclick=searchOrders;
  $("#refreshLogs").onclick=loadLogs;$("#refreshQueue").onclick=loadQueue;$("#addManualUpload").onclick=addManualUpload;$("#previewBulk").onclick=previewBulk;$("#addBulkUpload").onclick=addBulkUpload;$("#downloadBulkTemplate").onclick=downloadBulkTemplate;
  $("#previewReport").onclick=previewReport;$("#downloadReport").onclick=downloadReport;$$("[data-days]").forEach(b=>b.onclick=()=>{const d=new Date();d.setDate(d.getDate()-Number(b.dataset.days)+1);$("#reportFrom").value=localDate(d);$("#reportTo").value=localDate(new Date())});
  $("#refreshAnalytics").onclick=loadAnalytics;$("#runAnalytics").onclick=loadAnalytics;$("#resetAnalytics").onclick=resetAnalyticsFilters;$$('[data-analytics-preset]').forEach(b=>b.onclick=()=>applyAnalyticsPreset(b.dataset.analyticsPreset));["#analyticsFrom","#analyticsTo","#analyticsPlatform","#analyticsType","#analyticsPacker","#analyticsStatus"].forEach(sel=>$(sel).addEventListener($(sel).tagName==="INPUT"?"change":"change",()=>loadAnalytics()));$("#refreshHealth").onclick=loadHealth;$("#refreshUsers").onclick=loadUsers;$("#createUser").onclick=createUser;$("#closeCreateUser").onclick=closeCreateUser;$("#cancelCreateUser").onclick=closeCreateUser;$("#createUserForm").onsubmit=submitCreateUser;$("#toggleNewUserPassword").onclick=()=>{const a=$("#newUserPassword"),b=$("#newUserConfirmPassword"),show=a.type==="password";a.type=show?"text":"password";b.type=show?"text":"password";$("#toggleNewUserPassword").textContent=show?"Hide":"Show"};$("#createUserModal").addEventListener("click",e=>{if(e.target.id==="createUserModal")closeCreateUser()});document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#createUserModal").classList.contains("hidden"))closeCreateUser()});$("#userSearch").oninput=renderUsers;$("#userStatus").onchange=renderUsers;$("#userRole").onchange=renderUsers;
  $("#closePlayback").onclick=()=>{$("#playbackFrame").src="about:blank";$("#playbackModal").classList.add("hidden")};$("#playbackDownload").onclick=()=>playbackRecord&&downloadSearch(playbackRecord);
  restore();
});
})();
