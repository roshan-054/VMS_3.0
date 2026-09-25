/**
 * AI Real-Time Auto-Focusing & Optical Area Targeting Engine
 * 
 * Pure Auto-Focusing (Zero Auto-Zoom):
 * - Keeps the full uncropped 1.0x wide video frame at all times.
 * - Automatically detects the active focusing area:
 *   1. Shipping Label / Barcode (AWB) -> Locks focus on label for razor-sharp barcodes & addresses
 *   2. Invoice / Bill of Supply -> Locks focus on paperwork & tax/item details
 *   3. Product Packing Action -> Locks focus on product handling and security sealing
 *   4. Station Overview -> Default general packing station focus
 * - Directs camera hardware optical autofocus (points of interest, continuous autofocus)
 *   to physically focus the lens onto the detected item without any artificial cropping.
 */

import { BrowserMultiFormatReader } from '@zxing/library';

export type FocusMode = 'AUTO' | 'LABEL' | 'INVOICE' | 'PRODUCT' | 'OVERVIEW';

export interface BoundingBox {
  x: number;      // 0..1 normalized
  y: number;      // 0..1 normalized
  width: number;  // 0..1 normalized
  height: number; // 0..1 normalized
}

export interface FocusState {
  mode: FocusMode;
  detectedType: 'LABEL' | 'INVOICE' | 'PRODUCT' | 'OVERVIEW';
  confidence: number;
  label: string;
  focusPoint: { x: number; y: number }; // 0..1 normalized center of focus
  boundingBox: BoundingBox;
  targetBoundingBox: BoundingBox;
  barcodeText?: string;
  isCalibrated: boolean;
  sharpnessScore: number;
}

export interface AiFocusCalibration {
  autoHardwareFocus: boolean;
  enableClarityEnhance: boolean;
  minConfidence: number;
  holdTimeMs: number;
  transitionSpeed: number;
}

const DEFAULT_CALIBRATION: AiFocusCalibration = {
  autoHardwareFocus: true,
  enableClarityEnhance: true,
  minConfidence: 0.55,
  holdTimeMs: 1400,
  transitionSpeed: 0.2,
};

const CALIBRATION_KEY = 'vms_ai_focus_calibration';

export function getStoredAiFocusCalibration(): AiFocusCalibration {
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CALIBRATION, ...parsed };
    }
  } catch (e) {}
  return { ...DEFAULT_CALIBRATION };
}

export function saveStoredAiFocusCalibration(config: Partial<AiFocusCalibration>): AiFocusCalibration {
  const current = getStoredAiFocusCalibration();
  const updated = { ...current, ...config };
  try {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(updated));
  } catch (e) {}
  return updated;
}

export class AiFocusEngine {
  private calibration: AiFocusCalibration;
  private mode: FocusMode = 'AUTO';
  private zxingReader: BrowserMultiFormatReader;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D | null;

  // Detection hysteresis
  private lastDetectedType: 'LABEL' | 'INVOICE' | 'PRODUCT' | 'OVERVIEW' = 'OVERVIEW';
  private detectionConfidence = 0;
  private consecutiveFrames = 0;
  private lastDetectionTime = 0;
  private lastTargetBox: BoundingBox = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  private currentBoundingBox: BoundingBox = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  private lastBarcodeText = '';

  // Background detector cadence
  private isDetecting = false;
  private lastAnalyzeTime = 0;
  private lastHardwarePoiTime = 0;
  private lastPoiCoords = { x: 0.5, y: 0.5 };

