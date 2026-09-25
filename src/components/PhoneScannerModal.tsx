import React, { useState, useEffect, useRef } from 'react';
import {
  Smartphone,
  QrCode,
  X,
  Check,
  Copy,
  Wifi,
  WifiOff,
  Zap,
  ExternalLink,
  ShieldCheck,
  Radio,
  Sliders,
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  Sparkles,
  Info
} from 'lucide-react';
import { BrowserQRCodeSvgWriter } from '@zxing/library';
import { sharedScannerSync } from '../lib/phoneScannerSync';

interface PhoneScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  onSimulateBarcode?: (code: string) => void;
  autoRecordOnScan?: boolean;
  onToggleAutoRecord?: (enabled: boolean) => void;
}

export const PhoneScannerModal: React.FC<PhoneScannerModalProps> = ({
  isOpen,
  onClose,
  onShowToast,
  onSimulateBarcode,
  autoRecordOnScan = true,
  onToggleAutoRecord,
}) => {
  const [stationPin, setStationPin] = useState<string>(sharedScannerSync.getStationPin());
  const [isEditingPin, setIsEditingPin] = useState(false);
  const [tempPin, setTempPin] = useState(stationPin);
  const [isPhoneConnected, setIsPhoneConnected] = useState(false);
  const [phoneCount, setPhoneCount] = useState(0);
  const [phoneDeviceName, setPhoneDeviceName] = useState<string>('');
  const [latencyMs, setLatencyMs] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);
  const [recentScans, setRecentScans] = useState<Array<{ code: string; time: string; device: string }>>([]);

  const qrContainerRef = useRef<HTMLDivElement>(null);

  // Sync state with phoneScannerSync
  useEffect(() => {
    if (!isOpen) return;

    setStationPin(sharedScannerSync.getStationPin());
    setTempPin(sharedScannerSync.getStationPin());

    const unsubStatus = sharedScannerSync.onPhoneStatus((connected, count, device, latency) => {
      setIsPhoneConnected(connected);
      setPhoneCount(count);
      if (device) setPhoneDeviceName(device);
      if (latency !== undefined) setLatencyMs(latency);
    });

    const unsubBarcode = sharedScannerSync.onBarcode((barcode, format, platform, deviceName) => {
      const timeStr = new Date().toLocaleTimeString();
      setRecentScans((prev) => [
        { code: barcode, time: timeStr, device: deviceName || 'Phone' },
        ...prev.slice(0, 9),
      ]);
    });

    return () => {
      unsubStatus();
      unsubBarcode();
    };
  }, [isOpen]);

  // Generate SVG QR code when PIN or open changes
  useEffect(() => {
    if (!isOpen || !qrContainerRef.current) return;

    try {
      const pairingUrl = sharedScannerSync.getPairingUrl(stationPin);
      const writer = new BrowserQRCodeSvgWriter();
      const svg = writer.write(pairingUrl, 200, 200);

      // Set proper scalable viewBox and dimensions so SVG scales crisply without any clipping or offset
      svg.setAttribute('viewBox', '0 0 200 200');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.display = 'block';

      // Ensure white background inside SVG and pure black for all modules
      let bgRect = svg.querySelector('rect.qr-solid-bg');
      if (!bgRect) {
        bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('class', 'qr-solid-bg');
        bgRect.setAttribute('x', '0');
        bgRect.setAttribute('y', '0');
        bgRect.setAttribute('width', '200');
        bgRect.setAttribute('height', '200');
        bgRect.setAttribute('fill', '#ffffff');
        svg.insertBefore(bgRect, svg.firstChild);
      }

      // Ensure every QR module is pitch black
      const codeElements = svg.querySelectorAll('rect:not(.qr-solid-bg), path');
      codeElements.forEach((el) => {
        el.setAttribute('fill', '#000000');
      });

      qrContainerRef.current.innerHTML = '';
      qrContainerRef.current.appendChild(svg);
    } catch (e) {
      console.warn('QR code generation notice:', e);
    }
  }, [isOpen, stationPin]);

  if (!isOpen) return null;

  const pairingUrl = sharedScannerSync.getPairingUrl(stationPin);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(pairingUrl);
    setCopiedLink(true);
    onShowToast('Mobile scanner link copied to clipboard!', 'success');
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleSavePin = () => {
    const clean = tempPin.replace(/\D/g, '').slice(0, 4);
    if (clean.length !== 4) {
      onShowToast('Please enter a 4-digit station PIN', 'error');
      return;
    }
    sharedScannerSync.setStationPin(clean);
    setStationPin(clean);
    setIsEditingPin(false);
    onShowToast(`Station PIN updated to ${clean}`, 'success');
  };

  const handleSendTestBarcode = () => {
    const sample = `OD${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    sharedScannerSync.transmitBarcode(sample, 'CODE_128', 'D2C');
    if (onSimulateBarcode) onSimulateBarcode(sample);
    onShowToast(`Test scan sent: ${sample}`, 'info');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 text-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-3.5 sm:p-4 bg-gradient-to-r from-blue-950/90 via-slate-900 to-indigo-950/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center font-bold shadow-md shadow-blue-500/20 shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-100">
                  Wireless Phone Barcode Scanner
                </h3>
                <span className="text-[10px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5 fill-blue-300 text-blue-300" />
                  Real-Time Sync
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Turn any smartphone into an ultra-fast wireless laser barcode reader
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5 flex-1 text-slate-200">
          {/* Connection Status Banner */}
          <div
            className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
              isPhoneConnected
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                : 'bg-slate-950/70 border-slate-800 text-slate-400'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  isPhoneConnected
                    ? 'bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.8)]'
                    : 'bg-amber-500/70'
                }`}
              />
              <div>
                <span className="text-xs font-bold block text-slate-100">
                  {isPhoneConnected
                    ? `Phone Connected: ${phoneDeviceName || 'Wireless Scanner'}`
                    : 'Waiting for Smartphone to Connect…'}
                </span>
                <span className="text-[11px] text-slate-400">
                  {isPhoneConnected
                    ? `Ultra-Low Latency (~${latencyMs || 6}ms) • Ready to scan packages`
                    : 'Point phone camera at QR code below to connect with zero delay'}
                </span>
              </div>
            </div>

            {isPhoneConnected ? (
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold flex items-center gap-1 shrink-0">
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                Live Sync
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 text-xs font-mono shrink-0">
                Listening…
              </span>
            )}
          </div>

          {/* Quick Connect Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
            {/* Left: Pure High-Contrast White QR Code Card */}
            <div
              className="qr-code-white-card flex flex-col items-center justify-center p-3.5 sm:p-4 rounded-2xl shadow-xl border border-slate-300 text-center select-none"
              style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
            >
              <div
                ref={qrContainerRef}
                className="w-44 h-44 sm:w-48 sm:h-48 flex items-center justify-center p-1"
                style={{ backgroundColor: '#ffffff' }}
              />
              <div
                className="mt-2.5 flex items-center justify-center gap-1.5 text-xs font-bold"
                style={{ color: '#0f172a' }}
              >
                <QrCode className="w-4 h-4 text-blue-600 shrink-0" style={{ color: '#2563eb' }} />
                <span style={{ color: '#0f172a', fontWeight: 700 }}>
                  Scan with Phone Camera
                </span>
              </div>
            </div>

            {/* Right: 4-Digit Station PIN & Direct URL */}
            <div className="space-y-3 flex flex-col justify-between">
              {/* Station PIN Box */}
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                <span className="text-xs font-mono font-semibold text-slate-400 block">
                  Quick Station PIN (Manual Entry):
                </span>

                {!isEditingPin ? (
                  <div className="flex items-center justify-between">
                    <div className="text-3xl sm:text-4xl font-mono font-black tracking-widest text-emerald-400 drop-shadow-sm">
                      {stationPin}
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsEditingPin(true)}
                      className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition cursor-pointer"
                    >
                      Change PIN
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={4}
                      value={tempPin}
                      onChange={(e) => setTempPin(e.target.value.replace(/\D/g, ''))}
                      className="w-24 px-3 py-1 bg-slate-900 border border-emerald-500 rounded-lg text-lg font-mono font-bold text-center text-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleSavePin}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTempPin(stationPin);
                        setIsEditingPin(false);
                      }}
                      className="px-2 py-1.5 bg-slate-800 text-slate-400 text-xs rounded-lg transition cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 leading-snug">
                  Or open <span className="font-mono text-slate-300">{`${window.location.host}${window.location.pathname.replace(/\/$/, '')}/?scanner=mobile`}</span> on phone.
                </p>
              </div>

              {/* Direct Link Copy Button */}
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-full px-4 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-98 text-slate-200 hover:text-white rounded-xl text-xs font-semibold border border-slate-700 transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedLink ? 'Link Copied to Clipboard!' : 'Copy Mobile Scanner Link'}</span>
                </button>

                <a
                  href={pairingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full px-4 py-2 bg-slate-950 hover:bg-slate-900 text-blue-400 rounded-xl text-[11px] font-medium transition flex items-center justify-center gap-1.5 border border-slate-800"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Test Mobile Scanner in New Tab</span>
                </a>
              </div>
            </div>
          </div>

          {/* Real-time Scan Feed / Test Action */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                Recent Scanned Barcodes
              </span>
              <button
                type="button"
                onClick={handleSendTestBarcode}
                className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold transition cursor-pointer flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3 text-blue-400" />
                Simulate Test Scan
              </button>
            </div>

            <div className="bg-slate-950 p-2 rounded-xl border border-slate-800 min-h-[55px] max-h-28 overflow-y-auto space-y-1.5 font-mono text-xs">
              {recentScans.length > 0 ? (
                recentScans.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-1.5 px-2 bg-slate-900 rounded-lg border border-slate-800/80 flex items-center justify-between text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="font-bold text-slate-100">{item.code}</span>
                      <span className="text-[10px] text-slate-400">({item.device})</span>
                    </div>
                    <span className="text-[10px] text-slate-500">{item.time}</span>
                  </div>
                ))
              ) : (
                <div className="p-3 text-center text-[11px] text-slate-500 font-sans">
                  No barcodes scanned yet. Scan a package using your phone to test!
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-mono text-[11px]">
            Station PIN: <b className="text-emerald-400">{stationPin}</b> • WebSocket Real-Time
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
