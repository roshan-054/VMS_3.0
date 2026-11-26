import { closeOnBackdrop } from '../lib/backdrop';
import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  CameraOff,
  Video,
  StopCircle,
  Play,
  RotateCcw,
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
  QrCode,
  Radio,
  Lock,
  Shield,
  XCircle,
  Sliders,
  Zap,
  Boxes
} from 'lucide-react';
import { PlatformType, RecordingType, QueueItem, OrderManifest, ManifestItem, User } from '../types';
import { syncCloudBranding } from '../lib/branding';
import { dbPutQueue, dbGetAllQueue, exceedsMaxVideoSize, formatVideoSizeLimit, getStoredVideoBitrate } from '../lib/storage';
import { normalizeOrderId, checkDuplicate, formatOrderId } from '../lib/api';
import { triggerUploadWorker, setRecordingInProgress } from '../lib/uploadWorker';
import { saveRecordingLocally, ensureBackupPermission, backupPathParts } from '../lib/localBackup';
import { LocalBackupFolderPicker } from './LocalBackupFolderPicker';
import { LiveClock, ElapsedTimer, RecordedSize } from './RecordingIndicators';
import { startRecordingSession, canRecordAbove1080p, prepareCameraFeed, releaseCameraFeed, type RecordingSession, type RecordingResult } from '../lib/recordingPipeline';
import {
  getManifestByOrderId,
  getStoredManifests,
  findProductInCatalog,
  isBarcodeEqual,
  updateManifestStatus,
  getVerificationSettings,
} from '../lib/manifestStorage';
import { PackVerificationModal } from './PackVerificationModal';
import { fmtDateTime } from '../lib/dateFormat';

const MIN_VIDEO_BYTES = 64 * 1024; // anything smaller has no real footage
const MIN_VIDEO_MS = 2000;

interface ScanRecordProps {
  onQueueUpdated: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  currentUser: User | null;
  initialOrderId?: string | null;
  onClearInitialOrderId?: () => void;
}