  constructor() {
    this.calibration = getStoredAiFocusCalibration();
    this.zxingReader = new BrowserMultiFormatReader();
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = 320;
    this.offscreenCanvas.height = 180;
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  public setMode(mode: FocusMode) {
    this.mode = mode;
    this.updateTargetBasedOnMode();
  }

  public getMode(): FocusMode {
    return this.mode;
  }

  public getCalibration(): AiFocusCalibration {
    return this.calibration;
  }

  public updateCalibration(newCalib: Partial<AiFocusCalibration>) {
    this.calibration = saveStoredAiFocusCalibration(newCalib);
    this.updateTargetBasedOnMode();
  }

  /**
   * Run computer vision detection on the video element.
   * Call every ~100-200ms for lightweight CPU footprint.
   */
  public async analyzeFrame(video: HTMLVideoElement): Promise<void> {
    const now = Date.now();
    if (this.isDetecting || now - this.lastAnalyzeTime < 110) return;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;

    this.isDetecting = true;
    this.lastAnalyzeTime = now;

    try {
      const vWidth = video.videoWidth;
      const vHeight = video.videoHeight;
      const sWidth = 320;
      const sHeight = Math.round((vHeight / vWidth) * sWidth) || 180;

      if (this.offscreenCanvas.width !== sWidth || this.offscreenCanvas.height !== sHeight) {
        this.offscreenCanvas.width = sWidth;
        this.offscreenCanvas.height = sHeight;
      }

      const ctx = this.offscreenCtx;
      if (!ctx) return;

      // Draw downscaled frame for rapid vision analysis
      ctx.drawImage(video, 0, 0, sWidth, sHeight);

      // 1. Check for real barcode/QR code via ZXing
      let barcodeResult: any = null;
      try {
        barcodeResult = this.zxingReader.decode(this.offscreenCanvas as any);
      } catch (zxErr) {
        // Normal when no barcode in current frame
      }

      if (barcodeResult && barcodeResult.getText()) {
        const text = barcodeResult.getText();
        this.lastBarcodeText = text;
        const pts = barcodeResult.getResultPoints ? barcodeResult.getResultPoints() : [];
        let box: BoundingBox = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
        if (pts && pts.length >= 2) {
          const xs = pts.map((p: any) => p.x / sWidth);
          const ys = pts.map((p: any) => p.y / sHeight);
          const minX = Math.max(0, Math.min(...xs) - 0.12);
          const maxX = Math.min(1, Math.max(...xs) + 0.12);
          const minY = Math.max(0, Math.min(...ys) - 0.12);
          const maxY = Math.min(1, Math.max(...ys) + 0.12);
          box = {
            x: minX,
            y: minY,
            width: Math.max(0.25, maxX - minX),
            height: Math.max(0.2, maxY - minY),
          };
        }
        this.registerDetection('LABEL', 0.95, box);
        return;
      }

      // 2. Luminance & Edge density vision analysis
      const imgData = ctx.getImageData(0, 0, sWidth, sHeight);
      const data = imgData.data;
      const analysis = this.analyzeLuminanceAndEdges(data, sWidth, sHeight);

      if (analysis.detectedType !== 'OVERVIEW' && analysis.confidence >= this.calibration.minConfidence) {
        this.registerDetection(analysis.detectedType, analysis.confidence, analysis.box);
      } else {
        // If nothing detected for holdTimeMs, default back to OVERVIEW / PRODUCT
        if (now - this.lastDetectionTime > this.calibration.holdTimeMs) {
          if (analysis.hasCentralActivity) {
            this.registerDetection('PRODUCT', 0.65, analysis.centralBox);
          } else {
            this.registerDetection('OVERVIEW', 0.8, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
          }
        }
      }
    } catch (err) {
      // Vision notice
    } finally {
      this.isDetecting = false;
    }
  }

  /**
   * Scans pixels for white paper label rectangular blocks, high horizontal contrast (barcodes/lines),
   * and invoice-sized documents vs product packing activity.
   */
  private analyzeLuminanceAndEdges(
    data: Uint8ClampedArray,
    width: number,
    height: number
  ): {
    detectedType: 'LABEL' | 'INVOICE' | 'PRODUCT' | 'OVERVIEW';
    confidence: number;
    box: BoundingBox;
    hasCentralActivity: boolean;
    centralBox: BoundingBox;
  } {
    const gridCols = 8;
    const gridRows = 6;
    const cellW = Math.floor(width / gridCols);
    const cellH = Math.floor(height / gridRows);

    let brightCells = 0;
    let highContrastCells = 0;
    let centralMotionEnergy = 0;

    let minGridX = gridCols;
    let maxGridX = 0;
    let minGridY = gridRows;
    let maxGridY = 0;

    for (let gy = 0; gy < gridRows; gy++) {
      for (let gx = 0; gx < gridCols; gx++) {
        let cellBrightCount = 0;
        let cellContrastSum = 0;
        const totalPixels = cellW * cellH;

        for (let y = gy * cellH; y < (gy + 1) * cellH; y += 2) {
          for (let x = gx * cellW; x < (gx + 1) * cellW; x += 2) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;

            // Check brightness (white paper label/invoice)
            if (lum > 175) {
              cellBrightCount++;
            }

            // Horizontal gradient (detects text rows, barcode strips)
            if (x + 2 < width) {
              const r2 = data[idx + 8];
              const g2 = data[idx + 9];
              const b2 = data[idx + 10];
              const lum2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
              cellContrastSum += Math.abs(lum - lum2);
            }
          }
        }

        const brightRatio = cellBrightCount / (totalPixels / 4);
        const avgContrast = cellContrastSum / (totalPixels / 4);

        // Center zone activity
        const isCenter = gx >= 2 && gx <= 5 && gy >= 2 && gy <= 4;
        if (isCenter) {
          centralMotionEnergy += avgContrast;
        }

        if (brightRatio > 0.42 && avgContrast > 14) {
          brightCells++;
          highContrastCells++;
          minGridX = Math.min(minGridX, gx);
          maxGridX = Math.max(maxGridX, gx);
          minGridY = Math.min(minGridY, gy);
          maxGridY = Math.max(maxGridY, gy);
        }
      }
    }

    const centralBox: BoundingBox = {
      x: 0.2,
      y: 0.2,
      width: 0.6,
      height: 0.6,
    };

    // Calculate candidate bounding box
    let box: BoundingBox = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
    if (minGridX <= maxGridX && minGridY <= maxGridY) {
      const padX = 0.05;
      const padY = 0.05;
      const bx = Math.max(0, (minGridX / gridCols) - padX);
      const by = Math.max(0, (minGridY / gridRows) - padY);
      const bw = Math.min(1 - bx, ((maxGridX - minGridX + 1) / gridCols) + padX * 2);
      const bh = Math.min(1 - by, ((maxGridY - minGridY + 1) / gridRows) + padY * 2);
      box = { x: bx, y: by, width: Math.max(0.25, bw), height: Math.max(0.2, bh) };
    }

    const totalGrid = gridCols * gridRows;
    const brightRatio = brightCells / totalGrid;

    // Small-to-medium bright patch with high contrast is characteristic of a shipping label / AWB
    if (brightRatio >= 0.06 && brightRatio <= 0.32 && highContrastCells >= 3) {
      return {
        detectedType: 'LABEL',
        confidence: Math.min(0.92, 0.6 + brightRatio),
        box,
        hasCentralActivity: centralMotionEnergy > 100,
        centralBox,
      };
    }

    // Large bright sheet (35% to 65% of screen) characteristic of an invoice or folded A4 packing slip
    if (brightRatio > 0.32 && brightRatio <= 0.70 && highContrastCells >= 10) {
      return {
        detectedType: 'INVOICE',
        confidence: 0.88,
        box,
        hasCentralActivity: centralMotionEnergy > 100,
        centralBox,
      };
    }

    // Significant central packing contrast/object
    if (centralMotionEnergy > 240) {
      return {
        detectedType: 'PRODUCT',
        confidence: 0.72,
        box: centralBox,
        hasCentralActivity: true,
        centralBox,
      };
    }

    return {
      detectedType: 'OVERVIEW',
      confidence: 0.85,
      box: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      hasCentralActivity: centralMotionEnergy > 120,
      centralBox,
    };
  }

  private registerDetection(
    type: 'LABEL' | 'INVOICE' | 'PRODUCT' | 'OVERVIEW',
    confidence: number,
    box: BoundingBox
  ) {
    const now = Date.now();
    this.lastDetectionTime = now;
    this.lastTargetBox = box;
    this.detectionConfidence = confidence;

    if (this.lastDetectedType === type) {
      this.consecutiveFrames++;
    } else {
      this.consecutiveFrames = 1;
      this.lastDetectedType = type;
    }
  }

  private updateTargetBasedOnMode() {
    if (this.mode === 'OVERVIEW') {
      this.lastTargetBox = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
    } else if (this.mode === 'LABEL') {
      this.lastTargetBox = { x: 0.25, y: 0.22, width: 0.50, height: 0.52 };
    } else if (this.mode === 'INVOICE') {
      this.lastTargetBox = { x: 0.18, y: 0.15, width: 0.64, height: 0.68 };
    } else if (this.mode === 'PRODUCT') {
      this.lastTargetBox = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
    }
  }

  /**
   * Renders the video frame to the recording canvas without any cropping or digital zoom (1.0x Full Frame).
   * Dynamically tracks the auto-focus target area coordinates for optical auto-focus and visual feedback.
   */
  public renderFrameToCanvas(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D
  ): FocusState {
    const vWidth = video.videoWidth || 1280;
    const vHeight = video.videoHeight || 720;

    if (canvas.width !== vWidth || canvas.height !== vHeight) {
      canvas.width = vWidth;
      canvas.height = vHeight;
    }

    // Smooth Bounding Box transition for visual reticle
    const speed = Math.max(0.08, Math.min(0.4, this.calibration.transitionSpeed));
    this.currentBoundingBox.x += (this.lastTargetBox.x - this.currentBoundingBox.x) * speed;
    this.currentBoundingBox.y += (this.lastTargetBox.y - this.currentBoundingBox.y) * speed;
    this.currentBoundingBox.width += (this.lastTargetBox.width - this.currentBoundingBox.width) * speed;
    this.currentBoundingBox.height += (this.lastTargetBox.height - this.currentBoundingBox.height) * speed;

    // Draw the 100% FULL, uncropped video frame directly
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Apply mild clarity boost to enhance edge contrast for barcodes & text without zooming
    if (this.calibration.enableClarityEnhance && this.lastDetectedType !== 'OVERVIEW') {
      ctx.filter = 'contrast(104%) brightness(101%)';
    } else {
      ctx.filter = 'none';
    }

    ctx.drawImage(video, 0, 0, vWidth, vHeight);
    ctx.filter = 'none';

    // Determine current descriptive label
    let label = 'STATION OVERVIEW';
    const effectiveType = this.mode === 'AUTO' ? this.lastDetectedType : (this.mode as any);
    if (effectiveType === 'LABEL') {
      label = 'SHIPPING LABEL & BARCODE';
    } else if (effectiveType === 'INVOICE') {
      label = 'INVOICE / BILL OF SUPPLY';
    } else if (effectiveType === 'PRODUCT') {
      label = 'PRODUCT PACKING';
    }

    const focusPoint = {
      x: Number((this.currentBoundingBox.x + this.currentBoundingBox.width / 2).toFixed(3)),
      y: Number((this.currentBoundingBox.y + this.currentBoundingBox.height / 2).toFixed(3)),
    };

    return {
      mode: this.mode,
      detectedType: effectiveType,
      confidence: this.detectionConfidence,
      label,
      focusPoint,
      boundingBox: { ...this.currentBoundingBox },
      targetBoundingBox: { ...this.lastTargetBox },
      barcodeText: this.lastBarcodeText,
      isCalibrated: true,
      sharpnessScore: Math.round(75 + this.detectionConfidence * 25),
    };
  }

  /**
   * Applies hardware camera track point of interest optical autofocus if supported by webcam.
   * Tells the camera lens to focus directly on the target coordinates.
   */
  public async applyHardwarePoi(track: MediaStreamTrack | null): Promise<void> {
    if (!track || !this.calibration.autoHardwareFocus) return;

    const now = Date.now();
    // Throttle hardware constraint calls to prevent camera driver spam
    if (now - this.lastHardwarePoiTime < 350) return;

    const normX = Math.max(0.05, Math.min(0.95, this.currentBoundingBox.x + this.currentBoundingBox.width / 2));
    const normY = Math.max(0.05, Math.min(0.95, this.currentBoundingBox.y + this.currentBoundingBox.height / 2));

    // Only send if shifted by more than 5%
    const dist = Math.hypot(normX - this.lastPoiCoords.x, normY - this.lastPoiCoords.y);
    if (dist < 0.05 && now - this.lastHardwarePoiTime < 2500) return;

    this.lastHardwarePoiTime = now;
    this.lastPoiCoords = { x: normX, y: normY };

    try {
      if (typeof track.applyConstraints === 'function') {
        const caps: any = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
        const adv: any = {};

        // 1. Hardware Point of Interest Focus
        if (caps.pointsOfInterest) {
          adv.pointsOfInterest = [{ x: normX, y: normY }];
        }

        // 2. Hardware Auto-Focus Mode
        if (caps.focusMode && Array.isArray(caps.focusMode)) {
          if (caps.focusMode.includes('continuous')) {
            adv.focusMode = 'continuous';
          }
        }

        // 3. Hardware Auto-Exposure on the target
        if (caps.exposureMode && Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
          adv.exposureMode = 'continuous';
        }

        if (Object.keys(adv).length > 0) {
          await track.applyConstraints({ advanced: [adv] } as any);
        }
      }
    } catch (e) {
      // Hardware POI optional
    }
  }
}

export const sharedAiFocusEngine = new AiFocusEngine();
