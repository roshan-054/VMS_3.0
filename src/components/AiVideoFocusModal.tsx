import React, { useState } from 'react';
import {
  Sparkles,
  X,
  Scan,
  FileText,
  Package,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Sliders,
  ArrowRight,
  ShieldCheck,
  Maximize2,
  ExternalLink,
  Loader2,
  Check,
  Zap,
  TrendingUp
} from 'lucide-react';
import { sharedAiFocusEngine, getStoredAiFocusCalibration, saveStoredAiFocusCalibration, AiFocusCalibration } from '../lib/aiFocusEngine';

interface AiVideoFocusModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId?: string;
  fileId?: string;
  driveLink?: string;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  onAppliedCalibration?: () => void;
}

interface AnalysisResult {
  overallClarityRating: string;
  executiveSummary: string;
  focusShifts: Array<{
    timestampSec: number;
    focusTarget: string;
    description: string;
    clarityScore: number;
    isOptimalFocus?: boolean;
    recommendation?: string;
  }>;
  labelAnalysis: {
    detected: boolean;
    timestampSec?: number;
    barcodeReadable: boolean;
    clarityScore: number;
    notes: string;
  };
  invoiceAnalysis: {
    detected: boolean;
    timestampSec?: number;
    legibilityScore: number;
    notes: string;
  };
  productPackingAnalysis: {
    detected: boolean;
    timestampSec?: number;
    productIdentifiable: boolean;
    packagingQualityScore: number;
    notes: string;
  };
  suggestedCalibration: {
    autoHardwareFocus?: boolean;
    enableClarityEnhance?: boolean;
    focusHoldTime?: number;
    focusSensitivity?: string;
  };
}

