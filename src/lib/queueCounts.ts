import type { QueueItem } from '../types';

/**
 * The station's own counts, worked out exactly like the Upload Queue page does, from the whole
 * queue (not only the listed items), so the admin view shows the same numbers as the packer.
 */
export interface StationQueueCounts {
  waiting: number; // status pending
  uploading: number; // status uploading
  failed: number; // failed or paused
  duplicate: number; // blocked as duplicate order IDs (also counted in their status)
  completed: number;
  total: number;
}

export function queueCounts(items: QueueItem[]): StationQueueCounts {
  const c: StationQueueCounts = { waiting: 0, uploading: 0, failed: 0, duplicate: 0, completed: 0, total: items.length };
  for (const i of items) {
    if (i.status === 'pending') c.waiting++;
    else if (i.status === 'uploading') c.uploading++;
    else if (i.status === 'failed' || i.status === 'paused') c.failed++;
    else if (i.status === 'completed') c.completed++;
    if (i.isDuplicate || (i.status === 'failed' && (i.error?.toLowerCase().includes('duplicate') || i.stage?.toLowerCase().includes('duplicate')))) c.duplicate++;
  }
  return c;
}

