import type React from 'react';

/**
 * Close a popup when the dark area around it is clicked.
 * Spread on the full-screen backdrop element: {...closeOnBackdrop(close)}.
 * Only a click that both starts and ends on the backdrop itself counts, so selecting text
 * inside the popup and releasing the mouse outside it does not close it.
 * Pass busy = true while the popup is saving or running, to keep it open.
 */
export function closeOnBackdrop(close: () => void, busy = false) {
  return {
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? '1' : '';
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      const started = e.currentTarget.dataset.backdropDown === '1';
      e.currentTarget.dataset.backdropDown = '';
      if (!busy && started && e.target === e.currentTarget) close();
    },
    'data-backdrop-close': 'true',
  };
}
