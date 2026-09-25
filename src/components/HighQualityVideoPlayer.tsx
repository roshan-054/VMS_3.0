import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  RotateCcw,
  Camera,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Download,
  Check,
  Film,
  AlertCircle,
  Loader2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Move
} from 'lucide-react';
import { AiVideoFocusModal } from './AiVideoFocusModal';

interface HighQualityVideoPlayerProps {
  fileId?: string;
  driveLink?: string;
  localBlobUrl?: string;
  orderId?: string;
  fileName?: string;
  title?: string;
  autoPlay?: boolean;
  showTopBar?: boolean;
}

export const HighQualityVideoPlayer: React.FC<HighQualityVideoPlayerProps> = ({
  fileId,
  driveLink,
  localBlobUrl,
  orderId = 'Order',
  fileName = 'recording.mp4',
  title,
  autoPlay = false,
  showTopBar = false,
}) => {
  const hasLocalBlob = Boolean(localBlobUrl);
  const [playerMode, setPlayerMode] = useState<'local_master' | 'drive_hd'>(
    hasLocalBlob ? 'local_master' : 'drive_hd'
  );

  // Native Local Video Player State
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [snapshotSuccess, setSnapshotSuccess] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string>('Snapshot Saved as PNG!');
  const [isAiFocusModalOpen, setIsAiFocusModalOpen] = useState(false);

  // High-Precision Inspection Zoom & Pan State
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Reset zoom & pan if media changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [fileId, localBlobUrl]);

  // Listen to browser fullscreen changes to prevent state desync and UI disappearance
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = Boolean(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      setIsFullscreen(isCurrentlyFullscreen);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  // Zoom control handlers
  const handleZoomIn = () => {
    setZoom((prev) => Math.min(4, Number((prev + 0.25).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoom((prev) => {
      const next = Math.max(1, Number((prev - 0.25).toFixed(2)));
      if (next === 1) {
        setPan({ x: 0, y: 0 });
      }
      return next;
    });
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Pan / Dragging Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX - pan.x,
      y: e.clientY - pan.y,
    });
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || zoom <= 1) return;
    const maxPanX = (zoom - 1) * 350;
    const maxPanY = (zoom - 1) * 220;
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;

    setPan({
      x: Math.max(-maxPanX, Math.min(maxPanX, newX)),
      y: Math.max(-maxPanY, Math.min(maxPanY, newY)),
    });
  }, [isDragging, zoom, dragStart]);

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Format time (MM:SS.ms)
  const formatTime = (timeInSeconds: number, includeMs = false) => {
    if (isNaN(timeInSeconds) || timeInSeconds < 0) return '00:00';
    const mins = Math.floor(timeInSeconds / 60);
    const secs = Math.floor(timeInSeconds % 60);
    const ms = Math.floor((timeInSeconds % 1) * 100);
    const formattedMins = mins.toString().padStart(2, '0');
    const formattedSecs = secs.toString().padStart(2, '0');
    if (includeMs) {
      return `${formattedMins}:${formattedSecs}.${ms.toString().padStart(2, '0')}`;
    }
    return `${formattedMins}:${formattedSecs}`;
  };

  // Local Video Event Handlers
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handlePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.warn('Playback error:', err);
      });
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleFrameStep = (direction: 'forward' | 'backward', stepSeconds = 0.04) => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    setIsPlaying(false);
    const newTime = direction === 'forward'
      ? Math.min(videoRef.current.duration, videoRef.current.currentTime + stepSeconds)
      : Math.max(0, videoRef.current.currentTime - stepSeconds);
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackRate(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
  };

  const handleToggleMute = () => {
    if (!videoRef.current) return;
    const newMute = !isMuted;
    setIsMuted(newMute);
    videoRef.current.muted = newMute;
  };

  const handleToggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen toggle exception:', err);
      setIsFullscreen(prev => !prev);
    }
  };

  // Robust High-Resolution Snapshot Capture
  const handleCaptureSnapshot = async () => {
    setIsCapturing(true);

    // Case 1: Native Local Master Video Element Available
    if (videoRef.current && playerMode === 'local_master') {
      try {
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1920;
        canvas.height = video.videoHeight || 1080;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // Evidence footer stamp
          ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
          ctx.fillRect(20, canvas.height - 50, 520, 36);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 15px monospace';
          ctx.fillText(`ORDER: ${orderId} | TIME: ${formatTime(video.currentTime, true)}`, 32, canvas.height - 27);

          const dataUrl = canvas.toDataURL('image/png', 1.0);
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = `${orderId}_Snapshot_${Math.floor(video.currentTime)}s.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          setSnapshotMessage('Lossless 1080p Snapshot Saved as PNG!');
          setSnapshotSuccess(true);
          setTimeout(() => setSnapshotSuccess(false), 3000);
        }
      } catch (err) {
        console.warn('Canvas snapshot error:', err);
      } finally {
        setIsCapturing(false);
      }
      return;
    }

    // Case 2: Google Drive Embedded Stream / Cloud Stream Frame Capture
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: 'browser',
          },
          audio: false,
        });

        const track = stream.getVideoTracks()[0];
        const tempVideo = document.createElement('video');
        tempVideo.srcObject = stream;
        tempVideo.muted = true;
        await tempVideo.play();

        await new Promise((resolve) => setTimeout(resolve, 150));

        const canvas = document.createElement('canvas');
        canvas.width = tempVideo.videoWidth || 1920;
        canvas.height = tempVideo.videoHeight || 1080;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
          
          // Evidence stamp
          ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
          ctx.fillRect(20, canvas.height - 50, 480, 36);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 15px monospace';
          ctx.fillText(`ORDER: ${orderId} | SNAPSHOT PROOF`, 32, canvas.height - 27);

          const dataUrl = canvas.toDataURL('image/png', 1.0);
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = `${orderId}_Evidence_Snapshot.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          setSnapshotMessage('High-Resolution Frame Snapshot Saved as PNG!');
          setSnapshotSuccess(true);
          setTimeout(() => setSnapshotSuccess(false), 3500);
        }

        track.stop();
        stream.getTracks().forEach((t) => t.stop());
        tempVideo.remove();
      } else {
        alert(`Tip: You can use Windows Snipping Tool (Win + Shift + S) or Mac (Cmd + Shift + 4) to capture this frame.`);
      }
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError') {
        console.warn('Screen snapshot note:', err);
      }
    } finally {
      setIsCapturing(false);
    }
  };

  // Direct download link
  const directDriveDownloadUrl = fileId
    ? `https://drive.google.com/uc?export=download&id=${fileId}`
    : driveLink || '';

  return (
    <div
      ref={containerRef}
      className={`flex flex-col bg-slate-950 text-white overflow-hidden transition-all ${
        isFullscreen
          ? 'fixed inset-0 z-[99999] w-screen h-screen rounded-none bg-black justify-between'
          : 'relative w-full rounded-2xl border border-slate-800 shadow-2xl'
      }`}
    >
      {/* Optional Top Stream Selector Bar */}
      {(showTopBar || hasLocalBlob) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 shrink-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="font-bold text-xs text-slate-100 tracking-wide truncate">
              {title || `Order #${orderId}`}
            </span>
          </div>

          {hasLocalBlob && (
            <div className="bg-slate-950 p-0.5 rounded-xl border border-slate-800 flex items-center">
              <button
                onClick={() => setPlayerMode('local_master')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer ${
                  playerMode === 'local_master'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Station Master Recording (100% Uncompressed 1080p)"
              >
                <Sparkles className="w-3 h-3 text-amber-300" />
                Local HD Master
              </button>

              {fileId && (
                <button
                  onClick={() => setPlayerMode('drive_hd')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition cursor-pointer ${
                    playerMode === 'drive_hd'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Google Drive Cloud Player"
                >
                  <Film className="w-3 h-3" />
                  Drive Cloud
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Video Viewport (Supports Zoom & Pan) */}
      <div
        ref={viewportRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`relative bg-black flex items-center justify-center overflow-hidden select-none ${
          zoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
        } ${
          isFullscreen
            ? 'flex-1 w-full h-full'
            : 'w-full aspect-video min-h-[260px] sm:min-h-[380px] max-h-[58vh]'
        }`}
      >
        {/* Zoomed Media Content Wrapper */}
        <div
          className="w-full h-full flex items-center justify-center transition-transform"
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: 'center center',
            transitionDuration: isDragging ? '0ms' : '150ms',
          }}
        >
          {playerMode === 'local_master' && hasLocalBlob ? (
            <video
              ref={videoRef}
              src={localBlobUrl}
              crossOrigin="anonymous"
              playsInline
              autoPlay={autoPlay}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              onClick={zoom === 1 ? handlePlayPause : undefined}
              className="w-full h-full object-contain pointer-events-auto"
            />
          ) : fileId ? (
            <div className="relative w-full h-full">
              <iframe
                src={`https://drive.google.com/file/d/${fileId}/preview`}
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                className={`w-full h-full border-0 bg-black min-h-[260px] ${
                  zoom > 1 && isDragging ? 'pointer-events-none' : 'pointer-events-auto'
                }`}
                title={`Video Stream - Order ${orderId}`}
              />
              {/* Invisible drag overlay when zoomed in on iframe */}
              {zoom > 1 && !isDragging && (
                <div
                  className="absolute top-0 right-0 w-24 h-24 bg-transparent cursor-grab z-10"
                  title="Drag anywhere to pan zoomed view"
                />
              )}
            </div>
          ) : (
            <div className="p-8 text-center space-y-3">
              <AlertCircle className="w-12 h-12 text-amber-400 mx-auto animate-bounce" />
              <h4 className="text-sm font-bold text-white">Video Syncing or Unavailable</h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                This recording is currently in the upload queue or processing on Google Drive.
              </p>
            </div>
          )}
        </div>

        {/* Quality HUD Badge & Active Zoom Indicator */}
        <div className="absolute top-3 left-3 flex items-center gap-2 z-20">
          <div className="bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700/80 text-[11px] font-mono text-emerald-400 flex items-center gap-2 shadow-xl pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="font-bold">
              {playerMode === 'local_master' ? '1080p Master Stream' : 'Drive HD Cloud Stream'}
            </span>
          </div>

          {zoom > 1 && (
            <div className="bg-blue-950/90 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-blue-600/60 text-[11px] font-mono text-blue-300 flex items-center gap-1.5 shadow-xl animate-in fade-in">
              <Move className="w-3 h-3 text-blue-400 animate-pulse" />
              <span className="font-bold">{zoom.toFixed(1)}x Zoom</span>
              <span className="text-[10px] text-blue-400 hidden sm:inline">(Drag to Pan)</span>
              <button
                onClick={handleResetZoom}
                className="ml-1 text-[10px] bg-blue-600/40 hover:bg-blue-600 text-white px-1.5 py-0.5 rounded transition cursor-pointer"
                title="Reset zoom to 1.0x"
              >
                Reset
              </button>
            </div>
          )}
        </div>

        {/* Snapshot Toast Feedback */}
        {snapshotSuccess && (
          <div className="absolute top-3 right-3 bg-emerald-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-2xl animate-fade-in z-30">
            <Check className="w-4 h-4" />
            {snapshotMessage}
          </div>
        )}
      </div>

      {/* Playback & Action Toolbar */}
      <div className="bg-slate-900/95 backdrop-blur-md border-t border-slate-800 p-3 sm:p-4 space-y-3 shrink-0 z-20">
        {/* Local Master Video Timeline Scrubber */}
        {playerMode === 'local_master' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span className="text-emerald-400 font-bold">{formatTime(currentTime, true)}</span>
              <span>{formatTime(duration, true)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.01}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400 focus:outline-none"
            />
          </div>
        )}

        {/* Primary Action Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Playback Controls (when local master is active) */}
          {playerMode === 'local_master' ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handlePlayPause}
                className="w-9 h-9 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl flex items-center justify-center shadow-md transition cursor-pointer"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
              </button>

              <button
                onClick={() => handleFrameStep('backward', 0.04)}
                className="p-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition cursor-pointer"
                title="Step -1 Frame"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <button
                onClick={() => handleFrameStep('forward', 0.04)}
                className="p-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition cursor-pointer"
                title="Step +1 Frame"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = 0;
                    setCurrentTime(0);
                  }
                }}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition hidden sm:flex cursor-pointer"
                title="Restart Video (00:00)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              {/* Volume Slider */}
              <div className="flex items-center gap-1 ml-2 bg-slate-950/80 px-2 py-1 rounded-xl border border-slate-800">
                <button
                  onClick={handleToggleMute}
                  className="text-slate-400 hover:text-white transition cursor-pointer"
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-14 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              {/* Speed Multiplier */}
              <div className="flex items-center bg-slate-950 px-1.5 py-1 rounded-xl border border-slate-800 text-[11px] font-semibold text-slate-300 ml-1">
                {[0.5, 1, 1.5, 2].map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSpeedChange(s)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
                      playbackRate === s
                        ? 'bg-emerald-600 text-white font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-xs flex items-center gap-1.5 font-medium">
                <Film className="w-4 h-4 text-blue-400" />
                <span>Google Drive Stream Active</span>
              </span>
            </div>
          )}

          {/* Right Action Controls: Zoom Stepper, Download, Snapshot & Fullscreen */}
          <div className="flex items-center flex-wrap gap-2">
            {/* Zoom & Inspection Stepper */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs text-slate-300">
              <button
                onClick={handleZoomOut}
                disabled={zoom <= 1}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                title="Zoom Out (-25%)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              
              <button
                onClick={handleResetZoom}
                className={`px-2 py-0.5 rounded-md font-mono text-[11px] font-bold transition cursor-pointer ${
                  zoom > 1
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={zoom > 1 ? 'Click to Reset Zoom (1.0x)' : 'Current Zoom Level'}
              >
                {zoom.toFixed(1)}x
              </button>

              <button
                onClick={handleZoomIn}
                disabled={zoom >= 4}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                title="Zoom In (+25%)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Download MP4 Button */}
            {fileId && (
              <a
                href={directDriveDownloadUrl}
                target="_blank"
                rel="noreferrer"
                download={fileName}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold rounded-xl border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
                title="Download MP4 video file"
              >
                <Download className="w-4 h-4 text-slate-400" />
                <span className="hidden sm:inline">Download MP4</span>
              </a>
            )}

            {/* AI Focus Area Analysis with Gemini */}
            <button
              onClick={() => setIsAiFocusModalOpen(true)}
              className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-bold rounded-xl shadow-md transition flex items-center gap-2 cursor-pointer"
              title="Use Gemini AI to analyze focus shifts for shipping labels, invoices, and product packing"
            >
              <Sparkles className="w-4 h-4 text-emerald-200" />
              <span>AI Focus Analysis</span>
            </button>

            {/* Snapshot Button */}
            <button
              onClick={handleCaptureSnapshot}
              disabled={isCapturing}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 hover:text-white font-semibold rounded-xl border border-slate-700 transition flex items-center gap-2 disabled:opacity-50 cursor-pointer"
              title="Capture high-resolution PNG proof screenshot of the current frame"
            >
              {isCapturing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              <span>{isCapturing ? 'Capturing...' : 'Capture Snapshot'}</span>
            </button>

            {/* Fullscreen Button */}
            <button
              onClick={handleToggleFullscreen}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition cursor-pointer"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* AI Video Focus Analysis Modal */}
      <AiVideoFocusModal
        isOpen={isAiFocusModalOpen}
        onClose={() => setIsAiFocusModalOpen(false)}
        orderId={orderId}
        fileId={fileId}
        driveLink={driveLink}
        onShowToast={(msg, type) => {
          setSnapshotMessage(msg);
          setSnapshotSuccess(true);
          setTimeout(() => setSnapshotSuccess(false), 3000);
        }}
      />
    </div>
  );
};
