import React, { useEffect, useState } from 'react';

/**
 * Small self-updating labels. They tick on their own so the large Scan & Record screen does not
 * re-render every second while a video is being recorded.
 */
function useTick(active: boolean, ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

export function formatTimer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const LiveClock: React.FC = () => {
  useTick(true);
  const d = new Date();
  return <>{`${d.toLocaleDateString('en-CA')} ${d.toLocaleTimeString('en-GB', { hour12: false })}`}</>;
};

export const ElapsedTimer: React.FC<{ startedAt: number | null }> = ({ startedAt }) => {
  useTick(startedAt !== null);
  return <>{formatTimer(startedAt ? (Date.now() - startedAt) / 1000 : 0)}</>;
};

export const RecordedSize: React.FC<{ bytesRef: React.MutableRefObject<number>; active: boolean }> = ({ bytesRef, active }) => {
  useTick(active);
  return <>{(bytesRef.current / (1024 * 1024)).toFixed(2)}</>;
};
