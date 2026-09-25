import React, { useState, useEffect } from 'react';
import {
  X,
  Trash2,
  Sparkles,
  Layers,
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
  User as UserIcon
} from 'lucide-react';
import {
  scanDuplicateRecords,
  removeDuplicateRecords,
  ScanDuplicatesResult,
  RemoveDuplicatesResult,
  DuplicateGroupItem
} from '../lib/api';
import { getStoredDriveFolderId, getStoredApiUrl } from '../lib/storage';

interface CleanDuplicatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  initialOrderId?: string;
  onCleanSuccess?: () => void;
}

export const CleanDuplicatesModal: React.FC<CleanDuplicatesModalProps> = ({
  isOpen,
  onClose,
  onShowToast,
  initialOrderId = '',
  onCleanSuccess
}) => {
  const [orderIdFilter, setOrderIdFilter] = useState(initialOrderId);
  const [keepPolicy, setKeepPolicy] = useState<'latest' | 'first'>('latest');
  const [moveDriveVideos, setMoveDriveVideos] = useState(true);
  const [removeSheetRows, setRemoveSheetRows] = useState(true);

  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanDuplicatesResult | null>(null);

  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<RemoveDuplicatesResult | null>(null);

  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isOpen) {
      setOrderIdFilter(initialOrderId);
      setCleanResult(null);
      // Auto-scan upon modal open
      handleScan(initialOrderId);
    } else {
      setScanResult(null);
      setCleanResult(null);
      setIsCleaning(false);
      setIsScanning(false);
    }
  }, [isOpen, initialOrderId]);

  if (!isOpen) return null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleScan = async (specificOrder?: string, policyOverride?: 'latest' | 'first') => {
    setIsScanning(true);
    setCleanResult(null);
    try {
      const order = specificOrder !== undefined ? specificOrder : orderIdFilter;
      const policy = policyOverride !== undefined ? policyOverride : keepPolicy;
      const res = await scanDuplicateRecords({
        orderId: order.trim(),
        driveFolderId: getStoredDriveFolderId(),
        keepPolicy: policy
      });
      setScanResult(res);
      if (res.totalDuplicateOrders > 0) {
        onShowToast(`Detected ${res.totalDuplicateOrders} order(s) with duplicates across Google Sheets & Drive`, 'info');
      } else {
        onShowToast('No duplicate recordings found. Your sheets and Drive are clean!', 'success');
      }
    } catch (err: any) {
      onShowToast(err?.message || 'Failed to scan for duplicates. Check backend connection.', 'error');
    } finally {
      setIsScanning(false);
    }
  };

  const handlePolicyChange = (newPolicy: 'latest' | 'first') => {
    setKeepPolicy(newPolicy);
    handleScan(orderIdFilter, newPolicy);
  };

  const handleClean = async () => {
    if (!scanResult || scanResult.totalDuplicateOrders === 0) {
      onShowToast('No duplicates to clean. Run a scan first.', 'info');
      return;
    }

    const confirmMsg =
      `CONFIRM SAFE DEDUPLICATION ACROSS ALL TABS (${scanResult.totalDuplicateOrders} Orders with Duplicates):\n\n` +
      `✓ UNIQUE ORIGINAL GUARANTEE: Exactly 1 unique original recording per order will be 100% PRESERVED in each sheet and date folder.\n` +
      `✓ ALL TABS COVERAGE: Surplus duplicate rows will be cleaned from ALL tabs (UploadLog, ReturnLog, OrderLog, DownloadLog, and rest).\n` +
      `✓ SAFE TRASH FOLDER: ${scanResult.totalDuplicateDriveVideos} surplus duplicate video(s) will be moved into a "Trash" subfolder in the same date series folder (NEVER deleted to Drive system bin).\n` +
      `✓ LOG AUDIT: ${scanResult.totalDuplicateSheetRows} surplus duplicate row(s) will be removed from active sheets and permanently archived in "TrashLog".\n\n` +
      `Are you sure you want to proceed?`;

    if (!window.confirm(confirmMsg)) return;

    setIsCleaning(true);
    try {
      const res = await removeDuplicateRecords({
        keepPolicy,
        moveDriveVideosToTrashFolder: moveDriveVideos,
        removeSheetEntries: removeSheetRows,
        orderId: orderIdFilter.trim(),
        driveFolderId: getStoredDriveFolderId()
      });

      setCleanResult(res);
      onShowToast(res.message || 'Duplicate videos and sheet entries cleaned successfully!', 'success');
      if (onCleanSuccess) {
        onCleanSuccess();
      }
      // Re-scan to confirm 0 duplicates remaining
      setTimeout(() => {
        handleScan(orderIdFilter.trim(), keepPolicy);
      }, 1500);
    } catch (err: any) {
      onShowToast(err?.message || 'Failed to remove duplicates.', 'error');
    } finally {
      setIsCleaning(false);
    }
  };

  const filteredGroups = (scanResult?.groups || []).filter((grp) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      grp.orderId.toLowerCase().includes(term) ||
      grp.platform.toLowerCase().includes(term) ||
      grp.recordingType.toLowerCase().includes(term) ||
      grp.duplicates.some((d) => d.packerEmail.toLowerCase().includes(term) || (d.fileId && d.fileId.toLowerCase().includes(term)))
    );
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-6 py-5 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600/30 border border-purple-400/40 flex items-center justify-center text-purple-300">
              <Trash2 className="w-5 h-5 text-purple-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">
                  Remove Duplicate Videos & Sheet Entries
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold">
                  Safe Deduplication
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Clean redundant recordings from Google Sheets and move duplicate videos into date-series "Trash" folders
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informational Banner */}
        <div className="bg-indigo-50/70 border-b border-indigo-100 px-6 py-3 flex items-start gap-3">
          <Shield className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
          <div className="text-xs text-indigo-900 leading-relaxed">
            <span className="font-bold">Unique Preservation Guarantee:</span> We will{' '}
            <span className="font-semibold underline">never remove all entries or videos</span> of an order. Exactly 1 unique original recording per order is ALWAYS preserved.
            Only redundant surplus copies are moved into a dedicated{' '}
            <span className="font-mono font-bold bg-indigo-100 px-1.5 py-0.5 rounded text-indigo-800">Trash</span> folder inside the{' '}
            <span className="font-semibold">exact same parent date folder</span> (preserving the{' '}
            <span className="font-mono font-semibold">.../&lt;Platform&gt;/&lt;Type&gt;/&lt;Month&gt;/&lt;Date&gt;/Trash/</span> hierarchy). Duplicate sheet rows are removed from active logs and archived in <span className="font-mono font-bold">TrashLog</span>.
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Controls Bar */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            {/* Filter by Order ID */}
            <div className="md:col-span-4">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                Target Order ID (Optional)
              </label>
              <input
                type="text"
                placeholder="Leave blank for all orders"
                value={orderIdFilter}
                onChange={(e) => setOrderIdFilter(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Keeper Policy */}
            <div className="md:col-span-5">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                Duplicate Policy (Which Copy to Keep)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handlePolicyChange('latest')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    keepPolicy === 'latest'
                      ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  Keep Latest (Unique)
                </button>
                <button
                  type="button"
                  onClick={() => handlePolicyChange('first')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    keepPolicy === 'first'
                      ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  Keep Earliest (Unique)
                </button>
              </div>
            </div>

            {/* Scan Action */}
            <div className="md:col-span-3 flex items-end">
              <button
                type="button"
                disabled={isScanning || isCleaning}
                onClick={() => handleScan()}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                {isScanning ? 'Scanning Sheets & Drive…' : 'Scan for Duplicates'}
              </button>
            </div>
          </div>

          {/* Clean Success Results Banner */}
          {cleanResult && cleanResult.success && (
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl space-y-3">
              <div className="flex items-center gap-2.5 text-emerald-800 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                Cleanup Completed Successfully!
              </div>
              <p className="text-xs text-emerald-700 leading-relaxed">
                {cleanResult.message}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-xs">
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200 text-center">
                  <span className="text-[10px] text-slate-500 uppercase block font-sans">Orders Cleaned</span>
                  <span className="text-base font-bold text-emerald-700">{cleanResult.cleanedOrdersCount}</span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200 text-center">
                  <span className="text-[10px] text-slate-500 uppercase block font-sans">Videos Moved to Trash</span>
                  <span className="text-base font-bold text-purple-700">{cleanResult.movedDriveVideosCount}</span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200 text-center">
                  <span className="text-[10px] text-slate-500 uppercase block font-sans">Sheet Rows Deleted</span>
                  <span className="text-base font-bold text-red-600">{cleanResult.removedSheetRowsCount}</span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200 text-center">
                  <span className="text-[10px] text-slate-500 uppercase block font-sans">Archived in TrashLog</span>
                  <span className="text-base font-bold text-slate-700">{cleanResult.archivedCount}</span>
                </div>
              </div>

              {cleanResult.removedBySheet && Object.keys(cleanResult.removedBySheet).length > 0 && (
                <div className="pt-2 border-t border-emerald-200">
                  <span className="text-[11px] font-bold text-emerald-900 block mb-1">Rows Deleted by Tab:</span>
                  <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                    {Object.entries(cleanResult.removedBySheet).map(([sheet, cnt]) => (
                      <span key={sheet} className="bg-white px-2 py-0.5 rounded border border-emerald-300 text-emerald-800 font-semibold">
                        {sheet}: {cnt} rows
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {cleanResult.movedFiles && cleanResult.movedFiles.length > 0 && (
                <div className="mt-2 text-[11px] text-slate-600 bg-white p-3 rounded-lg border border-emerald-200">
                  <span className="font-bold text-slate-800 block mb-1.5">Videos Moved into Date-Series "Trash" Folders:</span>
                  <ul className="space-y-1 font-mono text-[10px]">
                    {cleanResult.movedFiles.slice(0, 5).map((f, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-slate-600">
                        <ArrowRight className="w-3 h-3 text-purple-600 shrink-0" />
                        <span className="font-semibold text-slate-800">{f.fileName}</span>
                        <span className="text-slate-400">→</span>
                        <span className="bg-purple-50 text-purple-700 px-1 py-0.5 rounded font-sans">
                          {f.parentFolderName} / {f.trashFolderName}
                        </span>
                      </li>
                    ))}
                    {cleanResult.movedFiles.length > 5 && (
                      <li className="text-slate-400 pl-4">
                        …and {cleanResult.movedFiles.length - 5} more files moved safely.
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Stats Cards */}
          {scanResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold text-lg">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 font-medium">Duplicate Orders</span>
                    <div className="text-xl font-bold text-slate-900">
                      {scanResult.totalDuplicateOrders}{' '}
                      <span className="text-xs font-normal text-slate-500">order(s)</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-lg">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 font-medium">Duplicate Sheet Rows</span>
                    <div className="text-xl font-bold text-amber-700">
                      {scanResult.totalDuplicateSheetRows}{' '}
                      <span className="text-xs font-normal text-slate-500">rows</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center font-bold text-lg">
                    <Film className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 font-medium">Drive Videos to Move</span>
                    <div className="text-xl font-bold text-red-700">
                      {scanResult.totalDuplicateDriveVideos}{' '}
                      <span className="text-xs font-normal text-slate-500">video(s)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* All Tabs Scanned Info Bar */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-700 flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
                    All Tabs Scanned:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {(scanResult.scannedTabs && scanResult.scannedTabs.length > 0
                      ? scanResult.scannedTabs
                      : ['OrderLog', 'ReturnLog', 'UploadLog', 'DownloadLog']
                    ).map((tab) => (
                      <span key={tab} className="font-mono text-[11px] px-2 py-0.5 bg-white border border-slate-200 rounded text-slate-700 font-medium">
                        {tab}
                      </span>
                    ))}
                  </div>
                </div>

                {scanResult.tabSummary && Object.keys(scanResult.tabSummary).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-slate-500 font-medium">Duplicates per tab:</span>
                    {Object.entries(scanResult.tabSummary).map(([sheet, count]) => (
                      <span key={sheet} className="font-mono px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded font-semibold">
                        {sheet}: {count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action Trigger Banner */}
          {scanResult && scanResult.totalDuplicateOrders > 0 && (
            <div className="bg-gradient-to-r from-purple-50 via-indigo-50 to-purple-50 p-4 rounded-xl border border-purple-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-bold text-purple-950 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  Ready to Deduplicate {scanResult.totalDuplicateOrders} Order(s)
                </span>
                <p className="text-xs text-purple-800 leading-relaxed">
                  Moving {scanResult.totalDuplicateDriveVideos} video(s) into their date folder <span className="font-mono font-bold">Trash</span> subfolder, and deleting {scanResult.totalDuplicateSheetRows} duplicate rows.
                </p>
              </div>

              <button
                type="button"
                disabled={isCleaning || isScanning}
                onClick={handleClean}
                className="w-full sm:w-auto px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition flex items-center justify-center gap-2 cursor-pointer shrink-0"
              >
                <Trash2 className={`w-4 h-4 ${isCleaning ? 'animate-spin' : ''}`} />
                {isCleaning ? 'Cleaning & Moving to Trash…' : 'Clean & Move Duplicates to Trash Folder'}
              </button>
            </div>
          )}

          {/* No Duplicates State */}
          {scanResult && scanResult.totalDuplicateOrders === 0 && (
            <div className="text-center py-10 px-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-800">
                All Order Recordings are Unique & Clean!
              </h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                Scanned OrderLog, ReturnLog, UploadLog, and Google Drive folders. No duplicate Order IDs of the same recording type were found.
              </p>
            </div>
          )}

          {/* Detailed Duplicate List */}
          {scanResult && scanResult.totalDuplicateOrders > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-slate-500" />
                  Duplicate Order Breakdown ({filteredGroups.length} shown)
                </h4>

                <input
                  type="text"
                  placeholder="Filter duplicates…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white w-48 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>

              <div className="space-y-3">
                {filteredGroups.map((grp, gIdx) => (
                  <div
                    key={gIdx}
                    className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs hover:border-purple-300 transition"
                  >
                    {/* Order Header */}
                    <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-slate-900">
                          {grp.orderId}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(grp.orderId)}
                          className="text-slate-400 hover:text-slate-700 p-0.5"
                          title="Copy Order ID"
                        >
                          {copiedText === grp.orderId ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                          {grp.platform}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {grp.recordingType}
                        </span>
                      </div>

                      <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                        {grp.totalEntries} recordings ({grp.duplicates.length} duplicate)
                      </span>
                    </div>

                    {/* Entries List */}
                    <div className="p-3 divide-y divide-slate-100 space-y-2">
                      {/* Keeper Entry */}
                      <div className="pt-2 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-emerald-50/70 p-3 rounded-xl border border-emerald-300 shadow-xs">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-700 text-white px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                              <CheckCircle2 className="w-3 h-3 text-white" />
                              KEEP (Unique Original)
                            </span>
                            <span className="text-xs font-bold text-emerald-950">
                              Sheet: {grp.keeper.sheet} (Row {grp.keeper.row})
                            </span>
                            <span className="text-[10px] text-emerald-700 font-medium hidden sm:inline">
                              • Will remain active in sheet & Google Drive
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-3">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-emerald-600" />
                              {grp.keeper.timestamp ? new Date(grp.keeper.timestamp).toLocaleString() : 'N/A'}
                            </span>
                            {grp.keeper.packerEmail && (
                              <span className="flex items-center gap-1 font-mono">
                                <UserIcon className="w-3 h-3 text-emerald-600" />
                                {grp.keeper.packerEmail}
                              </span>
                            )}
                            {grp.keeper.fileId && (
                              <span className="font-mono text-[10px] text-emerald-800 bg-emerald-100/70 px-1.5 py-0.5 rounded">
                                File ID: {grp.keeper.fileId.slice(0, 10)}… (Retained)
                              </span>
                            )}
                          </div>
                        </div>

                        {grp.keeper.playbackUrl && (
                          <a
                            href={grp.keeper.playbackUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-emerald-700 hover:text-emerald-900 bg-white border border-emerald-300 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 shrink-0 self-start sm:self-center shadow-2xs hover:bg-emerald-50 transition"
                          >
                            <Film className="w-3.5 h-3.5 text-emerald-600" />
                            View Video
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      {/* Duplicate Entries */}
                      {grp.duplicates.map((dup, dIdx) => (
                        <div
                          key={dIdx}
                          className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 hover:bg-amber-50/40 transition"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full">
                                SURPLUS DUPLICATE
                              </span>
                              <span className="text-xs font-semibold text-slate-800">
                                Sheet: {dup.sheet} (Row {dup.row})
                              </span>
                              {dup.willMoveFileToTrash ? (
                                <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">
                                  Duplicate Video File
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                  Same video file ID as keeper
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-3">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                {dup.timestamp ? new Date(dup.timestamp).toLocaleString() : 'N/A'}
                              </span>
                              {dup.packerEmail && (
                                <span className="flex items-center gap-1 font-mono">
                                  <UserIcon className="w-3 h-3 text-slate-400" />
                                  {dup.packerEmail}
                                </span>
                              )}
                              {dup.fileId && (
                                <span className="font-mono text-[10px] text-slate-400">
                                  ID: {dup.fileId.slice(0, 10)}…
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-start sm:self-center">
                            {dup.willMoveFileToTrash ? (
                              <span className="text-[11px] text-purple-700 font-medium">
                                → Moved to <code className="bg-purple-100 px-1 py-0.5 rounded text-purple-900 font-bold">Trash/</code>
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-600 font-medium">
                                → Row removed (Video kept)
                              </span>
                            )}
                            {dup.playbackUrl && (
                              <a
                                href={dup.playbackUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-slate-500 hover:text-slate-800 p-1 rounded hover:bg-slate-200 transition"
                                title="Inspect duplicate video"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-600" />
            <span>Preserves exact date series format. Archived in Google Sheet "TrashLog".</span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Close
            </button>
            {scanResult && scanResult.totalDuplicateOrders > 0 && (
              <button
                type="button"
                disabled={isCleaning || isScanning}
                onClick={handleClean}
                className="w-full sm:w-auto px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Trash2 className={`w-3.5 h-3.5 ${isCleaning ? 'animate-spin' : ''}`} />
                {isCleaning ? 'Cleaning…' : `Clean ${scanResult.totalDuplicateOrders} Duplicates Now`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