export const ScanRecord: React.FC<ScanRecordProps> = ({
  onQueueUpdated,
  onShowToast,
  currentUser,
  initialOrderId,
  onClearInitialOrderId,
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
  const [recStartedAt, setRecStartedAt] = useState<number | null>(null);
  const recordedBytesRef = useRef<number>(0);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);
  const [isBarcodeMode, setIsBarcodeMode] = useState(false);
  const [isFocusing, setIsFocusing] = useState(false);
  const [cameraResolution, setCameraResolution] = useState<{ width: number; height: number }>({ width: 1920, height: 1080 });

  const [focusClickPoint, setFocusClickPoint] = useState<{ x: number; y: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingSessionRef = useRef<RecordingSession | null>(null);
  const releaseCameraAfterSaveRef = useRef<boolean>(false);
  const barcodeBufferRef = useRef<string>('');
  const orderIdRef = useRef<string>('');
  const inputBurstRef = useRef<{ text: string; lastAt: number }>({ text: '', lastAt: 0 });
  const isPackVerificationOpenRef = useRef<boolean>(false);
  const barcodeTimeRef = useRef<number>(0);
  const wakeLockRef = useRef<any>(null);

  // Live refs read from timers/callbacks without re-running effects
  const isCameraActiveRef = useRef<boolean>(false);
  const isRecordingRef = useRef<boolean>(false);
  // True from Stop until the video is safely queued. A second Start in that window (a double click
  // on Stop/Start, or a scanner Enter) used to record the same order again as a near-empty video.
  const isSavingRef = useRef<boolean>(false);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
  const recordStartedAtRef = useRef<number>(0);
  const recordDurationRef = useRef<number>(Infinity);
  orderIdRef.current = orderId;

  // Snapshotted order metadata for the active recording session
  const recordingMetaRef = useRef<{
    orderId: string;
    effectivePlatform: string;
    recordingType: RecordingType;
    recordingDate?: string;
    mimeType: string;
    verifiedOrderItems: ManifestItem[] | null;
    bypassDuplicate: boolean;
    duplicateStatus: {
      hasSameTypeDup: boolean;
      hasOtherTypeDup: boolean;
      existingRecord?: { recordingType: string; fileName: string; driveUrl: string; createdAt: string };
      checkedOrder: string;
    } | null;
  } | null>(null);

  const bypassDuplicateRef = useRef<boolean>(false);

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

  // Pre-Pack Manifest & Physical GTIN Barcode Verification
  const [activeManifest, setActiveManifest] = useState<OrderManifest | null>(null);
  const [isPackVerificationOpen, setIsPackVerificationOpen] = useState<boolean>(false);
  isPackVerificationOpenRef.current = isPackVerificationOpen;
  const [verifiedOrderItems, setVerifiedOrderItems] = useState<ManifestItem[] | null>(null);
  const [unregisteredOrderWarning, setUnregisteredOrderWarning] = useState<{
    orderId: string;
  } | null>(null);

  // Handle initialOrderId passed when starting packing from Manifest queue or Order Processing tab
  useEffect(() => {
    if (initialOrderId && initialOrderId.trim()) {
      const clean = cleanBarcode(initialOrderId);
      if (clean) {
        setOrderId(clean);
        detectPlatformAndType(clean);
        const manifest = getManifestByOrderId(clean);
        if (manifest) {
          // If in Return mode, an already-packed outbound order is completely normal!
          if (recordingType === 'Return') {
            if (manifest.platform && manifest.platform !== 'Custom') {
              setPlatform(manifest.platform);
            }
            onShowToast(`Loaded Order ${clean} for Return recording`, 'info');
            onClearInitialOrderId?.();
            return;
          }

          if (manifest.status === 'Packed' || (manifest as any).status === 'Completed') {
            const packerInfo = manifest.packedByName || manifest.assignedPackerName || 'Packer';
            const packedTime = manifest.packedAt ? ` on ${fmtDateTime(manifest.packedAt)}` : '';
            onShowToast(`Order ${clean} is ALREADY PACKED & VERIFIED by ${packerInfo}${packedTime}. Packing is complete!`, 'success');
            setStatusMessage({
              text: `Order ${clean} has already been packed & verified by ${packerInfo}${packedTime}.`,
              type: 'success'
            });
            onClearInitialOrderId?.();
            return;
          }

          const isAssigned =
            !manifest.assignedPackerEmail ||
            !currentUser?.email ||
            manifest.assignedPackerEmail.toLowerCase().trim() === currentUser.email.toLowerCase().trim() ||
            currentUser.role === 'Admin' ||
            currentUser.role === 'Super Admin';

          if (!isAssigned) {
            const assignedName = manifest.assignedPackerName || manifest.assignedPackerEmail;
            onShowToast(`⛔ Order ${clean} is assigned to ${assignedName}. Not assigned to your workstation.`, 'error');
            setStatusMessage({
              text: `Order ${clean} is assigned to ${assignedName}.`,
              type: 'error'
            });
            onClearInitialOrderId?.();
            return;
          }

          setActiveManifest(manifest);
          setVerifiedOrderItems(null);
          setIsPackVerificationOpen(true);
          onShowToast(`Loaded Order ${clean}. Please scan product barcodes to verify items.`, 'info');
        } else {
          onShowToast(`Loaded Order ${clean}`, 'info');
        }
        onClearInitialOrderId?.();
      }
    }
  }, [initialOrderId]);

  // Real-Time Sync Listener: Automatically update activeManifest if modified by admin/manager on another station
  useEffect(() => {
    const handleManifestUpdate = () => {
      if (activeManifest) {
        const fresh = getManifestByOrderId(activeManifest.orderId);
        if (fresh) {
          setActiveManifest(fresh);
        }
      }
    };
    window.addEventListener('vms_manifests_updated', handleManifestUpdate);
    return () => {
      window.removeEventListener('vms_manifests_updated', handleManifestUpdate);
    };
  }, [activeManifest]);

  const checkAndOpenPackVerification = (scannedCode: string): boolean => {
    const clean = scannedCode.trim().toUpperCase();
    if (!clean) return false;

    // 1. Direct match: Check if scanned string is an Order ID in the pre-pack manifest
    const manifest = getManifestByOrderId(clean);
    if (manifest) {
      // The manifest knows the order's platform; barcode-shape guessing must not override it.
      if (manifest.platform && manifest.platform !== 'Custom') {
        setPlatform(manifest.platform);
      }
      // If operator is in Return recording mode, allow return recording smoothly without pre-pack blocking
      if (recordingType === 'Return') {
        if (manifest.platform && manifest.platform !== 'Custom') {
          setPlatform(manifest.platform);
        }
        setStatusMessage({
          text: `Order ${clean} (${manifest.platform}) loaded for customer return recording.`,
          type: 'info'
        });
        return true;
      }

      // Guard 1: Already packed orders (Only for Forward packing)
      if (manifest.status === 'Packed' || (manifest as any).status === 'Completed') {
        const packerName = manifest.packedByName || manifest.assignedPackerName || 'Packer';
        const packedDate = manifest.packedAt ? ` on ${fmtDateTime(manifest.packedAt)}` : '';
        onShowToast(`✓ Order ${clean} is ALREADY PACKED & VERIFIED by ${packerName}${packedDate}! Packing is complete.`, 'success');
        setStatusMessage({
          text: `Order ${clean} has already been packed & verified by ${packerName}${packedDate}.`,
          type: 'success'
        });
        return true;
      }

      // Guard 2: Assignment check
      const isAssigned =
        !manifest.assignedPackerEmail ||
        !currentUser?.email ||
        manifest.assignedPackerEmail.toLowerCase().trim() === currentUser.email.toLowerCase().trim() ||
        currentUser.role === 'Admin' ||
        currentUser.role === 'Super Admin';

      if (!isAssigned) {
        const assignedName = manifest.assignedPackerName || manifest.assignedPackerEmail;
        onShowToast(`⛔ Order ${clean} is assigned to ${assignedName}. You are logged in as ${currentUser?.name || currentUser?.email}.`, 'error');
        setStatusMessage({
          text: `Order ${clean} is assigned to ${assignedName}, not your workstation.`,
          type: 'error'
        });
        return false;
      }

      setActiveManifest(manifest);
      setVerifiedOrderItems(null);
      setIsPackVerificationOpen(true);
      onShowToast(`✓ Order ${clean} loaded! Now scan physical product barcodes to verify items.`, 'success');
      return true;
    }

    // 2. Smart Check: Is the scanned code a Product GTIN / SKU?
    const catalogProduct = findProductInCatalog(clean);
    const allManifests = getStoredManifests();

    // Check if any pending manifest assigned to this operator requires this item
    const matchingManifests = allManifests.filter((m) => {
      const isPending = (m.status || 'Pending') === 'Pending' || m.status === 'In Progress';
      if (!isPending) return false;

      // Must be assigned to this user if assigned
      const isAssigned =
        !m.assignedPackerEmail ||
        !currentUser?.email ||
        m.assignedPackerEmail.toLowerCase().trim() === currentUser.email.toLowerCase().trim();
      if (!isAssigned) return false;

      return (m.items || []).some((it) => {
        const itGtin = (it.gtin || '').trim().toUpperCase();
        const itSku = (it.sku || '').trim().toUpperCase();
        return (
          itGtin === clean ||
          itSku === clean ||
          (itGtin && itGtin.replace(/^0+/, '') === clean.replace(/^0+/, '')) ||
          (catalogProduct && (itSku === catalogProduct.sku.toUpperCase() || itGtin === catalogProduct.gtin.toUpperCase()))
        );
      });
    });

    if (matchingManifests.length > 1) {
      // The same product is in several pending orders: never guess which order the packer means.
      onShowToast(
        `Barcode ${clean} is in ${matchingManifests.length} pending orders. Scan the shipping label / Order ID instead.`,
        'error'
      );
      setStatusMessage({
        text: `Product ${clean} belongs to ${matchingManifests.length} pending orders, so no order was picked automatically. Scan the order's shipping label.`,
        type: 'error',
      });
      return false;
    }
    const matchingManifest = matchingManifests[0];
    if (matchingManifest) {
      // Auto-switch to the matching pending order!
      setActiveManifest(matchingManifest);
      setOrderId(matchingManifest.orderId);
      detectPlatformAndType(matchingManifest.orderId);
      setVerifiedOrderItems(null);
      setIsPackVerificationOpen(true);
      onShowToast(
        `📦 Scanned ${catalogProduct?.shortName || 'Product'} (Barcode ${clean}) → Matched to Order ${matchingManifest.orderId}!`,
        'success'
      );
      return true;
    }

    if (catalogProduct) {
      onShowToast(
        `📦 Scanned Product "${catalogProduct.shortName || catalogProduct.productName}". Please scan the package Shipping Label barcode (e.g. TEST-0200) to start packing!`,
        'info'
      );
      return false;
    }

    // 3. Fallback: If enforceManifestCheck is enabled, show clear instructions
    const settings = getVerificationSettings();
    if (settings.enforceManifestCheck) {
      setUnregisteredOrderWarning({ orderId: clean });
      return true;
    }
    return false;
  };

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
          const localSame = await findLocalRecording(trimmed, recordingType);
          if (!isMounted) return;
          const isSameDup = Boolean(localSame) || Boolean(
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
            existingRecord: sameRes || (localSame ? ({ timestamp: new Date(localSame.createdAt).toISOString(), playbackUrl: localSame.webViewLink || '' } as any) : sameRes),
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

  // Component unmount cleanup: shut down hardware camera tracks, worker, and wake lock when leaving the screen
  useEffect(() => {
    return () => {
      setRecordingInProgress(false);
      isRecordingRef.current = false;
      isCameraActiveRef.current = false;
      if (recordingSessionRef.current) {
        recordingSessionRef.current.stop().catch(() => {});
        recordingSessionRef.current = null;
      }
      releaseCameraFeed();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (wakeLockRef.current) {
        wakeLockRef.current.release?.().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);


  // Keep the preview decoder running if the browser pauses it (e.g. after the window loses focus)
  useEffect(() => {
    if (!isCameraActive) return;
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (video && video.paused && !video.ended && video.srcObject) video.play().catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [isCameraActive]);

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

  // Auto-detect platform and recording type based on clear barcode patterns (never on arbitrary substrings)
  const detectPlatformAndType = (barcode: string) => {
    if (!barcode) return;
    const clean = barcode.trim();
    const lower = clean.toLowerCase();

    // Detect Return keywords strictly (only clear prefixes/suffixes, never '-r-')
    if (/^ret[-_]/i.test(lower) || /[-_]ret$/i.test(lower) || /^rvp[-_]/i.test(lower) || lower.startsWith('return-')) {
      setRecordingType('Return');
    }

    // Detect Platform based on standard e-commerce barcode standards
    if (
      lower.startsWith('amz-') ||
      /^\d{3}-\d{7}-\d{7}$/.test(clean) ||
      /^40\d{8,12}$/.test(clean) ||
      /^17\d{8,12}$/.test(clean) ||
      lower.startsWith('amazon-')
    ) {
      setPlatform('Amazon');
    } else if (lower.startsWith('jio-') || lower.startsWith('jm-') || lower.startsWith('jiomart-')) {
      setPlatform('JioMart');
    } else if (
      lower.startsWith('#od-') ||
      lower.startsWith('od-') ||
      lower.startsWith('d2c-') ||
      lower.startsWith('w-') ||
      lower.startsWith('fk-') ||
      /^\d{12,16}$/.test(clean) // 12-16 digit Delhivery/Shiprocket tracking AWB
    ) {
      setPlatform('D2C');
    }
  };

  // One entry point for every scanned / typed / pasted order code.
  // While a video is recording the order is locked: a stray scan (e.g. a product barcode) can never
  // replace the Order ID of the video being recorded.
  const applyOrderCode = (raw: string, source: 'scanner' | 'typed' | 'pasted'): boolean => {
    const cleaned = cleanBarcode(raw);
    if (!cleaned) return false;
    if (isRecordingRef.current) {
      const current = recordingMetaRef.current?.orderId || orderIdRef.current;
      if (cleaned.toUpperCase() !== current.toUpperCase()) {
        onShowToast(`Recording Order ${current}. Stop & save it before scanning the next order (ignored ${cleaned}).`, 'error');
      }
      return false;
    }
    // A product barcode (GTIN/SKU) is never written into the Order ID box. If it belongs to exactly
    // one pending order, that order is loaded; otherwise the packer is asked to scan the label.
    if (!getManifestByOrderId(cleaned) && isKnownProductCode(cleaned)) {
      checkAndOpenPackVerification(cleaned);
      return false;
    }
    setOrderId(cleaned);
    detectPlatformAndType(cleaned);
    checkAndOpenPackVerification(cleaned);
    if (source === 'scanner') onShowToast(`Scanned Order: ${cleaned}`, 'success');
    if (source === 'pasted') onShowToast(`Scanned / Pasted Order: ${cleaned}`, 'info');
    return true;
  };
  const isKnownProductCode = (code: string): boolean => {
    if (findProductInCatalog(code)) return true;
    return getStoredManifests().some((m) =>
      (m.items || []).some((it) => isBarcodeEqual(it.gtin, code) || isBarcodeEqual(it.sku, code))
    );
  };
  const applyOrderCodeRef = useRef(applyOrderCode);
  applyOrderCodeRef.current = applyOrderCode;

  // USB / Bluetooth barcode scanner (keyboard wedge) when no text field has focus.
  // Scanners type a burst of keys a few ms apart and end with Enter; people type much slower.
  // Keys typed into any input (including the Order ID box itself) are left to that input, and
  // scans are ignored here while the product-verification popup is open (it handles them itself).
  useEffect(() => {
    const SCAN_KEY_GAP_MS = 80;
    const MIN_SCAN_LENGTH = 4;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPackVerificationOpenRef.current) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = Date.now();
      if (now - barcodeTimeRef.current > SCAN_KEY_GAP_MS) {
        barcodeBufferRef.current = '';
      }
      barcodeTimeRef.current = now;

      if (e.key === 'Enter' || e.key === 'Tab') {
        const raw = barcodeBufferRef.current;
        barcodeBufferRef.current = '';
        if (raw.length >= MIN_SCAN_LENGTH) {
          e.preventDefault();
          e.stopPropagation();
          applyOrderCodeRef.current(raw, 'scanner');
        }
      } else if (e.key.length === 1) {
        barcodeBufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

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

      // Stage 1: the camera's best resolution. With "Highest quality" and a computer that can encode 4K
      // on its graphics chip, ask for up to 4K; otherwise Full HD 1080p. Always capped at 30 FPS so
      // 60fps webcam modes cannot overload the real-time encoder (smooth video, no time gaps).
      const allowAbove1080 = getStoredVideoBitrate() <= 0 && (await canRecordAbove1080p().catch(() => false));
      try {
        const stage1Constraints: MediaStreamConstraints = {
          video: {
            deviceId: targetDevId ? { ideal: targetDevId } : undefined,
            facingMode: targetDevId ? undefined : { ideal: 'environment' },
            width: allowAbove1080 ? { ideal: 3840, max: 3840 } : { ideal: 1920, max: 1920 },
            height: allowAbove1080 ? { ideal: 2160, max: 2160 } : { ideal: 1080, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
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

      // Stage 2: 720p-1080p @ 30 FPS fallback with continuous autofocus
      if (!newStream) {
        try {
          const stage2Constraints: MediaStreamConstraints = {
            video: {
              deviceId: targetDevId ? { ideal: targetDevId } : undefined,
              facingMode: targetDevId ? undefined : { ideal: 'environment' },
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
              frameRate: { ideal: 30, max: 30 },
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
      prepareCameraFeed(newStream.getVideoTracks()[0]);
      isCameraActiveRef.current = true;
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
      isCameraActiveRef.current = false;
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

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release?.().catch(() => {});
      wakeLockRef.current = null;
    }
  };

  const releaseCameraTracks = () => {
    releaseCameraFeed();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    isCameraActiveRef.current = false;
    setIsCameraActive(false);
  };

  const stopCamera = () => {
    if (isRecordingRef.current) {
      // Let stopRecording -> handleFinishRecording flush trailing frames cleanly before closing hardware tracks
      releaseCameraAfterSaveRef.current = true;
      stopRecording();
      return;
    }
    releaseCameraTracks();
    releaseWakeLock();
    setRecordingInProgress(false);
    setIsRecording(false);
    setRecStartedAt(null);
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

  // This computer's own queue already holds a video for the order (pending, uploading, failed or
  // just uploaded). The sheet may not show it yet, so the server check alone cannot catch it.
  const findLocalRecording = async (oid: string, type: RecordingType) => {
    const key = normalizeOrderId(oid);
    if (!key) return null;
    const items = await dbGetAllQueue().catch(() => []);
    return items.find((q) => normalizeOrderId(q.orderId) === key && q.recordingType === type) || null;
  };

  const startRecording = async (verifiedItemsOverride?: ManifestItem[]) => {
    if (isRecordingRef.current) return;
    if (isSavingRef.current) {
      onShowToast('Still saving the previous video. Start again in a moment.', 'info');
      return;
    }
    const verifiedItems = verifiedItemsOverride ?? verifiedOrderItems;

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

    // PRE-PACK MANIFEST VERIFICATION GUARD: Ensure physical product GTINs are verified before recording starts
    // Strictly for outbound 'Forward' packing! Inbound customer 'Return' verification recordings inspect returned packages and do not require pre-pack manifest blocking.
    if (recordingType === 'Forward') {
      const targetManifest = activeManifest || getManifestByOrderId(orderId.trim());
      if (targetManifest && !verifiedItems) {
        setActiveManifest(targetManifest);
        setIsPackVerificationOpen(true);
        onShowToast(`Please scan and verify product GTINs for Order ${targetManifest.orderId} first`, 'info');
        return;
      }
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
    if (!bypassDuplicateRef.current) {
      const local = await findLocalRecording(orderId.trim(), recordingType);
      if (local) {
        const msg = `Order "${orderId.trim()}" was already recorded (${recordingType}) on this computer. Check 'Re-record & Upload Anyway' below to record it again.`;
        setDuplicateStatus((prev) => ({
          checkedOrder: orderId.trim(),
          hasSameTypeDup: true,
          hasOtherTypeRecord: prev?.hasOtherTypeRecord || false,
          existingRecord: { timestamp: new Date(local.createdAt).toISOString(), playbackUrl: local.webViewLink || '' } as any,
          otherTypeRecord: prev?.otherTypeRecord || null,
        }));
        setStatusMessage({ text: msg, type: 'error' });
        onShowToast(msg, 'error');
        return;
      }
    }

    if (!streamRef.current || !isCameraActiveRef.current) {
      await startCamera(selectedDeviceId);
      if (!streamRef.current) return;
    }

    // Wait up to 2s for the camera video element to deliver its first decoded frame with valid dimensions
    const waitStart = Date.now();
    while (
      videoRef.current &&
      (videoRef.current.readyState < 2 || videoRef.current.videoWidth === 0) &&
      Date.now() - waitStart < 2000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    // Re-grant access to the local backup folder while we still have the click/scan as a user gesture
    ensureBackupPermission().catch(() => {});

    // Pause background Drive upload chunk encoding while recording so main thread & IndexedDB stay 100% dedicated to video capture
    setRecordingInProgress(true);

    // Request Screen Wake Lock so the OS/browser does not dim or throttle timers during long packing recordings
    try {
      const wl = (navigator as any).wakeLock;
      if (wl && typeof wl.request === 'function') {
        wakeLockRef.current = await wl.request('screen');
      }
    } catch {
      // Wake Lock is optional and silently skipped if unavailable
    }

    // Determine if live enabled microphone audio tracks are actually attached
    const activeAudioTracks =
      streamRef.current && audioEnabled
        ? streamRef.current.getAudioTracks().filter((track) => track.enabled && track.readyState === 'live')
        : [];
    const cameraTrack = streamRef.current?.getVideoTracks()[0];
    if (!cameraTrack || !videoRef.current || !canvasRef.current) {
      setRecordingInProgress(false);
      releaseWakeLock();
      onShowToast('Camera is not ready yet. Please try again.', 'error');
      return;
    }

    // Highest quality (default): bitrate 0 lets the recorder match it to the real recording size,
    // and the camera's full resolution is used (up to 4K where the computer encodes it smoothly).
    const configuredBitrate = getStoredVideoBitrate();
    const maxQuality = configuredBitrate <= 0;
    const targetVideoBitrate = maxQuality ? 0 : Math.min(6000000, Math.max(1500000, configuredBitrate));

    isRecordingRef.current = true;
    let session: RecordingSession;
    try {
      session = await startRecordingSession({
        cameraTrack,
        video: videoRef.current,
        canvas: canvasRef.current,
        audioTracks: activeAudioTracks,
        videoBitsPerSecond: targetVideoBitrate,
        maxQuality,
        onProgress: (bytes) => {
          recordedBytesRef.current = bytes;
        },
        onError: (message) => console.error('Recorder error:', message),
      });
    } catch (err: any) {
      isRecordingRef.current = false;
      setRecordingInProgress(false);
      releaseWakeLock();
      onShowToast(`Could not start recording: ${err?.message || err}`, 'error');
      return;
    }
    recordingSessionRef.current = session;
    console.info('[recording] started', session.mode, session.codec, 'camera track:', cameraTrack.readyState);
    (window as any).__vmsRecorderMode = `${session.mode}:${session.codec}`;

    // Snapshot recording metadata now so handleFinishRecording is immune to stale closures or mid-save state changes
    recordingMetaRef.current = {
      orderId: formatOrderId(orderId, effectivePlatform),
      effectivePlatform,
      recordingType,
      // Date the recording STARTED (local time) decides the Drive / local date folder.
      recordingDate: new Date().toLocaleDateString('en-CA'),
      mimeType: session.mode === 'webcodecs' ? (session.codec.startsWith('avc') ? 'video/mp4' : 'video/webm') : session.codec || 'video/webm',
      verifiedOrderItems: verifiedItems,
      bypassDuplicate: bypassDuplicateRef.current,
      duplicateStatus,
    };

    setIsRecording(true);
    setIsPaused(false);
    recordStartedAtRef.current = Date.now();
    recordedBytesRef.current = 0;
    setRecStartedAt(Date.now());

    setStatusMessage({ text: 'Recording packing process…', type: 'info' });
    onShowToast('Recording started', 'info');
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    setIsRecording(false);
    setRecStartedAt(null);

    const session = recordingSessionRef.current;
    recordingSessionRef.current = null;
    recordDurationRef.current = recordStartedAtRef.current ? Date.now() - recordStartedAtRef.current : Infinity;
    if (session) {
      isSavingRef.current = true;
      setIsSavingRecording(true);
      setStatusMessage({ text: 'Saving video…', type: 'info' });
      session
        .stop()
        .then((result) => handleFinishRecording(result))
        .catch((err) => {
          console.error('Stopping recorder failed:', err);
          onShowToast(`Recording could not be saved: ${err?.message || err}`, 'error');
          recordingMetaRef.current = null;
          isSavingRef.current = false;
          setIsSavingRecording(false);
          releaseWakeLock();
          setRecordingInProgress(false);
        });
    } else {
      releaseWakeLock();
      setRecordingInProgress(false);
    }
  };

  const handleFinishRecording = async (result: RecordingResult) => {
    const meta = recordingMetaRef.current || {
      orderId: formatOrderId(orderId, effectivePlatform),
      effectivePlatform,
      recordingType,
      mimeType: result.mimeType,
      verifiedOrderItems,
      bypassDuplicate: bypassDuplicateRef.current,
      duplicateStatus,
    };

    try {
      const mimeType = result.mimeType || meta.mimeType || 'video/webm';
      const ext = mimeType.includes('mp4') ? '.mp4' : '.webm';
      const cleanOrderId = meta.orderId.replace(/^#+/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      const cleanPlatform = meta.effectivePlatform.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${cleanOrderId}_${cleanPlatform}_${meta.recordingType}${ext}`;

      const blob = result.blob;
      const recordedMs = recordDurationRef.current;
      if (blob.size < MIN_VIDEO_BYTES || recordedMs < MIN_VIDEO_MS) {
        // A recording stopped right after it started holds no packing footage (e.g. 1.4 KB). It
        // would only add a second, empty entry for the order, so it is not saved or uploaded.
        releaseWakeLock();
        onShowToast(`Recording for ${meta.orderId} was under 2 seconds, so it was discarded. Nothing was uploaded.`, 'info');
        setStatusMessage({ text: `Very short recording for ${meta.orderId} discarded.`, type: 'info' });
        return;
      }
      // Encoder has finished flushing. The camera stays on so the next order can start instantly
      // (no camera warm-up or dark first second).
      releaseWakeLock();

      const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);
      let overLimit = exceedsMaxVideoSize(blob.size);
      if (overLimit) {
        // The admin may have raised the limit since this station loaded: re-check once.
        await syncCloudBranding().catch(() => undefined);
        overLimit = exceedsMaxVideoSize(blob.size);
      }
      if (overLimit) {
        onShowToast(`Recorded video (${sizeMb} MB) is above the ${formatVideoSizeLimit()} limit set in Admin. It is saved on this computer but not uploaded. An admin can raise the limit in Admin settings.`, 'error');
        // We still trigger download so they don't lose the footage
      }

      const todayDateStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

      // Save a local copy first: into the station's backup folder using the same
      // Platform / Type / Month / Date structure as Drive, or to Downloads if no folder is set.
      const recordingDate = meta.recordingDate || todayDateStr;
      const local = await saveRecordingLocally(blob, {
        fileName,
        platform: meta.effectivePlatform,
        recordingType: meta.recordingType,
        recordingDate,
      });
      (window as any).__vmsLastLocalSave = local;

      if (overLimit) {
        setOrderId('');
        setRecordingType('Forward');
        setPlatform('Amazon');
        setIsRecording(false);
        return;
      }

      // STRICT DUPLICATE GUARD: Do not queue duplicate recording unless bypass was explicitly enabled
      if (
        meta.duplicateStatus &&
        meta.duplicateStatus.hasSameTypeDup &&
        meta.duplicateStatus.checkedOrder === meta.orderId &&
        !meta.bypassDuplicate
      ) {
        onShowToast(`Duplicate Order ${meta.orderId} blocked from upload queue (saved to Downloads).`, 'error');
        setStatusMessage({
          text: `Duplicate Order "${meta.orderId}" already uploaded. Video saved to Downloads but blocked from Drive upload.`,
          type: 'error',
        });
        setOrderId('');
        setIsRecording(false);
        return;
      }

      // Video recorded successfully and stored automatically in IndexedDB & queued for Google Drive sync without prompting Save As dialog
      const queueItem: QueueItem = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        orderId: meta.orderId,
        platform: meta.effectivePlatform,
        recordingType: meta.recordingType,
        fileName,
        fileSize: blob.size,
        mimeType,
        source: 'Automatic Recording',
        blob,
        status: 'pending',
        progress: 0,
        recordingDate: meta.recordingDate || todayDateStr,
        bypassDuplicate: meta.bypassDuplicate,
      };

      // Reset bypass flag after recording is queued
      bypassDuplicateRef.current = false;

      await dbPutQueue(queueItem);
      // Resume background uploads now that recording has completed and the new file is safely persisted
      setRecordingInProgress(false);

      // The upload worker opens the Drive upload session itself. (An extra startUpload here used
      // to open a second, unused session per video and hold an upload slot for 25 s.)
      window.dispatchEvent(new CustomEvent('ops_queue_updated'));
      onQueueUpdated();
      triggerUploadWorker();

      onShowToast(`Video recorded (${sizeMb} MB) & queued for automatic Drive upload!`, 'success');
      setStatusMessage({
        text: `Completed: ${fileName} saved & queued for Drive upload. Ready for next order.`,
        type: 'success',
      });

      // Update manifest status to 'Packed' if this order was in the manifest for Forward packing
      if (meta.orderId && meta.recordingType === 'Forward') {
        updateManifestStatus(
          meta.orderId,
          'Packed',
          meta.verifiedOrderItems || undefined,
          {
            name: currentUser?.name || 'Packer',
            email: currentUser?.email || 'packer@ops.local',
          }
        );
      }
      setVerifiedOrderItems(null);
      setActiveManifest(null);

      // Clear for next order
      setOrderId('');
    } catch (err: any) {
      console.error('Save recording failed:', err);
      onShowToast(`Error saving video: ${err.message}`, 'error');
    } finally {
      recordingMetaRef.current = null;
      isRecordingRef.current = false;
      isSavingRef.current = false;
      setIsSavingRecording(false);
      if (releaseCameraAfterSaveRef.current) {
        releaseCameraAfterSaveRef.current = false;
        releaseCameraTracks();
      }
      releaseWakeLock();
      setRecordingInProgress(false);
    }
  };

  return (
    <div id="scan-record-container" className="space-y-6">
      {/* Top Status Banner */}
      <div id="scan-record-header" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 tracking-tight flex items-center gap-2">
            <Camera className="w-5 h-5 text-blue-600" />
            Scan & Record
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            id="camera-status-chip"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap shrink-0 transition ${
              isRecording
                ? 'bg-red-50 text-red-700 border-red-200 animate-pulse'
                : isCameraActive
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-600 border border-slate-200'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isRecording ? 'bg-red-600 animate-ping' : isCameraActive ? 'bg-emerald-600' : 'bg-slate-400'
              }`}
            />
            <span>{isRecording ? <>Recording (<ElapsedTimer startedAt={recStartedAt} />)</> : isCameraActive ? 'Camera Ready' : 'Camera Off'}</span>
          </span>
        </div>
      </div>

      {/* Main Grid: Camera Preview on Left, Order Form on Right */}
      <div id="scan-record-grid" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Camera Column (10 Cols on LG for extra wide preview) */}
        <div id="camera-viewport-card" className="lg:col-span-7 xl:col-span-8 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
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
            {/* Off-screen (non-display:none) Canvas for Timestamp Stamping & Recording Capture so Chromium never suspends captureStream() */}
            <canvas ref={canvasRef} className="fixed top-0 left-0 w-px h-px opacity-[0.001] pointer-events-none -z-10" aria-hidden="true" />

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

            {/* In-Video Recording HUD (Authentic Camera OSD) */}
            {isCameraActive && (
              <div id="camera-active-hud" className="absolute top-3 right-3 flex items-start justify-end pointer-events-none text-[11px] sm:text-xs font-mono font-medium z-20">
                {/* Top-Right: Timestamp, Resolution & Auto-Focus */}
                <div className="flex flex-col items-end gap-1.5">
                  <div className="bg-black/60 backdrop-blur-xs text-white px-2.5 py-1.5 rounded shadow-sm border border-white/10 tracking-wider">
                    <LiveClock />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="backdrop-blur-xs text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-1 shadow-sm bg-black/70 text-emerald-400 border-emerald-500/30">
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
                      REC <ElapsedTimer startedAt={recStartedAt} />
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
                        disabled={isSavingRecording}
                        className="disabled:opacity-60 disabled:cursor-wait px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-lg shadow-sm transition inline-flex items-center gap-2 cursor-pointer"
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


                </>
              )}
            </div>

            {/* Metrics & Toggles */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
              {isRecording && (
                <div className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-md border border-slate-200 shadow-xs">
                  <span>Size:</span>
                  <b className="font-mono text-slate-800"><RecordedSize bytesRef={recordedBytesRef} active={isRecording} /> MB</b>
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
        <div id="order-details-card" className="lg:col-span-5 xl:col-span-4 space-y-4 min-w-0">
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
                </div>
              </div>
              <div className="relative">
                <input
                  id="orderIdInput"
                  type="text"
                  placeholder="Scan barcode (e.g. #OD-5035) or type Order ID"
                  value={orderId}
                  readOnly={isRecording}
                  title={isRecording ? 'Order ID is locked while recording' : undefined}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    if (!isRecordingRef.current) setOrderId(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    // Track the latest fast key burst so a scan into a box that still holds the
                    // previous order replaces it instead of being glued onto the end of it.
                    const now = Date.now();
                    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                      const burst = inputBurstRef.current;
                      if (now - burst.lastAt > 80) burst.text = '';
                      burst.text += e.key;
                      burst.lastAt = now;
                      return;
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const burst = inputBurstRef.current;
                      const value = e.currentTarget.value;
                      const scanned = burst.text.length >= 4 && now - burst.lastAt < 200 && value.length > burst.text.length && value.endsWith(burst.text);
                      inputBurstRef.current = { text: '', lastAt: 0 };
                      if (applyOrderCode(scanned ? burst.text : value, 'typed')) {
                        e.currentTarget.select();
                      }
                    }
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text');
                    if (pasted && cleanBarcode(pasted)) {
                      e.preventDefault();
                      applyOrderCode(pasted, 'pasted');
                    }
                  }}
                  className="w-full pl-3.5 pr-10 py-2.5 rounded-lg text-sm font-mono placeholder:text-slate-400 focus:outline-none transition bg-slate-50 border border-slate-300 text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500"
                />
                {orderId && !isRecording && (
                  <button
                    onClick={() => setOrderId('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Pre-Pack Manifest & Verification Status Card */}
              {orderId.trim() && (
                <div className="mt-2">
                  {activeManifest ? (
                    <div
                      className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition ${
                        verifiedOrderItems
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                          : 'bg-indigo-50 border-indigo-200 text-indigo-950'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {verifiedOrderItems ? (
                          <div className="w-7 h-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                            <CheckCircle2 className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                            <Boxes className="w-4 h-4" />
                          </div>
                        )}

                        <div>
                          <div className="font-bold flex items-center gap-1.5">
                            <span>
                              {verifiedOrderItems
                                ? '✓ All Product GTINs Verified'
                                : `Pre-Pack Manifest: ${activeManifest.items.length} Products`}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/80 border border-slate-200">
                              {activeManifest.platform}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono block">
                            Assigned To: <span className="font-bold text-indigo-700">{activeManifest.assignedPackerName || 'Unassigned'}</span> · Processed By: <span className="font-bold text-slate-700">{activeManifest.processedByName || 'System'}</span>
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setIsPackVerificationOpen(true)}
                        className={`px-3 py-1.5 rounded-xl font-bold text-xs shadow-xs transition cursor-pointer shrink-0 ${
                          verifiedOrderItems
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
                        }`}
                      >
                        {verifiedOrderItems ? 'Re-verify' : 'Verify Physical GTINs'}
                      </button>
                    </div>
                  ) : (
                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs text-slate-500">
                      <span className="text-[11px] font-mono">
                        ℹ️ Order not in pre-pack manifest
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const found = getManifestByOrderId(orderId.trim());
                          if (found) {
                            setActiveManifest(found);
                            setIsPackVerificationOpen(true);
                          } else {
                            onShowToast(`No manifest pre-entered for ${orderId.trim()}`, 'info');
                          }
                        }}
                        className="text-[11px] text-indigo-600 font-bold hover:underline cursor-pointer"
                      >
                        Check Manifest
                      </button>
                    </div>
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
                    onClick={() => {
                      setRecordingType(type);
                      if (type === 'Return') {
                        setIsPackVerificationOpen(false);
                        setActiveManifest(null);
                      }
                    }}
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
                        <>Order <strong>{orderId}</strong> already has a completed <strong>{recordingType}</strong> video recorded on {duplicateStatus.existingRecord?.timestamp ? fmtDateTime(duplicateStatus.existingRecord.timestamp) : 'earlier session'}.</>
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
                {backupPathParts(effectivePlatform, recordingType, new Date().toLocaleDateString('en-CA')).join(' / ')} / {orderId ? `${orderId.trim()}_${effectivePlatform}_${recordingType}.mp4` : '[OrderID]_[Platform]_[Type].mp4'}
              </p>
              <LocalBackupFolderPicker onShowToast={onShowToast} />
            </div>
          </div>
        </div>
      </div>

      {/* Pre-Pack Manifest & Physical GTIN Barcode Verification Modal */}
      {isPackVerificationOpen && activeManifest && (
        <PackVerificationModal
          key={activeManifest.orderId}
          manifest={activeManifest}
          currentUser={currentUser}
          recordingType={recordingType}
          onSwitchToReturn={() => {
            setRecordingType('Return');
            setIsPackVerificationOpen(false);
            setActiveManifest(null);
            onShowToast(`Switched to Return recording mode for Order ${activeManifest.orderId}`, 'info');
          }}
          onVerifiedAndProceed={(verified) => {
            setVerifiedOrderItems(verified);
            setIsPackVerificationOpen(false);
            onShowToast(`✓ Order ${activeManifest.orderId} verified! Starting packing recording…`, 'success');
            // Auto start recording now that items are verified
            if (!isRecording) {
              // Pass the verified items directly: the state update above is not visible to this call yet.
              startRecording(verified);
            }
          }}
          onCancel={() => {
            setIsPackVerificationOpen(false);
            setActiveManifest(null);
          }}
          onShowToast={onShowToast}
        />
      )}

      {/* Unregistered Order Warning Modal (if order is not in manifest) */}
      {unregisteredOrderWarning && (
        <div {...closeOnBackdrop(() => { setUnregisteredOrderWarning(null); setOrderId(''); })} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-fade-in select-none">
          <div className="w-full max-w-md bg-slate-900 border-2 border-amber-500 rounded-3xl p-6 text-white space-y-4 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500 text-amber-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-lg font-black text-white">Order Not in Pre-Pack Manifest</h3>
              <p className="text-xs text-slate-300">
                Order <span className="font-mono font-bold text-amber-400">{unregisteredOrderWarning.orderId}</span> has not been pre-entered by the processing team with product details and assigned packer.
              </p>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 font-mono space-y-1">
              <div>● Operator: {currentUser?.name || 'Packer'}</div>
              <div>● Status: Unregistered in manifest</div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setUnregisteredOrderWarning(null);
                  setOrderId('');
                }}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer"
              >
                Cancel &amp; Wait for Entry
              </button>

              <button
                type="button"
                onClick={() => {
                  setUnregisteredOrderWarning(null);
                  onShowToast('Proceeding with unverified order packing', 'info');
                }}
                className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl cursor-pointer shadow-md"
              >
                Proceed Unverified
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
