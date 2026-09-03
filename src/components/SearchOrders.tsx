import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Video,
  Play,
  Download,
  ExternalLink,
  Calendar,
  Filter,
  RefreshCw,
  X,
  FileCheck,
  Copy,
  Check,
  Info,
  Clock,
  User as UserIcon,
  Shield,
  Layers,
  ArrowUpDown,
  FileText,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Cloud,
  Database,
  AlertTriangle
} from 'lucide-react';
import { VideoRecord, User } from '../types';
import { requestApi, formatFileSize, deleteLogEntry } from '../lib/api';
import { canUserDeleteData } from '../lib/permissions';

interface SearchOrdersProps {
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  currentUser?: User | null;
}

export const SearchOrders: React.FC<SearchOrdersProps> = ({ onShowToast, currentUser }) => {
  const [orderQuery, setOrderQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'sheets' | 'drive'>('all');
  const [packerFilter, setPackerFilter] = useState('');
  const [datePreset, setDatePreset] = useState<'all' | 'today' | 'yesterday' | '7days' | '30days' | 'custom'>('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'orderId' | 'fileSize'>('newest');
  
  const [results, setResults] = useState<VideoRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<VideoRecord | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Deletion modal state
  const [recordToDelete, setRecordToDelete] = useState<VideoRecord | null>(null);
  const [deleteFromDriveOption, setDeleteFromDriveOption] = useState(true);
  const [deleteFromSheetsOption, setDeleteFromSheetsOption] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  const canDelete = currentUser ? canUserDeleteData(currentUser) : false;

  const fetchRecords = async () => {
    setLoading(true);
    try {
      // Calculate date bounds based on preset
      let effFrom = fromDate;
      let effTo = toDate;
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);

      if (datePreset === 'today') {
        effFrom = todayStr;
        effTo = todayStr;
      } else if (datePreset === 'yesterday') {
        const y = new Date(Date.now() - 86400000);
        effFrom = y.toISOString().slice(0, 10);
        effTo = y.toISOString().slice(0, 10);
      } else if (datePreset === '7days') {
        const last7 = new Date(Date.now() - 7 * 86400000);
        effFrom = last7.toISOString().slice(0, 10);
        effTo = todayStr;
      } else if (datePreset === '30days') {
        const last30 = new Date(Date.now() - 30 * 86400000);
        effFrom = last30.toISOString().slice(0, 10);
        effTo = todayStr;
      }

      const isSpecificQuery = !!orderQuery.trim();

      const res = await requestApi<{ results: VideoRecord[]; total: number }>('advancedSearch', {
        orderId: orderQuery.trim(),
        platform: platformFilter === 'all' ? '' : platformFilter,
        recordingType: typeFilter === 'all' ? '' : typeFilter,
        status: statusFilter === 'all' ? '' : statusFilter,
        sourceFilter: sourceFilter,
        packer: packerFilter.trim(),
        fromDate: isSpecificQuery ? '' : effFrom,
        toDate: isSpecificQuery ? '' : effTo,
        limit: isSpecificQuery ? 5000 : 100,
      });

      setResults(res.results || []);
    } catch (err: any) {
      console.warn('Search error:', err);
      onShowToast(err.message || 'Search query failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchRecords();
    }, 400);
    return () => clearTimeout(timer);
  }, [orderQuery, platformFilter, typeFilter, statusFilter, sourceFilter, datePreset, sortBy]);

  // Client-side refined sorting & filtering
  const filteredAndSortedResults = useMemo(() => {
    let list = [...results];

    if (packerFilter.trim()) {
      const q = packerFilter.toLowerCase().trim();
      list = list.filter((r) => r.packerEmail?.toLowerCase().includes(q));
    }

    if (sourceFilter === 'sheets') {
      list = list.filter((r) => r.sheet !== 'Google Drive (Direct)');
    } else if (sourceFilter === 'drive') {
      list = list.filter((r) => r.sheet === 'Google Drive (Direct)');
    }

    list.sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      }
      if (sortBy === 'oldest') {
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      }
      if (sortBy === 'orderId') {
        return (a.orderId || '').localeCompare(b.orderId || '');
      }
      if (sortBy === 'fileSize') {
        return (parseFloat(b.fileSize || '0') || 0) - (parseFloat(a.fileSize || '0') || 0);
      }
      return 0;
    });

    return list;
  }, [results, packerFilter, sourceFilter, sortBy]);

  const hasDriveOnlyResults = useMemo(() => {
    return filteredAndSortedResults.some((r) => r.sheet === 'Google Drive (Direct)');
  }, [filteredAndSortedResults]);

  const handleCopy = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    onShowToast(`Copied ${fieldName} to clipboard!`, 'info');
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleDownloadLog = async (rec: VideoRecord) => {
    try {
      await requestApi('downloadLog', {
        orderId: rec.orderId,
        platform: rec.platform,
        recordingType: rec.recordingType,
        fileName: rec.fileName,
        fileSize: rec.fileSize,
        downloadType: 'Search Order Download',
      });
    } catch (e) {}

    if (rec.driveLink) {
      window.open(rec.driveLink, '_blank');
    } else if (rec.fileId) {
      window.open(`https://drive.google.com/uc?export=download&id=${rec.fileId}`, '_blank');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!recordToDelete) return;
    setIsDeleting(true);
    try {
      const targetFileId = recordToDelete.fileId;
      const targetOrderId = recordToDelete.orderId;

      await deleteLogEntry({
        driveFileId: targetFileId,
        orderId: targetOrderId,
        fileName: recordToDelete.fileName,
        platform: recordToDelete.platform,
        recordingType: recordToDelete.recordingType,
        timestamp: recordToDelete.timestamp,
        deleteFromDrive: deleteFromDriveOption,
        deleteFromSheets: deleteFromSheetsOption,
      });

      // Optimistically remove from active search list
      setResults((prev) =>
        prev.filter((r) => {
          if (targetFileId && r.fileId === targetFileId) return false;
          if (targetOrderId && r.orderId === targetOrderId && r.timestamp === recordToDelete.timestamp) return false;
          return true;
        })
      );

      if (selectedRecord && (
        (targetFileId && selectedRecord.fileId === targetFileId) ||
        (targetOrderId && selectedRecord.orderId === targetOrderId && selectedRecord.timestamp === recordToDelete.timestamp)
      )) {
        setSelectedRecord(null);
      }

      onShowToast(`Recording "${recordToDelete.fileName || recordToDelete.orderId}" deleted successfully.`, 'success');
      setRecordToDelete(null);
    } catch (err: any) {
      console.error('Delete error in search:', err);
      onShowToast(err.message || 'Failed to delete recording', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetFilters = () => {
    setOrderQuery('');
    setPlatformFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
    setSourceFilter('all');
    setPackerFilter('');
    setDatePreset('all');
    setFromDate('');
    setToDate('');
    setSortBy('newest');
    onShowToast('Filters reset to default', 'info');
  };

  const activeFilterCount = [
    orderQuery.trim() !== '',
    platformFilter !== 'all',
    typeFilter !== 'all',
    statusFilter !== 'all',
    sourceFilter !== 'all',
    packerFilter.trim() !== '',
    datePreset !== 'all',
    fromDate !== '',
    toDate !== '',
  ].filter(Boolean).length;

  return (
    <div id="search-orders-container" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <Search className="w-5 h-5 text-blue-600" />
            Search Packing Videos & Order Audit
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Look up any order barcode, play high-definition recordings, and inspect full package logs from Google Drive & Sheets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <button
              onClick={handleResetFilters}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset ({activeFilterCount})
            </button>
          )}
          <button
            onClick={fetchRecords}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Search
          </button>
        </div>
      </div>

      {/* Advanced Filter Control Center */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        {/* Row 1: Search input + Date Presets */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
          <div className="lg:col-span-6 relative">
            <label htmlFor="searchQueryInput" className="block text-xs font-bold text-slate-700 mb-1">
              Search by Order ID, Barcode or File Name
            </label>
            <div className="relative">
              <input
                id="searchQueryInput"
                type="text"
                placeholder="e.g. 402-19283-91 or 1234_Amazon_Forward.mp4"
                value={orderQuery}
                onChange={(e) => setOrderQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchRecords()}
                className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-slate-900"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              {orderQuery && (
                <button
                  onClick={() => setOrderQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Quick Date Presets */}
          <div className="lg:col-span-6">
            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
              <span>Date Filter Preset</span>
              <span className="text-[10px] text-slate-400 font-normal">Fast range filtering</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'all', label: 'All Time' },
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: '7days', label: 'Last 7 Days' },
                { id: '30days', label: 'Last 30 Days' },
                { id: 'custom', label: 'Custom Date' },
              ].map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setDatePreset(preset.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    datePreset === preset.id
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: Secondary Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-1 border-t border-slate-100">
          {/* Platform */}
          <div>
            <label htmlFor="searchPlatformSelect" className="block text-[11px] font-bold text-slate-600 mb-1">
              Platform
            </label>
            <select
              id="searchPlatformSelect"
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:bg-white focus:outline-none"
            >
              <option value="all">All Platforms</option>
              <option value="Amazon">Amazon</option>
              <option value="D2C">D2C</option>
              <option value="JioMart">JioMart</option>
              <option value="Custom">Custom</option>
            </select>
          </div>

          {/* Recording Type */}
          <div>
            <label htmlFor="searchTypeSelect" className="block text-[11px] font-bold text-slate-600 mb-1">
              Recording Type
            </label>
            <select
              id="searchTypeSelect"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:bg-white focus:outline-none"
            >
              <option value="all">All Types</option>
              <option value="Forward">Forward (Packing)</option>
              <option value="Return">Return (Inbound)</option>
            </select>
          </div>

          {/* Storage / Location Source Filter */}
          <div>
            <label htmlFor="searchSourceSelect" className="block text-[11px] font-bold text-slate-600 mb-1">
              Storage Source
            </label>
            <select
              id="searchSourceSelect"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:bg-white focus:outline-none"
            >
              <option value="all">All Sources</option>
              <option value="sheets">Sheets Only (OrderLog)</option>
              <option value="drive">Drive Only (Direct)</option>
            </select>
          </div>

          {/* Operator / Packer */}
          <div>
            <label htmlFor="searchPackerInput" className="block text-[11px] font-bold text-slate-600 mb-1">
              Packer Email / ID
            </label>
            <input
              id="searchPackerInput"
              type="text"
              placeholder="e.g. packer@vms"
              value={packerFilter}
              onChange={(e) => setPackerFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-800 focus:bg-white focus:outline-none"
            />
          </div>

          {/* Status */}
          <div>
            <label htmlFor="searchStatusSelect" className="block text-[11px] font-bold text-slate-600 mb-1">
              Upload Status
            </label>
            <select
              id="searchStatusSelect"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:bg-white focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="Completed">Completed / Ready</option>
              <option value="in progress">In Progress</option>
              <option value="pending">Pending</option>
            </select>
          </div>

          {/* Sort By */}
          <div>
            <label htmlFor="searchSortSelect" className="block text-[11px] font-bold text-slate-600 mb-1 flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3 text-slate-400" />
              Sort By
            </label>
            <select
              id="searchSortSelect"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:bg-white focus:outline-none"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="orderId">Order ID (A-Z)</option>
              <option value="fileSize">File Size (Largest)</option>
            </select>
          </div>
        </div>

        {/* Custom Date Pickers (Shown if Custom preset is chosen) */}
        {datePreset === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 bg-blue-50/50 p-3 rounded-xl border border-blue-100">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">From Date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono"
              />
            </div>
          </div>
        )}

        {/* Search Submit Bar */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-slate-500 font-medium">
            Showing {filteredAndSortedResults.length} matching video records
          </span>
          <button
            id="search-orders-submit-btn"
            onClick={fetchRecords}
            className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-2 cursor-pointer"
          >
            <Search className="w-4 h-4" />
            Apply Search
          </button>
        </div>
      </div>

      {/* Informative notice if results are coming directly from Drive rather than Sheet logs */}
      {hasDriveOnlyResults && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-start gap-3 text-amber-900 text-xs">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold">Google Drive Direct Records Detected:</span> Some video recordings were found directly in your Google Drive storage folders because they are not currently listed in your Google Sheet tabs (<code className="bg-amber-100 px-1 py-0.5 rounded text-[11px] font-mono">OrderLog</code> / <code className="bg-amber-100 px-1 py-0.5 rounded text-[11px] font-mono">UploadLog</code>). You can play and download them, or permanently delete them from Drive if they are no longer needed.
          </div>
        </div>
      )}

      {/* Results List */}
      <div className="space-y-3">
        {loading ? (
          <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-xs">
            <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-2" />
            <p className="text-xs font-semibold text-slate-700">Searching Google Drive & Sheet logs…</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Scanning indexed database for Order ID matches</p>
          </div>
        ) : filteredAndSortedResults.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-xs">
            <FileCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h4 className="text-sm font-bold text-slate-800">No Matching Video Records Found</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              We couldn't find any recordings matching your search filters. Try clearing the query, selecting "All Time", or verifying the order barcode.
            </p>
            <button
              onClick={handleResetFilters}
              className="mt-4 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition"
            >
              Clear All Search Filters
            </button>
          </div>
        ) : (
          filteredAndSortedResults.map((r, idx) => {
            const isDriveDirect = r.sheet === 'Google Drive (Direct)';
            const isOrderSheet = r.sheet === 'OrderLog';
            const isReturnSheet = r.sheet === 'ReturnLog';
            const isUploadSheet = r.sheet === 'UploadLog';

            return (
              <div
                key={idx}
                className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs hover:shadow-md transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100 shadow-2xs">
                    <Video className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 text-base tracking-tight">{r.orderId}</span>
                      <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200">
                        {r.platform}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-md text-xs font-semibold border ${
                          r.recordingType === 'Return'
                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}
                      >
                        {r.recordingType}
                      </span>

                      {/* Storage Source Badge */}
                      {isDriveDirect ? (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300 flex items-center gap-1" title="Found directly in Google Drive storage folders (Not listed in Google Sheet)">
                          <Cloud className="w-3 h-3 text-amber-600" />
                          Drive Direct (Not in Sheet)
                        </span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border flex items-center gap-1 ${
                          isOrderSheet ? 'bg-emerald-50 text-emerald-800 border-emerald-300' :
                          isReturnSheet ? 'bg-purple-50 text-purple-800 border-purple-300' :
                          'bg-sky-50 text-sky-800 border-sky-300'
                        }`} title={`Indexed in ${r.sheet || 'Google Sheet'}`}>
                          <Database className="w-3 h-3 text-emerald-600" />
                          {r.sheet || 'Google Sheet'}
                        </span>
                      )}

                      <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        {r.status || 'Ready'}
                      </span>
                    </div>

                    <p className="text-xs font-mono text-slate-500 mt-1.5 truncate flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {r.fileName}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-2">
                      <span className="font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                        {formatFileSize(r.fileSize) || 'Standard HD'}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(r.timestamp).toLocaleDateString()} {new Date(r.timestamp).toLocaleTimeString()}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <UserIcon className="w-3 h-3" />
                        {r.packerEmail || 'Operator'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <button
                    onClick={() => setSelectedRecord(r)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    Play & View Details
                  </button>

                  {r.driveLink && (
                    <button
                      onClick={() => handleDownloadLog(r)}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                      title="Open directly in Google Drive"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Drive
                    </button>
                  )}

                  {canDelete && (
                    <button
                      onClick={() => setRecordToDelete(r)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition cursor-pointer border border-transparent hover:border-red-200"
                      title="Delete recording & logs"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ALL DETAILS & VIDEO PLAYBACK MODAL */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                  <Video className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white tracking-tight">
                      Order: {selectedRecord.orderId}
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/30 text-blue-300 border border-blue-400/30">
                      {selectedRecord.platform}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/30 text-purple-300 border border-purple-400/30">
                      {selectedRecord.recordingType}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-mono mt-0.5 truncate max-w-md">
                    {selectedRecord.fileName}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {selectedRecord.driveLink && (
                  <a
                    href={selectedRecord.driveLink}
                    target="_blank"
                    rel="noreferrer"
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open in Drive
                  </a>
                )}
                <button
                  onClick={() => setSelectedRecord(null)}
                  className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition cursor-pointer"
                  title="Close (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body: Scrollable */}
            <div className="overflow-y-auto p-4 sm:p-6 space-y-6">
              {/* Video Player Display Area */}
              <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-inner flex items-center justify-center w-full max-h-[50vh]">
                {selectedRecord.fileId ? (
                  <iframe
                    src={`https://drive.google.com/file/d/${selectedRecord.fileId}/preview`}
                    className="w-full h-full border-0 bg-black min-h-[300px]"
                    allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                    title={`Video Player - Order ${selectedRecord.orderId}`}
                  />
                ) : selectedRecord.driveLink ? (
                  <div className="p-8 text-center space-y-3">
                    <Video className="w-12 h-12 text-blue-400 mx-auto" />
                    <p className="text-xs text-slate-300">
                      High-resolution video recorded and securely stored on Google Drive.
                    </p>
                    <a
                      href={selectedRecord.driveLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      Watch on Google Drive
                    </a>
                  </div>
                ) : (
                  <div className="p-8 text-center space-y-2">
                    <AlertCircle className="w-10 h-10 text-amber-400 mx-auto" />
                    <p className="text-xs text-slate-400">
                      Drive File ID not directly previewable. Check Drive Link below.
                    </p>
                  </div>
                )}
              </div>

              {/* Comprehensive Order Metadata Breakdown */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-blue-600" />
                    Complete Order & Package Audit Information
                  </h4>
                  <button
                    onClick={() => handleCopy(JSON.stringify(selectedRecord, null, 2), 'JSON Data')}
                    className="text-[11px] font-semibold text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    Copy JSON Details
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {/* Order ID */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Order ID</span>
                      <p className="text-xs font-mono font-bold text-slate-900">{selectedRecord.orderId}</p>
                    </div>
                    <button
                      onClick={() => handleCopy(selectedRecord.orderId, 'Order ID')}
                      className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-white transition"
                      title="Copy Order ID"
                    >
                      {copiedField === 'Order ID' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Platform & Type */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Platform & Type</span>
                    <p className="text-xs font-bold text-slate-900">
                      {selectedRecord.platform} • {selectedRecord.recordingType}
                    </p>
                  </div>

                  {/* Storage Source */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Storage Source</span>
                    <p className="text-xs font-bold text-slate-900 flex items-center gap-1">
                      {selectedRecord.sheet === 'Google Drive (Direct)' ? (
                        <span className="text-amber-700 flex items-center gap-1">
                          <Cloud className="w-3.5 h-3.5" /> Drive Direct (Not in Sheet)
                        </span>
                      ) : (
                        <span className="text-emerald-700 flex items-center gap-1">
                          <Database className="w-3.5 h-3.5" /> {selectedRecord.sheet || 'Google Sheet'}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Timestamp */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Recording Timestamp</span>
                    <p className="text-xs font-mono font-medium text-slate-800">
                      {new Date(selectedRecord.timestamp).toLocaleString()}
                    </p>
                  </div>

                  {/* Packer Operator */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Packer Operator</span>
                    <p className="text-xs font-mono font-medium text-slate-800 truncate">
                      {selectedRecord.packerEmail || 'Standard Station'}
                    </p>
                  </div>

                  {/* File Size */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Video File Size</span>
                    <p className="text-xs font-mono font-medium text-slate-800">
                      {formatFileSize(selectedRecord.fileSize) || 'Standard 1080p'}
                    </p>
                  </div>

                  {/* Status */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Log Audit Status</span>
                    <p className="text-xs font-bold text-emerald-700">
                      ● {selectedRecord.status || 'Verified & Uploaded'}
                    </p>
                  </div>

                  {/* Google Drive File ID */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 sm:col-span-2 lg:col-span-3 flex items-center justify-between">
                    <div className="truncate mr-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Google Drive File ID</span>
                      <p className="text-xs font-mono text-slate-700 truncate">
                        {selectedRecord.fileId || 'N/A'}
                      </p>
                    </div>
                    {selectedRecord.fileId && (
                      <button
                        onClick={() => handleCopy(selectedRecord.fileId!, 'Drive File ID')}
                        className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-white transition shrink-0"
                        title="Copy File ID"
                      >
                        {copiedField === 'Drive File ID' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                {selectedRecord.driveLink && (
                  <button
                    onClick={() => handleCopy(selectedRecord.driveLink!, 'Drive Link')}
                    className="px-3 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy Drive Link
                  </button>
                )}
                {selectedRecord.fileId && (
                  <a
                    href={`https://drive.google.com/uc?export=download&id=${selectedRecord.fileId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Video File
                  </a>
                )}
                {canDelete && (
                  <button
                    onClick={() => {
                      setRecordToDelete(selectedRecord);
                    }}
                    className="px-3 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-600" />
                    Delete Recording
                  </button>
                )}
              </div>

              <button
                onClick={() => setSelectedRecord(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {recordToDelete && (
        <div className="fixed inset-0 z-60 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto border border-red-100 shadow-inner">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-base font-bold text-slate-900">
                Delete Recording & Logs?
              </h3>
              <p className="text-xs text-slate-500">
                Are you sure you want to delete recording for Order{' '}
                <span className="font-bold text-slate-800 font-mono">
                  {recordToDelete.orderId}
                </span>{' '}
                ({recordToDelete.platform} - {recordToDelete.recordingType})?
              </p>
              {recordToDelete.sheet === 'Google Drive (Direct)' && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                  This file is stored in Google Drive directly and not listed in Google Sheet logs. Trashing it will remove the video file permanently from Drive.
                </p>
              )}
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2.5 text-xs text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={deleteFromDriveOption}
                  onChange={(e) => setDeleteFromDriveOption(e.target.checked)}
                  className="rounded text-red-600 focus:ring-red-500 w-4 h-4"
                />
                <span>Delete & trash video file from Google Drive</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={deleteFromSheetsOption}
                  onChange={(e) => setDeleteFromSheetsOption(e.target.checked)}
                  className="rounded text-red-600 focus:ring-red-500 w-4 h-4"
                />
                <span>Remove log row from Google Sheet tabs (if present)</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRecordToDelete(null)}
                disabled={isDeleting}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={isDeleting || (!deleteFromDriveOption && !deleteFromSheetsOption)}
                className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting…</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

