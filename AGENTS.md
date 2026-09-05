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

### 7. Permanent Cloud Branding & Drive Image Integration (Admin Only)
- Admin configuration panel in `AdminPanel.tsx` (`Logo & Favicon` sub-tab).
- **Google Sheet Persistence**: Branding (Logo URL, Favicon URL, App Name, Subtitle) is permanently stored in the dedicated `Branding` sheet tab via Apps Script and referenced from there on every load.
- **Drive Image Asset Storage**: Uploaded logos and favicons are automatically stored inside a dedicated `VMS_Branding` folder in Google Drive and their permanent web URLs are recorded into the Google Sheet.
- **Favicon Synchronization**: Dynamically updates the document `<link rel="icon">` element and browser tab title.
- **Permanent Retention**: Configured branding remains permanently active across all screens (Sidebar, Mobile header, Login screen, and Browser tabs).