export const AiVideoFocusModal: React.FC<AiVideoFocusModalProps> = ({
  isOpen,
  onClose,
  orderId = '',
  fileId = '',
  driveLink = '',
  onShowToast,
  onAppliedCalibration,
}) => {
  const [targetOrderId, setTargetOrderId] = useState(orderId);
  const [targetFileId, setTargetFileId] = useState(fileId);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [calibrationApplied, setCalibrationApplied] = useState(false);
  const [activeTab, setActiveTab] = useState<'timeline' | 'details' | 'calibration'>('timeline');

  // Keep synced with incoming props
  React.useEffect(() => {
    if (orderId) setTargetOrderId(orderId);
    if (fileId) setTargetFileId(fileId);
  }, [orderId, fileId]);

  if (!isOpen) return null;

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setCalibrationApplied(false);
    try {
      // Call backend Gemini AI video analyzer
      const response = await fetch('/api/ai/analyze-packing-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: targetOrderId || 'Packing Video Sample',
          fileId: targetFileId || '',
          driveLink: driveLink || '',
          metadata: { timestamp: new Date().toISOString() },
        }),
      });

      const res = await response.json();
      if (!res.success) {
        throw new Error(res.error || 'Failed to complete AI video analysis');
      }

      setAnalysis(res.analysis);
      onShowToast('AI Focus & Area Identification complete!', 'success');
    } catch (err: any) {
      console.error('AI Analysis failed:', err);
      onShowToast(`Analysis note: ${err.message || 'Error running analysis'}`, 'error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyCalibration = () => {
    if (!analysis || !analysis.suggestedCalibration) return;
    const c = analysis.suggestedCalibration;
    const updated: Partial<AiFocusCalibration> = {
      autoHardwareFocus: c.autoHardwareFocus !== false,
      enableClarityEnhance: c.enableClarityEnhance !== false,
      holdTimeMs: c.focusHoldTime || 1400,
    };
    sharedAiFocusEngine.updateCalibration(updated);
    setCalibrationApplied(true);
    onShowToast('Calibrated AI Auto-Focus settings applied to live camera engine!', 'success');
    if (onAppliedCalibration) onAppliedCalibration();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 text-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-950/80 via-slate-900 to-indigo-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 flex items-center justify-center font-bold shadow-md shadow-emerald-500/20">
              <Sparkles className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-100">
                  AI Focus & Area Identification Analyzer
                </h3>
                <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-semibold">
                  Gemini 3.8 Vision
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Analyzes uploaded Drive packing videos to detect labels, invoices, and product packaging
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1 text-slate-200">
          {/* Target Video Selector Bar */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-center gap-3">
            <div className="flex-1 w-full space-y-1">
              <label className="text-[11px] font-mono font-semibold text-slate-400 flex items-center gap-1.5">
                <Scan className="w-3.5 h-3.5 text-emerald-400" />
                Target Order ID or Drive Video Reference:
              </label>
              <input
                type="text"
                value={targetOrderId}
                onChange={(e) => setTargetOrderId(e.target.value)}
                placeholder="e.g. 402-9831201-1928371 or OD19283123"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            <button
              type="button"
              disabled={isAnalyzing}
              onClick={runAnalysis}
              className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shrink-0 sm:self-end mt-1 sm:mt-0"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  <span>Analyzing with Gemini…</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-slate-950" />
                  <span>{analysis ? 'Re-Analyze Video' : 'Analyze Video Focus'}</span>
                </>
              )}
            </button>
          </div>

          {/* If No Analysis Yet: Explanation */}
          {!analysis && !isAnalyzing && (
            <div className="p-8 text-center bg-slate-950/40 rounded-2xl border border-dashed border-slate-800 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400 shadow-inner">
                <Sliders className="w-7 h-7" />
              </div>
              <div className="max-w-md mx-auto space-y-2">
                <h4 className="text-sm font-semibold text-slate-100">
                  Automatic AI Focus Area Calibration
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The AI analyzes packing videos from Google Drive to inspect whether the operator properly showed the shipping label, invoice, and product. It computes recommended auto-focus point coordinates and clarity enhancements for the camera.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-left">
                <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
                    <Scan className="w-3.5 h-3.5" />
                    <span>1. Shipping Label</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Detects when AWB/barcode is shown, pulls hardware lens focus on the label, and checks barcode line clarity.
                  </p>
                </div>

                <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-1">
                  <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs">
                    <FileText className="w-3.5 h-3.5" />
                    <span>2. Invoice / Bill</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Detects paperwork presentation, centers focus on the document, and verifies text legibility.
                  </p>
                </div>

                <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs">
                    <Package className="w-3.5 h-3.5" />
                    <span>3. Product Packing</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Pulls focus on product insertion, polybag sealing, box taping, and packing table actions.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Loading Indicator */}
          {isAnalyzing && (
            <div className="p-12 text-center space-y-4">
              <Loader2 className="w-10 h-10 animate-spin text-emerald-400 mx-auto" />
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-slate-200">
                  Gemini 3.8 Analyzing Video Focus Shifts…
                </h4>
                <p className="text-xs text-slate-400">
                  Evaluating label scanability, invoice legibility, and product packing framing
                </p>
              </div>
            </div>
          )}

          {/* Analysis Results Display */}
          {analysis && !isAnalyzing && (
            <div className="space-y-5">
              {/* Executive Summary Card */}
              <div className="p-4 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-300">Overall Video Clarity:</span>
                    <span
                      className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border ${
                        analysis.overallClarityRating.toLowerCase().includes('excellent')
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : analysis.overallClarityRating.toLowerCase().includes('good')
                          ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      }`}
                    >
                      {analysis.overallClarityRating}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleApplyCalibration}
                      disabled={calibrationApplied}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-md ${
                        calibrationApplied
                          ? 'bg-emerald-600 text-white'
                          : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                      }`}
                    >
                      {calibrationApplied ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Calibration Applied</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5" />
                          <span>Apply AI Calibration to Camera</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed font-sans">
                  {analysis.executiveSummary}
                </p>
              </div>

              {/* Three Pillars Focus Health Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* 1. Label */}
                <div className="p-3.5 bg-slate-950 rounded-xl border border-emerald-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
                      <Scan className="w-4 h-4" />
                      <span>Shipping Label</span>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded">
                      {analysis.labelAnalysis.clarityScore}/100
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">Barcode Scanable:</span>
                      <span className={analysis.labelAnalysis.barcodeReadable ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                        {analysis.labelAnalysis.barcodeReadable ? 'Yes (Sharp)' : 'Needs Improvement'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-tight">
                      {analysis.labelAnalysis.notes}
                    </p>
                  </div>
                </div>

                {/* 2. Invoice */}
                <div className="p-3.5 bg-slate-950 rounded-xl border border-cyan-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs">
                      <FileText className="w-4 h-4" />
                      <span>Invoice / Bill</span>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-cyan-300 bg-cyan-500/20 px-1.5 py-0.5 rounded">
                      {analysis.invoiceAnalysis.legibilityScore}/100
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">Document Detected:</span>
                      <span className={analysis.invoiceAnalysis.detected ? 'text-cyan-400 font-bold' : 'text-slate-500'}>
                        {analysis.invoiceAnalysis.detected ? 'Yes (Verified)' : 'Not Shown'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-tight">
                      {analysis.invoiceAnalysis.notes}
                    </p>
                  </div>
                </div>

                {/* 3. Product Packing */}
                <div className="p-3.5 bg-slate-950 rounded-xl border border-amber-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs">
                      <Package className="w-4 h-4" />
                      <span>Product Packing</span>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded">
                      {analysis.productPackingAnalysis.packagingQualityScore}/100
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">Product Verified:</span>
                      <span className={analysis.productPackingAnalysis.productIdentifiable ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                        {analysis.productPackingAnalysis.productIdentifiable ? 'Yes (Identifiable)' : 'Partial View'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-tight">
                      {analysis.productPackingAnalysis.notes}
                    </p>
                  </div>
                </div>
              </div>

              {/* Focus Shifts Timeline */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider font-mono">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  Chronological Focus Shift Moments
                </h4>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {analysis.focusShifts && analysis.focusShifts.length > 0 ? (
                    analysis.focusShifts.map((shift, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex items-start justify-between gap-3 text-xs"
                      >
                        <div className="flex items-start gap-2.5">
                          <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 mt-0.5 shrink-0">
                            {shift.timestampSec ? `${shift.timestampSec.toFixed(1)}s` : `00:${String(idx * 3).padStart(2, '0')}`}
                          </span>
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[10px] font-mono font-bold px-2 py-0.2 rounded ${
                                  shift.focusTarget === 'LABEL'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : shift.focusTarget === 'INVOICE'
                                    ? 'bg-cyan-500/20 text-cyan-400'
                                    : shift.focusTarget === 'PRODUCT'
                                    ? 'bg-amber-500/20 text-amber-400'
                                    : 'bg-slate-700 text-slate-300'
                                }`}
                              >
                                {shift.focusTarget} FOCUS
                              </span>
                              <span className="font-semibold text-slate-200">
                                {shift.description}
                              </span>
                            </div>
                            {shift.recommendation && (
                              <p className="text-[11px] text-slate-400">
                                {shift.recommendation}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-[10px] font-mono font-bold text-slate-300 block">
                            Clarity: {shift.clarityScore}%
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-xs text-slate-500">
                      No discrete focus shifts detected.
                    </div>
                  )}
                </div>
              </div>

              {/* Recommended Calibration Profile */}
              <div className="p-4 bg-slate-950 rounded-xl border border-emerald-500/20 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="space-y-1">
                  <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                    <Sliders className="w-4 h-4" />
                    <span>Auto-Focus Calibration:</span>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] font-mono text-slate-300">
                    <span>Hardware Optical Focus: <b>Active</b></span>
                    <span>Clarity Optimization: <b>Enabled</b></span>
                    <span>Hold Time: <b>1.4s</b></span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleApplyCalibration}
                  disabled={calibrationApplied}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50"
                >
                  {calibrationApplied ? <Check className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                  {calibrationApplied ? 'Tuned & Saved' : 'Apply Calibration'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 font-mono">
            VMS 3.0 • Intelligent Real-Time Focus Engine
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
