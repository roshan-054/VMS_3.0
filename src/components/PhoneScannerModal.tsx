import React, { useState } from 'react';
import { 
  Smartphone, 
  QrCode, 
  X, 
  Copy, 
  Check, 
  ExternalLink, 
  Radio, 
  Wifi, 
  Sparkles,
  Zap,
  CheckCircle2,
  ShieldCheck
} from 'lucide-react';

interface PhoneScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  stationSessionId: string;
  isPhoneConnected?: boolean;
  lastScannedTime?: number | null;
}

export function PhoneScannerModal({
  isOpen,
  onClose,
  stationSessionId,
  isPhoneConnected = false,
  lastScannedTime = null,
}: PhoneScannerModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // Build the complete direct mobile scanner URL
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const mobileScannerUrl = `${origin}${pathname}?mobile_scanner=1&station=${encodeURIComponent(stationSessionId)}`;
  
  // Public QR Code Generator API using the mobileScannerUrl
  const qrCodeApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(mobileScannerUrl)}&bgcolor=ffffff&color=0f172a&margin=1`;

  const handleCopy = () => {
    navigator.clipboard.writeText(mobileScannerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight">Wireless Phone Barcode Scanner</h3>
              <p className="text-xs text-slate-400">Scan orders with your mobile camera</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Station Status Badge */}
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-3.5">
            <div>
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Workstation Code
              </div>
              <div className="font-mono text-xl font-extrabold text-blue-600">
                {stationSessionId}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${isPhoneConnected ? 'bg-emerald-500 animate-pulse' : 'bg-blue-500'}`} />
              <span className="text-xs font-semibold text-slate-700">
                {isPhoneConnected ? 'Phone Connected' : 'Ready to Pair'}
              </span>
            </div>
          </div>

          {/* QR Code Container */}
          <div className="flex flex-col items-center justify-center text-center space-y-3">
            <div className="p-3 bg-white border-2 border-dashed border-blue-300 rounded-2xl shadow-inner inline-block">
              <img
                src={qrCodeApiUrl}
                alt="Scan with Phone"
                className="w-52 h-52 object-contain rounded-lg"
                loading="eager"
              />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-800 flex items-center justify-center gap-1.5">
                <QrCode className="w-4 h-4 text-blue-600" />
                Scan this QR code with your phone camera
              </p>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                No app installation required. Opens instant scanner web app in your phone's browser.
              </p>
            </div>
          </div>

          {/* Direct Link Copy */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Or Open Direct Mobile Link:</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={mobileScannerUrl}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600 truncate focus:outline-none select-all"
              />
              <button
                onClick={handleCopy}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium transition inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <a
                href={mobileScannerUrl}
                target="_blank"
                rel="noreferrer"
                className="p-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 rounded-lg transition shrink-0"
                title="Test Mobile View in New Tab"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5 font-medium">
            <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
            <span>Instant Zero-Latency Sync</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
