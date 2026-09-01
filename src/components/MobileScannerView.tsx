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
  RotateCcw
} from 'lucide-react';
import { sendBarcodeFromPhone } from '../lib/phoneSync';
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

export function MobileScannerView({ stationSessionId, onExit }: MobileScannerViewProps) {
  const [manualBarcode, setManualBarcode] = useState('');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scannedHistory, setScannedHistory] = useState<Array<{ code: string; time: string }>>([]);
  const [scanCount, setScanCount] = useState(0);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [supportsTorch, setSupportsTorch] = useState(false);
  const [supportsZoom, setSupportsZoom] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [viewfinderMode, setViewfinderMode] = useState<'barcode' | 'qr'>('barcode'); // 1D strip vs 2D box
  const [isNetworkSending, setIsNetworkSending] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'transmitting' | 'ready'>('ready');
  const [showHistory, setShowHistory] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const zxingReaderRef = useRef<MultiFormatReader | null>(null);
  const isProcessingFrameRef = useRef(false);
  const lastScannedRef = useRef<string | null>(null);

  // Initialize ZXing MultiFormatReader with warehouse-optimized hints
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

  // Audio feedback
  const playBeep = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1600, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {}
  }, [soundEnabled]);

  // Transmit barcode to desktop
  const handleProcessBarcode = useCallback(async (code: string) => {
    const clean = code.trim();
    if (!clean || clean.length < 2) return;
    if (clean === lastScannedRef.current) return;

    lastScannedRef.current = clean;
    setLastScanned(clean);
    setScanCount(prev => prev + 1);
    setConnectionStatus('transmitting');
    setIsNetworkSending(true);

    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setScannedHistory(prev => [{ code: clean, time: nowStr }, ...prev.slice(0, 19)]);

    if (hapticsEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([70, 30, 70]);
    }
    playBeep();

    try {
      await sendBarcodeFromPhone(stationSessionId, clean, 'Mobile Scanner App');
      setConnectionStatus('connected');
    } catch (err) {
      console.warn('Send barcode error:', err);
    } finally {
      setIsNetworkSending(false);
    }

    // Cooldown before permitting the exact same barcode again (prevents rapid re-trigger)
    setTimeout(() => {
      if (lastScannedRef.current === clean) {
        lastScannedRef.current = null;
      }
    }, 2200);
  }, [stationSessionId, hapticsEnabled, playBeep]);

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

  // Set digital zoom if supported
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

  // HIGH-ACCURACY REGION-OF-INTEREST (ROI) BARCODE SCANNING LOOP
  // Crops strictly to the illuminated viewfinder box so only the intended barcode is scanned!
  useEffect(() => {
    let nativeDetector: any = null;
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        nativeDetector = new (window as any).BarcodeDetector({
          formats: ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'qr_code', 'data_matrix', 'pdf417'],
        });
      } catch {}
    }

    const interval = setInterval(async () => {
      if (isProcessingFrameRef.current) return;
      const video = videoRef.current;
      const cropCanvas = cropCanvasRef.current;
      if (!video || !cropCanvas || video.readyState < 2) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;

      isProcessingFrameRef.current = true;

      try {
        // Calculate the Region of Interest (ROI) box in video coordinates
        // Barcode mode: 80% width, 32% height centered
        // QR mode: 65% width, 55% height centered
        const roiWidthFactor = viewfinderMode === 'barcode' ? 0.82 : 0.65;
        const roiHeightFactor = viewfinderMode === 'barcode' ? 0.32 : 0.55;

        const cropW = Math.floor(vw * roiWidthFactor);
        const cropH = Math.floor(vh * roiHeightFactor);
        const cropX = Math.floor((vw - cropW) / 2);
        const cropY = Math.floor((vh - cropH) / 2);

        cropCanvas.width = cropW;
        cropCanvas.height = cropH;

        const ctx = cropCanvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          isProcessingFrameRef.current = false;
          return;
        }

        // Draw ONLY the cropped ROI region into canvas
        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        let detectedCode: string | null = null;

        // 1. Primary Engine: Native Hardware BarcodeDetector on the cropped canvas
        if (nativeDetector) {
          try {
            const results = await nativeDetector.detect(cropCanvas);
            if (results && results.length > 0 && results[0].rawValue) {
              detectedCode = results[0].rawValue.trim();
            }
          } catch {}
        }

        // 2. Secondary Engine: ZXing MultiFormatReader fallback on cropped canvas
        if (!detectedCode && zxingReaderRef.current) {
          try {
            const imgData = ctx.getImageData(0, 0, cropW, cropH);
            const luminanceSource = new RGBLuminanceSource(imgData.data, cropW, cropH);
            const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
            const result = zxingReaderRef.current.decode(binaryBitmap);
            if (result && result.getText()) {
              detectedCode = result.getText().trim();
            }
          } catch {
            // NotFoundException is expected when no barcode is in the crop area
          }
        }

        if (detectedCode && detectedCode.length >= 2) {
          handleProcessBarcode(detectedCode);
        }
      } catch (err) {
        // Frame processing drop safe
      } finally {
        isProcessingFrameRef.current = false;
      }
    }, 180); // Fast 5.5 scans/second evaluation

    return () => clearInterval(interval);
  }, [viewfinderMode, handleProcessBarcode]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualBarcode.trim()) return;
    handleProcessBarcode(manualBarcode.trim());
    setManualBarcode('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-hidden touch-none">
      {/* Mobile Top Header */}
      <header className="px-4 py-3 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold shadow-md">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-tight flex items-center gap-1.5">
              Wireless Phone Scanner
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] font-mono">
              <span className={`w-2 h-2 rounded-full ${isNetworkSending ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 animate-pulse'}`} />
              <span className="text-emerald-400 font-bold">Station: {stationSessionId}</span>
              <span className="text-slate-500">•</span>
              <span className="text-slate-400">Realtime SSE</span>
            </div>
          </div>
        </div>

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
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
            title="Toggle Sound"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-blue-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
          </button>

          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className={`p-2 rounded-xl border transition ${showHistory ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
            title="Scan History"
          >
            <History className="w-4 h-4" />
          </button>

          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="p-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
              title="Close Mobile Scanner"
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

        {/* Outer Dimmed Mask Overlay (Shows user that only the centered box is active) */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          {/* Target Region of Interest (ROI) Box */}
          <div 
            className={`relative transition-all duration-300 border-2 rounded-2xl flex flex-col justify-between p-3 ${
              lastScanned 
                ? 'border-emerald-400 bg-emerald-500/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.7),0_0_30px_rgba(52,211,153,0.5)]' 
                : 'border-blue-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]'
            }`}
            style={{
              width: viewfinderMode === 'barcode' ? '86%' : '75%',
              height: viewfinderMode === 'barcode' ? '180px' : '280px',
              maxWidth: '420px',
            }}
          >
            {/* Viewfinder Target Corner Brackets */}
            <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
            <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
            <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />

            {/* Top Label */}
            <div className="w-full flex justify-between items-center text-[11px] font-mono text-emerald-300 font-bold drop-shadow-md">
              <span className="flex items-center gap-1">
                <Target className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                ACCURATE ROI WINDOW
              </span>
              <span className="bg-black/60 px-2 py-0.5 rounded text-[10px] uppercase text-blue-300 border border-white/10">
                {viewfinderMode === 'barcode' ? '1D Strip' : '2D Matrix'}
              </span>
            </div>

            {/* Red Laser Aiming Line across the center */}
            <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_rgba(239,68,68,1)] animate-pulse" />

            {/* Bottom Instruction Pill */}
            <div className="w-full flex justify-center">
              <span className="text-[11px] font-mono text-white bg-black/80 backdrop-blur-xs px-3 py-1 rounded-full border border-white/20 shadow-lg text-center">
                Center barcode inside red line
              </span>
            </div>
          </div>
        </div>

        {/* On-Screen Camera Controls Bar (Zoom + Mode switch) */}
        <div className="absolute top-4 inset-x-4 flex justify-between items-center z-20 pointer-events-auto">
          {/* Viewfinder Size Switcher */}
          <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 p-1 rounded-xl flex gap-1 shadow-lg">
            <button
              type="button"
              onClick={() => setViewfinderMode('barcode')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                viewfinderMode === 'barcode' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Barcode className="w-3.5 h-3.5" />
              1D Barcode
            </button>
            <button
              type="button"
              onClick={() => setViewfinderMode('qr')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                viewfinderMode === 'qr' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              2D / QR
            </button>
          </div>

          {/* Zoom Buttons */}
          <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 p-1 rounded-xl flex gap-1 shadow-lg">
            {[1, 1.5, 2].map(z => (
              <button
                key={z}
                type="button"
                onClick={() => changeZoom(z)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                  zoomLevel === z ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                {z}x
              </button>
            ))}
          </div>
        </div>

        {/* Real-time Sent Banner Toast */}
        {lastScanned && (
          <div className="absolute bottom-6 inset-x-4 z-30 animate-in slide-in-from-bottom-4 zoom-in-95 duration-150">
            <div className="bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center justify-between border border-emerald-400">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-100 font-bold">
                    TRANSMITTED TO DESKTOP
                  </div>
                  <div className="text-base font-mono font-extrabold">{lastScanned}</div>
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-xs bg-emerald-800/90 px-2.5 py-1 rounded-lg font-bold">
                  #{scanCount}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Scan History Drawer Modal */}
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
                      className="px-3 py-1.5 bg-blue-600/80 hover:bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
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
      <div className="p-3 bg-slate-900 border-t border-slate-800 z-30 shrink-0">
        <form onSubmit={handleManualSubmit} className="flex gap-2">
          <input
            type="text"
            value={manualBarcode}
            onChange={(e) => setManualBarcode(e.target.value)}
            placeholder="Or type order ID (e.g. 337372100192)..."
            className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-blue-500 placeholder:text-slate-500"
          />
          <button
            type="submit"
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5 transition shadow-sm cursor-pointer shrink-0"
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
