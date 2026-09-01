import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Smartphone, 
  Flashlight, 
  FlashlightOff, 
  CheckCircle2, 
  Send, 
  Zap, 
  Barcode, 
  QrCode,
  X,
  Volume2,
  VolumeX,
  Radio,
  Sliders,
  ZoomIn,
  ZoomOut,
  Target,
  Layers,
  History,
  RotateCcw,
  Sparkles,
  Filter,
  Check,
  Crosshair,
  Settings2,
  HelpCircle,
  Vibrate,
  AlertTriangle,
  Play,
  Pause,
  Edit3
} from 'lucide-react';
import { sendBarcodeFromPhone, sendStationPing, fetchStationStatus } from '../lib/phoneSync';
import { 
  MultiFormatReader, 
  BarcodeFormat, 
  DecodeHintType, 
  RGBLuminanceSource, 
  BinaryBitmap, 
  HybridBinarizer 
} from '@zxing/library';

interface MobileScannerViewProps {
  stationSessionId: string;
  onExit?: () => void;
}

export type ScanTriggerMode = 'auto_continuous' | 'tap_trigger' | 'hold_to_scan';
export type ReticleType = 'linear_1d' | 'standard_box' | 'matrix_2d';
export type BarcodeFilterPreset = 'all' | 'amazon' | 'd2c' | 'jiomart';

