# VMS 3.0 - Order Packing Video Management System Specification

## Current Core Features & Architecture

### 1. Recording Types
- **Forward**: Outbound order packing recording.
- **Return**: Inbound customer return verification recording.
- *(Note: 'Replacement' and 'Damage Inspection' were removed as per user requirement).*

### 2. Supported E-Commerce Platforms
- **Amazon**
- **D2C**
- **JioMart**
- **Custom** (allows typing custom platform name)

### 3. Video Timestamp & OSD Engine
- **Authentic CCTV / Security Camera OSD**:
  - Rendered onto a continuous canvas pipeline at 30 FPS and recorded directly into the output MP4/WebM video stream via `canvas.captureStream()`.
  - **Top-Right**: Live Date and Time in `YYYY-MM-DD  HH:MM:SS` format (monospace, crisp white text with dark translucent backing).
  - **Bottom-Right**: Dynamic `● REC` indicator active during recording.
- Audio recording is **disabled by default** (muted) to preserve packing station privacy and bandwidth; operators can toggle it on when needed via the toolbar microphone button.

### 4. Storage & Integrations
- **Google Drive Hierarchy**: `VMS_Packing_Videos / <Platform> / <Type> / <MMM-YYYY> / <YYYY-MM-DD> / [OrderID]_[Platform]_[Type].mp4`
- **Google Sheets Logging**: Automatic row insertion with timestamp, order ID, platform, recording type, duration, operator name, and Google Drive URL.
- **Local Fallback**: IndexedDB local storage queue with automatic retry when offline or when tokens are refreshed.

### 5. Barcode & Scanner Integration
- Hardware USB HID Barcode scanner detection via keyboard event buffer.
- Instant auto-start / stop recording triggers upon barcode scan.
- Duplicate order scanning detection with configurable warning modal.

### 6. Authentication & User Management
- Authentication strictly enforced via created ID / email and password (no demo/workstation bypass mode).
- Registration creates verified operator/admin accounts with immediate session activation.

### 7. Permanent Cloud Branding & Drive Integration (Admin Only)
- Admin configuration panel in `AdminPanel.tsx` (`Logo & Favicon` and `System Settings` sub-tabs).
- **Google Sheet Persistence**: Branding (Logo URL, Favicon URL, App Name, Subtitle) and **VideoDriveFolderId** (Google Drive root folder ID for videos) are permanently stored in the dedicated `Branding` sheet tab via Apps Script and referenced from there on every load.
- **Drive Folder Path Portability**: Moving or changing the root video folder requires only updating the `VideoDriveFolderId` row in the `Branding` sheet tab (or changing it in the Admin Panel and clicking Save), with no code changes or redeployments required. Accepts clean folder IDs or full Google Drive folder links.
- **Drive Image Asset Storage**: Uploaded logos and favicons are automatically stored inside a dedicated `VMS_Branding` folder in Google Drive and their permanent web URLs are recorded into the Google Sheet.
- **Favicon Synchronization**: Dynamically updates the document `<link rel="icon">` element and browser tab title.
- **Permanent Retention**: Configured branding remains permanently active across all screens (Sidebar, Mobile header, Login screen, and Browser tabs).

### 8. AI Dynamic Auto-Focus & Vision Intelligence (Area Targeting & Drive Video Analysis)
- **Pure Auto-Focusing (Zero Auto-Zooming)**:
  - Preserves the full, uncropped 1.0x wide-angle packing station camera view at all times (no digital zooming or cropping).
  - Automatically identifies the active focusing area in real-time:
    - **Shipping Label / Barcode (AWB)**: Detects barcode stripes & label boundaries and commands the optical camera lens (`pointsOfInterest`, `focusMode: 'continuous'`) to pull sharp focus on the label, with edge clarity enhancement for crisp barcodes & addresses.
    - **Invoice / Bill of Supply**: Detects document sheets & tabular line items, locking optical focus on the paperwork so item descriptions, pricing, and tax details are clearly legible.
    - **Product Packing Action**: Locks optical focus onto product handling, polybag insertion, box taping, and tamper-evident sealing.
    - **Station Overview**: Returns to default station focus across the wide packing table.
  - Video recording pipeline captures the full uncropped frame (`0, 0, vWidth, vHeight`) while physically focusing on the active target area.
- **Gemini AI Drive Video Analysis & Calibration**:
  - Uses Gemini 3.8 Flash (`/api/ai/analyze-packing-video`) to inspect already-uploaded packing videos in Google Drive.
  - Pinpoints exact focus moments, rates label scanability and invoice legibility, and calibrates auto-focus parameters for the station's live camera engine.

### 9. Real-Time Wireless Phone Barcode Scanner Engine
- **Turn Smartphone into Laser Barcode Reader**:
  - Operators can use their iPhone or Android mobile device as a wireless handheld barcode reader without installing any app.
  - Zero-delay instant pairing via QR code or 4-digit Station PIN (`/?scanner=mobile&pin=XXXX`).
- **Real-Time WebSocket Sync Pipeline**:
  - Ultra-low latency (<15ms) bidirectional WebSocket connection (`/ws-scanner`) with automatic reconnect and HTTP fallback buffer (`/api/scanner/broadcast`).
  - Barcodes scanned on the phone immediately appear in the desktop workstation Order ID field, auto-detect platform (Amazon, D2C, JioMart, Custom), and trigger auto-recording if enabled.
- **Hardware-Accelerated Dual Vision Decoder**:
  - Uses native GPU-accelerated `BarcodeDetector` API at 60 FPS for instant detection of 1D (Code 128, Code 39, EAN 13, UPC) and 2D (QR, DataMatrix) codes.
  - Automatic fallback to `@zxing/library` for universal browser compatibility.
  - Integrated mobile flashlight torch toggle, camera switcher, vibration haptics, and handheld scanner chirp audio tones.
- **Remote Workstation Controls from Phone**:
  - Operators can trigger **Start Recording**, **Stop & Save Video**, and **Camera Refocus** directly from the phone's touch controls while moving around the packing station.


