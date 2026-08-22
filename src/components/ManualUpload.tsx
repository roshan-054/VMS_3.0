import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileVideo,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Layers,
  Sparkles,
  Plus,
  ArrowRight,
  RefreshCw,
  Info,
  Calendar,
  FolderCheck,
  X
} from 'lucide-react';
import { PlatformType, RecordingType, QueueItem } from '../types';
import { dbPutQueue, getStoredDriveFolderId } from '../lib/storage';
import { checkDuplicate } from '../lib/api';

interface ManualUploadProps {
  onQueueUpdated: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

interface StagedFile {
  id: string;
  file: File;
  orderId: string;
  platform: PlatformType;
  customPlatform?: string;
  recordingType: RecordingType;
  recordingDate: string; // YYYY-MM-DD
  isDuplicate?: boolean;
  duplicateInfo?: any;
  status: 'ready' | 'checking' | 'queued';
}

export const ManualUpload: React.FC<ManualUploadProps> = ({ onQueueUpdated, onShowToast }) => {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [bulkPlatform, setBulkPlatform] = useState<PlatformType>('Amazon');
  const [bulkCustomPlatform, setBulkCustomPlatform] = useState<string>('CustomShop');
  const [bulkRecordingType, setBulkRecordingType] = useState<RecordingType>('Forward');
  const [bulkDate, setBulkDate] = useState<string>(() => new Date().toLocaleDateString('en-CA'));
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Helper to extract date from filename or file modification metadata
  const extractDateFromFilenameOrFile = (file: File): string => {
    const name = file.name;
    // 1. Look for YYYY-MM-DD or YYYY_MM_DD
    const matchIso = name.match(/(20\d{2})[-_](0[1-9]|1[0-2])[-_](0[1-9]|[12]\d|3[01])/);
    if (matchIso) {
      return `${matchIso[1]}-${matchIso[2]}-${matchIso[3]}`;
    }

    // 2. Look for DD-MM-YYYY or DD_MM_YYYY
    const matchDmY = name.match(/(0[1-9]|[12]\d|3[01])[-_](0[1-9]|1[0-2])[-_](20\d{2})/);
    if (matchDmY) {
      return `${matchDmY[3]}-${matchDmY[2]}-${matchDmY[1]}`;
    }

    // 3. Look for YYYYMMDD
    const matchCompact = name.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
    if (matchCompact) {
      return `${matchCompact[1]}-${matchCompact[2]}-${matchCompact[3]}`;
    }

    // 4. Fallback to file's hardware/OS last modified date
    if (file.lastModified) {
      const d = new Date(file.lastModified);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-CA'); // Returns YYYY-MM-DD
      }
    }

    // 5. Fallback to current date
    return new Date().toLocaleDateString('en-CA');
  };

