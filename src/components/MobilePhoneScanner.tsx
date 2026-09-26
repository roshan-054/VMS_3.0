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
  Play,
  StopCircle,
  Crosshair,
  Barcode,
  RotateCcw,
  Sparkles,
  ArrowRight,
  Send,
  Sliders,
  Check,
  Volume2,
  X,
  Target
} from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/library';
import { sharedScannerSync } from '../lib/phoneScannerSync';

interface MobilePhoneScannerProps {
  initialPin?: string;
  onExit?: () => void;
}

export const MobilePhoneScanner: React.FC<MobilePhoneScannerProps> = ({
  initialPin = '',
  onExit,
}) => {
  const [stationPin, setStationPin] = useState<string>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('pin') || urlParams.get('station') || initialPin || localStorage.getItem('vms_paired_pin') || '';
  });

  const [isPaired, setIsPaired] = useState<boolean>(Boolean(stationPin && stationPin.length === 4));
  const [pinInput, setPinInput] = useState<string>(stationPin);
  const [isScanning, setIsScanning] = useState<boolean>(true);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string>('');
  const [scannedHistory, setScannedHistory] = useState<Array<{ code: string; time: string }>>([]);
  const [manualCode, setManualCode] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('Ready to scan packages');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [lastScanSuccessTime, setLastScanSuccessTime] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScannedTimeRef = useRef<number>(0);
  const lastScannedCodeRef = useRef<string>('');
  const barcodeAnimRef = useRef<number | null>(null);

  useEffect(() => {
    if (initialPin && initialPin.length === 4 && initialPin !== stationPin) {
      setStationPin(initialPin);
      setPinInput(initialPin);
    }
  }, [initialPin]);

  // Auto-connect to WebSocket station room
  useEffect(() => {
    if (!stationPin || stationPin.length !== 4) {
      setIsPaired(false);
      return;
    }

    localStorage.setItem('vms_paired_pin', stationPin);
    setIsPaired(true);

    const userAgent = navigator.userAgent;
    const phoneModel = /iPhone/i.test(userAgent)
      ? 'iPhone'
      : /Android/i.test(userAgent)
      ? 'Android'
      : 'Mobile Phone';

    sharedScannerSync.connectAsPhone(stationPin, phoneModel);

    const unsubStatus = sharedScannerSync.onPhoneStatus((connected, _count, _dev, ping) => {
      setIsConnected(connected);
      if (ping) setLatencyMs(ping);
    });

    return () => {
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

        // Check if device supports torch
        const track = stream.getVideoTracks()[0];
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

        // Check for native BarcodeDetector API (Ultra-fast, hardware accelerated 60fps)
        const hasNativeBarcodeDetector = 'BarcodeDetector' in window;

        if (hasNativeBarcodeDetector) {
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

            const scanLoop = async () => {
              if (!isMounted || !videoRef.current) return;
              if (videoRef.current.readyState >= 2 && barcodeDetectorInstance) {
                try {
                  const barcodes = await barcodeDetectorInstance.detect(videoRef.current);
                  if (barcodes && barcodes.length > 0 && isMounted) {
                    const rawText = barcodes[0].rawValue || barcodes[0].text || '';
                    if (rawText) {
                      const text = rawText.trim();
                      const now = Date.now();
                      if (text !== lastScannedCodeRef.current || now - lastScannedTimeRef.current >= 1500) {
                        lastScannedCodeRef.current = text;
                        lastScannedTimeRef.current = now;
                        handleBarcodeScanned(text, barcodes[0].format || 'BARCODE');
                      }
                    }
                  }
                } catch (detErr) {
                  // Frame capture skip
                }
              }
              barcodeAnimRef.current = requestAnimationFrame(scanLoop);
            };

            barcodeAnimRef.current = requestAnimationFrame(scanLoop);
            return;
          } catch (initErr) {
            console.warn('Native BarcodeDetector fallback to ZXing:', initErr);
          }
        }

        // Fallback: ZXing Library
        const codeReader = new BrowserMultiFormatReader();
        zxingReaderRef.current = codeReader;

        (codeReader as any).decodeFromVideoElement(
          videoRef.current!,
          (result: any, _err: any) => {
            if (result && isMounted) {
              const text = (typeof result.getText === 'function' ? result.getText() : String(result.text || '')).trim();
              const now = Date.now();

              // Debounce identical scans within 1.5 seconds
              if (text === lastScannedCodeRef.current && now - lastScannedTimeRef.current < 1500) {
                return;
              }

              lastScannedCodeRef.current = text;
              lastScannedTimeRef.current = now;
              const formatStr = typeof result.getBarcodeFormat === 'function' ? String(result.getBarcodeFormat()) : 'AUTO';
              handleBarcodeScanned(text, formatStr);
            }
          }
        );
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
        zxingReaderRef.current.reset();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [isPaired, facingMode]);

  const handleBarcodeScanned = async (rawCode: string, format: string) => {
    // Clean raw barcode (remove prefixes/control chars)
    const cleaned = rawCode.trim().replace(/[\x00-\x1F\x7F]/g, '').replace(/^\][a-zA-Z0-9]{2,3}/, '').trim();

    setLastScannedBarcode(cleaned);
    setLastScanSuccessTime(Date.now());
    setStatusMessage(`Transmitted: ${cleaned}`);

    // Add to history
    setScannedHistory((prev) => [
      { code: cleaned, time: new Date().toLocaleTimeString() },
      ...prev.slice(0, 9),
    ]);

    // Transmit instantly to workstation
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

  // Active Wireless Scanner Screen
  const isRecentScan = Date.now() - lastScanSuccessTime < 1800;

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col z-50 overflow-hidden font-sans select-none">
      {/* Top Header Bar */}
      <div className="p-3 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-100">Station {stationPin}</span>
              <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.2 rounded font-bold">
                CONNECTED
              </span>
            </div>
            <span className="text-[10px] text-slate-400 block font-mono">
              Live Wireless Barcode Reader {latencyMs > 0 ? `(~${latencyMs}ms)` : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasTorch && (
            <button
              type="button"
              onClick={handleToggleTorch}
              className={`p-2 rounded-xl border text-xs font-bold transition ${
                isTorchOn
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-md shadow-amber-400/20'
                  : 'bg-slate-900 border-slate-700 text-slate-300'
              }`}
              title="Toggle Flashlight Torch"
            >
              <Flashlight className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handleToggleFacingMode}
            className="p-2 bg-slate-900 border border-slate-700 text-slate-300 rounded-xl"
            title="Switch Camera"
          >
            <SwitchCamera className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsPaired(false)}
            className="px-2.5 py-1.5 bg-slate-800 text-slate-300 text-[11px] font-bold rounded-lg border border-slate-700"
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

      {/* Camera Viewfinder Area */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Real-time Aiming Reticle & Laser */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
          <div
            className={`w-[85%] max-w-xs aspect-4/3 relative rounded-2xl border-2 transition-all duration-300 flex items-center justify-center shadow-2xl ${
              isRecentScan
                ? 'border-emerald-400 bg-emerald-500/20 scale-102'
                : 'border-white/50 bg-black/10'
            }`}
          >
            {/* Corner Aiming Brackets */}
            <div className="absolute -top-1 -left-1 w-6 h-6 border-t-3 border-l-3 border-emerald-400 rounded-tl-md" />
            <div className="absolute -top-1 -right-1 w-6 h-6 border-t-3 border-r-3 border-emerald-400 rounded-tr-md" />
            <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-3 border-l-3 border-emerald-400 rounded-bl-md" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-3 border-r-3 border-emerald-400 rounded-br-md" />

            {/* Red Laser Aiming Line */}
            <div className="absolute inset-x-3 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_rgba(239,68,68,0.9)] animate-bounce opacity-80" />

            {/* Target Reticle Crosshair */}
            <div className="w-8 h-8 rounded-full border border-emerald-400/40 flex items-center justify-center opacity-60">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </div>

            {/* Badge Note */}
            <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 bg-slate-950/90 backdrop-blur-xs text-[10px] font-mono font-bold px-3 py-0.5 rounded-full border border-white/20 text-slate-200 whitespace-nowrap shadow-md">
              Point at Shipping Label / Barcode
            </div>
          </div>
        </div>

        {/* Success Scan Popup Banner */}
        {isRecentScan && (
          <div className="absolute top-4 inset-x-4 bg-emerald-600/95 backdrop-blur-md text-white p-3.5 rounded-2xl shadow-2xl border border-emerald-400 flex items-center justify-between animate-fade-in z-30">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
              <div>
                <span className="text-[10px] font-mono text-emerald-100 block uppercase font-bold">
                  Transmitted to Station • &lt;5ms
                </span>
                <span className="text-sm font-mono font-black tracking-wider text-white">
                  {lastScannedBarcode}
                </span>
              </div>
            </div>
            <span className="px-2 py-1 rounded bg-black/20 text-[10px] font-mono font-bold">
              SENT
            </span>
          </div>
        )}
      </div>

      {/* Station Remote Control Action Bar */}
      <div className="bg-slate-950/95 backdrop-blur-md border-t border-slate-800 p-3 sm:p-4 space-y-3 shrink-0 z-30">
        {/* Remote Action Buttons */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              sharedScannerSync.transmitRemoteCommand('START_RECORDING');
              setStatusMessage('Triggered START recording on station');
            }}
            className="py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>START REC</span>
          </button>

          <button
            type="button"
            onClick={() => {
              sharedScannerSync.transmitRemoteCommand('STOP_RECORDING');
              setStatusMessage('Triggered STOP recording on station');
            }}
            className="py-2.5 bg-red-600 hover:bg-red-500 active:scale-95 text-white font-black text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <StopCircle className="w-3.5 h-3.5 fill-white" />
            <span>STOP REC</span>
          </button>

          <button
            type="button"
            onClick={() => {
              sharedScannerSync.transmitRemoteCommand('TRIGGER_FOCUS');
              setStatusMessage('Triggered lens auto-focus on station');
            }}
            className="py-2.5 bg-amber-600 hover:bg-amber-500 active:scale-95 text-white font-black text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>REFOCUS</span>
          </button>
        </div>

        {/* Manual Keyboard Barcode Entry (Fallback if barcode is ripped/damaged) */}
        <form onSubmit={handleSendManual} className="flex items-center gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Type Order ID if barcode is damaged..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!manualCode.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-40 shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </form>

        {/* Scan History / Status pill */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1 border-t border-slate-900">
          <span className="truncate max-w-[200px]">
            {lastScannedBarcode ? `Last: ${lastScannedBarcode}` : statusMessage}
          </span>
          <span>Scans: {scannedHistory.length}</span>
        </div>
      </div>
    </div>
  );
};
