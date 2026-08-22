import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  Video,
  StopCircle,
  Play,
  RotateCcw,
  Sparkles,
  Barcode,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Layers,
  Maximize2,
  Minimize2,
  Mic,
  MicOff,
  SwitchCamera,
  FolderSync,
  Focus,
  Crosshair,
  Sparkle
} from 'lucide-react';
import { PlatformType, RecordingType, QueueItem } from '../types';
import { dbPutQueue } from '../lib/storage';
import { checkDuplicate } from '../lib/api';
import { triggerUploadWorker } from '../lib/uploadWorker';

interface ScanRecordProps {
  onQueueUpdated: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  currentUser: { name: string; email: string; role: string } | null;
}

export const ScanRecord: React.FC<ScanRecordProps> = ({
  onQueueUpdated,
  onShowToast,
  currentUser,
}) => {
  const [orderId, setOrderId] = useState('');
  const [recordingType, setRecordingType] = useState<RecordingType>('Forward');
  const [platform, setPlatform] = useState<PlatformType>('Amazon');
  const [customPlatform, setCustomPlatform] = useState('');
  
  const effectivePlatform = platform === 'Custom' ? customPlatform.trim() || 'Custom' : platform;

  // Camera & Stream State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [recSeconds, setRecSeconds] = useState(0);
  const [estimatedSizeMb, setEstimatedSizeMb] = useState(0);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [isBarcodeMode, setIsBarcodeMode] = useState(false);
  const [isDuplicateChecking, setIsDuplicateChecking] = useState(false);
  const [isFocusing, setIsFocusing] = useState(false);
  const [cameraResolution, setCameraResolution] = useState<{ width: number; height: number }>({ width: 1920, height: 1080 });
  const [duplicateWarning, setDuplicateWarning] = useState<{
    orderId: string;
    platform: string;
    recordingType: string;
    existing: any;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const barcodeBufferRef = useRef<string>('');
  const barcodeTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const [currentLiveTime, setCurrentLiveTime] = useState<string>('');

  // Component unmount cleanup: shut down hardware camera tracks when leaving the screen
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Update live clock for HUD every second
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      const dateStr = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
      const timeStr = d.toLocaleTimeString('en-GB', { hour12: false }); // HH:MM:SS
      setCurrentLiveTime(`${dateStr} ${timeStr}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Continuous Canvas Frame & Timestamp Watermark Renderer (Authentic Camera OSD)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isRunning = true;

    const renderWatermarkedFrame = () => {
      if (!isRunning) return;

      const video = videoRef.current;
      if (video && isCameraActive && video.readyState >= 2) {
        const vWidth = video.videoWidth || 1280;
        const vHeight = video.videoHeight || 720;

        if (canvas.width !== vWidth || canvas.height !== vHeight) {
          canvas.width = vWidth;
          canvas.height = vHeight;
        }

        // 1. Draw raw video frame with high quality smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(video, 0, 0, vWidth, vHeight);

        // 2. Proportional scale based on resolution
        const scale = Math.max(0.8, vWidth / 1280);

        // Date and Time formatting (Industrial YYYY-MM-DD HH:MM:SS)
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const timeStr = `${hh}:${min}:${ss}`;
        const fullDateTimeStr = `${dateStr}  ${timeStr}`;

        const fontSize = Math.round(18 * scale);
        ctx.font = `600 ${fontSize}px "SF Mono", "Consolas", "Menlo", "Courier New", monospace`;
        ctx.textBaseline = 'top';

        const paddingX = Math.round(10 * scale);
        const paddingY = Math.round(6 * scale);
        const margin = Math.round(16 * scale);

        // --- TOP RIGHT: Real CCTV Timestamp OSD ---
        const timeTextWidth = ctx.measureText(fullDateTimeStr).width;
        const timeBoxWidth = timeTextWidth + paddingX * 2;
        const timeBoxHeight = fontSize + paddingY * 2;
        const timeBoxX = vWidth - timeBoxWidth - margin;
        const timeBoxY = margin;

        // Subtle dark translucent background for high legibility
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(timeBoxX, timeBoxY, timeBoxWidth, timeBoxHeight);

        // Crisp white text with subtle shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = 2;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(fullDateTimeStr, timeBoxX + paddingX, timeBoxY + paddingY);

        // --- TOP LEFT: Order ID & Tracking OSD ---
        const currentOrder = orderId.trim() || 'UNASSIGNED';
        const metaLine1 = `ORD: ${currentOrder}`;
        const metaLine2 = `${effectivePlatform.toUpperCase()} [${recordingType.toUpperCase()}]`;

        const metaLine1Width = ctx.measureText(metaLine1).width;
        const metaLine2Width = ctx.measureText(metaLine2).width;
        const infoBoxWidth = Math.max(metaLine1Width, metaLine2Width) + paddingX * 2;
        const lineHeight = fontSize + Math.round(4 * scale);
        const infoBoxHeight = lineHeight * 2 + paddingY * 2 - Math.round(4 * scale);
        const infoBoxX = margin;
        const infoBoxY = margin;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(infoBoxX, infoBoxY, infoBoxWidth, infoBoxHeight);

        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(metaLine1, infoBoxX + paddingX, infoBoxY + paddingY);
        ctx.fillStyle = '#CBD5E1';
        ctx.fillText(metaLine2, infoBoxX + paddingX, infoBoxY + paddingY + lineHeight);

        // --- BOTTOM RIGHT (If Recording): Clean REC indicator ---
        if (isRecording) {
          const recText = '● REC';
          const recWidth = ctx.measureText(recText).width;
          const recBoxWidth = recWidth + paddingX * 2;
          const recBoxHeight = fontSize + paddingY * 2;
          const recBoxX = vWidth - recBoxWidth - margin;
          const recBoxY = vHeight - recBoxHeight - margin;

          ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
          ctx.fillRect(recBoxX, recBoxY, recBoxWidth, recBoxHeight);

          ctx.fillStyle = '#EF4444';
          ctx.fillText(recText, recBoxX + paddingX, recBoxY + paddingY);
        }

        // Reset shadow for next frame
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }

      animFrameRef.current = requestAnimationFrame(renderWatermarkedFrame);
    };

    animFrameRef.current = requestAnimationFrame(renderWatermarkedFrame);

    return () => {
      isRunning = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isCameraActive, isRecording, orderId, effectivePlatform, recordingType, currentUser]);

  // Discover connected camera devices
  useEffect(() => {
    async function loadDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setCameraDevices(videoInputs);
        if (videoInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      } catch (err) {
        console.warn('Unable to enumerate devices:', err);
      }
    }
    loadDevices();
  }, []);

  // Listen for physical barcode scanner rapid keystrokes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in other inputs
      const target = e.target as HTMLElement;
      if (target && target.tagName === 'INPUT' && target.id !== 'orderIdInput') {
        return;
      }

      const now = Date.now();
      if (now - barcodeTimeRef.current > 100) {
        barcodeBufferRef.current = '';
      }
      barcodeTimeRef.current = now;

      if (e.key === 'Enter') {
        if (barcodeBufferRef.current.length >= 3) {
          const scanned = barcodeBufferRef.current.trim();
          setOrderId(scanned);
          onShowToast(`Scanned Order: ${scanned}`, 'success');
          barcodeBufferRef.current = '';
          e.preventDefault();
        }
      } else if (e.key.length === 1) {
        barcodeBufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onShowToast]);

  const startCamera = async (deviceId?: string) => {
    setStatusMessage({ text: 'Initializing high-definition camera stream with auto-focus…', type: 'info' });
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      let newStream: MediaStream | null = null;
      let lastErr: any = null;

      // Stage 1: Ultra-HD / 1080p-4K resolution with continuous autofocus & audio
      try {
        const stage1Constraints = {
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            facingMode: deviceId ? undefined : { ideal: 'environment' },
            width: { ideal: 1920, max: 3840 },
            height: { ideal: 1080, max: 2160 },
            frameRate: { ideal: 30, max: 60 },
            focusMode: { ideal: 'continuous' },
            advanced: [
              { focusMode: 'continuous' },
              { exposureMode: 'continuous' },
              { whiteBalanceMode: 'continuous' }
            ]
          } as any,
          audio: audioEnabled,
        };
        newStream = await navigator.mediaDevices.getUserMedia(stage1Constraints);
      } catch (err1) {
        lastErr = err1;
        console.warn('Stage 1 Ultra-HD camera init failed, trying 1080p video-only:', err1);
      }

      // Stage 2: 1080p Video-only with autofocus constraints
      if (!newStream) {
        try {
          const stage2Constraints = {
            video: {
              deviceId: deviceId ? { exact: deviceId } : undefined,
              facingMode: deviceId ? undefined : { ideal: 'environment' },
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
              advanced: [{ focusMode: 'continuous' }]
            } as any,
            audio: false,
          };
          newStream = await navigator.mediaDevices.getUserMedia(stage2Constraints);
        } catch (err2) {
          lastErr = err2;
          console.warn('Stage 2 camera init failed, trying basic video:', err2);
        }
      }

      // Stage 3: Most permissive basic video constraint
      if (!newStream) {
        try {
          newStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch (err3) {
          lastErr = err3;
          console.error('Stage 3 basic camera init failed:', err3);
        }
      }

      if (!newStream) {
        throw lastErr || new Error('No camera stream could be acquired');
      }

      // Apply and lock Continuous Auto-Focus on camera hardware track
      try {
        const videoTrack = newStream.getVideoTracks()[0];
        if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
          const caps: any = typeof videoTrack.getCapabilities === 'function' ? videoTrack.getCapabilities() : {};
          const adv: any = {};
          if (caps.focusMode && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
            adv.focusMode = 'continuous';
          }
          if (caps.exposureMode && Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
            adv.exposureMode = 'continuous';
          }
          if (caps.whiteBalanceMode && Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes('continuous')) {
            adv.whiteBalanceMode = 'continuous';
          }
          if (Object.keys(adv).length > 0) {
            await videoTrack.applyConstraints({ advanced: [adv] } as any);
          }
          const settings = typeof videoTrack.getSettings === 'function' ? videoTrack.getSettings() : {};
          if (settings.width && settings.height) {
            setCameraResolution({ width: settings.width, height: settings.height });
          }
        }
      } catch (afErr) {
        console.warn('Continuous auto-focus hardware track initialization notice:', afErr);
      }

      streamRef.current = newStream;
      setIsCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.muted = true;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        try {
          await videoRef.current.play();
        } catch (pErr) {
          console.warn('Camera preview auto-play info:', pErr);
        }
      }

      setStatusMessage({ text: 'High-definition camera active with continuous auto-focus.', type: 'success' });
    } catch (err: any) {
      console.error('Camera open failed:', err);
      setIsCameraActive(false);
      setStatusMessage({
        text: `Camera access note: ${err.message || 'Please allow camera permission in browser.'}`,
        type: 'error',
      });
      onShowToast('Could not access camera. Please check camera permissions.', 'error');
    }
  };

  const stopCamera = () => {
    if (isRecording) {
      stopRecording();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setIsRecording(false);
    setRecSeconds(0);
    setEstimatedSizeMb(0);
    setStatusMessage(null);
  };

  const triggerAutoFocus = async () => {
    if (!streamRef.current) {
      onShowToast('Camera is not active. Open camera first.', 'info');
      return;
    }
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    setIsFocusing(true);
    try {
      const caps: any = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
      if (typeof track.applyConstraints === 'function') {
        if (caps.focusMode && Array.isArray(caps.focusMode)) {
          if (caps.focusMode.includes('single-shot')) {
            await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] } as any);
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (caps.focusMode.includes('continuous')) {
            await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any);
          }
        }
      }
      onShowToast('Camera auto-focus calibrated on packing product', 'success');
    } catch (e) {
      console.warn('Auto focus trigger note:', e);
      onShowToast('Auto-focus refreshed', 'info');
    } finally {
      setTimeout(() => setIsFocusing(false), 500);
    }
  };

  const handleToggleCamera = async () => {
    if (isCameraActive) {
      stopCamera();
    } else {
      // Non-blocking duplicate check if order ID is present
      if (orderId.trim()) {
        setIsDuplicateChecking(true);
        checkDuplicate({
          orderId: orderId.trim(),
          platform: effectivePlatform,
          recordingType,
        })
          .then((existing) => {
            if (existing) {
              onShowToast(
                `Notice: Order ${orderId} already has a ${recordingType} video recorded in Drive.`,
                'info'
              );
            }
          })
          .catch(() => {})
          .finally(() => setIsDuplicateChecking(false));
      }

      await startCamera(selectedDeviceId);
    }
  };

  const handleToggleAudio = () => {
    const nextState = !audioEnabled;
    setAudioEnabled(nextState);
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      audioTracks.forEach((t) => {
        t.enabled = nextState;
      });
    }
    onShowToast(nextState ? 'Microphone enabled' : 'Microphone disabled (muted)', 'info');
  };

  const chooseMimeType = (): string => {
    const types = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return 'video/webm';
  };

  const startRecording = async (bypassDuplicateCheck = false) => {
    if (!orderId.trim()) {
      setStatusMessage({ text: 'Please enter or scan an Order ID before recording.', type: 'error' });
      onShowToast('Scan or enter Order ID to record', 'error');
      return;
    }
    if (platform === 'Custom' && !customPlatform.trim()) {
      setStatusMessage({ text: 'Please specify the Custom Platform name.', type: 'error' });
      onShowToast('Specify custom platform name', 'error');
      return;
    }

    // Check duplicate order ID if not explicitly bypassed
    if (!bypassDuplicateCheck) {
      setIsDuplicateChecking(true);
      try {
        const existing = await checkDuplicate({
          orderId: orderId.trim(),
          platform: effectivePlatform,
          recordingType,
        });
        if (existing) {
          setIsDuplicateChecking(false);
          setDuplicateWarning({
            orderId: orderId.trim(),
            platform: effectivePlatform,
            recordingType,
            existing,
          });
          return;
        }
      } catch (e) {
        console.warn('Duplicate pre-check warning:', e);
      } finally {
        setIsDuplicateChecking(false);
      }
    }

    if (!streamRef.current || !isCameraActive) {
      await startCamera(selectedDeviceId);
      if (!streamRef.current) return;
    }

    recordedChunksRef.current = [];
    const mimeType = chooseMimeType();

    // Acquire recording stream: prioritize timestamp-watermarked canvas stream
    let recordStream: MediaStream = streamRef.current;
    if (canvasRef.current && typeof canvasRef.current.captureStream === 'function') {
      try {
        const canvasStream = canvasRef.current.captureStream(30);
        // Transfer microphone audio tracks if available & audio enabled
        if (streamRef.current && audioEnabled) {
          const audioTracks = streamRef.current.getAudioTracks();
          audioTracks.forEach((track) => {
            if (track.enabled) {
              canvasStream.addTrack(track);
            }
          });
        }
        recordStream = canvasStream;
      } catch (cErr) {
        console.warn('Canvas stream capture fallback to camera stream:', cErr);
        recordStream = streamRef.current;
      }
    }

    try {
      mediaRecorderRef.current = new MediaRecorder(recordStream, {
        mimeType,
        videoBitsPerSecond: 8000000, // 8 Mbps Highest Quality for crystal clear barcodes & product text
        audioBitsPerSecond: 128000,
      });
    } catch {
      mediaRecorderRef.current = new MediaRecorder(recordStream);
    }

    mediaRecorderRef.current.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
        const totalBytes = recordedChunksRef.current.reduce((acc, c) => acc + c.size, 0);
        setEstimatedSizeMb(Number((totalBytes / (1024 * 1024)).toFixed(2)));
      }
    };

    mediaRecorderRef.current.onstop = () => handleFinishRecording();
    mediaRecorderRef.current.start(500); // 500ms chunks

    setIsRecording(true);
    setIsPaused(false);
    setRecSeconds(0);

    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = window.setInterval(() => {
      setRecSeconds((prev) => prev + 1);
    }, 1000);

    setStatusMessage({ text: 'Recording packing process…', type: 'info' });
    onShowToast('Recording started', 'info');
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setIsRecording(false);
  };

  const handleFinishRecording = async () => {
    try {
      const mimeType = mediaRecorderRef.current?.mimeType || 'video/webm';
      const ext = mimeType.includes('mp4') ? '.mp4' : '.webm';
      const cleanOrderId = orderId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const cleanPlatform = effectivePlatform.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${cleanOrderId}_${cleanPlatform}_${recordingType}${ext}`;

      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);
      const todayDateStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

      // Automatically download to computer's local drive
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Video recorded successfully and stored automatically in IndexedDB & queued for Google Drive sync without prompting Save As dialog
      const queueItem: QueueItem = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        orderId: orderId.trim(),
        platform: effectivePlatform,
        recordingType,
        fileName,
        fileSize: blob.size,
        mimeType,
        source: 'Automatic Recording',
        blob,
        status: 'pending',
        progress: 0,
        recordingDate: todayDateStr,
      };

      await dbPutQueue(queueItem);
      onQueueUpdated();
      triggerUploadWorker();

      onShowToast(`Video recorded (${sizeMb} MB) & queued for automatic Drive upload!`, 'success');
      setStatusMessage({
        text: `Completed: ${fileName} saved & queued for Drive upload. Camera feed remains active for next order.`,
        type: 'success',
      });

      // Clear for next order
      setOrderId('');
    } catch (err: any) {
      console.error('Save recording failed:', err);
      onShowToast(`Error saving video: ${err.message}`, 'error');
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div id="scan-record-container" className="space-y-6">
      {/* Top Status Banner */}
      <div id="scan-record-header" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 tracking-tight flex items-center gap-2">
            <Camera className="w-5 h-5 text-blue-600" />
            Scan & Record Station
          </h2>
          <p className="text-sm text-slate-500">
            Live video capture with automatic local backup and Google Drive sync.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            id="camera-status-chip"
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
              isRecording
                ? 'bg-red-50 text-red-700 border border-red-200 animate-pulse'
                : isCameraActive
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-600 border border-slate-200'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isRecording ? 'bg-red-600' : isCameraActive ? 'bg-emerald-600' : 'bg-slate-400'
              }`}
            />
            {isRecording ? `Recording (${formatTimer(recSeconds)})` : isCameraActive ? 'Camera Ready' : 'Camera Off'}
          </span>
        </div>
      </div>

      {/* Main Grid: Camera Preview on Left, Order Form on Right */}
      <div id="scan-record-grid" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Camera Column (10 Cols on LG for extra wide preview) */}
        <div id="camera-viewport-card" className="lg:col-span-10 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          {/* Camera Header Controls */}
          <div className="p-3 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Video className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-medium uppercase tracking-wider text-slate-300">
                Packing Lens View
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              {cameraDevices.length > 1 && (
                <div className="flex items-center gap-1 text-xs">
                  <SwitchCamera className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    id="camera-device-select"
                    aria-label="Camera Device"
                    className="bg-slate-800 text-slate-200 text-xs rounded px-2 py-1 border border-slate-700 focus:outline-none"
                    value={selectedDeviceId}
                    onChange={(e) => {
                      setSelectedDeviceId(e.target.value);
                      if (isCameraActive) startCamera(e.target.value);
                    }}
                  >
                    {cameraDevices.map((dev, idx) => (
                      <option key={dev.deviceId || idx} value={dev.deviceId}>
                        {dev.label || `Camera ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}


            </div>
          </div>

          {/* Viewport Box */}
          <div
            id="camera-video-container"
            className="relative bg-slate-950 flex items-center justify-center overflow-hidden aspect-video min-h-[480px]"
          >
            {/* Hidden Canvas for Timestamp Stamping & Recording Capture */}
            <canvas ref={canvasRef} className="hidden" />

            <video
              id="camera-live-video"
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={`w-full h-full object-cover ${!isCameraActive ? 'hidden' : ''}`}
            />

            {!isCameraActive && (
              <div id="camera-idle-placeholder" className="p-8 text-center flex flex-col items-center justify-center max-w-sm">
                <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mb-3 shadow-inner">
                  <Camera className="w-8 h-8 text-slate-500" />
                </div>
                <h4 className="text-sm font-medium text-slate-200 mb-1">Camera Preview Inactive</h4>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  Enter or scan an Order ID and click below to launch the camera feed.
                </p>
                <button
                  id="start-camera-idle-btn"
                  onClick={handleToggleCamera}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition inline-flex items-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  Open Camera Feed
                </button>
              </div>
            )}

            {/* In-Video Recording HUD (Authentic Camera OSD) */}
            {isCameraActive && (
              <div id="camera-active-hud" className="absolute top-3 left-3 right-3 flex items-start justify-between pointer-events-none text-[11px] sm:text-xs font-mono font-medium">
                {/* Top-Left: Metadata Box */}
                <div className="bg-black/60 backdrop-blur-xs text-white px-2.5 py-1.5 rounded space-y-0.5 shadow-sm border border-white/10">
                  <div className="text-white font-semibold tracking-wide">
                    ORD: {orderId.trim() || 'UNASSIGNED'}
                  </div>
                  <div className="text-slate-300 text-[10px]">
                    {effectivePlatform.toUpperCase()} [{recordingType.toUpperCase()}]
                  </div>
                </div>

                {/* Top-Right: Timestamp, Resolution & Auto-Focus */}
                <div className="flex flex-col items-end gap-1.5">
                  <div className="bg-black/60 backdrop-blur-xs text-white px-2.5 py-1.5 rounded shadow-sm border border-white/10 tracking-wider">
                    {currentLiveTime || new Date().toISOString().replace('T', ' ').slice(0, 19)}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="bg-black/70 backdrop-blur-xs text-emerald-400 text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-500/30 flex items-center gap-1">
                      <Focus className="w-3 h-3 text-emerald-400" />
                      AUTO-FOCUS
                    </span>

                    <span className="bg-black/70 backdrop-blur-xs text-blue-300 text-[10px] font-mono px-2 py-0.5 rounded border border-blue-500/30">
                      {cameraResolution.width}x{cameraResolution.height} HD
                    </span>
                  </div>

                  {isRecording && (
                    <div className="bg-black/70 backdrop-blur-xs text-red-400 px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1.5 shadow-sm border border-red-500/30">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      REC {formatTimer(recSeconds)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Camera Action Toolbar */}
          <div id="camera-controls-toolbar" className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {!isCameraActive ? (
                <button
                  id="open-camera-primary-btn"
                  onClick={handleToggleCamera}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg shadow-sm transition inline-flex items-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  Open Camera Feed
                </button>
              ) : (
                <>
                  {!isRecording ? (
                    <button
                      id="start-recording-btn"
                      onClick={() => startRecording(false)}
                      disabled={isDuplicateChecking}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm rounded-lg shadow-sm transition inline-flex items-center gap-2"
                    >
                      <Play className="w-4 h-4 fill-white" />
                      {isDuplicateChecking ? 'Checking Duplicate…' : 'Start Recording'}
                    </button>
                  ) : (
                    <button
                      id="stop-recording-btn"
                      onClick={stopRecording}
                      className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-lg shadow-md transition inline-flex items-center gap-2 animate-pulse"
                      title="Stops recording, saves video to Drive queue, and keeps camera active for next order"
                    >
                      <StopCircle className="w-4 h-4" />
                      Stop & Save Video
                    </button>
                  )}

                  <button
                    id="close-camera-btn"
                    onClick={stopCamera}
                    className="px-3.5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm rounded-lg font-medium transition inline-flex items-center gap-1.5"
                    title="Turns off camera sensor"
                  >
                    Turn Off Camera
                  </button>

                  <button
                    id="trigger-autofocus-btn"
                    onClick={triggerAutoFocus}
                    disabled={isFocusing}
                    className="px-3.5 py-2.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-sm rounded-lg font-semibold transition inline-flex items-center gap-1.5 cursor-pointer"
                    title="Triggers instant camera auto-focus on packing product and barcodes"
                  >
                    <Crosshair className={`w-4 h-4 text-amber-600 ${isFocusing ? 'animate-spin' : ''}`} />
                    {isFocusing ? 'Focusing Lens…' : 'Auto-Focus Lens'}
                  </button>
                </>
              )}
            </div>

            {/* Metrics & Toggles */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
              {isRecording && (
                <div className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-md border border-slate-200 shadow-xs">
                  <span>Size:</span>
                  <b className="font-mono text-slate-800">{estimatedSizeMb} MB</b>
                </div>
              )}

              <button
                id="toggle-mic-btn"
                onClick={handleToggleAudio}
                className={`p-2 rounded-lg border text-xs transition ${
                  audioEnabled
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-slate-100 border-slate-200 text-slate-400'
                }`}
                title={audioEnabled ? 'Microphone On (Click to mute)' : 'Microphone Disabled / Muted (Click to enable)'}
              >
                {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {statusMessage && (
            <div
              id="camera-status-alert"
              className={`px-4 py-2.5 text-xs font-medium flex items-center gap-2 border-t ${
                statusMessage.type === 'error'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : statusMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}
            >
              {statusMessage.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}
        </div>

        {/* Order Information Column (2 Cols on LG) */}
        <div id="order-details-card" className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">Order Information</h3>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                Auto-Backup Active
              </span>
            </div>

            {/* Order ID Input with Barcode indicator */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="orderIdInput" className="text-xs font-semibold text-slate-700">Order ID / Tracking Number</label>
                <span className="text-[11px] text-blue-600 flex items-center gap-1">
                  <Barcode className="w-3.5 h-3.5" />
                  USB Scanner Ready
                </span>
              </div>
              <div className="relative">
                <input
                  id="orderIdInput"
                  type="text"
                  placeholder="Scan barcode or type Order ID"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 font-mono placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {orderId && (
                  <button
                    onClick={() => setOrderId('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Recording Type */}
            <div>
              <label htmlFor="recordingTypeSelect" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Recording Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['Forward', 'Return'] as RecordingType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setRecordingType(type)}
                    className={`px-3 py-2.5 rounded-lg text-xs font-semibold border text-center transition ${
                      recordingType === type
                        ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-xs ring-1 ring-blue-500'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Platform Selection */}
            <div>
              <label htmlFor="platformSelect" className="block text-xs font-semibold text-slate-700 mb-1.5">
                E-Commerce Platform
              </label>
              <select
                id="platformSelect"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as PlatformType)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Amazon">Amazon</option>
                <option value="D2C">D2C</option>
                <option value="JioMart">JioMart</option>
                <option value="Custom">Custom</option>
              </select>

              {platform === 'Custom' && (
                <input
                  type="text"
                  placeholder="Enter custom platform name"
                  value={customPlatform}
                  onChange={(e) => setCustomPlatform(e.target.value)}
                  className="mt-2 w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>

            {/* Drive Storage Path Blueprint */}
            <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 text-xs space-y-1.5">
              <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                <FolderSync className="w-3.5 h-3.5 text-blue-600" />
                Google Drive Storage Hierarchy
              </div>
              <p className="font-mono text-[11px] text-slate-600 break-all bg-white p-2 rounded border border-slate-200">
                VMS_Packing_Videos / {effectivePlatform} / {recordingType} / {new Date().toISOString().slice(0, 10)} / {orderId ? `${orderId.trim()}_${effectivePlatform}_${recordingType}.mp4` : '[OrderID]_[Platform]_[Type].mp4'}
              </p>
              <p className="text-[11px] text-slate-400">
                Uploaded automatically chunk-by-chunk directly into your configured Google Sheet & Drive.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Duplicate Order Warning Modal */}
      {duplicateWarning && (
        <div
          id="duplicate-warning-modal"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-amber-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 bg-amber-500 text-white flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <h3 className="font-bold text-sm tracking-tight">Duplicate Order ID Detected</h3>
            </div>

            <div className="p-5 space-y-3.5 text-xs text-slate-600">
              <p className="text-slate-800 font-medium">
                Order <span className="font-mono font-bold text-blue-700">{duplicateWarning.orderId}</span> has already been recorded and logged in Google Drive & Google Sheet.
              </p>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Platform:</span>
                  <span className="text-slate-800 font-semibold">{duplicateWarning.platform}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Recording Type:</span>
                  <span className="text-slate-800 font-semibold">{duplicateWarning.recordingType}</span>
                </div>
                {duplicateWarning.existing?.timestamp && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Previous Date:</span>
                    <span className="text-slate-800">
                      {new Date(duplicateWarning.existing.timestamp).toLocaleString()}
                    </span>
                  </div>
                )}
                {duplicateWarning.existing?.packerEmail && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Recorded By:</span>
                    <span className="text-slate-800">{duplicateWarning.existing.packerEmail}</span>
                  </div>
                )}
              </div>

              {duplicateWarning.existing?.playbackUrl && (
                <div className="pt-1">
                  <a
                    href={duplicateWarning.existing.playbackUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium rounded-lg border border-blue-200 transition"
                  >
                    <FolderSync className="w-3.5 h-3.5" />
                    Open Existing Video in Google Drive
                  </a>
                </div>
              )}

              <p className="text-slate-500 text-[11px] leading-relaxed">
                Do you want to proceed and record a new video anyway, or cancel to scan a different order?
              </p>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                id="cancel-duplicate-btn"
                onClick={() => setDuplicateWarning(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-medium text-xs transition"
              >
                Cancel / Change Order
              </button>
              <button
                id="proceed-duplicate-btn"
                onClick={() => {
                  setDuplicateWarning(null);
                  startRecording(true); // Bypass duplicate check
                }}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shadow-sm transition"
              >
                Proceed & Record Anyway
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
};
