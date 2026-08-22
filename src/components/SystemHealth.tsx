import React, { useState, useEffect } from 'react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Camera,
  Mic,
  Database,
  Cloud,
  Cpu
} from 'lucide-react';
import { checkBackendHealth } from '../lib/api';
import { getStoredApiUrl } from '../lib/storage';

interface SystemHealthProps {
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export const SystemHealth: React.FC<SystemHealthProps> = ({ onShowToast }) => {
  const [checking, setChecking] = useState(false);
  const [healthResults, setHealthResults] = useState<{
    backend: { status: boolean; detail: string };
    camera: { status: boolean; detail: string };
    audio: { status: boolean; detail: string };
    indexedDB: { status: boolean; detail: string };
    mediaRecorder: { status: boolean; detail: string };
  }>({
    backend: { status: false, detail: 'Checking…' },
    camera: { status: false, detail: 'Checking…' },
    audio: { status: false, detail: 'Checking…' },
    indexedDB: { status: false, detail: 'Checking…' },
    mediaRecorder: { status: false, detail: 'Checking…' },
  });

  const runDiagnostics = async () => {
    setChecking(true);

    // 1. Check Apps Script Backend
    const backendRes = await checkBackendHealth();

    // 2. Check Camera Devices
    let cameraOk = false;
    let cameraDetail = 'No video devices detected';
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      if (videoInputs.length > 0) {
        cameraOk = true;
        cameraDetail = `${videoInputs.length} Camera device(s) ready (${videoInputs[0].label || 'Default Camera'})`;
      }
    } catch (e: any) {
      cameraDetail = `Permission denied or error: ${e.message}`;
    }

    // 3. Check Audio Devices
    let audioOk = false;
    let audioDetail = 'No audio input detected';
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      if (audioInputs.length > 0) {
        audioOk = true;
        audioDetail = `${audioInputs.length} Microphone(s) detected`;
      }
    } catch (e: any) {
      audioDetail = `Audio error: ${e.message}`;
    }

    // 4. Check IndexedDB
    let idbOk = false;
    let idbDetail = 'IndexedDB unavailable';
    try {
      if (window.indexedDB) {
        idbOk = true;
        idbDetail = 'IndexedDB active for offline-resilient upload queue';
      }
    } catch (e) {}

    // 5. MediaRecorder Codec
    let mrOk = false;
    let mrDetail = 'MediaRecorder unsupported';
    try {
      if (window.MediaRecorder) {
        const supported = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].filter((m) =>
          MediaRecorder.isTypeSupported(m)
        );
        mrOk = supported.length > 0;
        mrDetail = `Supported codecs: ${supported.join(', ') || 'basic webm'}`;
      }
    } catch (e) {}

    setHealthResults({
      backend: {
        status: backendRes.online,
        detail: backendRes.online
          ? `Online (Version ${backendRes.version || '2.9'})`
          : `Unavailable: ${backendRes.error || 'Check Web App URL'}`,
      },
      camera: { status: cameraOk, detail: cameraDetail },
      audio: { status: audioOk, detail: audioDetail },
      indexedDB: { status: idbOk, detail: idbDetail },
      mediaRecorder: { status: mrOk, detail: mrDetail },
    });

    setChecking(false);
    onShowToast('Diagnostics check completed.', 'info');
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  const items = [
    {
      title: 'Google Apps Script Backend API',
      icon: Cloud,
      ...healthResults.backend,
    },
    {
      title: 'Packing Camera Device',
      icon: Camera,
      ...healthResults.camera,
    },
    {
      title: 'Microphone & Audio Input',
      icon: Mic,
      ...healthResults.audio,
    },
    {
      title: 'Offline Storage (IndexedDB Queue)',
      icon: Database,
      ...healthResults.indexedDB,
    },
    {
      title: 'Video Encoding Engine (MediaRecorder)',
      icon: Cpu,
      ...healthResults.mediaRecorder,
    },
  ];

  return (
    <div id="system-health-container" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 tracking-tight flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            System Diagnostics & Health Check
          </h2>
          <p className="text-sm text-slate-500">
            Verify workstation hardware and cloud connectivity status.
          </p>
        </div>
        <button
          onClick={runDiagnostics}
          disabled={checking}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
          Run Diagnostics
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((it, i) => {
          const Icon = it.icon;
          return (
            <div
              key={i}
              className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-start gap-3.5"
            >
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                  it.status ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-900">{it.title}</h4>
                  {it.status ? (
                    <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Notice
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1 break-words">{it.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
