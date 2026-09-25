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
  XCircle,
  Sliders,
  Zap
} from 'lucide-react';
import { PlatformType, RecordingType, QueueItem } from '../types';
import { dbPutQueue, getStoredMaxVideoSizeMb } from '../lib/storage';
import { requestApi, normalizeOrderId, checkDuplicate } from '../lib/api';
import { triggerUploadWorker } from '../lib/uploadWorker';
import { sharedAiFocusEngine, FocusMode, FocusState } from '../lib/aiFocusEngine';
import { AiVideoFocusModal } from './AiVideoFocusModal';
import { PhoneScannerModal } from './PhoneScannerModal';
import { sharedScannerSync } from '../lib/phoneScannerSync';

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

  // Wireless Phone Barcode Scanner Sync
  const [isPhoneScannerModalOpen, setIsPhoneScannerModalOpen] = useState(false);
  const [isPhoneConnected, setIsPhoneConnected] = useState(false);
  const [connectedPhonesCount, setConnectedPhonesCount] = useState(0);
  const [phoneDeviceName, setPhoneDeviceName] = useState('');
  const [autoRecordOnPhoneScan, setAutoRecordOnPhoneScan] = useState(() => localStorage.getItem('vms_phone_auto_record') !== 'false');

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
  const [isFocusing, setIsFocusing] = useState(false);
  const [cameraResolution, setCameraResolution] = useState<{ width: number; height: number }>({ width: 1920, height: 1080 });

  // Real-Time Dynamic AI Auto-Focus & Smart Viewport Framing (PTZ) Engine
  const [aiFocusEnabled, setAiFocusEnabled] = useState<boolean>(() => {
    return localStorage.getItem('vms_ai_focus_active') !== 'false';
  });
  const [aiFocusMode, setAiFocusMode] = useState<FocusMode>('AUTO');
  const [aiFocusState, setAiFocusState] = useState<FocusState | null>(null);
  const [isAiFocusModalOpen, setIsAiFocusModalOpen] = useState(false);
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

  // Live duplicate inspection per recording type
  const [duplicateStatus, setDuplicateStatus] = useState<{
    checkedOrder: string;
    hasSameTypeDup: boolean;
    hasOtherTypeRecord: boolean;
    existingRecord?: any;
    otherTypeRecord?: any;
  } | null>(null);
  const [isCheckingDup, setIsCheckingDup] = useState(false);
  const [allowBypassDuplicate, setAllowBypassDuplicate] = useState(false);

  // Debounced duplicate checker that distinguishes Forward from Return
  useEffect(() => {
    const trimmed = orderId.trim();
    if (!trimmed || trimmed.length < 3) {
      setDuplicateStatus(null);
      setIsCheckingDup(false);
      setAllowBypassDuplicate(false);
      bypassDuplicateRef.current = false;
      return;
    }

    let isMounted = true;
    const timer = setTimeout(async () => {
      setIsCheckingDup(true);
      try {
        const otherType: RecordingType = recordingType === 'Forward' ? 'Return' : 'Forward';
        const [sameRes, otherRes] = await Promise.all([
          checkDuplicate({
            orderId: trimmed,
            platform: effectivePlatform,
            recordingType,
          }),
          checkDuplicate({
            orderId: trimmed,
            platform: effectivePlatform,
            recordingType: otherType,
          }),
        ]);

        if (isMounted) {
          const sameObj = sameRes as any;
          const otherObj = otherRes as any;
          const isSameDup = Boolean(
            sameRes &&
              (sameRes.fileId ||
                sameObj?.isDuplicate ||
                sameObj?.isInProgress ||
                sameObj?.packerEmail ||
                sameObj?.status?.includes('Progress'))
          );
          const isOtherDup = Boolean(
            otherRes &&
              (otherRes.fileId ||
                otherObj?.isDuplicate ||
                otherObj?.isInProgress ||
                otherObj?.packerEmail)
          );
          setDuplicateStatus({
            checkedOrder: trimmed,
            hasSameTypeDup: isSameDup,
            hasOtherTypeRecord: isOtherDup,
            existingRecord: sameRes,
            otherTypeRecord: otherRes,
          });
        }
      } catch (e) {
        if (isMounted) {
          setDuplicateStatus(null);
        }
      } finally {
        if (isMounted) {
          setIsCheckingDup(false);
        }
      }
    }, 450);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [orderId, recordingType, effectivePlatform]);

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

  // Continuous vision detector ticker: samples video frame to detect Label, Invoice, or Product
  useEffect(() => {
    if (!isCameraActive || !aiFocusEnabled) return;
    const interval = setInterval(() => {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        sharedAiFocusEngine.analyzeFrame(videoRef.current);
      }
    }, 120);
    return () => clearInterval(interval);
  }, [isCameraActive, aiFocusEnabled]);

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

        // 1. Draw video frame with AI Auto-Focus & Dynamic Viewport PTZ
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        if (aiFocusEnabled) {
          const fState = sharedAiFocusEngine.renderFrameToCanvas(video, canvas, ctx);
          setAiFocusState(fState);
          // Periodically calibrate optical hardware point-of-interest if supported
          if (Math.random() < 0.08 && streamRef.current) {
            const track = streamRef.current.getVideoTracks()[0];
            sharedAiFocusEngine.applyHardwarePoi(track);
          }
        } else {
          ctx.drawImage(video, 0, 0, vWidth, vHeight);
        }

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

  const handleToggleAiFocus = () => {
    const nextState = !aiFocusEnabled;
    setAiFocusEnabled(nextState);
    localStorage.setItem('vms_ai_focus_active', String(nextState));
    onShowToast(
      nextState
        ? 'AI Dynamic Auto-Focus activated (Auto-focusing on Label, Invoice, & Product)'
        : 'AI Auto-Focus disabled',
      'info'
    );
  };

  const handleSelectFocusMode = (mode: FocusMode) => {
    setAiFocusMode(mode);
    sharedAiFocusEngine.setMode(mode);
    if (!aiFocusEnabled) {
      setAiFocusEnabled(true);
      localStorage.setItem('vms_ai_focus_active', 'true');
    }
    const modeLabels: Record<FocusMode, string> = {
      AUTO: 'AI Auto-Focus: Intelligent automatic area targeting',
      LABEL: 'Focus Locked: Shipping Label & Barcodes',
      INVOICE: 'Focus Locked: Invoice & Paperwork',
      PRODUCT: 'Focus Locked: Product Packing Zone',
      OVERVIEW: 'Focus Reset: General Packing Station',
    };
    onShowToast(modeLabels[mode] || `Focus set to ${mode}`, 'info');
  };

  const handleToggleCamera = async () => {
    if (isCameraActive) {
      stopCamera();
    } else {
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

  const startRecording = async () => {
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

    // STRICT DUPLICATE GUARD: Block recording if duplicate detected and bypass not checked
    if (duplicateStatus && duplicateStatus.hasSameTypeDup && duplicateStatus.checkedOrder === orderId.trim() && !bypassDuplicateRef.current) {
      const activePacker = (duplicateStatus.existingRecord as any)?.packerEmail;
      const collisionMsg = activePacker
        ? `Duplicate collision: Order "${orderId.trim()}" is currently being packed/uploaded by ${activePacker}. Duplicate recording blocked.`
        : `Duplicate Order Blocked: Order "${orderId.trim()}" already has a completed ${recordingType} video in Google Drive. Check 'Re-record & Upload Anyway' below to bypass.`;
      setStatusMessage({ text: collisionMsg, type: 'error' });
      onShowToast(collisionMsg, 'error');
      return;
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
      const maxSizeBytes = getStoredMaxVideoSizeMb() * 1024 * 1024;
      
      if (blob.size > maxSizeBytes) {
        onShowToast(`Recorded video (${sizeMb} MB) exceeds maximum allowed size (${getStoredMaxVideoSizeMb()} MB). Adjust limits in Admin panel if needed.`, 'error');
        // We still trigger download so they don't lose the footage
      }

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

      if (blob.size > maxSizeBytes) {
        setOrderId('');
        setRecordingType('Forward');
        setPlatform('Amazon');
        setIsRecording(false);
        recordedChunksRef.current = [];
        return;
      }

      // STRICT DUPLICATE GUARD: Do not queue duplicate recording unless bypass was explicitly enabled
      if (
        duplicateStatus &&
        duplicateStatus.hasSameTypeDup &&
        duplicateStatus.checkedOrder === orderId.trim() &&
        !bypassDuplicateRef.current
      ) {
        onShowToast(`Duplicate Order ${orderId.trim()} blocked from upload queue (saved to Downloads).`, 'error');
        setStatusMessage({
          text: `Duplicate Order "${orderId.trim()}" already uploaded. Video saved to Downloads but blocked from Drive upload.`,
          type: 'error',
        });
        setOrderId('');
        setIsRecording(false);
        recordedChunksRef.current = [];
        return;
      }

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
      window.dispatchEvent(new CustomEvent('ops_queue_updated'));
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

  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const startRecordingRef = useRef(startRecording);
  startRecordingRef.current = startRecording;
  const stopRecordingRef = useRef(stopRecording);
  stopRecordingRef.current = stopRecording;

  // Real-time synchronization with Wireless Phone Barcode Scanner
  useEffect(() => {
    sharedScannerSync.connectAsStation(
      (barcode, _format, _platform, device) => {
        const cleaned = cleanBarcode(barcode);
        if (cleaned) {
          setOrderId(cleaned);
          detectPlatformAndType(cleaned);
          onShowToast(`📱 Phone Scanned: ${cleaned} (${device || 'Mobile Phone'})`, 'success');
        }
      },
      (connected, count, device) => {
        setIsPhoneConnected(connected);
        setConnectedPhonesCount(count);
        if (device) setPhoneDeviceName(device);
      }
    );

    const unsubCmd = sharedScannerSync.onRemoteCommand((action, device) => {
      if (action === 'START_RECORDING') {
        if (!isRecordingRef.current) {
          startRecordingRef.current();
          onShowToast(`📱 Remote START from ${device || 'Phone'}`, 'info');
        }
      } else if (action === 'STOP_RECORDING') {
        if (isRecordingRef.current) {
          stopRecordingRef.current();
          onShowToast(`📱 Remote STOP from ${device || 'Phone'}`, 'info');
        }
      } else if (action === 'TRIGGER_FOCUS') {
        triggerAutoFocus();
        onShowToast(`📱 Remote Auto-Focus Triggered`, 'info');
      } else if (action === 'TOGGLE_CAMERA') {
        handleToggleCamera();
      }
    });

    return () => {
      unsubCmd();
    };
  }, []);

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
        <div className="flex flex-wrap items-center gap-2">
          {/* Wireless Phone Barcode Scanner Status & Pair Button */}
          <button
            id="open-phone-scanner-modal-btn"
            type="button"
            onClick={() => setIsPhoneScannerModalOpen(true)}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer shadow-xs whitespace-nowrap shrink-0 ${
              isPhoneConnected
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-700/80 hover:dark:bg-emerald-900/60'
                : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-950/80 dark:text-blue-200 dark:border-blue-700/80 hover:dark:bg-blue-900/60'
            }`}
            title="Connect your phone as a wireless barcode scanner in real-time"
          >
            <Smartphone className={`w-3.5 h-3.5 shrink-0 ${isPhoneConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'}`} />
            <span className="whitespace-nowrap">
              {isPhoneConnected
                ? `Phone Scanner: Active (${connectedPhonesCount})`
                : 'Phone Barcode Scanner'}
            </span>
            {isPhoneConnected ? (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            ) : (
              <span className="text-[10px] font-mono bg-blue-200/90 dark:bg-blue-900 text-blue-900 dark:text-blue-100 border border-blue-300/60 dark:border-blue-600/50 px-2 py-0.5 rounded-full font-bold whitespace-nowrap shrink-0 leading-none">
                Pair (QR)
              </span>
            )}
          </button>

          <span
            id="camera-status-chip"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap shrink-0 transition ${
              isRecording
                ? 'bg-red-50 text-red-700 border-red-200 animate-pulse dark:bg-red-950/80 dark:text-red-300 dark:border-red-800'
                : isCameraActive
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800'
                : 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isRecording ? 'bg-red-600 animate-ping' : isCameraActive ? 'bg-emerald-600' : 'bg-slate-400'
              }`}
            />
            <span>{isRecording ? `Recording (${formatTimer(recSeconds)})` : isCameraActive ? 'Camera Ready' : 'Camera Off'}</span>
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

            {/* Dynamic AI Auto-Focus Reticle (Tracks Label, Invoice, or Product) */}
            {isCameraActive && aiFocusEnabled && aiFocusState && aiFocusState.detectedType !== 'OVERVIEW' && (
              <div
                className="absolute pointer-events-none transition-all duration-300 z-10"
                style={{
                  left: `${aiFocusState.boundingBox.x * 100}%`,
                  top: `${aiFocusState.boundingBox.y * 100}%`,
                  width: `${aiFocusState.boundingBox.width * 100}%`,
                  height: `${aiFocusState.boundingBox.height * 100}%`,
                }}
              >
                {/* Floating Animated Brackets */}
                <div
                  className={`w-full h-full relative rounded-xl border border-dashed shadow-lg transition-colors ${
                    aiFocusState.detectedType === 'LABEL'
                      ? 'border-emerald-400 bg-emerald-500/5 shadow-emerald-500/10'
                      : aiFocusState.detectedType === 'INVOICE'
                      ? 'border-cyan-400 bg-cyan-500/5 shadow-cyan-500/10'
                      : 'border-amber-400 bg-amber-500/5 shadow-amber-500/10'
                  }`}
                >
                  {/* Precision corner ticks */}
                  <div className="absolute -top-1 -left-1 w-5 h-5 border-t-2 border-l-2 border-current rounded-tl-xs" />
                  <div className="absolute -top-1 -right-1 w-5 h-5 border-t-2 border-r-2 border-current rounded-tr-xs" />
                  <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-2 border-l-2 border-current rounded-bl-xs" />
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-2 border-r-2 border-current rounded-br-xs" />

                  {/* Target Pill */}
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-slate-950/95 px-2.5 py-0.5 rounded-full text-[9px] font-mono font-bold whitespace-nowrap shadow-md border border-white/20 flex items-center gap-1 text-white">
                    <Sparkles className="w-2.5 h-2.5 text-emerald-400 animate-spin" />
                    <span>{aiFocusState.label} • AUTO-FOCUSED</span>
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
                    <span
                      className={`backdrop-blur-xs text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-1 shadow-sm transition-colors ${
                        aiFocusEnabled && aiFocusState?.detectedType === 'LABEL'
                          ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/60 animate-pulse'
                          : aiFocusEnabled && aiFocusState?.detectedType === 'INVOICE'
                          ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500/60 animate-pulse'
                          : aiFocusEnabled && aiFocusState?.detectedType === 'PRODUCT'
                          ? 'bg-amber-950/90 text-amber-300 border-amber-500/60'
                          : 'bg-black/70 text-emerald-400 border-emerald-500/30'
                      }`}
                    >
                      <Focus className="w-3 h-3 text-emerald-400" />
                      {aiFocusEnabled && aiFocusState
                        ? `FOCUS: ${aiFocusState.detectedType}`
                        : 'AUTO-FOCUS'}
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
                    duplicateStatus && duplicateStatus.hasSameTypeDup && duplicateStatus.checkedOrder === orderId.trim() && !allowBypassDuplicate ? (
                      <button
                        id="start-recording-btn"
                        onClick={() => {
                          const activePacker = (duplicateStatus.existingRecord as any)?.packerEmail;
                          const msg = activePacker
                            ? `Order "${orderId.trim()}" is currently being packed/uploaded by ${activePacker}. Duplicate packing is blocked.`
                            : `Duplicate Order Blocked: Order "${orderId.trim()}" already uploaded. Check 'Re-record & Upload Anyway' below to bypass.`;
                          onShowToast(msg, 'error');
                        }}
                        className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-sm rounded-lg shadow-sm transition inline-flex items-center gap-2 cursor-pointer animate-pulse"
                        title="Duplicate Order ID detected. Check 'Re-record & Upload Anyway' below to enable recording."
                      >
                        <ShieldAlert className="w-4 h-4 text-white" />
                        Duplicate Order Blocked
                      </button>
                    ) : (
                      <button
                        id="start-recording-btn"
                        onClick={() => startRecording()}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-lg shadow-sm transition inline-flex items-center gap-2 cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        Start Recording
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
                    id="toggle-ai-focus-btn"
                    type="button"
                    onClick={handleToggleAiFocus}
                    className={`px-3.5 py-2.5 border text-sm rounded-lg font-semibold transition inline-flex items-center gap-1.5 shadow-xs cursor-pointer ${
                      aiFocusEnabled
                        ? 'bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-900'
                        : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                    }`}
                    title="Automatically focuses camera lens onto Shipping Labels, Invoices, and Product Packaging"
                  >
                    <Sparkles className={`w-4 h-4 ${aiFocusEnabled ? 'text-emerald-600' : 'text-slate-500'}`} />
                    {aiFocusEnabled ? 'AI Focus: Active' : 'Enable AI Focus'}
                  </button>

                  <button
                    id="open-drive-analysis-btn"
                    type="button"
                    onClick={() => setIsAiFocusModalOpen(true)}
                    className="px-3.5 py-2.5 bg-gradient-to-r from-indigo-50 to-purple-50 hover:from-indigo-100 hover:to-purple-100 border border-indigo-200 text-indigo-900 text-sm rounded-lg font-semibold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                    title="Analyze uploaded packing videos in Google Drive to identify focusing areas with Gemini AI"
                  >
                    <Sliders className="w-4 h-4 text-indigo-600" />
                    Analyze Drive Videos
                  </button>

                  <button
                    id="open-phone-scanner-toolbar-btn"
                    type="button"
                    onClick={() => setIsPhoneScannerModalOpen(true)}
                    className="px-3.5 py-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-900 dark:bg-blue-950/70 dark:border-blue-700/80 dark:text-blue-200 text-sm rounded-lg font-semibold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs whitespace-nowrap"
                    title="Connect your phone as a wireless barcode reader in real-time"
                  >
                    <Smartphone className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>{isPhoneConnected ? `Phone Linked (${connectedPhonesCount})` : 'Phone Scanner (QR)'}</span>
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

          {/* Real-Time AI Auto-Focus Controls & Shift Overrides */}
          <div id="ai-focus-controls-bar" className="bg-slate-900 border-t border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>AI Auto-Focus:</span>
              </div>
              <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                aiFocusEnabled && aiFocusState?.detectedType === 'LABEL'
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
                  : aiFocusEnabled && aiFocusState?.detectedType === 'INVOICE'
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-500/50'
                  : aiFocusEnabled && aiFocusState?.detectedType === 'PRODUCT'
                  ? 'bg-amber-950 text-amber-300 border-amber-500/50'
                  : 'bg-slate-950 text-slate-400 border-slate-800'
              }`}>
                {aiFocusEnabled && aiFocusState
                  ? `${aiFocusState.label}`
                  : 'Disabled'}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800 shadow-inner">
                <button
                  type="button"
                  onClick={() => handleSelectFocusMode('AUTO')}
                  className={`px-3 py-1 text-xs rounded-md transition font-medium cursor-pointer ${
                    aiFocusEnabled && aiFocusMode === 'AUTO'
                      ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  title="Automatically identifies focusing area (Label, Invoice, Product)"
                >
                  Auto (Smart AI)
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectFocusMode('LABEL')}
                  className={`px-3 py-1 text-xs rounded-md transition font-medium cursor-pointer ${
                    aiFocusEnabled && aiFocusMode === 'LABEL'
                      ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  title="Lock camera focus on Shipping Label / Barcode"
                >
                  Focus Label
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectFocusMode('INVOICE')}
                  className={`px-3 py-1 text-xs rounded-md transition font-medium cursor-pointer ${
                    aiFocusEnabled && aiFocusMode === 'INVOICE'
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  title="Lock camera focus on Invoice / Bill of Supply"
                >
                  Focus Invoice
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectFocusMode('PRODUCT')}
                  className={`px-3 py-1 text-xs rounded-md transition font-medium cursor-pointer ${
                    aiFocusEnabled && aiFocusMode === 'PRODUCT'
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  title="Lock camera focus on Product Packing Zone"
                >
                  Focus Product
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectFocusMode('OVERVIEW')}
                  className={`px-3 py-1 text-xs rounded-md transition font-medium cursor-pointer ${
                    aiFocusMode === 'OVERVIEW'
                      ? 'bg-slate-700 text-white font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  title="Reset to Full Packing Station Focus"
                >
                  Overview
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsAiFocusModalOpen(true)}
                className="px-3 py-1 text-xs font-semibold rounded-md border border-indigo-500/50 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 transition cursor-pointer inline-flex items-center gap-1.5"
                title="Use uploaded packing videos in Google Drive for AI focus analysis and calibration"
              >
                <Sliders className="w-3 h-3 text-indigo-400" />
                <span>Calibrate with Drive Videos</span>
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
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 flex items-center gap-1">
                    <Barcode className="w-3.5 h-3.5 text-blue-600" />
                    USB Scanner
                  </span>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <button
                    type="button"
                    onClick={() => setIsPhoneScannerModalOpen(true)}
                    className="text-[11px] text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-semibold flex items-center gap-1 hover:underline cursor-pointer whitespace-nowrap"
                    title="Connect phone as wireless barcode reader"
                  >
                    <Smartphone className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>{isPhoneConnected ? 'Phone: Linked' : 'Phone Scanner'}</span>
                  </button>
                </div>
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
                  className="w-full pl-3.5 pr-10 py-2.5 rounded-lg text-sm font-mono placeholder:text-slate-400 focus:outline-none transition bg-slate-50 border border-slate-300 text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500"
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
                    className={`px-3 py-2.5 rounded-lg text-xs font-semibold border text-center transition cursor-pointer ${
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

            {/* Live Duplicate & Recording Type Verification Card */}
            {isCheckingDup && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs flex items-center gap-2 text-slate-500 animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
                <span>Checking records for {recordingType}…</span>
              </div>
            )}

            {!isCheckingDup && duplicateStatus && duplicateStatus.checkedOrder === orderId.trim() && (
              <div className="text-xs space-y-1.5">
                {duplicateStatus.hasSameTypeDup ? (
                  <div className={`rounded-lg p-2.5 space-y-2 border ${
                    (duplicateStatus.existingRecord as any)?.packerEmail
                      ? 'bg-red-50 border-red-300 text-red-900'
                      : 'bg-amber-50 border-amber-300 text-amber-900'
                  }`}>
                    <div className="flex items-center justify-between font-bold">
                      <span className={`flex items-center gap-1.5 ${
                        (duplicateStatus.existingRecord as any)?.packerEmail ? 'text-red-800' : 'text-amber-800'
                      }`}>
                        <ShieldAlert className={`w-4 h-4 shrink-0 ${
                          (duplicateStatus.existingRecord as any)?.packerEmail ? 'text-red-600' : 'text-amber-600'
                        }`} />
                        {(duplicateStatus.existingRecord as any)?.packerEmail
                          ? 'Simultaneous Packing Collision'
                          : `Existing ${recordingType} Video in Drive`}
                      </span>
                      {duplicateStatus.existingRecord?.playbackUrl && (
                        <a
                          href={duplicateStatus.existingRecord.playbackUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1 font-semibold"
                        >
                          View <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <p className={`text-[11px] leading-snug ${
                      (duplicateStatus.existingRecord as any)?.packerEmail ? 'text-red-800 font-medium' : 'text-amber-700'
                    }`}>
                      {(duplicateStatus.existingRecord as any)?.packerEmail ? (
                        <>Order <strong>{orderId}</strong> is currently being packed/uploaded by <strong>{(duplicateStatus.existingRecord as any)?.packerEmail}</strong>. Do NOT pack this order again to avoid duplicate shipping/verification.</>
                      ) : (
                        <>Order <strong>{orderId}</strong> already has a completed <strong>{recordingType}</strong> video recorded on {duplicateStatus.existingRecord?.timestamp ? new Date(duplicateStatus.existingRecord.timestamp).toLocaleDateString() : 'earlier session'}.</>
                      )}
                    </p>
                    <label className="flex items-center gap-2 pt-1 border-t border-amber-200/80 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allowBypassDuplicate}
                        onChange={(e) => {
                          setAllowBypassDuplicate(e.target.checked);
                          bypassDuplicateRef.current = e.target.checked;
                        }}
                        className="w-3.5 h-3.5 rounded text-amber-600 border-amber-300 focus:ring-amber-500"
                      />
                      <span className="text-[11px] font-semibold text-amber-900">
                        Re-record & Upload Anyway (Bypass Duplicate Guard)
                      </span>
                    </label>
                  </div>
                ) : duplicateStatus.hasOtherTypeRecord ? (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-2.5 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-emerald-800">
                        {recordingType === 'Return' ? 'Outbound Forward Video on Record' : 'Inbound Return Video on Record'}
                      </div>
                      <p className="text-[11px] text-emerald-700 mt-0.5 leading-snug">
                        Ready to record <strong>{recordingType}</strong>. It is treated as a separate verification record and will be saved in the <strong>{recordingType === 'Return' ? 'ReturnLog' : 'OrderLog'}</strong> tab.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-blue-50/70 border border-blue-200 text-blue-800 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span>New Order ID — ready to record <strong>{recordingType}</strong>.</span>
                  </div>
                )}
              </div>
            )}

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

      {/* AI Video Focus & Area Identification Modal */}
      <AiVideoFocusModal
        isOpen={isAiFocusModalOpen}
        onClose={() => setIsAiFocusModalOpen(false)}
        orderId={orderId.trim()}
        onShowToast={onShowToast}
        onAppliedCalibration={() => {
          setAiFocusEnabled(true);
          setAiFocusMode('AUTO');
        }}
      />

      {/* Wireless Phone Barcode Scanner Setup & Real-Time Sync Modal */}
      <PhoneScannerModal
        isOpen={isPhoneScannerModalOpen}
        onClose={() => setIsPhoneScannerModalOpen(false)}
        onShowToast={onShowToast}
        autoRecordOnScan={autoRecordOnPhoneScan}
        onToggleAutoRecord={(enabled) => {
          setAutoRecordOnPhoneScan(enabled);
          localStorage.setItem('vms_phone_auto_record', String(enabled));
        }}
        onSimulateBarcode={(code) => {
          const cleaned = cleanBarcode(code);
          if (cleaned) {
            setOrderId(cleaned);
            detectPlatformAndType(cleaned);
          }
        }}
      />
    </div>
  );
};
