import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  CameraOff,
  Video,
  StopCircle,
  Play,
  RotateCcw,
  Sparkles,
  Barcode,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Layers,
  Maximize2,
  Minimize2,
  Mic,
  MicOff,
  SwitchCamera,
  FolderSync,
  Focus,
  Crosshair,
  Sparkle,
  Target,
  Box,
  Grid3X3,
  PackageCheck,
  ShieldAlert,
  ExternalLink,
  RefreshCw,
  Smartphone,
  QrCode,
  Radio,
  Lock,
  Shield,
  XCircle
} from 'lucide-react';
import { PlatformType, RecordingType, QueueItem } from '../types';
import { dbPutQueue, dbGetAllQueue, getStoredDuplicatePolicy, DuplicatePolicy } from '../lib/storage';
import { checkDuplicate, requestApi, normalizeOrderId } from '../lib/api';
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
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);
  const [isBarcodeMode, setIsBarcodeMode] = useState(false);
  const [isDuplicateChecking, setIsDuplicateChecking] = useState(false);
  const [detectedDuplicate, setDetectedDuplicate] = useState<any | null>(null);
  const [isFocusing, setIsFocusing] = useState(false);
  const [cameraResolution, setCameraResolution] = useState<{ width: number; height: number }>({ width: 1920, height: 1080 });
  const [duplicateWarning, setDuplicateWarning] = useState<{
    orderId: string;
    platform: string;
    recordingType: string;
    existing: any;
  } | null>(null);

  // AI Virtual Packing Framing & Focus Zone
  const [showAiPackingZone, setShowAiPackingZone] = useState<boolean>(() => {
    return localStorage.getItem('vms_ai_packing_zone') !== 'false';
  });
  const [packingZonePreset, setPackingZonePreset] = useState<'standard' | 'flyer' | 'carton' | 'grid'>(() => {
    return (localStorage.getItem('vms_ai_zone_preset') as any) || 'standard';
  });
  const [focusClickPoint, setFocusClickPoint] = useState<{ x: number; y: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const barcodeBufferRef = useRef<string>('');
  const barcodeTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const bypassDuplicateRef = useRef<boolean>(false);
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
  const loadDevices = async () => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setCameraDevices(videoInputs);
      if (videoInputs.length > 0) {
        const exists = videoInputs.some((d) => d.deviceId && d.deviceId === selectedDeviceId);
        if (!exists && videoInputs[0].deviceId) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      }
    } catch (err) {
      console.warn('Unable to enumerate devices:', err);
    }
  };

  useEffect(() => {
    loadDevices();

    if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
      navigator.mediaDevices.addEventListener('devicechange', loadDevices);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
      };
    }
  }, [selectedDeviceId]);

  // Monitor permission state changes if supported
  useEffect(() => {
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      navigator.permissions
        .query({ name: 'camera' as any })
        .then((permStatus) => {
          if (permStatus.state === 'granted') {
            setCameraPermissionError(null);
          } else if (permStatus.state === 'denied') {
            setCameraPermissionError('Camera access is blocked by your browser settings.');
          }
          permStatus.onchange = () => {
            if (permStatus.state === 'granted') {
              setCameraPermissionError(null);
              loadDevices();
            } else if (permStatus.state === 'denied') {
              setCameraPermissionError('Camera access is blocked by your browser settings.');
            }
          };
        })
        .catch(() => {});
    }
  }, []);

  const cleanBarcode = (raw: string): string => {
    if (!raw) return '';
    let cleaned = String(raw).trim();
    
    // Remove non-printable control characters (ASCII 0-31, 127)
    cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, '');
    
    // Remove standard AIM symbology identifiers sent by barcode scanners (e.g. ]C0, ]C1, ]A0, ]e0, ]Q1)
    cleaned = cleaned.replace(/^\][a-zA-Z0-9]{2,3}/, '');

    // Normalize spacing
    cleaned = cleaned.trim();

    // If multi-line (e.g. 2D barcode payload)
    if (cleaned.includes('\n') || cleaned.includes('\r') || cleaned.includes('\t')) {
      const lines = cleaned.split(/[\r\n\t]+/).map((s) => s.trim()).filter(Boolean);
      const odLine = lines.find((l) => /^#?OD[-\d_]/i.test(l) || /^#?ORD[-\d_]/i.test(l));
      if (odLine) {
        return cleanBarcode(odLine);
      }
      if (lines.length > 0) {
        return cleanBarcode(lines[0]);
      }
    }

    // Remove common label header prefixes like "ORD: " or "ORDER: "
    if (/^(ORD|ORDER|ORDER\s*ID|INVOICE|INV)[:\s]+/i.test(cleaned)) {
      cleaned = cleaned.replace(/^(ORD|ORDER|ORDER\s*ID|INVOICE|INV)[:\s]+/i, '');
    }

    // Remove wrapping quotes or brackets
    cleaned = cleaned.replace(/^["'(\[{<]+|["')\]}>]+$/g, '').trim();

    return cleaned;
  };

  // Auto-detect platform and recording type based on barcode pattern
  const detectPlatformAndType = (barcode: string) => {
    if (!barcode) return;
    const lower = barcode.toLowerCase().trim();
    
    // Detect Return keywords
    if (/^ret[-_]/i.test(lower) || /[-_]ret$/i.test(lower) || lower.includes('return') || lower.includes('-r-') || lower.includes('_ret')) {
      setRecordingType('Return');
    }
    
    // Detect Platform
    if (
      lower.startsWith('amz') || 
      lower.startsWith('40') || 
      lower.startsWith('17') ||
      /^\d{3}-\d{7}-\d{7}$/.test(barcode.trim()) ||
      lower.includes('amazon')
    ) {
      setPlatform('Amazon');
    } else if (lower.startsWith('jio') || lower.startsWith('jm-') || lower.startsWith('r-') || lower.includes('jiomart')) {
      setPlatform('JioMart');
    } else if (
      lower.startsWith('#od') ||
      lower.startsWith('od') || 
      lower.startsWith('d2c') || 
      lower.startsWith('w-') || 
      lower.startsWith('sh-') || 
      lower.startsWith('fk-') ||
      /^\d{12,16}$/.test(barcode.trim()) || // 12-16 digit Delhivery/Shiprocket AWB e.g. 33737210019224
      lower.includes('delhivery') ||
      lower.includes('d2c')
    ) {
      setPlatform('D2C');
    }
  };

  // Listen for physical barcode scanner rapid keystrokes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in other inputs
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && target.id !== 'orderIdInput') {
        return;
      }

      const now = Date.now();
      if (now - barcodeTimeRef.current > 150) {
        barcodeBufferRef.current = '';
      }
      barcodeTimeRef.current = now;

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (barcodeBufferRef.current.length >= 2) {
          const raw = barcodeBufferRef.current;
          const cleaned = cleanBarcode(raw);
          if (cleaned) {
            setOrderId(cleaned);
            detectPlatformAndType(cleaned);
            onShowToast(`Scanned Order: ${cleaned}`, 'success');
            barcodeBufferRef.current = '';
            e.preventDefault();
            e.stopPropagation();
          }
        }
      } else if (e.key.length === 1) {
        barcodeBufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onShowToast]);

  // Debounced real-time duplicate check whenever Order ID, platform, or recording type changes
  useEffect(() => {
    const trimmed = orderId.trim();
    if (trimmed.length < 3) {
      setDetectedDuplicate(null);
      return;
    }

    let isCancelled = false;
    const timer = setTimeout(async () => {
      try {
        setIsDuplicateChecking(true);
        const normTarget = normalizeOrderId(trimmed);

        // 1. Check local IndexedDB queue (only completed records)
        const allQueue = await dbGetAllQueue();
        const localMatch = allQueue.find(
          (item) =>
            normalizeOrderId(item.orderId) === normTarget &&
            item.status === 'completed' &&
            (item.fileId || item.webViewLink)
        );

        if (localMatch && !isCancelled) {
          setDetectedDuplicate({
            orderId: localMatch.orderId,
            platform: localMatch.platform,
            recordingType: localMatch.recordingType,
            timestamp: new Date(localMatch.createdAt).toISOString(),
            packerEmail: currentUser?.email || 'operator@vms.local',
            playbackUrl: localMatch.webViewLink || '#',
          });
          setIsDuplicateChecking(false);
          return;
        }

        // 2. Check remote Google Sheets / Drive
        const remote = await checkDuplicate({
          orderId: trimmed,
          platform: effectivePlatform,
          recordingType,
        });

        if (!isCancelled) {
          if (remote && remote.fileId) {
            setDetectedDuplicate(remote);
          } else {
            setDetectedDuplicate(null);
          }
        }
      } catch (e) {
        if (!isCancelled) setDetectedDuplicate(null);
      } finally {
        if (!isCancelled) setIsDuplicateChecking(false);
      }
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [orderId, effectivePlatform, recordingType, currentUser]);

  const startCamera = async (deviceId?: string) => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setStatusMessage({ text: 'MediaDevices API not supported in this browser context.', type: 'error' });
      setCameraPermissionError('Your browser or iframe environment does not support camera capture.');
      return;
    }

    setCameraPermissionError(null);
    setStatusMessage({ text: 'Initializing high-definition camera stream with auto-focus…', type: 'info' });
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      let newStream: MediaStream | null = null;
      let lastErr: any = null;
      const targetDevId = deviceId || selectedDeviceId;

      // Stage 1: Ultra-HD / 1080p-4K resolution with continuous autofocus
      try {
        const stage1Constraints: MediaStreamConstraints = {
          video: {
            deviceId: targetDevId ? { ideal: targetDevId } : undefined,
            facingMode: targetDevId ? undefined : { ideal: 'environment' },
            width: { ideal: 1920, max: 3840 },
            height: { ideal: 1080, max: 2160 },
            frameRate: { ideal: 30, max: 60 },
            advanced: [
              { focusMode: 'continuous' },
              { exposureMode: 'continuous' },
              { whiteBalanceMode: 'continuous' }
            ]
          } as any,
          audio: false, // Keep video request isolated from microphone permission
        };
        newStream = await navigator.mediaDevices.getUserMedia(stage1Constraints);
      } catch (err1: any) {
        lastErr = err1;
        // If permission explicitly denied, do not try unnecessary stages
        if (
          err1?.name === 'NotAllowedError' ||
          err1?.name === 'PermissionDeniedError' ||
          String(err1?.message || '').toLowerCase().includes('permission denied')
        ) {
          throw err1;
        }
      }

      // Stage 2: 1080p Video-only with autofocus constraints
      if (!newStream) {
        try {
          const stage2Constraints: MediaStreamConstraints = {
            video: {
              deviceId: targetDevId ? { ideal: targetDevId } : undefined,
              facingMode: targetDevId ? undefined : { ideal: 'environment' },
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
              advanced: [{ focusMode: 'continuous' }]
            } as any,
            audio: false,
          };
          newStream = await navigator.mediaDevices.getUserMedia(stage2Constraints);
        } catch (err2: any) {
          lastErr = err2;
          if (
            err2?.name === 'NotAllowedError' ||
            err2?.name === 'PermissionDeniedError' ||
            String(err2?.message || '').toLowerCase().includes('permission denied')
          ) {
            throw err2;
          }
        }
      }

      // Stage 3: Most permissive basic video constraint
      if (!newStream) {
        try {
          newStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch (err3) {
          lastErr = err3;
        }
      }

      if (!newStream) {
        throw lastErr || new Error('No camera stream could be acquired');
      }

      // If audio is enabled, attempt to attach microphone audio track non-blockingly
      if (audioEnabled) {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const audioTrack = audioStream.getAudioTracks()[0];
          if (audioTrack) {
            newStream.addTrack(audioTrack);
          }
        } catch (micErr) {
          console.warn('Microphone audio track optional init notice:', micErr);
        }
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
      setCameraPermissionError(null);

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

      // Refresh camera devices list with actual device labels now that permission is active
      loadDevices();

      setStatusMessage({ text: 'High-definition camera active with continuous auto-focus.', type: 'success' });
    } catch (err: any) {
      console.error('Camera open failed:', err);
      setIsCameraActive(false);

      const isPermissionErr =
        err?.name === 'NotAllowedError' ||
        err?.name === 'PermissionDeniedError' ||
        String(err?.message || '').toLowerCase().includes('permission denied') ||
        String(err?.message || '').toLowerCase().includes('notallowed');

      if (isPermissionErr) {
        setCameraPermissionError(
          'Camera access was blocked by your browser. Please allow camera access in your browser address bar to record packing videos.'
        );
        setStatusMessage({
          text: 'Camera Permission Denied. Please allow camera in your browser address bar (lock/camera icon).',
          type: 'error',
        });
        onShowToast('Camera permission was blocked. Please click Allow in your browser.', 'error');
      } else {
        setStatusMessage({
          text: `Camera access note: ${err.message || 'Please connect a webcam.'}`,
          type: 'error',
        });
        onShowToast(`Could not access camera: ${err.message || 'Unknown error'}`, 'error');
      }
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

  const handleVideoContainerClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCameraActive || !streamRef.current) return;
    
    // Ignore clicks on buttons/controls inside the container
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('select') || target.closest('.no-focus-trigger')) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const percentX = Math.max(0, Math.min(1, clickX / rect.width));
    const percentY = Math.max(0, Math.min(1, clickY / rect.height));

    // Show temporary focus target animation
    setFocusClickPoint({ x: clickX, y: clickY });
    setTimeout(() => setFocusClickPoint(null), 1200);

    // Apply hardware point of interest focus
    try {
      const track = streamRef.current.getVideoTracks()[0];
      if (track && typeof track.applyConstraints === 'function') {
        const caps: any = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
        const adv: any = {};
        if (caps.pointsOfInterest) {
          adv.pointsOfInterest = [{ x: percentX, y: percentY }];
        }
        if (caps.focusMode && Array.isArray(caps.focusMode)) {
          if (caps.focusMode.includes('single-shot')) {
            adv.focusMode = 'single-shot';
          } else if (caps.focusMode.includes('continuous')) {
            adv.focusMode = 'continuous';
          }
        }
        if (Object.keys(adv).length > 0) {
          await track.applyConstraints({ advanced: [adv] } as any);
        }
      }
    } catch (err) {
      console.warn('Point of interest focus notice:', err);
    }
  };

  const toggleAiPackingZone = () => {
    const nextState = !showAiPackingZone;
    setShowAiPackingZone(nextState);
    localStorage.setItem('vms_ai_packing_zone', String(nextState));
    onShowToast(nextState ? 'AI Virtual Packing Guide enabled' : 'AI Packing Guide hidden', 'info');
  };

  const handleSelectZonePreset = (preset: 'standard' | 'flyer' | 'carton' | 'grid') => {
    setPackingZonePreset(preset);
    localStorage.setItem('vms_ai_zone_preset', preset);
    if (!showAiPackingZone) {
      setShowAiPackingZone(true);
      localStorage.setItem('vms_ai_packing_zone', 'true');
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

    const policy = getStoredDuplicatePolicy();

    // Check duplicate order ID if not explicitly bypassed
    if (!bypassDuplicateCheck) {
      setIsDuplicateChecking(true);
      try {
        const normTarget = normalizeOrderId(orderId);

        // 1. Check local IndexedDB queue for completed orders with video files
        const allQueue = await dbGetAllQueue();
        const localMatch = allQueue.find(
          (item) =>
            normalizeOrderId(item.orderId) === normTarget &&
            item.status === 'completed' &&
            (item.fileId || item.webViewLink)
        );

        if (localMatch) {
          setIsDuplicateChecking(false);
          setDuplicateWarning({
            orderId: orderId.trim(),
            platform: effectivePlatform,
            recordingType,
            existing: {
              timestamp: new Date(localMatch.createdAt).toISOString(),
              packerEmail: currentUser?.email || 'operator@vms.local',
              playbackUrl: localMatch.webViewLink || '#',
            },
          });
          return;
        }

        // 2. Check remote Google Drive / Sheets
        const existing = await checkDuplicate({
          orderId: orderId.trim(),
          platform: effectivePlatform,
          recordingType,
        });
        if (existing && existing.fileId) {
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
    } else {
      // If bypass is attempted, verify permission under system policy
      if (policy === 'strict_block') {
        onShowToast('Duplicate recording is strictly prohibited by System Policy.', 'error');
        return;
      }
      if (policy === 'admin_override' && currentUser?.role !== 'admin') {
        onShowToast('Only an Administrator can authorize a duplicate recording.', 'error');
        return;
      }
    }

    if (!streamRef.current || !isCameraActive) {
      await startCamera(selectedDeviceId);
      if (!streamRef.current) return;
    }

    bypassDuplicateRef.current = bypassDuplicateCheck;
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
    // Also turn off camera as requested
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
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
        bypassDuplicate: bypassDuplicateRef.current,
      };

      // Reset bypass flag after recording is queued
      bypassDuplicateRef.current = false;

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
            onClick={handleVideoContainerClick}
            className={`relative bg-slate-950 flex items-center justify-center overflow-hidden aspect-video min-h-[480px] ${
              isCameraActive ? 'cursor-crosshair select-none' : ''
            }`}
            title={isCameraActive ? 'Click anywhere on the preview to focus camera on that spot' : undefined}
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

            {!isCameraActive && cameraPermissionError && (
              <div id="camera-permission-blocked-guide" className="p-6 sm:p-8 text-center flex flex-col items-center justify-center max-w-md bg-slate-900/95 border border-amber-500/40 rounded-2xl m-4 shadow-2xl backdrop-blur-md z-20">
                <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-3 shadow-inner text-amber-400">
                  <ShieldAlert className="w-7 h-7 text-amber-400 animate-pulse" />
                </div>
                <h4 className="text-base font-semibold text-white mb-1.5 flex items-center gap-2">
                  Camera Permission Required
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed mb-4 text-center">
                  Your browser has blocked camera access for this page. Follow these quick steps to unblock:
                </p>

                <div className="w-full bg-slate-950/90 rounded-xl p-3.5 border border-slate-800 text-left space-y-2 mb-5 text-xs text-slate-300 font-sans shadow-inner">
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                    <span>Click the <strong>🔒 Lock</strong> or <strong>📹 Camera</strong> icon next to the URL in your browser address bar.</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                    <span>Switch <strong>Camera</strong> permission to <strong>Allow</strong>.</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
                    <span>Click <strong>"Try Allowing Camera Again"</strong> below.</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    id="retry-camera-perm-btn"
                    onClick={() => startCamera(selectedDeviceId)}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-md transition inline-flex items-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Try Allowing Camera Again
                  </button>

                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition inline-flex items-center gap-1.5"
                    title="Open app in a standalone tab if iframe preview is blocking permissions"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open in New Tab
                  </a>
                </div>
              </div>
            )}

            {!isCameraActive && !cameraPermissionError && (
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

            {/* Click-to-Focus Target Animation Ring */}
            {focusClickPoint && isCameraActive && (
              <div
                className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 z-30 transition-all duration-300"
                style={{ left: focusClickPoint.x, top: focusClickPoint.y }}
              >
                <div className="w-12 h-12 rounded-full border-2 border-emerald-400 animate-ping opacity-75" />
                <div className="absolute inset-0 w-12 h-12 rounded-full border-2 border-amber-300 flex items-center justify-center bg-black/30 backdrop-blur-xs">
                  <Crosshair className="w-6 h-6 text-amber-300 animate-spin" />
                </div>
                <span className="absolute top-14 left-1/2 -translate-x-1/2 text-[9px] font-mono bg-black/90 text-emerald-300 px-1.5 py-0.5 rounded whitespace-nowrap border border-emerald-500/40 shadow-sm">
                  CALIBRATING FOCUS
                </span>
              </div>
            )}

            {/* AI Smart Packing Framing & Virtual Focus Zone Overlay */}
            {isCameraActive && showAiPackingZone && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10 p-4">
                <div
                  className={`relative transition-all duration-300 border border-dashed border-emerald-400/50 bg-emerald-400/[0.03] rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.12)] ${
                    packingZonePreset === 'flyer'
                      ? 'w-[54%] h-[54%]'
                      : packingZonePreset === 'carton'
                      ? 'w-[88%] h-[84%]'
                      : packingZonePreset === 'grid'
                      ? 'w-[92%] h-[88%]'
                      : 'w-[72%] h-[72%]'
                  }`}
                >
                  {/* High Precision Corner Brackets */}
                  <div className="absolute -top-1 -left-1 w-6 h-6 border-t-3 border-l-3 border-emerald-400 rounded-tl-sm shadow-xs" />
                  <div className="absolute -top-1 -right-1 w-6 h-6 border-t-3 border-r-3 border-emerald-400 rounded-tr-sm shadow-xs" />
                  <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-3 border-l-3 border-emerald-400 rounded-bl-sm shadow-xs" />
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-3 border-r-3 border-emerald-400 rounded-br-sm shadow-xs" />

                  {/* Top Guide Pill Badge */}
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-slate-950/90 text-emerald-400 text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full border border-emerald-500/50 shadow-md flex items-center gap-1.5 whitespace-nowrap">
                    <Sparkles className="w-3 h-3 text-emerald-400 animate-pulse" />
                    AI OPTIMAL PACKING ZONE
                  </div>

                  {/* Camera Barcode Active Red Scanning Laser when Camera Scanner is ON */}
                  {isBarcodeMode && !isRecording && (
                    <div className="absolute inset-x-6 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_rgba(239,68,68,0.8)] animate-bounce" />
                  )}

                  {/* Center Target Reticle Crosshair */}
                  <div className="relative flex items-center justify-center pointer-events-none opacity-60">
                    <div className="w-8 h-8 rounded-full border border-emerald-400/60 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    </div>
                    <div className="absolute w-12 h-px bg-emerald-400/60" />
                    <div className="absolute h-12 w-px bg-emerald-400/60" />
                  </div>

                  {/* Rule-of-Thirds Grid Overlay (when Grid preset selected) */}
                  {packingZonePreset === 'grid' && (
                    <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                      <div className="border-r border-b border-dashed border-cyan-400/30" />
                      <div className="border-r border-b border-dashed border-cyan-400/30" />
                      <div className="border-b border-dashed border-cyan-400/30" />
                      <div className="border-r border-b border-dashed border-cyan-400/30" />
                      <div className="border-r border-b border-dashed border-cyan-400/30" />
                      <div className="border-b border-dashed border-cyan-400/30" />
                      <div className="border-r border-dashed border-cyan-400/30" />
                      <div className="border-r border-dashed border-cyan-400/30" />
                      <div />
                    </div>
                  )}

                  {/* Bottom Guidance Note */}
                  <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur-xs text-slate-200 text-[9px] font-mono px-2.5 py-0.5 rounded-full border border-white/15 shadow-md whitespace-nowrap flex items-center gap-1.5">
                    <Target className="w-3 h-3 text-amber-400" />
                    <span>Place Parcel & Barcodes Here • Tap to Focus</span>
                  </div>
                </div>
              </div>
            )}


            {/* In-Video Recording HUD (Authentic Camera OSD) */}
            {isCameraActive && (
              <div id="camera-active-hud" className="absolute top-3 right-3 flex items-start justify-end pointer-events-none text-[11px] sm:text-xs font-mono font-medium z-20">
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
                    detectedDuplicate && getStoredDuplicatePolicy() === 'strict_block' ? (
                      <button
                        id="start-recording-btn"
                        onClick={() => {
                          setDuplicateWarning({
                            orderId: orderId.trim(),
                            platform: effectivePlatform,
                            recordingType,
                            existing: detectedDuplicate,
                          });
                        }}
                        className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-lg shadow-sm transition inline-flex items-center gap-2 cursor-pointer"
                        title="Duplicate Order ID: Click to view details"
                      >
                        <Lock className="w-4 h-4 text-white" />
                        <span>Recording Blocked (Duplicate)</span>
                      </button>
                    ) : detectedDuplicate && getStoredDuplicatePolicy() === 'admin_override' && currentUser?.role !== 'admin' ? (
                      <button
                        id="start-recording-btn"
                        onClick={() => {
                          setDuplicateWarning({
                            orderId: orderId.trim(),
                            platform: effectivePlatform,
                            recordingType,
                            existing: detectedDuplicate,
                          });
                        }}
                        className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm rounded-lg shadow-sm transition inline-flex items-center gap-2 cursor-pointer"
                        title="Admin authorization required"
                      >
                        <Shield className="w-4 h-4 text-white" />
                        <span>Admin Override Required</span>
                      </button>
                    ) : (
                      <button
                        id="start-recording-btn"
                        onClick={() => startRecording(false)}
                        disabled={isDuplicateChecking}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm rounded-lg shadow-sm transition inline-flex items-center gap-2"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        {isDuplicateChecking ? 'Checking Duplicate…' : 'Start Recording'}
                      </button>
                    )
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
                    id="off-camera-btn"
                    onClick={handleToggleCamera}
                    className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm rounded-lg font-semibold transition inline-flex items-center gap-1.5 border border-slate-300 shadow-xs"
                    title="Turn off live camera stream"
                  >
                    <CameraOff className="w-4 h-4 text-slate-600" />
                    Off Camera
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


                  <button
                    id="toggle-ai-zone-btn"
                    type="button"
                    onClick={toggleAiPackingZone}
                    className={`px-3.5 py-2.5 border text-sm rounded-lg font-semibold transition inline-flex items-center gap-1.5 shadow-xs ${
                      showAiPackingZone
                        ? 'bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-900'
                        : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                    }`}
                    title="Toggle AI Smart Packing Framing & Guide Box"
                  >
                    <Sparkles className={`w-4 h-4 ${showAiPackingZone ? 'text-emerald-600' : 'text-slate-500'}`} />
                    {showAiPackingZone ? 'AI Guide: Active' : 'Enable AI Guide'}
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

          {/* AI Virtual Packing Guide Controls - Available Below Buttons */}
          <div id="ai-guide-options-bar" className="bg-slate-900 border-t border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>AI Packing Zone Guide:</span>
              </div>
              <span className="text-[11px] text-slate-400 font-sans">
                (Visual assistant only — not recorded in output video)
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800 shadow-inner">
                <button
                  type="button"
                  onClick={() => handleSelectZonePreset('standard')}
                  className={`px-3 py-1 text-xs rounded-md transition font-medium cursor-pointer ${
                    showAiPackingZone && packingZonePreset === 'standard'
                      ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  title="Standard Box / Medium Parcel (72%)"
                >
                  Standard (72%)
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectZonePreset('flyer')}
                  className={`px-3 py-1 text-xs rounded-md transition font-medium cursor-pointer ${
                    showAiPackingZone && packingZonePreset === 'flyer'
                      ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  title="Flyer / Polybag / Small Items (54%)"
                >
                  Flyer (54%)
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectZonePreset('carton')}
                  className={`px-3 py-1 text-xs rounded-md transition font-medium cursor-pointer ${
                    showAiPackingZone && packingZonePreset === 'carton'
                      ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  title="Large Carton / Bulk Shipment (88%)"
                >
                  Carton (88%)
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectZonePreset('grid')}
                  className={`px-3 py-1 text-xs rounded-md transition font-medium cursor-pointer ${
                    showAiPackingZone && packingZonePreset === 'grid'
                      ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  title="3x3 Alignment Grid"
                >
                  3×3 Grid
                </button>
              </div>


              <button
                type="button"
                onClick={toggleAiPackingZone}
                className={`px-3 py-1 text-xs font-semibold rounded-md border transition cursor-pointer inline-flex items-center gap-1.5 ${
                  showAiPackingZone
                    ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/25'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
                title={showAiPackingZone ? 'Hide Guide Frame' : 'Show Guide Frame'}
              >
                {showAiPackingZone ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    Hide Frame
                  </>
                ) : (
                  'Show Frame'
                )}
              </button>
            </div>
          </div>
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
                <span className="text-[11px] text-slate-500 flex items-center gap-1">
                  <Barcode className="w-3.5 h-3.5 text-blue-600" />
                  USB Scanner
                </span>
              </div>
              <div className="relative">
                <input
                  id="orderIdInput"
                  type="text"
                  placeholder="Scan barcode (e.g. #OD-5035) or type Order ID"
                  value={orderId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setOrderId(val);
                    detectPlatformAndType(val);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const cleaned = cleanBarcode(orderId);
                      if (cleaned && cleaned !== orderId) {
                        setOrderId(cleaned);
                        detectPlatformAndType(cleaned);
                      }
                    }
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text');
                    if (pasted) {
                      const cleaned = cleanBarcode(pasted);
                      if (cleaned) {
                        setOrderId(cleaned);
                        detectPlatformAndType(cleaned);
                        onShowToast(`Scanned / Pasted Order: ${cleaned}`, 'info');
                        e.preventDefault();
                      }
                    }
                  }}
                  className={`w-full pl-3.5 pr-10 py-2.5 rounded-lg text-sm font-mono placeholder:text-slate-400 focus:outline-none transition ${
                    detectedDuplicate
                      ? 'bg-red-50 border-2 border-red-500 text-red-900 focus:ring-2 focus:ring-red-400'
                      : 'bg-slate-50 border border-slate-300 text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500'
                  }`}
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

              {detectedDuplicate && (
                <div className="mt-2.5 p-3 bg-red-50 border border-red-300 rounded-lg text-xs space-y-1.5 animate-in fade-in duration-200">
                  <div className="flex items-center gap-1.5 font-bold text-red-800">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>DUPLICATE ORDER ID DETECTED</span>
                  </div>
                  <p className="text-red-700 text-[11px] leading-snug">
                    Order <b>{orderId}</b> has already been uploaded to Google Drive on{' '}
                    <b>{detectedDuplicate.timestamp ? new Date(detectedDuplicate.timestamp).toLocaleString() : 'a previous session'}</b> by{' '}
                    <b>{detectedDuplicate.packerEmail || 'operator'}</b>. Duplicate upload will be automatically blocked.
                  </p>
                  {detectedDuplicate.playbackUrl && (
                    <a
                      href={detectedDuplicate.playbackUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 underline pt-0.5"
                    >
                      <FolderSync className="w-3 h-3" />
                      Open Existing Recording in Google Drive
                    </a>
                  )}
                </div>
              )}
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
      {duplicateWarning && (() => {
        const policy = getStoredDuplicatePolicy();
        const isAdmin = currentUser?.role === 'admin';
        const isStrict = policy === 'strict_block';
        const isAdminOverride = policy === 'admin_override';

        return (
          <div
            id="duplicate-warning-modal"
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-red-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className={`p-4 ${isStrict ? 'bg-red-600' : isAdminOverride && !isAdmin ? 'bg-amber-600' : 'bg-red-600'} text-white flex items-center gap-2.5`}>
                {isStrict ? <Lock className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                <h3 className="font-bold text-sm tracking-tight">
                  {isStrict
                    ? 'Recording Blocked: Duplicate Order ID'
                    : isAdminOverride && !isAdmin
                    ? 'Duplicate Order: Admin Authorization Required'
                    : 'Duplicate Order ID Detected'}
                </h3>
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

                {isStrict ? (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-800 space-y-1">
                    <p className="font-semibold flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5 text-red-600 shrink-0" />
                      Strict Duplicate Prevention Active
                    </p>
                    <p className="text-red-700 leading-snug">
                      Duplicate recording for this Order ID is blocked to prevent accidental duplicate video files. Please clear this order and scan the next order.
                    </p>
                  </div>
                ) : isAdminOverride && !isAdmin ? (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 space-y-1">
                    <p className="font-semibold flex items-center gap-1">
                      <Shield className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      Admin Approval Required
                    </p>
                    <p className="text-amber-700 leading-snug">
                      Operators cannot record duplicate videos. Please contact a supervisor or administrator to authorize duplicate recording.
                    </p>
                  </div>
                ) : (
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    {isAdminOverride && isAdmin
                      ? 'As an Administrator, you may authorize a duplicate recording if this package is being re-packed.'
                      : 'Do you want to proceed and record a new video anyway, or cancel to scan a different order?'}
                  </p>
                )}
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  id="cancel-duplicate-btn"
                  onClick={() => {
                    setDuplicateWarning(null);
                    setOrderId('');
                  }}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-medium text-xs transition"
                >
                  Cancel / Scan New Order
                </button>

                {isStrict ? null : isAdminOverride ? (
                  isAdmin ? (
                    <button
                      id="proceed-duplicate-btn"
                      onClick={() => {
                        setDuplicateWarning(null);
                        startRecording(true);
                      }}
                      className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-xs shadow-sm transition flex items-center gap-1.5"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      Admin Override: Proceed & Record
                    </button>
                  ) : null
                ) : (
                  <button
                    id="proceed-duplicate-btn"
                    onClick={() => {
                      setDuplicateWarning(null);
                      startRecording(true);
                    }}
                    className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shadow-sm transition"
                  >
                    Proceed & Record Anyway
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}




    </div>
  );
};
