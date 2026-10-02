import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Barcode,
  ShoppingBag,
  ArrowRight,
  X,
  Volume2,
  Sparkles,
  Zap,
  RotateCcw,
  Check,
  Video,
  Info,
  UserX,
  UserCheck
} from 'lucide-react';
import { OrderManifest, ManifestItem, User } from '../types';
import { logPackVerification, updateManifestStatus, normalizeBarcode } from '../lib/manifestStorage';
import { sharedScannerSync } from '../lib/phoneScannerSync';

interface PackVerificationModalProps {
  manifest: OrderManifest;
  currentUser: User | null;
  onVerifiedAndProceed: (verifiedItems: ManifestItem[]) => void;
  onCancel: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

// Web Audio API Synth for instant Zero-Latency Chime & Error Buzzer
function playAudioFeedback(type: 'success' | 'error' | 'celebrate') {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === 'success') {
      // Crisp 2-tone barcode chirp
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1760, ctx.currentTime); // A6
      osc.frequency.setValueAtTime(2637, ctx.currentTime + 0.06); // E7
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } else if (type === 'error') {
      // Low dual-frequency buzzer
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.setValueAtTime(140, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    } else if (type === 'celebrate') {
      // Triumphant chord
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.07);
        gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.07 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.07);
        osc.stop(ctx.currentTime + i * 0.07 + 0.45);
      });
    }
  } catch (_) {}
}

