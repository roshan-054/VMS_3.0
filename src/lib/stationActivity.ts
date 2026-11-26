/**
 * What this station's user is doing right now (page, order on screen, last action). Sent with the
 * station report so admins see each user's work live on the Live Team page. Only short text.
 */
export interface StationActivity {
  page: string;
  orderId: string;
  state: '' | 'scanning' | 'recording' | 'packing';
  lastAction: string;
  lastActionAt: number;
}

const activity: StationActivity = { page: '', orderId: '', state: '', lastAction: '', lastActionAt: 0 };
export const ACTIVITY_EVENT = 'vms_activity_changed';

function changed() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACTIVITY_EVENT));
}

export function getStationActivity(): StationActivity {
  return { ...activity };
}

/** Which page the user has open. */
export function setActivityPage(page: string): void {
  if (activity.page === page) return;
  activity.page = page;
  changed();
}

/** The order currently on screen, and what is happening with it. */
export function setActivityOrder(orderId: string, state: StationActivity['state']): void {
  const o = String(orderId || '').trim().slice(0, 80);
  if (activity.orderId === o && activity.state === state) return;
  activity.orderId = o;
  activity.state = o ? state : '';
  changed();
}

/** Something the user just did, e.g. "Saved video 405-123". */
export function noteAction(text: string): void {
  activity.lastAction = String(text || '').slice(0, 160);
  activity.lastActionAt = Date.now();
  changed();
}
