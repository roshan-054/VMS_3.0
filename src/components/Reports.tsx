import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  Filter,
  RefreshCw,
  Layers,
  Search,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Package,
  TrendingUp,
  Users,
  Clock
} from 'lucide-react';
import { requestApi } from '../lib/api';

interface ReportsProps {
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export const Reports: React.FC<ReportsProps> = ({ onShowToast }) => {
  const today = new Date().toISOString().slice(0, 10);
  const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [datePreset, setDatePreset] = useState<'today' | 'yesterday' | '7days' | '14days' | '30days' | 'thisMonth' | 'lastMonth' | 'custom'>('7days');
  const [fromDate, setFromDate] = useState(lastWeek);
  const [toDate, setToDate] = useState(today);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [packerFilter, setPackerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [videoFilter, setVideoFilter] = useState('all');

  const [loading, setLoading] = useState(false);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [inTableSearch, setInTableSearch] = useState('');
  const [sortColumn, setSortColumn] = useState<string>('Timestamp');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [pageSize, setPageSize] = useState<number>(50);

  const handleDatePresetChange = (preset: typeof datePreset) => {
    setDatePreset(preset);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (preset === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (preset === 'yesterday') {
      const y = new Date(Date.now() - 86400000);
      const yStr = y.toISOString().slice(0, 10);
      setFromDate(yStr);
      setToDate(yStr);
    } else if (preset === '7days') {
      const d = new Date(Date.now() - 7 * 86400000);
      setFromDate(d.toISOString().slice(0, 10));
      setToDate(todayStr);
    } else if (preset === '14days') {
      const d = new Date(Date.now() - 14 * 86400000);
      setFromDate(d.toISOString().slice(0, 10));
      setToDate(todayStr);
    } else if (preset === '30days') {
      const d = new Date(Date.now() - 30 * 86400000);
      setFromDate(d.toISOString().slice(0, 10));
      setToDate(todayStr);
    } else if (preset === 'thisMonth') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      setFromDate(firstDay);
      setToDate(todayStr);
    } else if (preset === 'lastMonth') {
      const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
      const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
      setFromDate(firstDayLastMonth);
      setToDate(lastDayLastMonth);
    }
  };

  const fetchReport = async () => {
    setLoading(true);
    try {
      const res = await requestApi<{ rows: any[] }>('getReportData', {
        fromDate,
        toDate,
        platform: platformFilter === 'all' ? '' : platformFilter,
        recordingType: typeFilter === 'all' ? '' : typeFilter,
        packer: packerFilter.trim(),
        status: statusFilter === 'all' ? '' : statusFilter,
        video: videoFilter === 'all' ? '' : videoFilter,
      });
      setPreviewRows(res.rows || []);
      onShowToast(`Generated report with ${res.rows?.length || 0} verified records.`, 'info');
    } catch (err: any) {
      console.warn('Report error:', err);
      onShowToast(err.message || 'Report query failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResetFilters = () => {
    handleDatePresetChange('7days');
    setPlatformFilter('all');
    setTypeFilter('all');
    setPackerFilter('');
    setStatusFilter('all');
    setVideoFilter('all');
    setInTableSearch('');
    onShowToast('Report filters reset to 7-day default', 'info');
  };

  // Filtered & Sorted in-memory rows
  const displayRows = useMemo(() => {
    let list = [...previewRows];

    if (inTableSearch.trim()) {
      const q = inTableSearch.toLowerCase().trim();
      list = list.filter((r) =>
        Object.values(r).some((val) => String(val || '').toLowerCase().includes(q))
      );
    }

    if (sortColumn) {
      list.sort((a, b) => {
        const valA = a[sortColumn] ?? '';
        const valB = b[sortColumn] ?? '';
        const comp = String(valA).localeCompare(String(valB), undefined, { numeric: true });
        return sortDirection === 'asc' ? comp : -comp;
      });
    }

    return list;
  }, [previewRows, inTableSearch, sortColumn, sortDirection]);

  // Statistics Summary
  const stats = useMemo(() => {
    const total = displayRows.length;
    const uniqueOrders = new Set(displayRows.map((r) => r['Order ID'] || r.orderId)).size;
    const forwardCount = displayRows.filter((r) => (r['Recording Type'] || r.recordingType) === 'Forward').length;
    const returnCount = displayRows.filter((r) => (r['Recording Type'] || r.recordingType) === 'Return').length;
    const platforms: Record<string, number> = {};
    displayRows.forEach((r) => {
      const p = r['Platform'] || r.platform || 'Other';
      platforms[p] = (platforms[p] || 0) + 1;
    });

    return { total, uniqueOrders, forwardCount, returnCount, platforms };
  }, [displayRows]);

  const handleDownloadCsv = () => {
    if (displayRows.length === 0) {
      onShowToast('No report rows available to export. Generate preview first.', 'error');
      return;
    }

    const headers = Object.keys(displayRows[0]);
    const csvContent = [
      headers.join(','),
      ...displayRows.map((row) =>
        headers
          .map((h) => {
            const val = String(row[h] ?? '').replace(/"/g, '""');
            return `"${val}"`;
          })
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Packing_Audit_Report_${fromDate}_to_${toDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onShowToast('CSV Report exported successfully!', 'success');
  };

  const toggleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection('desc');
    }
  };

  return (
    <div id="reports-container" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-600" />
            Consolidated Packing & Audit Reports
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Generate, filter, and export high-precision audit logs and video links from your Google Sheet database.
          </p>
        </div>

        {/* Download CSV Action */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleDownloadCsv}
            disabled={displayRows.length === 0}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Advanced Filtering Control Panel */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        {/* Row 1: Date Range Presets */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
              Report Date Range Preset
            </label>
            <span className="text-[11px] font-mono text-slate-500 font-semibold">
              {fromDate} → {toDate}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: '7days', label: 'Last 7 Days' },
              { id: '14days', label: 'Last 14 Days' },
              { id: '30days', label: 'Last 30 Days' },
              { id: 'thisMonth', label: 'This Month' },
              { id: 'lastMonth', label: 'Last Month' },
              { id: 'custom', label: 'Custom Range' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => handleDatePresetChange(p.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  datePreset === p.id
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Precision Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-2 border-t border-slate-100">
          {/* Custom From Date */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setDatePreset('custom');
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:bg-white focus:outline-none"
            />
          </div>

          {/* Custom To Date */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setDatePreset('custom');
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:bg-white focus:outline-none"
            />
          </div>

          {/* Platform */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Platform</label>
            <select
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
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Recording Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:bg-white focus:outline-none"
            >
              <option value="all">All Types</option>
              <option value="Forward">Forward (Packing)</option>
              <option value="Return">Return (Inbound)</option>
            </select>
          </div>

          {/* Packer Operator */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Packer Filter</label>
            <input
              type="text"
              placeholder="e.g. packer@vms"
              value={packerFilter}
              onChange={(e) => setPackerFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-800 focus:bg-white focus:outline-none"
            />
          </div>

          {/* Video Attachment Filter */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Video Status</label>
            <select
              value={videoFilter}
              onChange={(e) => setVideoFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:bg-white focus:outline-none"
            >
              <option value="all">All Records</option>
              <option value="yes">Only With Drive Video</option>
              <option value="no">Without Video Link</option>
            </select>
          </div>
        </div>

        {/* Generate Report Button Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={handleResetFilters}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Filter Options
          </button>

          <button
            id="preview-report-btn"
            onClick={fetchReport}
            disabled={loading}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Querying Google Sheet Logs…' : 'Generate Report Preview'}
          </button>
        </div>
      </div>

      {/* Summary KPI Cards of Filtered Report */}
      {previewRows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-slate-900">{stats.total}</div>
              <div className="text-[11px] text-slate-500 font-semibold">Total Verified Packages</div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-slate-900">{stats.uniqueOrders}</div>
              <div className="text-[11px] text-slate-500 font-semibold">Unique Orders</div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-slate-900">{stats.forwardCount}</div>
              <div className="text-[11px] text-slate-500 font-semibold">Forward Packing Logs</div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center shrink-0">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-slate-900">{stats.returnCount}</div>
              <div className="text-[11px] text-slate-500 font-semibold">Return Verifications</div>
            </div>
          </div>
        </div>
      )}

      {/* Report Data Preview Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        {/* Table Top Controls */}
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/80">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-800">
              Report Rows Preview ({displayRows.length} {displayRows.length === 1 ? 'row' : 'rows'})
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              • {fromDate} to {toDate}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick in-table search filter */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search within report…"
                value={inTableSearch}
                onChange={(e) => setInTableSearch(e.target.value)}
                className="w-48 sm:w-64 pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            </div>

            {/* Page size */}
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-700"
            >
              <option value={25}>Show 25</option>
              <option value={50}>Show 50</option>
              <option value={100}>Show 100</option>
              <option value={9999}>Show All</option>
            </select>
          </div>
        </div>

        {/* Data Table */}
        {previewRows.length === 0 ? (
          <div className="p-16 text-center text-slate-400 text-xs space-y-2">
            <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="font-semibold text-slate-600">No report preview generated yet.</p>
            <p className="text-[11px] text-slate-400">
              Click "Generate Report Preview" above to query your live Google Sheet database.
            </p>
          </div>
        ) : displayRows.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            No rows match the search query "{inTableSearch}".
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0 z-10 shadow-2xs">
                <tr>
                  <th className="px-3 py-3 w-10 text-center text-slate-400">#</th>
                  {Object.keys(displayRows[0]).map((h, i) => (
                    <th
                      key={i}
                      onClick={() => toggleSort(h)}
                      className="px-4 py-3 whitespace-nowrap cursor-pointer hover:bg-slate-200/70 transition select-none"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{h}</span>
                        {sortColumn === h ? (
                          sortDirection === 'asc' ? (
                            <ChevronUp className="w-3.5 h-3.5 text-blue-600" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                          )
                        ) : (
                          <ChevronDown className="w-3 h-3 text-slate-300 opacity-0 hover:opacity-100" />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {displayRows.slice(0, pageSize).map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-blue-50/40 transition">
                    <td className="px-3 py-2.5 text-center text-slate-400 text-[11px] font-sans">
                      {rIdx + 1}
                    </td>
                    {Object.keys(displayRows[0]).map((h, cIdx) => {
                      const val = String(row[h] ?? '');
                      const isLink = val.startsWith('http://') || val.startsWith('https://');
                      const isDriveId = h === 'Drive File ID' && val.length > 5;
                      const isOrderId = h === 'Order ID';

                      return (
                        <td key={cIdx} className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                          {isLink ? (
                            <a
                              href={val}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline flex items-center gap-1 font-semibold"
                            >
                              Open Link <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : isDriveId ? (
                            <a
                              href={`https://drive.google.com/file/d/${val}/view`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline font-semibold flex items-center gap-1"
                            >
                              {val.slice(0, 12)}… <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : isOrderId ? (
                            <span className="font-bold text-slate-900 font-sans">{val}</span>
                          ) : h === 'Platform' ? (
                            <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-sans font-semibold text-[11px]">
                              {val}
                            </span>
                          ) : h === 'Recording Type' ? (
                            <span
                              className={`px-2 py-0.5 rounded font-sans font-semibold text-[11px] ${
                                val === 'Return'
                                  ? 'bg-purple-50 text-purple-700'
                                  : 'bg-blue-50 text-blue-700'
                              }`}
                            >
                              {val}
                            </span>
                          ) : (
                            <span>{val}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer */}
        {displayRows.length > pageSize && (
          <div className="p-3 bg-slate-50 border-t border-slate-200 text-center text-xs text-slate-500 font-medium">
            Showing first {pageSize} of {displayRows.length} rows. Select "Show All" or export CSV to view the entire audit dataset.
          </div>
        )}
      </div>
    </div>
  );
};
