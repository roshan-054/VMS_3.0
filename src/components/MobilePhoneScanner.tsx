import React, { useState, useEffect, useRef } from 'react';
import {
  Smartphone,
  Camera,
  CameraOff,
  Flashlight,
  SwitchCamera,
  CheckCircle2,
  AlertCircle,
  Wifi,
  WifiOff,
  Zap,
  Barcode,
  RotateCcw,
  Sparkles,
  ArrowRight,
  Send,
  Sliders,
  Check,
  Volume2,
  X,
  Target,
  Radio
} from 'lucide-react';
import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
  BinaryBitmap,
} from '@zxing/library';
import { sharedScannerSync, cleanStationPin } from '../lib/phoneScannerSync';

interface MobilePhoneScannerProps {
  initialPin?: string;
  onExit?: () => void;
}

// Crisp Handheld Scanner Beep
function playScannerBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2400, ctx.currentTime);
    osc.frequency.setValueAtTime(2800, ctx.currentTime + 0.04);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
  } catch (_) {}
}

export const MobilePhoneScanner: React.FC<MobilePhoneScannerProps> = ({
  initialPin = '',
  onExit,
}) => {
  const [stationPin, setStationPin] = useState<string>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = cleanStationPin(urlParams.get('pin') || urlParams.get('station') || initialPin);
    if (fromUrl) return fromUrl;
    const fromStorage = cleanStationPin(localStorage.getItem('vms_paired_pin') || '');
    if (fromStorage) return fromStorage;
    return '5829';
  });

  const [isPaired, setIsPaired] = useState<boolean>(true);
  const [pinInput, setPinInput] = useState<string>(stationPin);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string>('');
  const [scannedHistory, setScannedHistory] = useState<Array<{ code: string; time: string }>>([]);
  const [manualCode, setManualCode] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('Ready to scan barcodes');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [isRecentScan, setIsRecentScan] = useState<boolean>(false);
  const [isFocusing, setIsFocusing] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apertureRef = useRef<HTMLDivElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fullCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const zxingReaderRef = useRef<MultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScannedTimeRef = useRef<number>(0);
  const lastScannedCodeRef = useRef<string>('');
  const barcodeAnimRef = useRef<number | null>(null);
  const scanThrottledRef = useRef<boolean>(false);

  useEffect(() => {
    const clean = cleanStationPin(initialPin);
    if (clean && clean.length === 4 && clean !== stationPin) {
      setStationPin(clean);
      setPinInput(clean);
    }
  }, [initialPin]);

  // Auto-connect to WebSocket station room
  useEffect(() => {
    const effectivePin = cleanStationPin(stationPin) || '5829';
    localStorage.setItem('vms_paired_pin', effectivePin);
    setIsPaired(true);

    const userAgent = navigator.userAgent;
    const phoneModel = /iPhone/i.test(userAgent)
      ? 'iPhone'
      : /Android/i.test(userAgent)
      ? 'Android'
      : 'Mobile Phone';

    const urlParams = new URLSearchParams(window.location.search);
    const peerFromUrl = urlParams.get('peer') || '';

    sharedScannerSync.connectAsPhone(effectivePin, phoneModel, peerFromUrl);
    sharedScannerSync.pairInstant();

    const unsubStatus = sharedScannerSync.onPhoneStatus((connected, _count, _dev, ping) => {
      setIsConnected(connected);
      if (ping) setLatencyMs(ping);
      const syncedPin = sharedScannerSync.getStationPin();
      if (syncedPin && syncedPin.length === 4 && syncedPin !== stationPin) {
        setStationPin(syncedPin);
        setPinInput(syncedPin);
      }
    });

    const phonePoll = setInterval(() => {
      sharedScannerSync.pairInstant();
      sharedScannerSync.pollHttpEvents();
    }, 400);

    return () => {
      clearInterval(phonePoll);
      unsubStatus();
    };
  }, [stationPin]);

  // Start real-time camera scanner (Hardware BarcodeDetector with ZXing fallback)
  useEffect(() => {
    if (!isPaired) return;

    let isMounted = true;
    let barcodeDetectorInstance: any = null;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            advanced: [
              { focusMode: 'continuous' }
            ] as any,
          },
          audio: false,
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        if (track && typeof track.applyConstraints === 'function') {
          try {
            await track.applyConstraints({
              advanced: [
                { focusMode: 'continuous' },
                { exposureMode: 'continuous' },
                { pointsOfInterest: [{ x: 0.5, y: 0.5 }] },
              ] as any,
            });
          } catch (_) {}
        }

        if (track && typeof track.getCapabilities === 'function') {
          const caps: any = track.getCapabilities();
          setHasTorch(Boolean(caps.torch));
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.setAttribute('webkit-playsinline', 'true');
          await videoRef.current.play();
        }

        // Initialize Hardware BarcodeDetector if supported
        if ('BarcodeDetector' in window) {
          try {
            barcodeDetectorInstance = new (window as any).BarcodeDetector({
              formats: [
                'code_128',
                'code_39',
                'ean_13',
                'ean_8',
                'qr_code',
                'data_matrix',
                'upc_a',
                'upc_e',
                'itf',
              ],
            });
          } catch (e) {
            console.warn('BarcodeDetector init fallback:', e);
          }
        }

        // Initialize ZXing MultiFormatReader
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.QR_CODE,
          BarcodeFormat.DATA_MATRIX,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.ITF,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);

        const codeReader = new MultiFormatReader();
        codeReader.setHints(hints);
        zxingReaderRef.current = codeReader;

        // High-Precision Frame Scanner Loop
        const scanFrame = async () => {
          if (!isMounted) return;

          const video = videoRef.current;
          if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
            barcodeAnimRef.current = requestAnimationFrame(scanFrame);
            return;
          }

          const now = Date.now();
          let detectedText: string | null = null;
          let detectedFormat = 'BARCODE';

          // 1. Primary Pass: Hardware GPU BarcodeDetector directly on Video element
          if (barcodeDetectorInstance) {
            try {
              const detected = await barcodeDetectorInstance.detect(video);
              if (detected && detected.length > 0) {
                const raw = detected[0].rawValue || detected[0].text || '';
                if (raw && raw.trim().length >= 3) {
                  detectedText = raw.trim();
                  detectedFormat = detected[0].format || 'BARCODE';
                }
              }
            } catch (_) {}
          }

          // 2. Secondary Pass: ZXing fallback via Canvas (Aperture crop and Full scale)
          if (!detectedText && zxingReaderRef.current) {
            try {
              if (!fullCanvasRef.current) {
                fullCanvasRef.current = document.createElement('canvas');
              }
              const fCanvas = fullCanvasRef.current;
              const w = Math.min(640, video.videoWidth);
              const h = Math.round(w * (video.videoHeight / video.videoWidth));
              if (fCanvas.width !== w || fCanvas.height !== h) {
                fCanvas.width = w;
                fCanvas.height = h;
              }
              const fCtx = fCanvas.getContext('2d', { willReadFrequently: true });
              if (fCtx) {
                fCtx.drawImage(video, 0, 0, w, h);
                const luminanceSource = new HTMLCanvasElementLuminanceSource(fCanvas);
                const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
                const zxResult = zxingReaderRef.current.decode(binaryBitmap);
                if (zxResult) {
                  const text = typeof zxResult.getText === 'function' ? zxResult.getText() : String(zxResult.text || '');
                  if (text && text.trim().length >= 3) {
                    detectedText = text.trim();
                    detectedFormat = typeof zxResult.getBarcodeFormat === 'function' ? String(zxResult.getBarcodeFormat()) : 'AUTO';
                  }
                }
              }
            } catch (_) {}
          }

          if (detectedText) {
            const cleaned = detectedText.replace(/[\x00-\x1F\x7F]/g, '').replace(/^\][a-zA-Z0-9]{2,3}/, '').trim();

            if (cleaned.length >= 3) {
              // Anti-duplicate throttle: ignore identical code within 1.2s
              const isDuplicate = cleaned === lastScannedCodeRef.current && now - lastScannedTimeRef.current < 1200;

              if (!isDuplicate && !scanThrottledRef.current) {
                lastScannedCodeRef.current = cleaned;
                lastScannedTimeRef.current = now;
                scanThrottledRef.current = true;

                // Fire scan event
                handleBarcodeScanned(cleaned, detectedFormat);

                setTimeout(() => {
                  scanThrottledRef.current = false;
                }, 400);
              }
            }
          }

          barcodeAnimRef.current = requestAnimationFrame(scanFrame);
        };

        barcodeAnimRef.current = requestAnimationFrame(scanFrame);
      } catch (err: any) {
        console.error('Mobile camera start error:', err);
        setStatusMessage('Camera error: Please allow camera access in mobile browser');
      }
    };

    startCamera();

    return () => {
      isMounted = false;
      if (barcodeAnimRef.current) {
        cancelAnimationFrame(barcodeAnimRef.current);
        barcodeAnimRef.current = null;
      }
      if (zxingReaderRef.current) {
        try {
          zxingReaderRef.current.reset();
        } catch (_) {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [isPaired, facingMode]);

  // Hardware optical auto-focus trigger
  const triggerCameraAutoFocus = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') return;

    setIsFocusing(true);
    setTimeout(() => setIsFocusing(false), 700);

    try {
      if (typeof track.applyConstraints === 'function') {
        const caps: any = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
        const adv: any = {};
        if (caps.focusMode && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
          adv.focusMode = 'continuous';
        }
        if (caps.pointsOfInterest) {
          adv.pointsOfInterest = [{ x: 0.5, y: 0.5 }];
        }
        if (Object.keys(adv).length > 0) {
          await track.applyConstraints({ advanced: [adv] } as any);
        }
      }
    } catch (_) {}
  };

  const handleBarcodeScanned = async (rawCode: string, format: string) => {
    const cleaned = rawCode.trim().replace(/[\x00-\x1F\x7F]/g, '').replace(/^\][a-zA-Z0-9]{2,3}/, '').trim();
    if (!cleaned) return;

    // Haptic vibration feedback
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate([40, 30, 40]);
      } catch (_) {}
    }

    // Audio chirp
    playScannerBeep();

    setLastScannedBarcode(cleaned);
    setIsRecentScan(true);
    setTimeout(() => setIsRecentScan(false), 1400);

    setStatusMessage(`Transmitted: ${cleaned}`);

    // Add to local history
    setScannedHistory((prev) => [
      { code: cleaned, time: new Date().toLocaleTimeString() },
      ...prev.slice(0, 19),
    ]);

    // Transmit instantly to workstation via WebSocket & HTTP
    await sharedScannerSync.transmitBarcode(cleaned, format);
  };

  const handleToggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && typeof track.applyConstraints === 'function') {
      try {
        const next = !isTorchOn;
        await track.applyConstraints({
          advanced: [{ torch: next }] as any,
        });
        setIsTorchOn(next);
      } catch (e) {
        console.warn('Torch toggle note:', e);
      }
    }
  };

  const handleToggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const handleSendManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    const code = manualCode.trim();
    setManualCode('');
    await handleBarcodeScanned(code, 'MANUAL_ENTRY');
  };

  const handleReconnect = () => {
    setStatusMessage('Reconnecting to workstation…');
    sharedScannerSync.reconnect();
    sharedScannerSync.pairInstant();
    sharedScannerSync.pollHttpEvents();
  };

  const handlePairSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = pinInput.replace(/\D/g, '').slice(0, 4);
    if (clean.length === 4) {
      setStationPin(clean);
      setIsPaired(true);
    }
  };

  // If not paired with 4-digit PIN: show Quick PIN Setup Screen
  if (!isPaired) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center items-center p-5 font-sans">
        <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 text-center relative">
          {onExit && (
            <button
              onClick={onExit}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 cursor-pointer"
              title="Exit Scanner"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center mx-auto shadow-lg shadow-blue-500/20">
            <Smartphone className="w-8 h-8" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl font-black text-white tracking-tight">
              Connect to Packing Station
            </h2>
            <p className="text-xs text-slate-400">
              Enter the 4-digit Station PIN displayed on your packing computer screen
            </p>
          </div>

          <form onSubmit={handlePairSubmit} className="space-y-4">
            <input
              type="tel"
              pattern="[0-9]*"
              inputMode="numeric"
              maxLength={4}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
              placeholder="e.g. 5829"
              className="w-full py-4 text-center text-3xl font-mono font-black tracking-widest bg-slate-950 border-2 border-slate-700 rounded-2xl text-emerald-400 placeholder-slate-700 focus:outline-none focus:border-emerald-500 transition shadow-inner"
              autoFocus
            />

            <button
              type="submit"
              disabled={pinInput.length !== 4}
              className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 text-slate-950 font-black text-sm rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
            >
              <span>Connect Wireless Scanner</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <p className="text-[11px] text-slate-500 font-mono">
            VMS 3.0 • Real-Time Zero Delay Sync
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col z-50 overflow-hidden font-sans select-none">
      {/* Top Header Bar */}
      <div className="p-3 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isConnected
                ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                : 'bg-amber-400 animate-pulse'
            }`}
          />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-100">Station {stationPin}</span>
              {isConnected ? (
                <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.2 rounded font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                  CONNECTED
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => sharedScannerSync.forceSync()}
                  className="text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.2 rounded font-bold flex items-center gap-1 animate-pulse cursor-pointer"
                  title="Click to re-sync with workstation"
                >
                  <Radio className="w-2.5 h-2.5 text-amber-400" />
                  CONNECTING…
                </button>
              )}
            </div>
            <span className="text-[10px] text-slate-400 block font-mono">
              {isConnected
                ? `Live Wireless Barcode Reader ${latencyMs > 0 ? `(~${latencyMs}ms)` : ''}`
                : 'Connecting to workstation… (Tap to re-sync)'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Reconnect Button */}
          <button
            type="button"
            onClick={handleReconnect}
            className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-[11px] font-bold rounded-xl border border-blue-400/40 flex items-center gap-1.5 transition cursor-pointer shadow-xs"
            title="Reconnect with Workstation"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Sync</span>
          </button>

          {/* Camera Flip Button */}
          <button
            type="button"
            onClick={handleToggleFacingMode}
            className="p-2 bg-slate-900 border border-slate-700 hover:border-slate-500 text-slate-200 active:scale-95 rounded-xl transition cursor-pointer"
            title="Flip Camera (Front / Back)"
          >
            <SwitchCamera className="w-4 h-4" />
          </button>

          {hasTorch && (
            <button
              type="button"
              onClick={handleToggleTorch}
              className={`p-2 rounded-xl border text-xs font-bold transition cursor-pointer ${
                isTorchOn
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-md shadow-amber-400/20'
                  : 'bg-slate-900 border-slate-700 text-slate-300'
              }`}
              title="Toggle Flashlight Torch"
            >
              <Flashlight className="w-4 h-4" />
            </button>
          )}

          {/* Hardware Auto-Focus Camera Button */}
          <button
            type="button"
            onClick={triggerCameraAutoFocus}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold transition cursor-pointer flex items-center gap-1 shadow-xs ${
              isFocusing
                ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-emerald-500/30'
                : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-slate-500'
            }`}
            title="Auto-Focus Camera on Barcode"
          >
            <Target className={`w-3.5 h-3.5 ${isFocusing ? 'animate-spin text-slate-950' : 'text-emerald-400'}`} />
            <span>Focus</span>
          </button>

          <button
            type="button"
            onClick={() => setIsPaired(false)}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-bold rounded-lg border border-slate-700 cursor-pointer"
            title="Change Station PIN"
          >
            PIN
          </button>

          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl cursor-pointer"
              title="Exit Scanner"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Camera Viewfinder Area (Tap anywhere to trigger optical Auto-Focus) */}
      <div
        ref={containerRef}
        onClick={() => triggerCameraAutoFocus()}
        className="relative flex-1 bg-black flex items-center justify-center overflow-hidden cursor-pointer"
        title="Tap to Auto-Focus on Barcode"
      >
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Optical Auto-Focus Target Pulse Ring Indicator */}
        {isFocusing && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-30 animate-fade-in">
            <div className="w-24 h-24 rounded-full border-2 border-emerald-400 flex items-center justify-center animate-ping shadow-[0_0_25px_rgba(52,211,153,1)]">
              <Target className="w-8 h-8 text-emerald-400" />
            </div>
          </div>
        )}

        {/* Real-time Aiming Reticle with Clear Scanning Window */}
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-10">
          <div className="w-full flex-1 flex flex-col items-center justify-end pb-3">
            <div className="text-[10px] font-mono tracking-wider font-semibold text-slate-200 uppercase bg-slate-900/90 backdrop-blur-xs px-3 py-1 rounded-full border border-slate-700 shadow-md">
              Aim Camera at Any Barcode / QR Code
            </div>
          </div>

          <div className="w-full flex items-center justify-center shrink-0">
            <div
              ref={apertureRef}
              className={`w-[85%] max-w-[340px] h-40 sm:h-44 relative rounded-2xl border-2 transition-all duration-200 flex items-center justify-center shrink-0 ${
                isRecentScan
                  ? 'border-emerald-400 bg-emerald-500/20 scale-[1.03] ring-4 ring-emerald-500/50 shadow-[0_0_30px_rgba(52,211,153,0.8)]'
                  : 'border-white/80 bg-black/10'
              }`}
            >
              {/* Corner Brackets */}
              <div className="absolute -top-1.5 -left-1.5 w-6 h-6 border-t-3 border-l-3 border-emerald-400 rounded-tl-md shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <div className="absolute -top-1.5 -right-1.5 w-6 h-6 border-t-3 border-r-3 border-emerald-400 rounded-tr-md shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <div className="absolute -bottom-1.5 -left-1.5 w-6 h-6 border-b-3 border-l-3 border-emerald-400 rounded-bl-md shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 border-b-3 border-r-3 border-emerald-400 rounded-br-md shadow-[0_0_8px_rgba(52,211,153,0.8)]" />

              {/* Red Laser Aiming Guide */}
              <div className="absolute inset-x-3 h-0.5 bg-gradient-to-r from-red-500/10 via-red-500 to-red-500/10 shadow-[0_0_16px_rgba(239,68,68,1)] animate-pulse" />

              {/* Center Alignment Guide Marks */}
              <div className="absolute inset-y-1/2 left-2.5 w-3 border-t-2 border-emerald-400/90" />
              <div className="absolute inset-y-1/2 right-2.5 w-3 border-t-2 border-emerald-400/90" />

              <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 bg-slate-950 text-[10px] font-mono font-bold px-3 py-0.5 rounded-full border border-slate-700 text-slate-200 whitespace-nowrap shadow-md">
                Continuous Laser Scanning Active
              </div>
            </div>
          </div>

          <div className="w-full flex-1 flex flex-col items-center justify-start pt-4">
            <div className="text-[10px] font-mono text-slate-300 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-xs px-3 py-1 rounded-full border border-slate-700 shadow-md">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Tap screen anytime to pull sharp focus</span>
            </div>
          </div>
        </div>

        {/* Live Scan Notification Toast Banner */}
        {isRecentScan && (
          <div className="absolute top-4 inset-x-4 bg-emerald-600/95 backdrop-blur-md text-white p-3.5 rounded-2xl shadow-2xl border border-emerald-400 flex items-center justify-between animate-fade-in z-30">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-6 h-6 text-emerald-200 shrink-0 animate-bounce" />
              <div>
                <span className="text-[10px] font-mono text-emerald-100 block uppercase font-bold">
                  Transmitted to Packing Workstation
                </span>
                <span className="text-base font-mono font-black tracking-wider text-white">
                  {lastScannedBarcode}
                </span>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded bg-black/20 text-[11px] font-mono font-bold text-emerald-100">
              ✓ SENT
            </span>
          </div>
        )}
      </div>

      {/* Clean Scanner Control Bar (Manual Barcode Entry & Status) */}
      <div className="bg-slate-950/95 backdrop-blur-md border-t border-slate-800 p-3 sm:p-4 space-y-2.5 shrink-0 z-30">
        <form onSubmit={handleSendManual} className="flex items-center gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Type barcode or Order ID manually..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!manualCode.trim()}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-40 shrink-0 shadow-sm"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </form>

        {/* Scan History / Status pill */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1 border-t border-slate-900">
          <span className="truncate max-w-[220px]">
            {lastScannedBarcode ? `Last: ${lastScannedBarcode}` : statusMessage}
          </span>
          <span>Scans: {scannedHistory.length}</span>
        </div>
      </div>
    </div>
  );
};