export function MobileScannerView({ stationSessionId: initialSessionId, onExit }: MobileScannerViewProps) {
  const [stationSessionId, setStationSessionId] = useState(() => {
    if (initialSessionId && initialSessionId !== 'STATION-1') return initialSessionId;
    try {
      const stored = localStorage.getItem('vms_phone_target_station') || localStorage.getItem('vms_station_session_id');
      if (stored) return stored;
    } catch {}
    return initialSessionId || 'PK-1000';
  });
  const [isEditingStation, setIsEditingStation] = useState(false);
  const [stationInput, setStationInput] = useState(initialSessionId || 'PK-1000');

  const [manualBarcode, setManualBarcode] = useState('');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scannedHistory, setScannedHistory] = useState<Array<{ code: string; time: string }>>([]);
  const [scanCount, setScanCount] = useState(0);
  
  // Hardware controls
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [supportsTorch, setSupportsTorch] = useState(false);
  const [supportsZoom, setSupportsZoom] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);

  // Precision Scanner Controls - Auto-Continuous is default for instantaneous point-and-scan
  const [triggerMode, setTriggerMode] = useState<ScanTriggerMode>('auto_continuous');
  const [isHoldingTrigger, setIsHoldingTrigger] = useState(false);
  const [reticleType, setReticleType] = useState<ReticleType>('standard_box');
  const [minBarcodeLength, setMinBarcodeLength] = useState<number>(4);
  const [filterPreset, setFilterPreset] = useState<BarcodeFilterPreset>('all');
  const [ignoreRetailUpc, setIgnoreRetailUpc] = useState(false);

  // Modals & Drawers
  const [showHistory, setShowHistory] = useState(false);
  const [showFilterSettings, setShowFilterSettings] = useState(false);
  const [isCapturingSingle, setIsCapturingSingle] = useState(false);
  const [scanFeedbackMsg, setScanFeedbackMsg] = useState<string | null>(null);

  // Connection & Heartbeat
  const [isNetworkSending, setIsNetworkSending] = useState(false);
  const [isStationActive, setIsStationActive] = useState(true);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const zxingReaderRef = useRef<MultiFormatReader | null>(null);
  const isProcessingFrameRef = useRef(false);
  const lastScannedRef = useRef<string | null>(null);
  const lastScanTimeRef = useRef<number>(0);

  // Keep target station persisted in phone storage
  useEffect(() => {
    if (stationSessionId) {
      try {
        localStorage.setItem('vms_phone_target_station', stationSessionId);
      } catch {}
    }
  }, [stationSessionId]);

  // Initialize ZXing MultiFormatReader
  useEffect(() => {
    const hints = new Map();
    const formats = [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.ITF,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.PDF_417,
      BarcodeFormat.AZTEC,
    ];
    hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const reader = new MultiFormatReader();
    reader.setHints(hints);
    zxingReaderRef.current = reader;

    // Create offscreen canvas for ROI cropping
    const canvas = document.createElement('canvas');
    cropCanvasRef.current = canvas;
  }, []);

  // Heartbeat to Desktop Workstation every 4 seconds
  useEffect(() => {
    let active = true;
    const pingDesktop = async () => {
      if (!active) return;
      const t0 = performance.now();
      try {
        const res = await sendStationPing(stationSessionId, 'phone', 'Mobile Companion Phone');
        if (res && active) {
          const t1 = performance.now();
          setLastLatencyMs(Math.round(t1 - t0));
          setIsStationActive(Boolean(res.isDesktopActive));
        }
      } catch {}
    };

    pingDesktop();
    const interval = setInterval(pingDesktop, 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [stationSessionId]);

  // Audio feedback
  const playBeep = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {}
  }, [soundEnabled]);

  // Validate scanned barcode against precision filters to prevent unwanted barcodes
  const isValidBarcode = useCallback((code: string): { valid: boolean; reason?: string } => {
    const clean = code.trim();
    if (!clean) return { valid: false, reason: 'Empty code' };

    // 1. Min length check
    if (clean.length < minBarcodeLength) {
      return { valid: false, reason: `Too short (<${minBarcodeLength} chars)` };
    }

    // 2. Ignore standard retail UPC/EAN if requested
    if (ignoreRetailUpc) {
      if (/^\d{8}$/.test(clean) || /^\d{12,13}$/.test(clean)) {
        return { valid: false, reason: 'Retail UPC/EAN Ignored' };
      }
    }

    // 3. Preset pattern filters
    const lower = clean.toLowerCase();
    if (filterPreset === 'amazon') {
      const isAmz = lower.startsWith('tba') || 
                    lower.startsWith('40') || 
                    lower.startsWith('17') || 
                    /^\d{3}-\d{7}-\d{7}$/.test(clean) || 
                    lower.includes('amazon');
      if (!isAmz) return { valid: false, reason: 'Not an Amazon Order/AWB' };
    } else if (filterPreset === 'd2c') {
      const isD2c = lower.startsWith('#od') || 
                    lower.startsWith('od') || 
                    lower.startsWith('d2c') || 
                    /^\d{12,16}$/.test(clean) || 
                    lower.startsWith('sh-') || 
                    lower.startsWith('w-');
      if (!isD2c) return { valid: false, reason: 'Not a D2C Order/AWB' };
    } else if (filterPreset === 'jiomart') {
      const isJio = lower.startsWith('jm-') || 
                    lower.startsWith('jio') || 
                    lower.startsWith('r-') || 
                    lower.includes('jiomart');
      if (!isJio) return { valid: false, reason: 'Not a JioMart Order' };
    }

    return { valid: true };
  }, [minBarcodeLength, ignoreRetailUpc, filterPreset]);

  // Transmit barcode to desktop workstation
  const handleProcessBarcode = useCallback(async (code: string) => {
    const clean = code.trim();
    const check = isValidBarcode(clean);
    if (!check.valid) {
      if (check.reason) {
        setScanFeedbackMsg(`Ignored: ${check.reason}`);
        setTimeout(() => setScanFeedbackMsg(null), 2000);
      }
      return;
    }

    const now = Date.now();
    // Cooldown check (1.8s) for identical barcode
    if (clean === lastScannedRef.current && (now - lastScanTimeRef.current < 1800)) {
      return;
    }

    lastScannedRef.current = clean;
    lastScanTimeRef.current = now;
    setLastScanned(clean);
    setScanCount(prev => prev + 1);
    setIsNetworkSending(true);

    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setScannedHistory(prev => [{ code: clean, time: nowStr }, ...prev.slice(0, 24)]);

    if (hapticsEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([60, 40, 60]);
    }
    playBeep();

    try {
      await sendBarcodeFromPhone(stationSessionId, clean, 'Mobile Scanner App');
    } catch (err) {
      console.warn('Send barcode error:', err);
    } finally {
      setIsNetworkSending(false);
    }

    // Cooldown before permitting the exact same barcode again
    setTimeout(() => {
      if (lastScannedRef.current === clean) {
        lastScannedRef.current = null;
      }
    }, 2200);
  }, [stationSessionId, hapticsEnabled, playBeep, isValidBarcode]);

  // Start mobile camera
  useEffect(() => {
    let isMounted = true;

    const startMobileCamera = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!isMounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const track = stream.getVideoTracks()[0];
        if (track) {
          const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as any;
          if (capabilities.torch) setSupportsTorch(true);
          if (capabilities.zoom) setSupportsZoom(true);
        }
      } catch (err: any) {
        console.warn('Camera stream error:', err);
      }
    };

    startMobileCamera();

    return () => {
      isMounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Set digital zoom
  const changeZoom = async (newZoom: number) => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const clamped = Math.max(1, Math.min(3, newZoom));
      const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as any;
      if (capabilities.zoom) {
        await (track as any).applyConstraints({
          advanced: [{ zoom: clamped }],
        });
      }
      setZoomLevel(clamped);
    } catch {}
  };

  // Toggle Torch
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const nextState = !isTorchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setIsTorchOn(nextState);
    } catch {}
  };

  // Single Frame Decoder Core (Extracts & decodes region of interest + full frame fallback)
  const decodeReticleRegion = useCallback(async (): Promise<string | null> => {
    const video = videoRef.current;
    const cropCanvas = cropCanvasRef.current;
    if (!video || !cropCanvas || video.readyState < 2) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    // Viewfinder geometry
    let roiWidthFactor = 0.88;
    let roiHeightFactor = 0.42;

    if (reticleType === 'linear_1d') {
      roiWidthFactor = 0.92;
      roiHeightFactor = 0.26;
    } else if (reticleType === 'matrix_2d') {
      roiWidthFactor = 0.72;
      roiHeightFactor = 0.58;
    }

    const cropW = Math.floor(vw * roiWidthFactor);
    const cropH = Math.floor(vh * roiHeightFactor);
    const cropX = Math.floor((vw - cropW) / 2);
    const cropY = Math.floor((vh - cropH) / 2);

    cropCanvas.width = cropW;
    cropCanvas.height = cropH;

    const ctx = cropCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // Draw the cropped region into canvas
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    let detectedCode: string | null = null;

    // 1. Native Hardware BarcodeDetector API (Android Chrome & modern browsers)
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const detector = new (window as any).BarcodeDetector({
          formats: ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'qr_code', 'data_matrix', 'pdf417'],
        });
        const results = await detector.detect(cropCanvas);
        if (results && results.length > 0 && results[0].rawValue) {
          detectedCode = results[0].rawValue.trim();
        }
      } catch {}
    }

    // 2. High-performance ZXing MultiFormatReader (iOS Safari & universal fallback)
    if (!detectedCode && zxingReaderRef.current) {
      try {
        const imgData = ctx.getImageData(0, 0, cropW, cropH);
        // Pass Int32Array view of pixel buffer for 32-bit RGBLuminanceSource
        const int32Buffer = new Int32Array(imgData.data.buffer);
        const luminanceSource = new RGBLuminanceSource(int32Buffer, cropW, cropH);
        const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
        const result = zxingReaderRef.current.decode(binaryBitmap);
        if (result && result.getText()) {
          detectedCode = result.getText().trim();
        }
      } catch {}
    }

    return detectedCode;
  }, [reticleType]);

  // Execute Manual Trigger Scan
  const handleTriggerManualScan = useCallback(async () => {
    setIsCapturingSingle(true);
    try {
      const code = await decodeReticleRegion();
      if (code) {
        handleProcessBarcode(code);
      } else {
        setScanFeedbackMsg('No barcode detected in laser reticle. Aim and tap again.');
        if (hapticsEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(35);
        }
        setTimeout(() => setScanFeedbackMsg(null), 2000);
      }
    } catch {} finally {
      setTimeout(() => setIsCapturingSingle(false), 200);
    }
  }, [decodeReticleRegion, handleProcessBarcode, hapticsEnabled]);

  // High-Speed Continuous Auto-Scan Loop
  useEffect(() => {
    const isAutoActive = triggerMode === 'auto_continuous' || (triggerMode === 'hold_to_scan' && isHoldingTrigger);
    if (!isAutoActive) return;

    const interval = setInterval(async () => {
      if (isProcessingFrameRef.current) return;
      isProcessingFrameRef.current = true;

      try {
        const code = await decodeReticleRegion();
        if (code && code.length >= minBarcodeLength) {
          handleProcessBarcode(code);
        }
      } catch {} finally {
        isProcessingFrameRef.current = false;
      }
    }, 130); // ~7.7 frames/sec for instantaneous response

    return () => clearInterval(interval);
  }, [triggerMode, isHoldingTrigger, decodeReticleRegion, handleProcessBarcode, minBarcodeLength]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualBarcode.trim()) return;
    handleProcessBarcode(manualBarcode.trim());
    setManualBarcode('');
  };

  const handleSaveStationId = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = stationInput.trim().toUpperCase();
    if (clean) {
      setStationSessionId(clean);
      setIsEditingStation(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-hidden touch-none">
      {/* Mobile Top Header */}
      <header className="px-3.5 py-2.5 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold shadow-md shrink-0">
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              {isEditingStation ? (
                <form onSubmit={handleSaveStationId} className="flex items-center gap-1">
                  <input
                    type="text"
                    value={stationInput}
                    onChange={(e) => setStationInput(e.target.value.toUpperCase())}
                    className="bg-slate-800 border border-blue-400 rounded px-1.5 py-0.5 text-xs font-mono text-white w-24 focus:outline-none"
                    autoFocus
                  />
                  <button type="submit" className="px-1.5 py-0.5 bg-blue-600 text-[10px] font-bold rounded">
                    Save
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setStationInput(stationSessionId);
                    setIsEditingStation(true);
                  }}
                  className="flex items-center gap-1 text-xs font-mono font-bold text-white hover:text-blue-400"
                  title="Tap to change workstation code"
                >
                  <span>Station: <strong className="text-blue-400">{stationSessionId}</strong></span>
                  <Edit3 className="w-3 h-3 text-slate-400" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono">
              <span className={`w-1.5 h-1.5 rounded-full ${isStationActive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className={isStationActive ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                {isStationActive ? 'Live Paired' : 'Station Idle'}
              </span>
              {lastLatencyMs !== null && (
                <span className="text-slate-500">({lastLatencyMs}ms)</span>
              )}
            </div>
          </div>
        </div>

        {/* Top Action Buttons */}
        <div className="flex items-center gap-1.5">
          {supportsTorch && (
            <button
              type="button"
              onClick={toggleTorch}
              className={`p-2 rounded-xl border transition ${
                isTorchOn ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
              title="Toggle Flashlight"
            >
              {isTorchOn ? <Flashlight className="w-4 h-4" /> : <FlashlightOff className="w-4 h-4" />}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowFilterSettings(!showFilterSettings)}
            className={`p-2 rounded-xl border transition ${
              showFilterSettings ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}
            title="Precision & Filter Settings"
          >
            <Sliders className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className={`p-2 rounded-xl border transition ${
              showHistory ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}
            title="Scan History"
          >
            <History className="w-4 h-4" />
          </button>

          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="p-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
              title="Close Scanner"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Main Viewfinder Screen */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover"
        />

        {/* Outer Dimmed Mask Overlay (Crops only the active reticle window) */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          {/* Target Region of Interest (ROI) Laser Reticle */}
          <div 
            className={`relative transition-all duration-200 border-2 rounded-2xl flex flex-col justify-between p-2.5 ${
              lastScanned 
                ? 'border-emerald-400 bg-emerald-500/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.72),0_0_30px_rgba(52,211,153,0.6)]' 
                : isCapturingSingle 
                  ? 'border-white bg-white/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.72)]'
                  : 'border-red-500/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.72)]'
            }`}
            style={{
              width: reticleType === 'linear_1d' ? '92%' : reticleType === 'standard_box' ? '84%' : '72%',
              height: reticleType === 'linear_1d' ? '120px' : reticleType === 'standard_box' ? '180px' : '260px',
              maxWidth: '440px',
            }}
          >
            {/* Viewfinder Corner Targeting Brackets */}
            <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-red-400 rounded-tl-lg" />
            <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-red-400 rounded-tr-lg" />
            <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-red-400 rounded-bl-lg" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-red-400 rounded-br-lg" />

            {/* Top Label */}
            <div className="w-full flex justify-between items-center text-[10px] font-mono text-red-300 font-bold drop-shadow-md">
              <span className="flex items-center gap-1">
                <Crosshair className="w-3 h-3 text-red-400 animate-spin" />
                <span>{reticleType === 'linear_1d' ? 'PRECISION LASER STRIP' : reticleType === 'standard_box' ? 'ORDER LABEL BOX' : '2D QR BOX'}</span>
              </span>
              <span className="bg-black/70 px-2 py-0.5 rounded text-[9px] uppercase text-emerald-300 border border-white/10">
                {triggerMode === 'tap_trigger' ? 'Tap-to-Scan' : triggerMode === 'auto_continuous' ? 'Auto-Scan' : 'Hold-to-Scan'}
              </span>
            </div>

            {/* Red Laser Aiming Line across the center with optical pulse */}
            <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_14px_rgba(239,68,68,1)] animate-pulse" />

            {/* Bottom Instruction */}
            <div className="w-full flex justify-center">
              <span className="text-[10px] font-mono text-white bg-black/80 backdrop-blur-xs px-2.5 py-0.5 rounded-full border border-white/20 shadow-lg text-center truncate">
                {triggerMode === 'tap_trigger' 
                  ? 'Aim red laser on Order barcode & tap trigger' 
                  : 'Center barcode directly on red laser'}
              </span>
            </div>
          </div>
        </div>

        {/* Top On-Screen Controls (Zoom + Reticle Presets) */}
        <div className="absolute top-3 inset-x-3 flex justify-between items-center z-20 pointer-events-auto">
          {/* Reticle Shape Selector */}
          <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 p-1 rounded-xl flex gap-1 shadow-lg">
            <button
              type="button"
              onClick={() => setReticleType('linear_1d')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition ${
                reticleType === 'linear_1d' ? 'bg-red-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Narrow 1D Laser Strip (Best for isolating single barcode)"
            >
              <Barcode className="w-3.5 h-3.5" />
              1D Laser
            </button>
            <button
              type="button"
              onClick={() => setReticleType('standard_box')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition ${
                reticleType === 'standard_box' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Standard Label Box"
            >
              <Target className="w-3.5 h-3.5" />
              Standard
            </button>
            <button
              type="button"
              onClick={() => setReticleType('matrix_2d')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition ${
                reticleType === 'matrix_2d' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="2D Matrix / QR Code"
            >
              <QrCode className="w-3.5 h-3.5" />
              QR
            </button>
          </div>

          {/* Zoom Buttons */}
          <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 p-1 rounded-xl flex gap-1 shadow-lg">
            {[1, 1.5, 2, 2.5].map(z => (
              <button
                key={z}
                type="button"
                onClick={() => changeZoom(z)}
                className={`px-2 py-1 rounded-lg text-[11px] font-mono font-bold transition ${
                  zoomLevel === z ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                {z}x
              </button>
            ))}
          </div>
        </div>

        {/* Scan Feedback Warning / Notification */}
        {scanFeedbackMsg && (
          <div className="absolute top-16 inset-x-4 z-30 flex justify-center pointer-events-none animate-in fade-in duration-150">
            <div className="bg-amber-500/95 text-slate-950 px-3.5 py-1.5 rounded-full text-xs font-semibold shadow-xl flex items-center gap-1.5 border border-amber-300">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{scanFeedbackMsg}</span>
            </div>
          </div>
        )}

        {/* Real-time Sent Success Banner */}
        {lastScanned && (
          <div className="absolute bottom-24 inset-x-4 z-30 animate-in slide-in-from-bottom-3 zoom-in-95 duration-150 pointer-events-none">
            <div className="bg-emerald-600 text-white px-4 py-2.5 rounded-2xl shadow-2xl flex items-center justify-between border border-emerald-400">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-wider text-emerald-100 font-bold">
                    SYNCED TO WORKSTATION
                  </div>
                  <div className="text-sm font-mono font-extrabold">{lastScanned}</div>
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-[11px] bg-emerald-800 px-2 py-0.5 rounded-lg font-bold">
                  #{scanCount}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Precision Trigger & Mode Controller (Ergonomic Thumb Area) */}
        <div className="absolute bottom-4 inset-x-4 z-20 flex flex-col gap-2">
          {triggerMode === 'tap_trigger' && (
            <button
              type="button"
              onClick={handleTriggerManualScan}
              disabled={isCapturingSingle}
              className={`w-full py-4 rounded-2xl font-bold text-base shadow-2xl flex items-center justify-center gap-2.5 transition active:scale-95 cursor-pointer border-2 ${
                isCapturingSingle
                  ? 'bg-white text-slate-950 border-white animate-pulse'
                  : 'bg-gradient-to-r from-red-600 via-red-500 to-amber-500 text-white border-red-400 shadow-red-500/40 hover:brightness-110'
              }`}
            >
              <Crosshair className={`w-6 h-6 ${isCapturingSingle ? 'animate-spin' : ''}`} />
              <span>⚡ TAP TO CAPTURE TARGET BARCODE</span>
            </button>
          )}

          {triggerMode === 'hold_to_scan' && (
            <button
              type="button"
              onMouseDown={() => setIsHoldingTrigger(true)}
              onMouseUp={() => setIsHoldingTrigger(false)}
              onTouchStart={() => setIsHoldingTrigger(true)}
              onTouchEnd={() => setIsHoldingTrigger(false)}
              className={`w-full py-4 rounded-2xl font-bold text-base shadow-2xl flex items-center justify-center gap-2.5 transition border-2 ${
                isHoldingTrigger
                  ? 'bg-emerald-600 text-white border-emerald-400 shadow-emerald-500/50'
                  : 'bg-slate-800 text-slate-200 border-slate-600'
              }`}
            >
              <Target className={`w-6 h-6 ${isHoldingTrigger ? 'animate-spin text-emerald-300' : ''}`} />
              <span>{isHoldingTrigger ? 'SCANNING ACTIVE (RELEASE TO STOP)' : 'HOLD BUTTON TO SCAN'}</span>
            </button>
          )}

          {triggerMode === 'auto_continuous' && (
            <div className="w-full py-3 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-700/80 text-center flex items-center justify-center gap-2 shadow-xl">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-slate-200">
                Auto-Detect Active (Aim red laser line at barcode)
              </span>
            </div>
          )}
        </div>

        {/* Filter & Precision Settings Drawer */}
        {showFilterSettings && (
          <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-md z-40 p-5 flex flex-col animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Sliders className="w-5 h-5 text-blue-400" />
                Precision & Unwanted Barcode Filters
              </h3>
              <button
                type="button"
                onClick={() => setShowFilterSettings(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-5">
              {/* Trigger Mode */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Trigger Mode
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setTriggerMode('tap_trigger')}
                    className={`p-2.5 rounded-xl border text-center transition ${
                      triggerMode === 'tap_trigger'
                        ? 'bg-red-600 text-white border-red-500 font-bold'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    <div className="text-xs font-bold">🎯 Tap to Scan</div>
                    <div className="text-[10px] text-slate-300 mt-0.5">100% Precise</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTriggerMode('auto_continuous')}
                    className={`p-2.5 rounded-xl border text-center transition ${
                      triggerMode === 'auto_continuous'
                        ? 'bg-blue-600 text-white border-blue-500 font-bold'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    <div className="text-xs font-bold">⚡ Auto Detect</div>
                    <div className="text-[10px] text-slate-300 mt-0.5">Continuous</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTriggerMode('hold_to_scan')}
                    className={`p-2.5 rounded-xl border text-center transition ${
                      triggerMode === 'hold_to_scan'
                        ? 'bg-emerald-600 text-white border-emerald-500 font-bold'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    <div className="text-xs font-bold">👆 Hold Button</div>
                    <div className="text-[10px] text-slate-300 mt-0.5">Press & Aim</div>
                  </button>
                </div>
              </div>

              {/* Barcode Length Filter */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Minimum Barcode Length
                  </label>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    {minBarcodeLength} characters
                  </span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={14}
                  value={minBarcodeLength}
                  onChange={(e) => setMinBarcodeLength(parseInt(e.target.value, 10))}
                  className="w-full accent-blue-500 bg-slate-800 h-2 rounded-lg cursor-pointer"
                />
                <p className="text-[11px] text-slate-500">
                  Rejects noisy 2-5 character short internal tags or spurious reflections.
                </p>
              </div>

              {/* Platform Preset Filter */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Platform / Order Format Filter
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'all', label: 'All Orders & AWBs' },
                    { id: 'amazon', label: 'Amazon Only (TBA / 40x)' },
                    { id: 'd2c', label: 'D2C / Courier (OD- / AWBs)' },
                    { id: 'jiomart', label: 'JioMart (JM- / R-)' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setFilterPreset(p.id as BarcodeFilterPreset)}
                      className={`p-2.5 rounded-xl border text-xs font-semibold text-left flex items-center justify-between transition ${
                        filterPreset === p.id
                          ? 'bg-blue-600 text-white border-blue-500 shadow-xs'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      <span>{p.label}</span>
                      {filterPreset === p.id && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ignore Retail UPC Toggle */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white">Ignore Item UPC/EAN Barcodes</div>
                  <div className="text-[11px] text-slate-500">Skips standard 8/12/13-digit product packaging barcodes</div>
                </div>
                <input
                  type="checkbox"
                  checked={ignoreRetailUpc}
                  onChange={(e) => setIgnoreRetailUpc(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
              </div>

              {/* Sound & Haptics */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className={`p-3 rounded-xl border flex items-center justify-between ${
                    soundEnabled ? 'bg-slate-900 border-blue-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {soundEnabled ? <Volume2 className="w-4 h-4 text-blue-400" /> : <VolumeX className="w-4 h-4" />}
                    <span className="text-xs font-semibold">Sound Beep</span>
                  </div>
                  <span className="text-[10px] font-bold">{soundEnabled ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setHapticsEnabled(!hapticsEnabled)}
                  className={`p-3 rounded-xl border flex items-center justify-between ${
                    hapticsEnabled ? 'bg-slate-900 border-emerald-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Vibrate className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-semibold">Vibration</span>
                  </div>
                  <span className="text-[10px] font-bold">{hapticsEnabled ? 'ON' : 'OFF'}</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowFilterSettings(false)}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition mt-3"
            >
              Apply & Close
            </button>
          </div>
        )}

        {/* Scan History Drawer */}
        {showHistory && (
          <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-md z-40 p-5 flex flex-col animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <History className="w-5 h-5 text-blue-400" />
                Scanned History ({scannedHistory.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-2">
              {scannedHistory.length === 0 ? (
                <div className="text-center text-slate-500 py-10 text-sm">
                  No barcodes scanned yet
                </div>
              ) : (
                scannedHistory.map((item, i) => (
                  <div 
                    key={i} 
                    className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between"
                  >
                    <div>
                      <div className="font-mono font-bold text-white text-sm">{item.code}</div>
                      <div className="text-[11px] text-slate-500">{item.time}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleProcessBarcode(item.code)}
                      className="px-3 py-1.5 bg-blue-600/80 hover:bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Resend
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Manual Input Fallback Bar at bottom */}
      <div className="p-2.5 bg-slate-900 border-t border-slate-800 z-30 shrink-0">
        <form onSubmit={handleManualSubmit} className="flex gap-2">
          <input
            type="text"
            value={manualBarcode}
            onChange={(e) => setManualBarcode(e.target.value)}
            placeholder="Or type/paste Order ID..."
            className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-blue-500 placeholder:text-slate-500"
          />
          <button
            type="submit"
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm cursor-pointer shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

