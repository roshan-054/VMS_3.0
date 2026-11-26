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
import { getOriginalVideoUrl, getDriveStreamUrl, isDriveStreamUsable, reportDriveStreamResult } from '../lib/videoFetch';
import { ensureVideoStreamWorker, getBackendStreamUrl } from '../lib/videoStream';

// Full quality tries three ways to play the original file, fastest first:
//  direct:   the browser streams it straight from Google Drive (starts in a second or two).
//  backend:  streamed through the Apps Script backend in 4 MB pieces (starts in a few seconds).
//  download: the whole file is downloaded through the backend, then played (slow for big files).
type OriginalSource = 'direct' | 'backend' | 'download';
const firstSource = (): OriginalSource => (isDriveStreamUsable() ? 'direct' : 'backend');
// How long each stream may take to show the first frame before the next way is tried.
const START_TIMEOUT_MS: Record<OriginalSource, number> = { direct: 6000, backend: 60000, download: 0 };

// The back / forward buttons and arrow keys jump this many seconds.
const SKIP_SECONDS = 5;

// Get the stream worker in place early so it is ready by the time a video is opened.
if (typeof window !== 'undefined') ensureVideoStreamWorker().catch(() => {});

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
  // local_master: this station's own copy. original: the uploaded file itself, downloaded from
  // Drive at full resolution. drive_hd: Google Drive's preview player (re-encoded, lower quality).
  const [playerMode, setPlayerMode] = useState<'local_master' | 'original' | 'drive_hd'>(
    hasLocalBlob ? 'local_master' : fileId ? 'original' : 'drive_hd'
  );
  const [originalUrl, setOriginalUrl] = useState<string>('');
  const [originalProgress, setOriginalProgress] = useState<{ loaded: number; total: number }>({ loaded: 0, total: 0 });
  const [originalError, setOriginalError] = useState<string>('');
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [source, setSource] = useState<OriginalSource>(firstSource);
  const [streamStarted, setStreamStarted] = useState(false);
  const [workerReady, setWorkerReady] = useState<boolean | null>(null);
  // When full quality has to be downloaded whole, the Drive preview plays meanwhile and the
  // viewer switches over when the download is done (fullReady = they chose to, or it was instant).
  const [fullReady, setFullReady] = useState(false);

  useEffect(() => {
    let alive = true;
    ensureVideoStreamWorker().then((ok) => alive && setWorkerReady(ok));
    return () => {
      alive = false;
    };
  }, []);

  // No stream worker in this browser: go straight from the direct stream to the download.
  useEffect(() => {
    if (source === 'backend' && workerReady === false) {
      console.warn('[VMS player] stream worker unavailable in this tab; downloading the whole file instead.');
      setSource('download');
    }
  }, [source, workerReady]);

  useEffect(() => {
    setPlayerMode(hasLocalBlob ? 'local_master' : fileId ? 'original' : 'drive_hd');
    setOriginalUrl('');
    setOriginalError('');
    setOriginalProgress({ loaded: 0, total: 0 });
    setVideoSize(null);
    setSource(firstSource());
    setStreamStarted(false);
    setFullReady(false);
  }, [fileId, localBlobUrl]);

  useEffect(() => {
    if (playerMode !== 'original' || !fileId || originalUrl || source !== 'download') return;
    let alive = true;
    const t0 = Date.now();
    setOriginalError('');
    const { url, unsubscribe } = getOriginalVideoUrl(fileId, (loaded, total) => {
      if (alive) setOriginalProgress({ loaded, total });
    });
    url
      .then((u) => {
        if (!alive) return;
        setOriginalUrl(u);
        if (Date.now() - t0 < 2000) setFullReady(true); // already downloaded earlier: play it at once
      })
      .catch((err: any) => alive && setOriginalError(err?.message || 'Could not load the full-quality video.'));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [playerMode, fileId, originalUrl, retryKey, source]);

  const streamUrl =
    playerMode !== 'original' || !fileId
      ? ''
      : source === 'direct'
        ? getDriveStreamUrl(fileId)
        : source === 'backend' && workerReady
          ? getBackendStreamUrl(fileId)
          : '';
  const nativeSrc = playerMode === 'local_master' ? localBlobUrl || '' : playerMode === 'original' ? streamUrl || (fullReady ? originalUrl : '') : '';
  const isStreaming = Boolean(streamUrl);
  const previewWhileLoading = playerMode === 'original' && Boolean(fileId) && !nativeSrc && source === 'download' && !originalError;

  // The current stream did not work: move on to the next way of playing the original.
  const streamFailed = useCallback((why: string) => {
    console.warn('[VMS player] full-quality stream did not start:', why);
    setStreamStarted(false);
    setSource((cur) => {
      if (cur === 'direct') {
        reportDriveStreamResult(false);
        return 'backend';
      }
      return 'download';
    });
  }, []);

  // Give up on a stream that shows nothing within its time limit.
  useEffect(() => {
    if (!isStreaming || streamStarted) return;
    const t = setTimeout(() => streamFailed(`${source}: no picture within ${START_TIMEOUT_MS[source] / 1000} s`), START_TIMEOUT_MS[source]);
    return () => clearTimeout(t);
  }, [isStreaming, streamStarted, streamUrl, source, streamFailed]);

  const handleVideoError = () => {
    if (isStreaming) streamFailed(`${source}: video error ${videoRef.current?.error?.code ?? ''} ${videoRef.current?.error?.message ?? ''}`);
  };
  const isNative = playerMode !== 'drive_hd';

  // Native Local Video Player State
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
      setVideoSize({ w: videoRef.current.videoWidth, h: videoRef.current.videoHeight });
    }
  };

  const switchMode = (mode: 'local_master' | 'original' | 'drive_hd') => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setVideoSize(null);
    if (mode === 'original') {
      setFullReady(Boolean(originalUrl)); // already downloaded: play it straight away
      setOriginalError('');
      setRetryKey((k) => k + 1);
      setStreamStarted(false);
      setSource(firstSource());
    }
    setPlayerMode(mode);
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

  // Jump back or forward by a few seconds. Playback keeps going if it was playing.
  const handleSkip = (seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    const end = Number.isFinite(v.duration) ? v.duration : v.currentTime + Math.max(0, seconds);
    const newTime = Math.max(0, Math.min(end, v.currentTime + seconds));
    v.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // Keyboard: Left/Right arrows jump 5 s, Space plays/pauses. Ignored while typing in a field.
  const hasNativeVideo = isNative && Boolean(nativeSrc);
  useEffect(() => {
    if (!hasNativeVideo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return;
      const v = videoRef.current;
      if (!v) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        handleSkip(e.key === 'ArrowRight' ? SKIP_SECONDS : -SKIP_SECONDS);
      } else if (e.key === ' ' && tag !== 'button') {
        e.preventDefault();
        if (v.paused) v.play().catch(() => {});
        else v.pause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasNativeVideo]);

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
      {(showTopBar || hasLocalBlob || fileId) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 shrink-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="font-bold text-xs text-slate-100 tracking-wide truncate">
              {title || `Order #${String(orderId || '').replace(/^#+/, '')}`}
            </span>
          </div>

          {(hasLocalBlob || fileId) && (
            <div className="bg-slate-950 p-0.5 rounded-xl border border-slate-800 flex items-center" id="player-source-switch">
              {hasLocalBlob && (
              <button
                onClick={() => switchMode('local_master')}
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
              )}

              {fileId && (
                <button
                  id="player-mode-original"
                  onClick={() => switchMode('original')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer ${
                    playerMode === 'original'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Play the original uploaded file at its full recorded resolution"
                >
                  <Sparkles className="w-3 h-3 text-amber-300" />
                  Full quality
                </button>
              )}

              {fileId && (
                <button
                  id="player-mode-drive"
                  onClick={() => switchMode('drive_hd')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition cursor-pointer ${
                    playerMode === 'drive_hd'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Google Drive Cloud Player"
                >
                  <Film className="w-3 h-3" />
                  Drive preview
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
          {isNative && nativeSrc ? (
            <>
            {isStreaming && !streamStarted && (
              <div id="hq-player-stream-loading" className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none z-10">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                <span className="text-xs font-semibold text-white">
                  {source === 'backend' ? 'Starting the original video from Google Drive…' : 'Opening the original video…'}
                </span>
              </div>
            )}
            <video
              ref={videoRef}
              id="hq-player-video"
              src={nativeSrc}
              data-source={isStreaming ? (source === 'backend' ? 'backend-stream' : 'drive-stream') : nativeSrc.startsWith('blob:') ? 'blob' : 'other'}
              playsInline
              preload="auto"
              onError={handleVideoError}
              onLoadedData={() => {
                if (isStreaming && !streamStarted) {
                  setStreamStarted(true);
                  if (source === 'direct') reportDriveStreamResult(true);
                }
              }}
              autoPlay={autoPlay}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onClick={zoom === 1 ? handlePlayPause : undefined}
              className="w-full h-full object-contain pointer-events-auto"
            />
            </>
          ) : previewWhileLoading ? (
            <div className="relative w-full h-full" id="hq-player-preview-while-loading">
              <iframe
                src={`https://drive.google.com/file/d/${fileId}/preview`}
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                className="w-full h-full border-0 bg-black min-h-[260px]"
                title={`Video Stream - Order ${orderId}`}
              />
              <div
                id="hq-player-loading"
                className="absolute bottom-3 right-3 z-20 bg-slate-950/90 backdrop-blur-md border border-slate-700 rounded-xl px-3 py-2 w-64 space-y-1.5 shadow-xl"
              >
                {originalUrl ? (
                  <button
                    id="hq-player-play-full"
                    onClick={() => setFullReady(true)}
                    className="w-full px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-amber-300" />
                    Full quality ready: play it
                  </button>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-[11px] text-slate-300">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <Loader2 className="w-3 h-3 text-emerald-400 animate-spin" />
                        Full quality loading
                      </span>
                      <span className="font-mono text-slate-400">
                        {originalProgress.total
                          ? `${Math.round(originalProgress.loaded / 1048576)} / ${Math.round(originalProgress.total / 1048576)} MB`
                          : '…'}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all"
                        style={{ width: `${originalProgress.total ? Math.round((originalProgress.loaded / originalProgress.total) * 100) : 0}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : playerMode === 'original' && fileId ? (
            <div className="p-8 text-center space-y-3 w-full max-w-md" id="hq-player-loading">
              {originalError ? (
                <>
                  <AlertCircle className="w-10 h-10 text-amber-400 mx-auto" />
                  <h4 className="text-sm font-bold text-white">Full-quality video could not be loaded</h4>
                  <p className="text-xs text-slate-400">{originalError}</p>
                  <div className="flex justify-center gap-2">
                    <button onClick={() => switchMode('original')} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-xs font-bold cursor-pointer">Try again</button>
                    <button onClick={() => switchMode('drive_hd')} className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs font-bold cursor-pointer">Use Drive preview</button>
                  </div>
                </>
              ) : (
                <>
                  <Loader2 className="w-8 h-8 text-emerald-400 mx-auto animate-spin" />
                  <h4 className="text-sm font-bold text-white">Loading the original video at full quality…</h4>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${originalProgress.total ? Math.round((originalProgress.loaded / originalProgress.total) * 100) : 0}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {originalProgress.total
                      ? `${(originalProgress.loaded / 1048576).toFixed(1)} of ${(originalProgress.total / 1048576).toFixed(1)} MB`
                      : 'Connecting to Google Drive…'}
                  </p>
                  <button onClick={() => switchMode('drive_hd')} className="text-[11px] text-slate-400 underline cursor-pointer">
                    Watch the Drive preview instead (lower quality, starts faster)
                  </button>
                </>
              )}
            </div>
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
              {playerMode === 'drive_hd' || previewWhileLoading
                ? 'Drive preview (re-encoded by Google)'
                : `${playerMode === 'local_master' ? 'Station copy' : 'Original file'}${videoSize?.w ? ` · ${videoSize.w}×${videoSize.h}` : ''}`}
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

      </div>

      {/* Playback & Action Toolbar */}
      <div className="bg-slate-900/95 backdrop-blur-md border-t border-slate-800 p-3 sm:p-4 space-y-3 shrink-0 z-20">
        {/* Local Master Video Timeline Scrubber */}
        {isNative && nativeSrc && (
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
          {isNative && nativeSrc ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handlePlayPause}
                className="w-9 h-9 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl flex items-center justify-center shadow-md transition cursor-pointer"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
              </button>

              <button
                id="player-skip-back"
                onClick={() => handleSkip(-SKIP_SECONDS)}
                className="h-9 px-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition cursor-pointer flex items-center gap-0.5 text-[11px] font-bold font-mono"
                title={`Back ${SKIP_SECONDS} seconds (Left arrow)`}
              >
                <ChevronLeft className="w-4 h-4" />
                {SKIP_SECONDS}s
              </button>

              <button
                id="player-skip-forward"
                onClick={() => handleSkip(SKIP_SECONDS)}
                className="h-9 px-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition cursor-pointer flex items-center gap-0.5 text-[11px] font-bold font-mono"
                title={`Forward ${SKIP_SECONDS} seconds (Right arrow)`}
              >
                {SKIP_SECONDS}s
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
                <span>{playerMode === 'drive_hd' ? 'Google Drive preview' : 'Loading full quality…'}</span>
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
            {(fileId || nativeSrc) && (
              <a
                href={isStreaming || !nativeSrc ? directDriveDownloadUrl : nativeSrc}
                target={nativeSrc.startsWith('blob:') ? undefined : '_blank'}
                rel="noreferrer"
                download={fileName}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold rounded-xl border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
                title="Download MP4 video file"
              >
                <Download className="w-4 h-4 text-slate-400" />
                <span className="hidden sm:inline">Download</span>
              </a>
            )}

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
    </div>
  );
};
