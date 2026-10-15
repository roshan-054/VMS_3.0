import React, { useState, useEffect } from 'react';
import {
  X,
  Trash2,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  FolderSync,
  ExternalLink,
  Shield,
  FileSpreadsheet,
  Film,
  HardDrive,
  Copy,
  Check,
  ArrowRight,
  Info,
  Clock,
  Filter,
  Layers,
  Sparkles
} from 'lucide-react';
import {
  scanOlderVideos,
  deleteOlderVideos,
  ScanOlderVideosResult,
  DeleteOlderVideosResult,
  OlderVideoItem,
  formatFileSize
} from '../lib/api';
import { getStoredDriveFolderId } from '../lib/storage';

interface DeleteOlderVideosModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  initialDays?: number;
  onDeleteSuccess?: () => void;
}

export const DeleteOlderVideosModal: React.FC<DeleteOlderVideosModalProps> = ({
  isOpen,
  onClose,
  onShowToast,
  initialDays = 90,
  onDeleteSuccess
}) => {
  const [daysThreshold, setDaysThreshold] = useState<number>(initialDays);
  const [customDaysInput, setCustomDaysInput] = useState<string>('');
  const [isCustomDays, setIsCustomDays] = useState<boolean>(false);

  const [platformFilter, setPlatformFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const [moveDriveVideos, setMoveDriveVideos] = useState<boolean>(true);
  const [removeSheetRows, setRemoveSheetRows] = useState<boolean>(true);

  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanResult, setScanResult] = useState<ScanOlderVideosResult | null>(null);

  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteResult, setDeleteResult] = useState<DeleteOlderVideosResult | null>(null);

  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [copiedText, setCopiedText] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDaysThreshold(initialDays);
      setCustomDaysInput('');
      setIsCustomDays(false);
      setDeleteResult(null);
      setShowConfirm(false);
      handleScan(initialDays);
    } else {
      setScanResult(null);
      setDeleteResult(null);
      setIsDeleting(false);
      setIsScanning(false);
      setShowConfirm(false);
    }
  }, [isOpen, initialDays]);

  if (!isOpen) return null;

  const handleDaysChange = (val: number) => {
    setIsCustomDays(false);
    setDaysThreshold(val);
    handleScan(val, platformFilter, typeFilter);
  };

  const handleApplyCustomDays = () => {
    const num = parseInt(customDaysInput, 10);
    if (!num || num < 1) {
      onShowToast('Please enter a valid number of days (at least 1)', 'error');
      return;
    }
    setDaysThreshold(num);
    handleScan(num, platformFilter, typeFilter);
  };

  const handleScan = async (
    daysVal: number = daysThreshold,
    platformVal: string = platformFilter,
    typeVal: string = typeFilter
  ) => {
    setIsScanning(true);
    setDeleteResult(null);
    setShowConfirm(false);
    try {
      const res = await scanOlderVideos({
        days: daysVal,
        platform: platformVal === 'ALL' ? '' : platformVal,
        recordingType: typeVal === 'ALL' ? '' : typeVal,
        driveFolderId: getStoredDriveFolderId(),
      });
      setScanResult(res);
      if (res.totalOlderOrders > 0 || res.totalOlderDriveVideos > 0 || res.totalOlderSheetRows > 0) {
        onShowToast(
          `Found ${res.totalOlderOrders} record(s) older than ${daysVal} days (Cutoff: ${res.cutoffDate})`,
          'info'
        );
      } else {
        onShowToast(`No videos or logs found older than ${daysVal} days.`, 'success');
      }
    } catch (err: any) {
      onShowToast(`Scan failed: ${err.message || 'Error communicating with backend'}`, 'error');
    } finally {
      setIsScanning(false);
    }
  };

  const handleExecuteDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await deleteOlderVideos({
        days: daysThreshold,
        platform: platformFilter === 'ALL' ? '' : platformFilter,
        recordingType: typeFilter === 'ALL' ? '' : typeFilter,
        driveFolderId: getStoredDriveFolderId(),
        moveDriveVideosToTrash: moveDriveVideos,
        removeSheetEntries: removeSheetRows,
      });

      setDeleteResult(res);
      setShowConfirm(false);

      if (res.deletedOrdersCount > 0 || res.movedDriveVideosCount > 0 || res.removedSheetRowsCount > 0) {
        onShowToast(
          `Successfully cleaned ${res.movedDriveVideosCount || res.deletedOrdersCount} video(s) and ${
            res.removedSheetRowsCount
          } sheet row(s) older than ${daysThreshold} days!`,
          'success'
        );
        if (onDeleteSuccess) onDeleteSuccess();
      } else {
        onShowToast('Cleanup finished. No matching older entries required deletion.', 'info');
      }
    } catch (err: any) {
      onShowToast(`Deletion failed: ${err.message || 'Failed to execute video deletion'}`, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const filteredItems = (scanResult?.items || []).filter((item) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase().trim();
    return (
      (item.orderId && item.orderId.toLowerCase().includes(term)) ||
      (item.platform && item.platform.toLowerCase().includes(term)) ||
      (item.recordingType && item.recordingType.toLowerCase().includes(term)) ||
      (item.sheet && item.sheet.toLowerCase().includes(term)) ||
      (item.fileName && item.fileName.toLowerCase().includes(term))
    );
  });

  const getCutoffDateStr = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-4xl overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 text-white p-5 sm:p-6 flex items-start justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner shrink-0">
              <Trash2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white tracking-tight">
                  Delete Videos & Logs Older Than {daysThreshold} Days
                </h3>
                <span className="text-[10px] font-mono font-bold bg-white/20 text-white px-2 py-0.5 rounded-full border border-white/30 uppercase tracking-wider">
                  Retention Policy
                </span>
              </div>
              <p className="text-xs text-red-100 mt-0.5">
                Automatically scan & purge old recordings from Google Drive and Google Sheets to save cloud storage
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {/* Controls & Filter Bar */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-red-600" />
                <span className="text-xs font-bold text-slate-800">Select Storage Retention Period:</span>
              </div>
              <div className="text-xs font-semibold text-slate-600 bg-white border border-slate-200 px-3 py-1 rounded-xl shadow-2xs">
                Purge Cutoff: <span className="font-bold text-red-600">{getCutoffDateStr(daysThreshold)}</span> (Older than {daysThreshold} days)
              </div>
            </div>

            {/* Quick Days Selector Pills */}
            <div className="flex flex-wrap items-center gap-2">
              {[30, 60, 90, 120, 180, 365].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleDaysChange(d)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                    daysThreshold === d && !isCustomDays
                      ? 'bg-red-600 text-white ring-2 ring-red-400'
                      : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {d === 90 && <Sparkles className="w-3 h-3 text-amber-300" />}
                  {d} Days {d === 90 && '(Recommended)'}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setIsCustomDays(!isCustomDays)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  isCustomDays
                    ? 'bg-red-100 text-red-800 border border-red-300'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                Custom Days…
              </button>
            </div>

            {/* Custom Days Input Row */}
            {isCustomDays && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="number"
                  min="1"
                  max="3650"
                  placeholder="e.g. 45"
                  value={customDaysInput}
                  onChange={(e) => setCustomDaysInput(e.target.value)}
                  className="w-32 px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <button
                  type="button"
                  onClick={handleApplyCustomDays}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  Apply Custom Days
                </button>
              </div>
            )}

            {/* Optional Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Filter by Platform
                </label>
                <select
                  value={platformFilter}
                  onChange={(e) => {
                    setPlatformFilter(e.target.value);
                    handleScan(daysThreshold, e.target.value, typeFilter);
                  }}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-red-500 cursor-pointer"
                >
                  <option value="ALL">All E-Commerce Platforms (Amazon, D2C, JioMart, Custom)</option>
                  <option value="Amazon">Amazon Only</option>
                  <option value="D2C">D2C Only</option>
                  <option value="JioMart">JioMart Only</option>
                  <option value="Custom">Custom Only</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Filter by Recording Type
                </label>
                <select
                  value={typeFilter}
                  onChange={(e) => {
                    setTypeFilter(e.target.value);
                    handleScan(daysThreshold, platformFilter, e.target.value);
                  }}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-red-500 cursor-pointer"
                >
                  <option value="ALL">All Recording Types (Forward & Return)</option>
                  <option value="Forward">Outbound Forward Packing Recordings</option>
                  <option value="Return">Inbound Return Verification Recordings</option>
                </select>
              </div>
            </div>
          </div>

          {/* Action options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-start gap-2.5 p-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition cursor-pointer">
              <input
                type="checkbox"
                checked={moveDriveVideos}
                onChange={(e) => setMoveDriveVideos(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-red-600 focus:ring-red-500"
              />
              <div>
                <span className="text-xs font-bold text-slate-800 block flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-rose-600" />
                  Move Drive Video Files to Trash
                </span>
                <span className="text-[11px] text-slate-500">
                  Safely moves matching older video MP4 files into Google Drive Trash / Trash subfolders
                </span>
              </div>
            </label>

            <label className="flex items-start gap-2.5 p-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition cursor-pointer">
              <input
                type="checkbox"
                checked={removeSheetRows}
                onChange={(e) => setRemoveSheetRows(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-red-600 focus:ring-red-500"
              />
              <div>
                <span className="text-xs font-bold text-slate-800 block flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  Purge Log Entries from Google Sheets
                </span>
                <span className="text-[11px] text-slate-500">
                  Removes corresponding rows older than {daysThreshold} days from OrderLog, ReturnLog & UploadLog
                </span>
              </div>
            </label>
          </div>

          {/* Scanning / Result Metrics Summary Card */}
          {isScanning ? (
            <div className="p-8 rounded-2xl bg-amber-50/70 border border-amber-200 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-amber-600 animate-spin mx-auto" />
              <div>
                <h4 className="text-sm font-bold text-amber-900">
                  Scanning Google Sheets & Drive for Entries Older Than {daysThreshold} Days…
                </h4>
                <p className="text-xs text-amber-700 mt-1">
                  Checking OrderLog, ReturnLog, UploadLog, and video folder structure for cutoff date {getCutoffDateStr(daysThreshold)}
                </p>
              </div>
            </div>
          ) : scanResult ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-950 space-y-1">
                  <span className="text-[11px] font-semibold text-rose-700 block">Older Orders Found</span>
                  <span className="text-2xl font-extrabold font-mono text-rose-900">
                    {scanResult.totalOlderOrders}
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-purple-50 border border-purple-200 text-purple-950 space-y-1">
                  <span className="text-[11px] font-semibold text-purple-700 block">Older Video Files</span>
                  <span className="text-2xl font-extrabold font-mono text-purple-900">
                    {scanResult.totalOlderDriveVideos}
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-1">
                  <span className="text-[11px] font-semibold text-emerald-700 block">Sheet Rows to Purge</span>
                  <span className="text-2xl font-extrabold font-mono text-emerald-900">
                    {scanResult.totalOlderSheetRows}
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 space-y-1">
                  <span className="text-[11px] font-semibold text-amber-700 block">Purge Cutoff Date</span>
                  <span className="text-xs font-bold font-mono text-amber-900 block mt-1">
                    {scanResult.cutoffDate || getCutoffDateStr(daysThreshold)}
                  </span>
                </div>
              </div>

              {/* List of scanned items */}
              {scanResult.items && scanResult.items.length > 0 && (
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-xs">
                  <div className="bg-slate-100 p-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
                    <span className="text-xs font-bold text-slate-800">
                      Scanned Items Older Than {daysThreshold} Days ({filteredItems.length})
                    </span>
                    <input
                      type="text"
                      placeholder="Filter order ID, platform, sheet…"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="px-3 py-1 bg-white border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>

                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                    {filteredItems.map((item, idx) => (
                      <div key={idx} className="p-3 hover:bg-slate-50 transition flex items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${
                            item.recordingType === 'Return'
                              ? 'bg-purple-100 text-purple-800 border border-purple-200'
                              : 'bg-blue-100 text-blue-800 border border-blue-200'
                          }`}>
                            {item.recordingType}
                          </span>
                          <span className="font-mono font-bold text-slate-900 truncate">
                            #{item.orderId}
                          </span>
                          <span className="text-slate-500 text-[11px]">
                            • {item.platform}
                          </span>
                          <span className="text-slate-400 text-[10px] font-mono">
                            • {item.sheet}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 shrink-0 text-[11px]">
                          <span className="font-mono text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded border border-red-100">
                            {item.ageDays ? `${item.ageDays} days old` : `Older than ${daysThreshold}d`}
                          </span>
                          {item.dateStr && (
                            <span className="text-slate-500 font-mono text-[10px]">
                              {item.dateStr}
                            </span>
                          )}
                          {item.playbackUrl && (
                            <a
                              href={item.playbackUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 flex items-center gap-1 font-semibold"
                            >
                              Video <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Confirm Banner before execute */}
          {showConfirm && (
            <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-300 text-red-950 space-y-3 animate-pulse">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-red-900">
                    Are you sure you want to delete videos & logs older than {daysThreshold} days?
                  </h4>
                  <p className="text-xs text-red-700 mt-1">
                    This action will delete video files created before <span className="font-mono font-bold">{scanResult?.cutoffDate || getCutoffDateStr(daysThreshold)}</span> and remove their rows from Google Sheets.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleExecuteDelete}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  {isDeleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  {isDeleting ? 'Deleting Older Videos…' : 'Yes, Delete Older Videos Now'}
                </button>
              </div>
            </div>
          )}

          {/* Delete Execution Result Banner */}
          {deleteResult && (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h4 className="text-sm font-bold text-emerald-900">
                  Older Videos Purge Completed Successfully!
                </h4>
              </div>
              <p className="text-xs text-emerald-800">
                Purged <span className="font-bold">{deleteResult.movedDriveVideosCount || deleteResult.deletedOrdersCount}</span> video file(s) and <span className="font-bold">{deleteResult.removedSheetRowsCount}</span> sheet log entry(s) older than {daysThreshold} days (Cutoff: {deleteResult.cutoffDate}).
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-100 p-4 sm:p-5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleScan(daysThreshold, platformFilter, typeFilter)}
            disabled={isScanning || isDeleting}
            className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            Re-Scan Older Entries
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Close
            </button>

            {!showConfirm && (
              <button
                type="button"
                disabled={isScanning || isDeleting || !scanResult || (scanResult.totalOlderOrders === 0 && scanResult.totalOlderDriveVideos === 0 && scanResult.totalOlderSheetRows === 0)}
                onClick={() => setShowConfirm(true)}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <Trash2 className="w-4 h-4" />
                Purge Videos & Logs Older Than {daysThreshold} Days
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
