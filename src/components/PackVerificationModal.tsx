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
  UserCheck,
  Plus
} from 'lucide-react';
import { OrderManifest, ManifestItem, User } from '../types';
import {
  logPackVerification,
  updateManifestStatus,
  normalizeBarcode,
  isBarcodeEqual,
  findProductInCatalog,
  getStoredGtinCatalog
} from '../lib/manifestStorage';
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
      // Low buzz for mismatch
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.setValueAtTime(130, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.32);
    } else if (type === 'celebrate') {
      // 3-note celebration chime
      const now = ctx.currentTime;
      [1046.5, 1318.5, 1567.98, 2093.0].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.18, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.28);
      });
    }
  } catch (e) {
    // Audio context may be restricted before user interaction
  }
}

export const PackVerificationModal: React.FC<PackVerificationModalProps> = ({
  manifest,
  currentUser,
  onVerifiedAndProceed,
  onCancel,
  onShowToast,
}) => {
  // Verification progress tracking per item
  const [items, setItems] = useState<Array<ManifestItem & { scannedCount: number }>>(() =>
    (manifest.items || []).map((it) => ({
      ...it,
      scannedCount: 0,
    }))
  );

  const [gtinInput, setGtinInput] = useState<string>('');
  const [mismatchError, setMismatchError] = useState<{
    scannedGtin: string;
    reason: 'NOT_IN_ORDER' | 'QUANTITY_EXCEEDED';
    message: string;
    matchedCatalogProduct?: any;
  } | null>(null);

  const [isFullyVerified, setIsFullyVerified] = useState<boolean>(false);
  const [scannedHistory, setScannedHistory] = useState<string[]>([]);
  const [lastScannedCode, setLastScannedCode] = useState<string>('');
  const [adminOverride, setAdminOverride] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  // Check if order is already packed
  const isOrderPacked = manifest.status === 'Packed' || (manifest as any).status === 'Completed';

  // Check if current user is directly assigned for this order
  const isDirectlyAssigned =
    !manifest.assignedPackerEmail ||
    !currentUser?.email ||
    manifest.assignedPackerEmail.toLowerCase().trim() === currentUser.email.toLowerCase().trim();

  const isAssignedToCurrent = isDirectlyAssigned || adminOverride;

  // Keep input focused so USB scanner keystrokes land automatically
  useEffect(() => {
    if (isAssignedToCurrent && !isFullyVerified) {
      inputRef.current?.focus();
    }
  }, [items, isAssignedToCurrent, isFullyVerified]);

  // If unauthorized: trigger warning tone once
  useEffect(() => {
    if (!isAssignedToCurrent) {
      playAudioFeedback('error');
    }
  }, [isAssignedToCurrent]);

  const applyItemMatch = (targetIndex: number, codeUsed: string) => {
    const targetItem = items[targetIndex];

    if (targetItem.scannedCount >= targetItem.quantity) {
      // OVER-PACK WARNING: Quantity already satisfied!
      playAudioFeedback('error');
      setMismatchError({
        scannedGtin: codeUsed,
        reason: 'QUANTITY_EXCEEDED',
        message: `Already scanned required quantity (${targetItem.quantity}/${targetItem.quantity}) for "${targetItem.shortName || targetItem.productName}". Do not pack excess items!`,
      });
      return;
    }

    // MATCH: Valid item scanned and quantity needed!
    playAudioFeedback('success');
    setMismatchError(null);

    const updatedItems = [...items];
    updatedItems[targetIndex] = {
      ...targetItem,
      scannedCount: targetItem.scannedCount + 1,
    };
    setItems(updatedItems);

    onShowToast(`✓ Verified: ${targetItem.shortName || targetItem.productName} (${updatedItems[targetIndex].scannedCount}/${targetItem.quantity})`, 'success');

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
        itemsSummary: updatedItems.map((it) => `${it.shortName || it.productName}: ${it.scannedCount}/${it.quantity}`).join(', '),
        scannedGtinsLog: [...scannedHistory, codeUsed],
        durationSeconds: Math.round((Date.now() - startTimeRef.current) / 1000),
        notes: 'All items matched and verified',
      });
    }
  };

  const processGtinScan = (rawScan: string) => {
    const cleanScan = normalizeBarcode(rawScan).toUpperCase() || rawScan.trim().toUpperCase();
    if (!cleanScan) return;

    setLastScannedCode(cleanScan);
    setScannedHistory((prev) => [cleanScan, ...prev.slice(0, 19)]);

    // 0. Check if the scanned code is the Shipping Label / Order ID itself
    if (
      isBarcodeEqual(cleanScan, manifest.orderId) ||
      cleanScan === manifest.orderId.toUpperCase() ||
      manifest.orderId.toUpperCase().replace(/[-_\s]/g, '') === cleanScan.replace(/[-_\s]/g, '')
    ) {
      playAudioFeedback('success');
      onShowToast(
        `✓ Shipping Label [${manifest.orderId}] Confirmed! Please scan each physical product barcode (GTIN).`,
        'success'
      );
      setMismatchError(null);
      return;
    }

    // 1. Direct match check against item list (GTIN, SKU, Product Name, Short Name)
    let matchIndex = items.findIndex((it) => {
      const itGtin = normalizeBarcode(it.gtin);
      const itSku = (it.sku || '').trim();
      const itName = (it.productName || '').trim();
      const itShort = (it.shortName || '').trim();

      return (
        isBarcodeEqual(itGtin, cleanScan) ||
        isBarcodeEqual(itSku, cleanScan) ||
        isBarcodeEqual(itName, cleanScan) ||
        isBarcodeEqual(itShort, cleanScan) ||
        (itName && itName.toUpperCase() === cleanScan) ||
        (itShort && itShort.toUpperCase() === cleanScan) ||
        (itName && cleanScan.length >= 4 && itName.toUpperCase().includes(cleanScan))
      );
    });

    // 2. Fallback check: look up barcode in Master GTIN Catalog to resolve linked SKU / GTIN / Names
    let catalogProdMatch: any = null;
    if (matchIndex === -1) {
      const catalogProd = findProductInCatalog(cleanScan);
      if (catalogProd) {
        catalogProdMatch = catalogProd;
        matchIndex = items.findIndex((it) => {
          const itGtin = normalizeBarcode(it.gtin);
          const itSku = (it.sku || '').trim();
          return (
            isBarcodeEqual(itGtin, catalogProd.gtin) ||
            isBarcodeEqual(itSku, catalogProd.sku) ||
            isBarcodeEqual(itSku, catalogProd.gtin) ||
            isBarcodeEqual(itGtin, catalogProd.sku) ||
            (it.shortName && catalogProd.shortName && it.shortName.trim().toUpperCase() === catalogProd.shortName.trim().toUpperCase()) ||
            (it.productName && catalogProd.productName && it.productName.trim().toUpperCase() === catalogProd.productName.trim().toUpperCase())
          );
        });
      }
    }

    if (matchIndex === -1) {
      // MISMATCH: Scanned item is NOT in this order!
      playAudioFeedback('error');
      setMismatchError({
        scannedGtin: cleanScan,
        reason: 'NOT_IN_ORDER',
        message: `Product with Barcode "${cleanScan}" does NOT belong to Order ${manifest.orderId}!`,
        matchedCatalogProduct: catalogProdMatch,
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
        itemsSummary: items.map((it) => `${it.shortName || it.productName}: ${it.scannedCount}/${it.quantity}`).join(', '),
        scannedGtinsLog: [cleanScan],
        durationSeconds: Math.round((Date.now() - startTimeRef.current) / 1000),
        notes: `Mismatch: Scanned ${cleanScan} which is not in order`,
      });

      return;
    }

    applyItemMatch(matchIndex, cleanScan);
  };

  // Hardware Scanner & Wireless Phone Scanner real-time listener
  useEffect(() => {
    const unsubPhone = sharedScannerSync.onBarcode((code) => {
      processGtinScan(code);
    });

    return () => {
      unsubPhone();
    };
  }, [items, isFullyVerified]);

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
  // CASE 0: ORDER ALREADY PACKED & VERIFIED
  // ==========================================
  if (isOrderPacked) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in select-none">
        <div className="w-full max-w-lg bg-slate-950 border-2 border-emerald-500 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(16,185,129,0.3)] text-center space-y-5 text-white">
          <div className="w-20 h-20 rounded-3xl bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/30">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-1.5">
            <div className="inline-block px-3 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-widest bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
              ✓ Order Already Packed
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Packing is Already Complete!
            </h2>
            <p className="text-xs text-slate-300 max-w-md mx-auto">
              This order has already been physically verified, packed, and recorded. No further packing action is required.
            </p>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 text-left space-y-2.5 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">Order ID:</span>
              <span className="font-bold text-white text-sm">{manifest.orderId}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">Platform:</span>
              <span className="font-bold text-indigo-400">{manifest.platform}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">Assigned Packer:</span>
              <span className="font-bold text-slate-300">{manifest.assignedPackerName || manifest.assignedPackerEmail || 'Unassigned'}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">Packed By:</span>
              <span className="font-bold text-emerald-400">{manifest.packedByName || manifest.assignedPackerName || 'Packer'}</span>
            </div>
            {manifest.packedAt && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Packed At:</span>
                <span className="font-bold text-slate-300">{new Date(manifest.packedAt).toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-xl transition cursor-pointer border border-slate-700"
            >
              Close &amp; Return to Workstation
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // CASE 1: UNAUTHORIZED ORDER ASSIGNMENT SCREEN
  // ==========================================
  if (!isAssignedToCurrent) {
    const isUserAdmin = currentUser?.role === 'Admin' || currentUser?.role === 'Master Admin';

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in select-none">
        <div className="w-full max-w-lg bg-slate-950 border-2 border-red-500 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(239,68,68,0.4)] text-center space-y-6">
          {/* Warning Icon Badge */}
          <div className="w-20 h-20 rounded-3xl bg-red-500/20 border-2 border-red-500 text-red-400 flex items-center justify-center mx-auto shadow-lg shadow-red-500/30 animate-pulse">
            <UserX className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <div className="inline-block px-3 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-widest bg-red-500/20 text-red-400 border border-red-500/40">
              🚨 Order Assigned to Another Packer
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Order Not Assigned to You!
            </h2>
            <p className="text-xs text-slate-300 max-w-md mx-auto">
              This order has been pre-assigned to <strong className="text-white font-bold">{manifest.assignedPackerName || manifest.assignedPackerEmail}</strong>. You cannot pack this order.
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
              <span className="text-slate-400">Assigned Packer:</span>
              <span className="font-bold text-amber-400">{manifest.assignedPackerName || manifest.assignedPackerEmail}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Your Account:</span>
              <span className="font-bold text-slate-300">{currentUser?.name} ({currentUser?.email})</span>
            </div>
          </div>

          <div className="pt-2 flex flex-col gap-2">
            {isUserAdmin && (
              <button
                type="button"
                onClick={() => setAdminOverride(true)}
                className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl transition shadow-lg shadow-amber-600/20 cursor-pointer"
              >
                Supervisor Override: Pack on Behalf of {manifest.assignedPackerName || 'User'}
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition cursor-pointer border border-slate-700"
            >
              Return to Packing Station
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // CASE 2: ACTIVE GTIN SCAN VERIFICATION
  // ==========================================
  const totalItemsRequired = items.reduce((acc, it) => acc + it.quantity, 0);
  const totalItemsScanned = items.reduce((acc, it) => acc + it.scannedCount, 0);
  const pendingItems = items.filter((it) => it.scannedCount < it.quantity);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-2xl bg-slate-900 border-2 border-indigo-500/80 rounded-3xl p-6 sm:p-7 shadow-[0_0_60px_rgba(99,102,241,0.3)] space-y-5 text-white flex flex-col max-h-[92vh]">
        {/* Header Bar */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/50 text-indigo-400 flex items-center justify-center shrink-0 shadow-inner">
              <ShieldCheck className="w-7 h-7" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight text-white">
                  Physical Product Barcode Verification
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {manifest.platform}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Order <strong className="text-white font-bold">{manifest.orderId}</strong> • Assigned to: <span className="text-indigo-400 font-semibold">{manifest.assignedPackerName || manifest.assignedPackerEmail || 'Unassigned'}{isDirectlyAssigned ? ' (You)' : ''}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Real-Time Progress Bar */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono font-bold">
            <span className="text-slate-300 flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>Pack Items Scanned</span>
            </span>
            <span className="text-indigo-400 text-sm">
              {totalItemsScanned} / {totalItemsRequired} Units
            </span>
          </div>

          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isFullyVerified
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                  : 'bg-gradient-to-r from-indigo-500 to-blue-500'
              }`}
              style={{
                width: `${Math.min(100, Math.round((totalItemsScanned / (totalItemsRequired || 1)) * 100))}%`,
              }}
            />
          </div>
        </div>

        {/* Mismatch Alert Screen (If Wrong Barcode Scanned) */}
        {mismatchError && (
          <div className="bg-red-950/90 border-2 border-red-500 rounded-2xl p-4 text-white flex items-start gap-3.5 shadow-lg shadow-red-500/20 animate-shake">
            <div className="w-10 h-10 rounded-xl bg-red-500 text-white flex items-center justify-center shrink-0 shadow-md">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-red-300 uppercase tracking-widest">
                  {mismatchError.reason === 'NOT_IN_ORDER'
                    ? '⚠️ Scanned Code Not Matched'
                    : '⚠️ Excess Quantity Scanned'}
                </span>
                <span className="text-[10px] font-mono bg-red-900/60 px-2 py-0.5 rounded text-red-200">
                  Scanned: {mismatchError.scannedGtin}
                </span>
              </div>
              <p className="text-xs font-bold text-white">{mismatchError.message}</p>
              
              {/* Quick 1-Click Match Option if operator is holding an unverified item */}
              {pendingItems.length > 0 && (
                <div className="bg-red-900/40 rounded-xl p-2.5 border border-red-500/30 space-y-1.5">
                  <p className="text-[11px] text-red-200 font-semibold">
                    Holding the correct physical product? Choose the matching item below:
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {pendingItems.map((pi) => {
                      const idx = items.findIndex((it) => it.id === pi.id || it.sku === pi.sku);
                      return (
                        <button
                          key={pi.id || pi.sku}
                          type="button"
                          onClick={() => applyItemMatch(idx, mismatchError.scannedGtin)}
                          className="px-2.5 py-1 bg-white/10 hover:bg-white/20 active:scale-95 border border-white/20 rounded-lg text-xs font-bold text-white transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Accept for: {pi.shortName || pi.productName} ({pi.scannedCount}/{pi.quantity})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
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
                      alt={item.shortName || item.productName}
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
                      {item.gtin ? `GTIN: ${item.gtin}` : 'GTIN: Optional (Verify by Barcode/Click)'}
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
                    {!isItemDone ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/50">
                        Pending Scan
                      </span>
                    ) : (
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/50">
                        Verified
                      </span>
                    )}
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
