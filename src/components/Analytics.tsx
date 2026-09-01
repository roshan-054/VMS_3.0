import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  LineChart as LineChartIcon,
  TrendingUp,
  Package,
  Layers,
  Users,
  Calendar,
  CheckCircle2,
  RefreshCw,
  Clock,
  Award,
  Filter,
  Download,
  RotateCcw,
  Sparkles,
  ArrowUpRight,
  ShieldCheck,
  ChevronRight,
  Activity,
  CalendarDays
} from 'lucide-react';
import { AnalyticsData } from '../types';
import { requestApi } from '../lib/api';

interface AnalyticsProps {
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

function getLocalDateStr(offsetDays = 0): string {
  const d = new Date();
  if (offsetDays !== 0) {
    d.setDate(d.getDate() + offsetDays);
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDDMM(dateStr?: string): string {
  if (!dateStr) return '';
  const parts = dateStr.trim().split('-');
  if (parts.length === 3) {
    // YYYY-MM-DD -> DD-MM
    return `${parts[2]}-${parts[1]}`;
  }
  if (parts.length === 2 && parts[0].length === 2 && parts[1].length === 2) {
    // MM-DD -> DD-MM
    return `${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

export function formatDDMMYYYY(dateStr?: string): string {
  if (!dateStr) return '';
  const parts = dateStr.trim().split('-');
  if (parts.length === 3) {
    // YYYY-MM-DD -> DD-MM-YYYY
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

export const Analytics: React.FC<AnalyticsProps> = ({ onShowToast }) => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);

  // Time & Custom Date Range Filters
  const [timePreset, setTimePreset] = useState<'today' | 'yesterday' | '7days' | '14days' | '30days' | '90days' | 'custom'>('7days');
  const [fromDate, setFromDate] = useState<string>(() => getLocalDateStr(-7));
  const [toDate, setToDate] = useState<string>(() => getLocalDateStr(0));

  const [platformFilter, setPlatformFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [packerFilter, setPackerFilter] = useState('');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeChartMode, setActiveChartMode] = useState<'total' | 'forward' | 'return'>('total');

  const handlePresetSelect = (preset: typeof timePreset) => {
    setTimePreset(preset);
    const todayStr = getLocalDateStr(0);

    if (preset === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (preset === 'yesterday') {
      const yStr = getLocalDateStr(-1);
      setFromDate(yStr);
      setToDate(yStr);
    } else if (preset === '7days') {
      setFromDate(getLocalDateStr(-7));
      setToDate(todayStr);
    } else if (preset === '14days') {
      setFromDate(getLocalDateStr(-14));
      setToDate(todayStr);
    } else if (preset === '30days') {
      setFromDate(getLocalDateStr(-30));
      setToDate(todayStr);
    } else if (preset === '90days') {
      setFromDate(getLocalDateStr(-90));
      setToDate(todayStr);
    }
  };

  const fetchAnalytics = async () => {
    if (!fromDate || !toDate) {
      onShowToast('Please specify both start and end dates', 'error');
      return;
    }
    if (fromDate > toDate) {
      onShowToast('From Date cannot be later than To Date', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await requestApi<AnalyticsData>('getAnalyticsData', {
        fromDate,
        toDate,
        platform: platformFilter === 'all' ? '' : platformFilter,
        recordingType: typeFilter === 'all' ? '' : typeFilter,
        packer: packerFilter.trim(),
      });
      setData(res);
    } catch (err: any) {
      console.warn('Analytics fetch error:', err);
      onShowToast(err.message || 'Failed to fetch analytics', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [fromDate, toDate, platformFilter, typeFilter]);

  // Derived metrics
  const totalPackings = data?.total ?? 0;
  const uniqueOrders = data?.uniqueOrders ?? 0;
  const duplicateOrders = Math.max(0, totalPackings - uniqueOrders);

  const forwardCount = data?.types?.find((t) => t.label === 'Forward')?.count || 0;
  const returnCount = data?.types?.find((t) => t.label === 'Return')?.count || 0;

  const topPlatform = data?.platforms?.[0] || { label: 'None', count: 0 };
  const topPlatformPct = totalPackings > 0 ? Math.round((topPlatform.count / totalPackings) * 100) : 0;

  const topPacker = data?.users?.[0] || { label: 'None', count: 0 };
  const topPackerName = topPacker.label ? topPacker.label.split('@')[0] : 'Operator';
  const topPackerPct = totalPackings > 0 ? Math.round((topPacker.count / totalPackings) * 100) : 0;

  // Max value in daily series for line graph scaling
  const dailyList = data?.daily || [];
  const actualPeakVolume = useMemo(() => {
    if (!dailyList.length) return 0;
    return Math.max(
      ...dailyList.map((d) => {
        if (activeChartMode === 'forward') return d.types?.Forward || 0;
        if (activeChartMode === 'return') return d.types?.Return || 0;
        return d.total;
      }),
      0
    );
  }, [dailyList, activeChartMode]);

  const maxDaily = useMemo(() => {
    if (!actualPeakVolume) return 5;
    return Math.ceil(actualPeakVolume * 1.25) || 5; // Add 25% headroom so peak curve doesn't touch top
  }, [actualPeakVolume]);

  // SVG Line Graph Geometry Calculations - Full width enlarged view
  const chartWidth = 1000;
  const chartHeight = 280;
  const padding = { top: 28, right: 20, bottom: 42, left: 45 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;
  const baselineY = padding.top + plotHeight;

  const points = useMemo(() => {
    if (!dailyList.length) return [];
    const count = dailyList.length;
    return dailyList.map((d, index) => {
      let val = d.total;
      if (activeChartMode === 'forward') val = d.types?.Forward || 0;
      if (activeChartMode === 'return') val = d.types?.Return || 0;

      const x = count === 1 ? padding.left + plotWidth / 2 : padding.left + (index / (count - 1)) * plotWidth;
      const y = padding.top + plotHeight - (val / (maxDaily || 1)) * plotHeight;
      return { x, y, val, day: d, index };
    });
  }, [dailyList, maxDaily, activeChartMode, plotWidth, plotHeight, padding.left, padding.top]);

  // Construct SVG Path strings with clamped control points to prevent dips below baseline
  const linePathD = useMemo(() => {
    if (!points.length) return '';
    if (points.length === 1) {
      return `M ${points[0].x - 10} ${points[0].y} L ${points[0].x + 10} ${points[0].y}`;
    }
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? 0 : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      let cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      let cp2y = p2.y - (p3.y - p1.y) / 6;

      // Clamp control points between top padding and baselineY
      cp1y = Math.max(padding.top, Math.min(cp1y, baselineY));
      cp2y = Math.max(padding.top, Math.min(cp2y, baselineY));

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }, [points, baselineY, padding.top]);

  const areaPathD = useMemo(() => {
    if (!points.length) return '';
    if (points.length === 1) {
      return `M ${points[0].x - 10} ${points[0].y} L ${points[0].x + 10} ${points[0].y} L ${points[0].x + 10} ${baselineY} L ${points[0].x - 10} ${baselineY} Z`;
    }
    const linePart = linePathD;
    const lastP = points[points.length - 1];
    const firstP = points[0];
    return `${linePart} L ${lastP.x} ${baselineY} L ${firstP.x} ${baselineY} Z`;
  }, [linePathD, points, baselineY]);

  const hoveredPoint = hoveredIndex !== null && points[hoveredIndex] ? points[hoveredIndex] : null;

  const handleExportSummary = () => {
    if (!data) return;
    const summary = {
      timeFrame: timePreset,
      dateRange: `${data.fromDate} to ${data.toDate}`,
      totalPackings,
      uniqueOrders,
      forwardPackings: forwardCount,
      returnVerifications: returnCount,
      platforms: data.platforms,
      users: data.users,
      daily: data.daily,
    };

    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VMS_Analytics_Summary_${data.fromDate}_to_${data.toDate}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    onShowToast('Analytics summary exported!', 'success');
  };

  return (
    <div id="analytics-container" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <LineChartIcon className="w-5 h-5 text-blue-600" />
            Station Packing Analytics & Throughput
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time performance metrics, platform volume distributions, and operator leaderboards from Google Drive video logs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Refreshing…' : 'Refresh Metrics'}
          </button>
        </div>
      </div>

      {/* Dynamic Interactive Filter Toolbar with Custom Date Range */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        {/* Row 1: Time Presets */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-slate-600 mr-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
              Time Range:
            </span>
            {[
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: '7days', label: '7 Days' },
              { id: '14days', label: '14 Days' },
              { id: '30days', label: '30 Days' },
              { id: '90days', label: '90 Days' },
              { id: 'custom', label: 'Custom Range' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => handlePresetSelect(p.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  timePreset === p.id
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Platform and Type Selectors */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 focus:bg-white focus:outline-none"
            >
              <option value="all">All Platforms</option>
              <option value="Amazon">Amazon</option>
              <option value="D2C">D2C</option>
              <option value="JioMart">JioMart</option>
              <option value="Custom">Custom</option>
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 focus:bg-white focus:outline-none"
            >
              <option value="all">All Types</option>
              <option value="Forward">Forward Only</option>
              <option value="Return">Return Only</option>
            </select>
          </div>
        </div>

        {/* Row 2: Custom Date Range Pickers (Always accessible or prominent when custom selected) */}
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 bg-slate-50/70 p-3 rounded-xl">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <CalendarDays className="w-4 h-4 text-blue-600" />
            <span>Custom Date Range:</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1">
              <span className="text-[11px] font-medium text-slate-400">From:</span>
              <input
                type="date"
                value={fromDate}
                max={toDate || getLocalDateStr(0)}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setTimePreset('custom');
                }}
                className="text-xs font-semibold text-slate-700 focus:outline-none bg-transparent"
              />
            </div>

            <span className="text-xs text-slate-400 font-bold">→</span>

            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1">
              <span className="text-[11px] font-medium text-slate-400">To:</span>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                max={getLocalDateStr(0)}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setTimePreset('custom');
                }}
                className="text-xs font-semibold text-slate-700 focus:outline-none bg-transparent"
              />
            </div>

            <button
              onClick={fetchAnalytics}
              disabled={loading}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
            >
              Apply Dates
            </button>
          </div>

          <span className="text-[11px] text-slate-400 ml-auto hidden md:inline">
            Active: <strong className="text-slate-600">{formatDDMMYYYY(fromDate)}</strong> to <strong className="text-slate-600">{formatDDMMYYYY(toDate)}</strong> ({dailyList.length} days)
          </span>
        </div>
      </div>

      {/* Modern Dynamic KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Verified Recordings */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-blue-300 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Total Packings
            </span>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <Package className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-3xl font-extrabold text-slate-900 tracking-tight">{totalPackings}</div>
            <div className="text-xs text-slate-400 mt-1 flex items-center gap-1 font-medium">
              <Clock className="w-3 h-3 text-blue-500" />
              Verified in selected range
            </div>
          </div>
        </div>

        {/* Card 2: Unique Orders & Duplicates */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-emerald-300 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Unique Orders
            </span>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-3xl font-extrabold text-slate-900 tracking-tight">{uniqueOrders}</div>
            <div className="text-xs text-emerald-700 mt-1 font-semibold flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              {duplicateOrders > 0 ? `${duplicateOrders} duplicate scans logged` : 'Zero duplicates detected'}
            </div>
          </div>
        </div>

        {/* Card 3: Top Performing Platform */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-purple-300 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Top Platform
            </span>
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight truncate">
              {topPlatform.label || 'N/A'}
            </div>
            <div className="text-xs text-purple-700 mt-1 font-semibold flex items-center gap-1">
              <span>{topPlatform.count} packages</span>
              <span>•</span>
              <span>{topPlatformPct}% share</span>
            </div>
          </div>
        </div>

        {/* Card 4: Top Packer Operator */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-amber-300 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Lead Operator
            </span>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
              <Award className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight truncate">
              {topPackerName}
            </div>
            <div className="text-xs text-amber-700 mt-1 font-semibold flex items-center gap-1 truncate">
              <span>{topPacker.count} completed</span>
              <span>•</span>
              <span>{topPackerPct}% throughput</span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Daily Throughput Line Graph */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              Daily Packing Throughput & Trend (Line Graph)
            </h3>
            <p className="text-[11px] text-slate-500">
              Interactive continuous trend curve representing daily video volumes across the selected timeframe.
            </p>
          </div>

          {/* Metric Selector Pills */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
            <button
              onClick={() => setActiveChartMode('total')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                activeChartMode === 'total' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Total Volume
            </button>
            <button
              onClick={() => setActiveChartMode('forward')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                activeChartMode === 'forward' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Forward Packing
            </button>
            <button
              onClick={() => setActiveChartMode('return')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                activeChartMode === 'return' ? 'bg-white text-purple-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Return Inbound
            </button>
          </div>
        </div>

        {/* Stable Day Inspector Banner - Fixed height container to prevent layout shifting/flickering */}
        <div className="min-h-[46px] flex items-center">
          {hoveredPoint ? (
            <div className="w-full bg-blue-50/90 border border-blue-200 p-2.5 sm:px-3 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs transition-all animate-in fade-in duration-150">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
                <span className="font-bold text-slate-800">Date: {formatDDMMYYYY(hoveredPoint.day.date)} ({formatDDMM(hoveredPoint.day.date)})</span>
                <span className="text-slate-400">•</span>
                <span className="font-bold text-blue-700">Volume: {hoveredPoint.val} packages</span>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-slate-600 font-medium">
                <span>Forward: <strong className="text-blue-700">{hoveredPoint.day.types?.Forward || 0}</strong></span>
                <span>Return: <strong className="text-purple-700">{hoveredPoint.day.types?.Return || 0}</strong></span>
                <span>Amazon: <strong className="text-slate-800">{hoveredPoint.day.platforms?.Amazon || 0}</strong></span>
                <span>D2C: <strong className="text-slate-800">{hoveredPoint.day.platforms?.D2C || 0}</strong></span>
                <span>JioMart: <strong className="text-slate-800">{hoveredPoint.day.platforms?.JioMart || 0}</strong></span>
              </div>
            </div>
          ) : (
            <div className="w-full bg-slate-50/80 border border-slate-100 p-2.5 sm:px-3 rounded-xl flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                <span>Hover or drag along the curve to inspect daily platform and order details.</span>
              </span>
              <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                {points.length} data points
              </span>
            </div>
          )}
        </div>

        {/* Line Graph SVG Container - Fully Responsive & Enlarged */}
        {points.length > 0 ? (
          <div className="space-y-3 pt-1">
            <div className="w-full relative">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                preserveAspectRatio="none"
                className="w-full h-72 sm:h-80 md:h-[340px] select-none overflow-visible cursor-crosshair"
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (!rect.width || !points.length) return;
                  const mouseX = e.clientX - rect.left;
                  const svgX = (mouseX / rect.width) * chartWidth;
                  let closestIdx = 0;
                  let minDiff = Infinity;
                  for (let i = 0; i < points.length; i++) {
                    const diff = Math.abs(points[i].x - svgX);
                    if (diff < minDiff) {
                      minDiff = diff;
                      closestIdx = i;
                    }
                  }
                  setHoveredIndex(closestIdx);
                }}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <defs>
                  <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.32" />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.00" />
                  </linearGradient>
                  <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#2563EB" />
                    <stop offset="100%" stopColor="#4F46E5" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid Lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                  const y = padding.top + plotHeight - ratio * plotHeight;
                  const value = Math.round(ratio * maxDaily);
                  return (
                    <g key={i} className="pointer-events-none">
                      <line
                        x1={padding.left}
                        y1={y}
                        x2={padding.left + plotWidth}
                        y2={y}
                        stroke="#E2E8F0"
                        strokeDasharray={i === 0 ? '0' : '4 4'}
                        strokeWidth="1"
                      />
                      <text
                        x={padding.left - 10}
                        y={y + 4}
                        textAnchor="end"
                        className="text-[10px] fill-slate-400 font-mono font-medium"
                      >
                        {value}
                      </text>
                    </g>
                  );
                })}

                {/* Shaded Area Under Curve */}
                {areaPathD && (
                  <path d={areaPathD} fill="url(#areaGradient)" className="pointer-events-none" />
                )}

                {/* Main Line Stroke */}
                {linePathD && (
                  <path
                    d={linePathD}
                    fill="none"
                    stroke="url(#lineGradient)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="pointer-events-none"
                  />
                )}

                {/* Active Hover Crosshair Line */}
                {hoveredPoint && (
                  <line
                    x1={hoveredPoint.x}
                    y1={padding.top}
                    x2={hoveredPoint.x}
                    y2={padding.top + plotHeight}
                    stroke="#3B82F6"
                    strokeDasharray="3 3"
                    strokeWidth="1.5"
                    className="pointer-events-none"
                  />
                )}

                {/* Data Points / Node Circles */}
                {points.map((p, idx) => {
                  const isHovered = hoveredIndex === idx;
                  return (
                    <g key={idx} className="pointer-events-none">
                      {/* Outer Glow Ring on Hover */}
                      {isHovered && (
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r="8"
                          fill="#93C5FD"
                          opacity="0.6"
                        />
                      )}

                      {/* Inner Node Circle */}
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={isHovered ? 5.5 : 3.5}
                        fill={isHovered ? '#1D4ED8' : '#3B82F6'}
                        stroke="#FFFFFF"
                        strokeWidth="2"
                      />

                      {/* Value Tag on Hover */}
                      {isHovered && (
                        <g>
                          <rect
                            x={p.x - 18}
                            y={p.y - 24}
                            width="36"
                            height="18"
                            rx="4"
                            fill="#1E293B"
                          />
                          <text
                            x={p.x}
                            y={p.y - 12}
                            textAnchor="middle"
                            className="text-[10px] fill-white font-mono font-bold"
                          >
                            {p.val}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* X-Axis Date Labels in DD-MM format */}
                {points.map((p, idx) => {
                  // Show dates intelligently based on count
                  const totalDays = points.length;
                  const step = totalDays > 30 ? Math.ceil(totalDays / 12) : totalDays > 14 ? 2 : 1;
                  const showLabel = idx === 0 || idx === totalDays - 1 || idx % step === 0;

                  if (!showLabel) return null;

                  return (
                    <text
                      key={`label-${idx}`}
                      x={p.x}
                      y={padding.top + plotHeight + 22}
                      textAnchor="middle"
                      className={`text-[11px] font-mono pointer-events-none font-medium ${
                        hoveredIndex === idx ? 'fill-blue-700 font-bold' : 'fill-slate-500'
                      }`}
                    >
                      {formatDDMM(p.day.date)}
                    </text>
                  );
                })}
              </svg>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 px-2 pt-2 border-t border-slate-100 font-medium">
              <span>Start: <strong className="text-slate-700 font-mono">{formatDDMMYYYY(dailyList[0]?.date)}</strong></span>
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                Peak Volume: <strong className="text-blue-700 font-mono font-bold">{actualPeakVolume} packings/day</strong>
              </span>
              <span>End: <strong className="text-slate-700 font-mono">{formatDDMMYYYY(dailyList[dailyList.length - 1]?.date)}</strong></span>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400 text-xs">
            No daily volume data available for the selected filters.
          </div>
        )}
      </div>

      {/* 2-Column Breakdown Grids */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Platform Share Breakdown */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-600" />
              Platform Volume Distribution
            </h3>
            <span className="text-[11px] font-mono text-slate-400 font-semibold">
              {data?.platforms?.length || 0} Platforms Active
            </span>
          </div>

          <div className="space-y-3">
            {data?.platforms?.length ? (
              data.platforms.map((p, i) => {
                const pct = totalPackings > 0 ? Math.round((p.count / totalPackings) * 100) : 0;
                const colors = [
                  'bg-blue-600',
                  'bg-purple-600',
                  'bg-emerald-600',
                  'bg-amber-600',
                  'bg-rose-600',
                ];
                const color = colors[i % colors.length];

                return (
                  <div key={i} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-semibold text-slate-700">
                      <span className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
                        {p.label}
                      </span>
                      <span className="font-mono text-slate-600 font-bold">
                        {p.count} <span className="text-slate-400 font-normal">({pct}%)</span>
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                      <div
                        className={`${color} h-full rounded-full transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-slate-400 p-4 text-center">No platform distribution logged yet.</p>
            )}
          </div>
        </div>

        {/* Forward vs Return Comparison */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-blue-600" />
              Recording Flow: Forward vs Return
            </h3>
            <span className="text-[11px] font-mono text-slate-400 font-semibold">Inbound / Outbound</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Forward Outbound */}
            <div className="bg-blue-50/70 border border-blue-100 p-4 rounded-xl space-y-1">
              <span className="text-[11px] font-bold text-blue-700 uppercase">Forward Packing</span>
              <div className="text-2xl font-bold text-blue-900">{forwardCount}</div>
              <div className="text-[11px] text-blue-600 font-medium">
                {totalPackings > 0 ? Math.round((forwardCount / totalPackings) * 100) : 0}% of all video recordings
              </div>
            </div>

            {/* Return Inbound */}
            <div className="bg-purple-50/70 border border-purple-100 p-4 rounded-xl space-y-1">
              <span className="text-[11px] font-bold text-purple-700 uppercase">Return Verification</span>
              <div className="text-2xl font-bold text-purple-900">{returnCount}</div>
              <div className="text-[11px] text-purple-600 font-medium">
                {totalPackings > 0 ? Math.round((returnCount / totalPackings) * 100) : 0}% of all video recordings
              </div>
            </div>
          </div>

          {/* Combined Visual Ratio Bar */}
          {totalPackings > 0 && (
            <div className="space-y-1.5 pt-2">
              <div className="flex justify-between text-xs font-semibold text-slate-600">
                <span>Forward ({Math.round((forwardCount / totalPackings) * 100)}%)</span>
                <span>Return ({Math.round((returnCount / totalPackings) * 100)}%)</span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
                <div
                  className="bg-blue-600 h-full"
                  style={{ width: `${(forwardCount / totalPackings) * 100}%` }}
                />
                <div
                  className="bg-purple-600 h-full"
                  style={{ width: `${(returnCount / totalPackings) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Operator Throughput Leaderboard */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-600" />
              Operator & Packer Productivity Leaderboard
            </h3>
            <p className="text-[11px] text-slate-500">
              Workstation activity ranked by total successful package recordings.
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {data?.users?.length ? (
            data.users.map((u, idx) => {
              const pct = totalPackings > 0 ? Math.round((u.count / totalPackings) * 100) : 0;
              const rankColor =
                idx === 0
                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                  : idx === 1
                  ? 'bg-slate-200 text-slate-800 border-slate-300'
                  : idx === 2
                  ? 'bg-orange-100 text-orange-800 border-orange-300'
                  : 'bg-slate-100 text-slate-600 border-slate-200';

              return (
                <div key={idx} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 border ${rankColor}`}
                    >
                      #{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {u.label || 'Unknown Operator'}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono truncate">
                        {u.label?.includes('@') ? u.label : `${u.label}@vms.local`}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <div className="text-xs font-bold text-slate-900 font-mono">
                        {u.count} <span className="text-slate-500 font-normal">packages</span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-medium">
                        {pct}% of system total
                      </div>
                    </div>

                    <div className="w-24 bg-slate-100 h-2 rounded-full overflow-hidden hidden sm:block">
                      <div className="bg-amber-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-xs text-slate-400 p-4 text-center">No operator records available.</p>
          )}
        </div>
      </div>
    </div>
  );
};