export const PackVerificationModal: React.FC<PackVerificationModalProps> = ({
  manifest,
  currentUser,
  onVerifiedAndProceed,
  onCancel,
  onShowToast,
}) => {
  // 1. Assignment Check
  const currentEmail = String(currentUser?.email || '').trim().toLowerCase();
  const assignedEmail = String(manifest.assignedPackerEmail || '').trim().toLowerCase();
  const isMasterOrAdmin =
    currentUser?.role === 'Master Admin' ||
    currentUser?.role === 'Admin' ||
    currentEmail === 'askroshan.2002@gmail.com';

  const isAssignedToCurrent = isMasterOrAdmin || (assignedEmail ? currentEmail === assignedEmail : true);

  // Live item verification state
  const [items, setItems] = useState<ManifestItem[]>(() => {
    return manifest.items.map((it) => ({
      ...it,
      scannedCount: 0,
    }));
  });

  const [gtinInput, setGtinInput] = useState<string>('');
  const [lastScannedCode, setLastScannedCode] = useState<string>('');
  const [scannedHistory, setScannedHistory] = useState<string[]>([]);
  const [mismatchError, setMismatchError] = useState<{
    scannedGtin: string;
    reason: 'NOT_IN_ORDER' | 'QUANTITY_EXCEEDED';
    message: string;
  } | null>(null);

  const [isFullyVerified, setIsFullyVerified] = useState<boolean>(false);
  const startTimeRef = useRef<number>(Date.now());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus input automatically
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Listen to mobile phone scanner events during verification!
  useEffect(() => {
    const unsubPhone = sharedScannerSync.onBarcode((code) => {
      if (code && isAssignedToCurrent && !isFullyVerified) {
        processGtinScan(code);
      }
    });

    return () => {
      unsubPhone();
    };
  }, [items, isAssignedToCurrent, isFullyVerified]);

  // If unauthorized: trigger warning tone once
  useEffect(() => {
    if (!isAssignedToCurrent) {
      playAudioFeedback('error');
    }
  }, [isAssignedToCurrent]);

  const processGtinScan = (rawScan: string) => {
    const cleanScan = normalizeBarcode(rawScan).toUpperCase() || rawScan.trim().toUpperCase();
    if (!cleanScan) return;

    setLastScannedCode(cleanScan);
    setScannedHistory((prev) => [cleanScan, ...prev.slice(0, 19)]);

    // Check if this GTIN or SKU or Name matches any item in the order
    const matchIndex = items.findIndex((it) => {
      const itGtin = normalizeBarcode(it.gtin).toUpperCase();
      const itSku = (it.sku || '').trim().toUpperCase();
      const itName = (it.productName || '').trim().toUpperCase();
      const itShort = (it.shortName || '').trim().toUpperCase();
      return (
        (itGtin && itGtin === cleanScan) ||
        (itSku && itSku === cleanScan) ||
        (itGtin && itGtin.replace(/^0+/, '') === cleanScan.replace(/^0+/, '')) ||
        (itName && itName === cleanScan) ||
        (itShort && itShort === cleanScan) ||
        (itName && cleanScan.length >= 4 && itName.includes(cleanScan))
      );
    });

    if (matchIndex === -1) {
      // MISMATCH: Scanned item is NOT in this order!
      playAudioFeedback('error');
      setMismatchError({
        scannedGtin: cleanScan,
        reason: 'NOT_IN_ORDER',
        message: `Product with Barcode "${cleanScan}" does NOT belong to Order ${manifest.orderId}!`,
      });

      // Log mismatch event
      logPackVerification({
        timestamp: new Date().toISOString(),
        orderId: manifest.orderId,
        platform: manifest.platform,
        assignedPacker: manifest.assignedPackerName,
        verifiedByPacker: currentUser?.name || 'Packer',
        packerEmail: currentUser?.email || 'packer@ops.local',
        processedBy: manifest.processedByName,
        status: 'MISMATCH',
        totalRequired: items.reduce((s, it) => s + it.quantity, 0),
        totalScanned: items.reduce((s, it) => s + it.scannedCount, 0),
        itemsSummary: items.map((it) => `${it.shortName}: ${it.scannedCount}/${it.quantity}`).join(', '),
        scannedGtinsLog: [cleanScan],
        durationSeconds: Math.round((Date.now() - startTimeRef.current) / 1000),
        notes: `Mismatch: Scanned ${cleanScan} which is not in order`,
      });

      return;
    }

    const targetItem = items[matchIndex];

    if (targetItem.scannedCount >= targetItem.quantity) {
      // OVER-PACK WARNING: Quantity already satisfied!
      playAudioFeedback('error');
      setMismatchError({
        scannedGtin: cleanScan,
        reason: 'QUANTITY_EXCEEDED',
        message: `Already scanned required quantity (${targetItem.quantity}/${targetItem.quantity}) for "${targetItem.shortName}". Do not pack excess items!`,
      });
      return;
    }

    // MATCH: Valid item scanned and quantity needed!
    playAudioFeedback('success');
    setMismatchError(null);

    const updatedItems = [...items];
    updatedItems[matchIndex] = {
      ...targetItem,
      scannedCount: targetItem.scannedCount + 1,
    };
    setItems(updatedItems);

    onShowToast(`✓ Scanned: ${targetItem.shortName} (${updatedItems[matchIndex].scannedCount}/${targetItem.quantity})`, 'success');

    // Check if ALL items in order have reached required quantity
    const allDone = updatedItems.every((it) => it.scannedCount >= it.quantity);
    if (allDone) {
      setIsFullyVerified(true);
      playAudioFeedback('celebrate');

      // Log full verification event
      logPackVerification({
        timestamp: new Date().toISOString(),
        orderId: manifest.orderId,
        platform: manifest.platform,
        assignedPacker: manifest.assignedPackerName,
        verifiedByPacker: currentUser?.name || 'Packer',
        packerEmail: currentUser?.email || 'packer@ops.local',
        processedBy: manifest.processedByName,
        status: 'MATCHED',
        totalRequired: updatedItems.reduce((s, it) => s + it.quantity, 0),
        totalScanned: updatedItems.reduce((s, it) => s + it.scannedCount, 0),
        itemsSummary: updatedItems.map((it) => `${it.shortName}: ${it.scannedCount}/${it.quantity}`).join(', '),
        scannedGtinsLog: [...scannedHistory, cleanScan],
        durationSeconds: Math.round((Date.now() - startTimeRef.current) / 1000),
        notes: 'All items matched and verified',
      });
    }
  };

  const handleManualScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gtinInput.trim()) return;
    const code = gtinInput.trim();
    setGtinInput('');
    processGtinScan(code);
  };

  const handleProceedToRecord = () => {
    onVerifiedAndProceed(items);
  };

  // ==========================================
  // CASE 1: UNAUTHORIZED ORDER ASSIGNMENT SCREEN
  // ==========================================
  if (!isAssignedToCurrent) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in select-none">
        <div className="w-full max-w-lg bg-slate-950 border-2 border-red-500 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(239,68,68,0.4)] text-center space-y-6">
          {/* Warning Icon Badge */}
          <div className="w-20 h-20 rounded-3xl bg-red-500/20 border-2 border-red-500 text-red-400 flex items-center justify-center mx-auto shadow-lg shadow-red-500/30 animate-pulse">
            <UserX className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <div className="inline-block px-3 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-widest bg-red-500/20 text-red-400 border border-red-500/40">
              🚨 Unauthorized Packing Attempt
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Order Not Assigned to You!
            </h2>
            <p className="text-xs text-slate-300 max-w-md mx-auto">
              This order has been pre-assigned to a different packing operator on the physical label. You cannot pack this order.
            </p>
          </div>

          {/* Detailed Assignment Breakdown Box */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 text-left space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">Order ID:</span>
              <span className="font-bold text-white text-sm tracking-wider">{manifest.orderId}</span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">Platform:</span>
              <span className="font-bold text-indigo-400">{manifest.platform}</span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-red-400 font-bold">Assigned Packer:</span>
              <span className="font-black text-red-300">
                {manifest.assignedPackerName} ({manifest.assignedPackerEmail})
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">Logged-in Operator:</span>
              <span className="font-bold text-amber-300">
                {currentUser?.name || 'Guest'} ({currentUser?.email || 'unauthorized'})
              </span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-400">Processed By:</span>
              <span className="text-slate-300 font-medium">
                {manifest.processedByName} • {new Date(manifest.processedAt).toLocaleTimeString()}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-3.5 bg-red-600 hover:bg-red-500 active:scale-95 text-white font-black text-sm rounded-xl shadow-lg shadow-red-600/30 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Dismiss &amp; Scan My Assigned Order</span>
            </button>
            <p className="text-[11px] text-slate-500 font-mono">
              Please hand this package to {manifest.assignedPackerName} or contact your supervisor.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // CASE 2: PHYSICAL GTIN VERIFICATION SCREEN
  // ==========================================
  const totalRequiredCount = items.reduce((s, it) => s + it.quantity, 0);
  const totalScannedCount = items.reduce((s, it) => s + it.scannedCount, 0);
  const progressPercent = Math.min(100, Math.round((totalScannedCount / totalRequiredCount) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in select-none overflow-y-auto">
      <div className="w-full max-w-3xl bg-slate-900 border-2 border-indigo-500/80 rounded-3xl p-5 sm:p-7 shadow-[0_0_50px_rgba(99,102,241,0.3)] text-white space-y-5 my-auto">
        {/* Header Bar */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl font-mono font-black text-white tracking-wider">
                {manifest.orderId}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                {manifest.platform}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 font-mono">
                <UserCheck className="w-3 h-3 text-emerald-400" />
                <span>Assigned to You</span>
              </span>
            </div>

            <p className="text-xs text-slate-400 font-mono">
              Processed by: <span className="text-slate-200 font-bold">{manifest.processedByName}</span> • Scan each physical product's GTIN barcode to verify
            </p>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
            title="Cancel Verification"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Overall Verification Progress Bar */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-2 shadow-inner">
          <div className="flex items-center justify-between text-xs font-mono font-bold">
            <span className="flex items-center gap-1.5 text-indigo-300">
              <Barcode className="w-4 h-4 text-indigo-400" />
              <span>GTIN Scan Progress</span>
            </span>
            <span
              className={`text-sm tracking-wider font-black ${
                isFullyVerified ? 'text-emerald-400' : 'text-white'
              }`}
            >
              {totalScannedCount} / {totalRequiredCount} Items Verified ({progressPercent}%)
            </span>
          </div>

          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isFullyVerified
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]'
                  : 'bg-gradient-to-r from-indigo-500 to-blue-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Mismatch Alert Screen (If Wrong Barcode Scanned) */}
        {mismatchError && (
          <div className="bg-red-950/90 border-2 border-red-500 rounded-2xl p-4 text-white flex items-start gap-3.5 shadow-lg shadow-red-500/20 animate-shake">
            <div className="w-10 h-10 rounded-xl bg-red-500 text-white flex items-center justify-center shrink-0 shadow-md">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-red-300 uppercase tracking-widest">
                  {mismatchError.reason === 'NOT_IN_ORDER'
                    ? '⚠️ Wrong Product Scanned'
                    : '⚠️ Excess Quantity Scanned'}
                </span>
                <span className="text-[10px] font-mono bg-red-900/60 px-2 py-0.5 rounded text-red-200">
                  Scanned: {mismatchError.scannedGtin}
                </span>
              </div>
              <p className="text-xs font-bold text-white">{mismatchError.message}</p>
              <p className="text-[11px] text-red-200/80">
                Please remove the wrong item and scan the correct product barcode listed below.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setMismatchError(null)}
              className="p-1 text-red-300 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Required Items Verification Cards */}
        <div className="space-y-3 max-h-[42vh] overflow-y-auto pr-1">
          {items.map((item, idx) => {
            const isItemDone = item.scannedCount >= item.quantity;

            return (
              <div
                key={item.id || idx}
                className={`border-2 rounded-2xl p-3.5 transition flex items-center gap-3.5 ${
                  isItemDone
                    ? 'bg-emerald-950/40 border-emerald-500/80 shadow-[0_0_15px_rgba(52,211,153,0.15)]'
                    : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Product Thumbnail */}
                <div className="relative shrink-0">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.shortName}
                      className="w-16 h-16 rounded-xl object-contain bg-slate-900 border border-slate-700 p-1"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-slate-800 text-slate-400 flex items-center justify-center">
                      <ShoppingBag className="w-6 h-6" />
                    </div>
                  )}

                  {isItemDone && (
                    <div className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow-md animate-bounce">
                      <Check className="w-4 h-4 stroke-[3]" />
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white truncate">
                      {item.shortName || item.productName}
                    </span>
                  </div>

                  <div className="text-xs text-slate-400 font-mono truncate">
                    SKU: <span className="text-slate-200">{item.sku || 'N/A'}</span>
                  </div>

                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="text-[11px] font-mono bg-slate-800 px-2 py-0.5 rounded text-indigo-300 border border-slate-700">
                      {item.gtin ? `GTIN: ${item.gtin}` : 'GTIN: Optional (Verify by SKU/Click)'}
                    </span>
                  </div>
                </div>

                {/* Quantity Progress Indicator & Action */}
                <div className="text-right shrink-0 space-y-1.5 flex flex-col items-end">
                  <div
                    className={`text-lg font-mono font-black ${
                      isItemDone ? 'text-emerald-400' : 'text-slate-200'
                    }`}
                  >
                    {item.scannedCount} / {item.quantity}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        isItemDone
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                      }`}
                    >
                      {isItemDone ? 'Verified' : 'Needs Scan'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Live Barcode Scanner Input (USB scanner, phone scanner, or manual typing) */}
        {!isFullyVerified ? (
          <form onSubmit={handleManualScanSubmit} className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>Ready for Barcode Scan (USB reader / Phone / Keyboard)</span>
              </span>
              <span>Wireless Phone Synced</span>
            </div>

            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={gtinInput}
                onChange={(e) => setGtinInput(e.target.value)}
                placeholder="Scan or type product GTIN barcode..."
                className="w-full pl-11 pr-24 py-3 bg-slate-950 border-2 border-indigo-500/50 rounded-2xl text-sm font-mono font-bold text-white placeholder-slate-600 focus:outline-none focus:border-indigo-400 shadow-inner"
              />
              <Barcode className="w-5 h-5 text-indigo-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <button
                type="submit"
                disabled={!gtinInput.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white font-bold text-xs rounded-xl transition cursor-pointer shadow-xs"
              >
                Verify
              </button>
            </div>
          </form>
        ) : (
          /* All Items Matched Celebration Card */
          <div className="bg-gradient-to-r from-emerald-950/80 to-teal-950/80 border-2 border-emerald-400 rounded-2xl p-5 text-center space-y-3 shadow-[0_0_30px_rgba(52,211,153,0.3)] animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/40 animate-bounce">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <div>
              <h3 className="text-xl font-black text-white tracking-tight">
                All Products 100% Verified!
              </h3>
              <p className="text-xs text-emerald-300 font-mono">
                Exact items and quantities matched against the manifest. Proceed to packing video recording.
              </p>
            </div>

            <button
              type="button"
              onClick={handleProceedToRecord}
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-base rounded-2xl shadow-xl shadow-emerald-500/30 transition flex items-center justify-center gap-2.5 cursor-pointer"
            >
              <Video className="w-5 h-5" />
              <span>Start Packing Video Recording</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