  // Helper to parse filename into OrderID, Platform, Type
  const parseFilename = (name: string): { orderId: string; platform: PlatformType; recordingType: RecordingType } => {
    // Remove extension
    const base = name.replace(/\.[^/.]+$/, '');
    const parts = base.split(/[_-]/);

    let parsedOrderId = parts[0] || base;
    let parsedPlatform: PlatformType = 'Amazon';
    let parsedType: RecordingType = 'Forward';

    // Scan parts for platform and recording type
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower.includes('amazon')) parsedPlatform = 'Amazon';
      else if (lower.includes('d2c') || lower.includes('shopify')) parsedPlatform = 'D2C';
      else if (lower.includes('jiomart') || lower.includes('jio')) parsedPlatform = 'JioMart';
      else if (lower.includes('return') || lower.includes('inbound')) parsedType = 'Return';
      else if (lower.includes('forward') || lower.includes('outbound')) parsedType = 'Forward';
    }

    return {
      orderId: parsedOrderId.trim(),
      platform: parsedPlatform,
      recordingType: parsedType,
    };
  };

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newItems: StagedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.includes('video') && !file.name.match(/\.(mp4|webm|mov|mkv|avi)$/i)) {
        onShowToast(`Skipped non-video file: ${file.name}`, 'info');
        continue;
      }

      const parsed = parseFilename(file.name);
      const autoDate = extractDateFromFilenameOrFile(file);

      newItems.push({
        id: crypto.randomUUID(),
        file,
        orderId: parsed.orderId || `ORDER_${Date.now()}_${i}`,
        platform: parsed.platform,
        recordingType: parsed.recordingType,
        recordingDate: autoDate,
        status: 'ready',
      });
    }

    if (newItems.length > 0) {
      setStagedFiles((prev) => [...prev, ...newItems]);
      onShowToast(`Added ${newItems.length} video(s). Target date folders auto-detected.`, 'success');
      // Run duplicate check on new items
      checkDuplicatesForBatch(newItems);
    }
  };

  const checkDuplicatesForBatch = async (items: StagedFile[]) => {
    for (const item of items) {
      if (!item.orderId.trim()) continue;
      try {
        const existing = await checkDuplicate({
          orderId: item.orderId.trim(),
          platform: item.platform,
          recordingType: item.recordingType,
        });

        setStagedFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? {
                  ...f,
                  isDuplicate: !!existing,
                  duplicateInfo: existing,
                }
              : f
          )
        );
      } catch (e) {}
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFilesSelected(e.dataTransfer.files);
  };

  const handleApplyBulkSettings = () => {
    setStagedFiles((prev) =>
      prev.map((f) => ({
        ...f,
        platform: bulkPlatform,
        customPlatform: bulkPlatform === 'Custom' ? bulkCustomPlatform : f.customPlatform,
        recordingType: bulkRecordingType,
        recordingDate: bulkDate || f.recordingDate,
      }))
    );
    onShowToast(`Applied ${bulkPlatform === 'Custom' ? bulkCustomPlatform : bulkPlatform} (${bulkRecordingType}) to all staged files`, 'info');
    checkDuplicatesForBatch(stagedFiles.map((f) => ({ ...f, platform: bulkPlatform })));
  };

  const handleRemoveStaged = (id: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleClearAllStaged = () => {
    setStagedFiles([]);
  };

  const handleQueueAll = async () => {
    if (stagedFiles.length === 0) return;

    setIsProcessing(true);
    let queuedCount = 0;
    const driveFolderId = getStoredDriveFolderId();

    try {
      for (const item of stagedFiles) {
        if (!item.orderId.trim()) {
          onShowToast(`Skipping item without Order ID: ${item.file.name}`, 'error');
          continue;
        }

        const effectivePlatform =
          item.platform === 'Custom' ? item.customPlatform?.trim() || 'Custom' : item.platform;
        const cleanOrderId = item.orderId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        const cleanPlatform = effectivePlatform.replace(/[^a-zA-Z0-9_-]/g, '_');
        const ext = item.file.name.toLowerCase().endsWith('.mp4') ? '.mp4' : '.webm';
        const fileName = `${cleanOrderId}_${cleanPlatform}_${item.recordingType}${ext}`;
        const targetDate = item.recordingDate || new Date().toLocaleDateString('en-CA');

        const queueItem: QueueItem = {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          orderId: item.orderId.trim(),
          platform: effectivePlatform,
          recordingType: item.recordingType,
          fileName: fileName,
          fileSize: item.file.size,
          mimeType: item.file.type || 'video/mp4',
          source: 'Manual Backup Upload',
          blob: item.file,
          status: 'pending',
          progress: 0,
          driveFolderId: driveFolderId,
          recordingDate: targetDate,
        };

        await dbPutQueue(queueItem);
        queuedCount++;
      }

      setStagedFiles([]);
      onQueueUpdated();
      onShowToast(
        `Successfully queued ${queuedCount} manual video(s) for Google Drive upload into relevant date folders!`,
        'success'
      );
    } catch (err: any) {
      console.error('Manual queue error:', err);
      onShowToast(`Failed to queue manual videos: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div id="manual-upload-card" className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-blue-600" />
            Manual Backup Video Upload (Single & Bulk)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Manually upload local packing videos with automatic date folder detection to sync directly to Google Drive hierarchy.
          </p>
        </div>

        {stagedFiles.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleClearAllStaged}
              className="px-3 py-1.5 text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg border border-slate-200 transition"
            >
              Clear All
            </button>
            <button
              onClick={handleQueueAll}
              disabled={isProcessing}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition inline-flex items-center gap-1.5"
            >
              <CheckCircle className="w-4 h-4" />
              Queue {stagedFiles.length} Video(s) for Drive Sync
            </button>
          </div>
        )}
      </div>

      {/* Drag and Drop Zone */}
      <div
        id="manual-upload-dropzone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 ${
          isDragging
            ? 'border-blue-500 bg-blue-50/60'
            : 'border-slate-300 hover:border-blue-400 bg-slate-50/50 hover:bg-slate-50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,.mp4,.webm,.mov,.mkv"
          multiple
          className="hidden"
          onChange={(e) => handleFilesSelected(e.target.files)}
        />
        <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-xs">
          <UploadCloud className="w-6 h-6" />
        </div>
        <div>
          <span className="text-xs font-semibold text-blue-600 hover:underline">
            Click to select video files
          </span>{' '}
          <span className="text-xs text-slate-500">or drag and drop here</span>
        </div>
        <p className="text-[11px] text-slate-400">
          Supports MP4, WebM, MOV, MKV. Automatically extracts Order ID, Platform, and Recording Date from video metadata or filename.
        </p>
      </div>

      {/* Bulk Settings Bar */}
      {stagedFiles.length > 0 && (
        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-slate-700 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              Apply to All Staged:
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Platform:</span>
              <select
                aria-label="Bulk Platform"
                value={bulkPlatform}
                onChange={(e) => setBulkPlatform(e.target.value as PlatformType)}
                className="bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 text-xs font-medium focus:ring-1 focus:ring-blue-500 focus:outline-none"
              >
                <option value="Amazon">Amazon</option>
                <option value="D2C">D2C</option>
                <option value="JioMart">JioMart</option>
                <option value="Custom">Custom</option>
              </select>
              {bulkPlatform === 'Custom' && (
                <input
                  type="text"
                  placeholder="Enter custom platform name"
                  value={bulkCustomPlatform}
                  onChange={(e) => setBulkCustomPlatform(e.target.value)}
                  className="bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 text-xs font-medium w-32 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Type:</span>
              <select
                aria-label="Bulk Recording Type"
                value={bulkRecordingType}
                onChange={(e) => setBulkRecordingType(e.target.value as RecordingType)}
                className="bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 text-xs font-medium focus:ring-1 focus:ring-blue-500 focus:outline-none"
              >
                <option value="Forward">Forward</option>
                <option value="Return">Return</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Date:</span>
              <input
                type="date"
                aria-label="Bulk Target Date"
                value={bulkDate}
                onChange={(e) => setBulkDate(e.target.value)}
                className="bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 text-xs font-medium focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <button
              onClick={handleApplyBulkSettings}
              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 font-medium rounded border border-slate-300 shadow-2xs transition"
            >
              Apply to All
            </button>
          </div>

          <div className="text-slate-500 text-[11px]">
            Total Staged: <b>{stagedFiles.length} file(s)</b> ({' '}
            {(stagedFiles.reduce((acc, f) => acc + f.file.size, 0) / (1024 * 1024)).toFixed(1)} MB)
          </div>
        </div>
      )}

      {/* Staged File List */}
      {stagedFiles.length > 0 && (
        <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
          {stagedFiles.map((item) => (
            <div
              key={item.id}
              className={`p-3 rounded-lg border text-xs transition flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                item.isDuplicate
                  ? 'bg-amber-50/70 border-amber-300'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0 md:w-1/3">
                <FileVideo className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 truncate" title={item.file.name}>
                    {item.file.name}
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-2">
                    <span>{(item.file.size / (1024 * 1024)).toFixed(2)} MB</span>
                    <span>•</span>
                    <span className="uppercase">{item.file.type || 'video/mp4'}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5 font-mono">
                    <FolderCheck className="w-3 h-3 text-emerald-600" />
                    <span>Drive: {item.platform}/{item.recordingType}/{item.recordingDate}/</span>
                  </div>
                </div>
              </div>

              {/* Editable Meta Controls */}
              <div className="flex flex-wrap items-center gap-2.5 min-w-0 flex-1">
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Order ID / Custom ID</label>
                  <input
                    type="text"
                    placeholder="Type Order ID..."
                    value={item.orderId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setStagedFiles((prev) =>
                        prev.map((f) => (f.id === item.id ? { ...f, orderId: val } : f))
                      );
                    }}
                    className="w-full px-3 py-1.5 bg-white border-2 border-slate-300 rounded-md font-mono text-xs text-slate-900 shadow-2xs focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Platform</label>
                  <select
                    aria-label="Platform"
                    value={item.platform}
                    onChange={(e) => {
                      const val = e.target.value as PlatformType;
                      setStagedFiles((prev) =>
                        prev.map((f) => (f.id === item.id ? { ...f, platform: val } : f))
                      );
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-medium text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
                  >
                    <option value="Amazon">Amazon</option>
                    <option value="D2C">D2C</option>
                    <option value="JioMart">JioMart</option>
                    <option value="Custom">Custom</option>
                  </select>
                </div>

                {item.platform === 'Custom' && (
                  <div className="min-w-[120px]">
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Custom Name</label>
                    <input
                      type="text"
                      placeholder="Type custom..."
                      value={item.customPlatform || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStagedFiles((prev) =>
                          prev.map((f) => (f.id === item.id ? { ...f, customPlatform: val } : f))
                        );
                      }}
                      className="w-full px-2.5 py-1.5 bg-white border-2 border-slate-300 rounded-md text-xs text-slate-900 shadow-2xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Type</label>
                  <select
                    aria-label="Recording Type"
                    value={item.recordingType}
                    onChange={(e) => {
                      const val = e.target.value as RecordingType;
                      setStagedFiles((prev) =>
                        prev.map((f) => (f.id === item.id ? { ...f, recordingType: val } : f))
                      );
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-medium text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
                  >
                    <option value="Forward">Forward</option>
                    <option value="Return">Return</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Date</label>
                  <div className="flex items-center gap-1" title="Target Date Folder (YYYY-MM-DD)">
                    <input
                      type="date"
                      aria-label="Target Recording Date"
                      value={item.recordingDate}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStagedFiles((prev) =>
                          prev.map((f) => (f.id === item.id ? { ...f, recordingDate: val } : f))
                        );
                      }}
                      className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-medium text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
                    />
                  </div>
                </div>

                {item.isDuplicate && (
                  <span
                    className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-1 rounded border border-amber-300 flex items-center gap-1 shrink-0 self-end mt-4"
                    title="This Order ID has already been recorded in Google Drive & Sheet."
                  >
                    <AlertTriangle className="w-3 h-3 text-amber-600" />
                    Duplicate Order ID
                  </span>
                )}
              </div>

              <button
                onClick={() => handleRemoveStaged(item.id)}
                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition self-end md:self-center shrink-0"
                title="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
