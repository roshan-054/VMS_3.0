import { User } from '../types';

/**
 * Local (on-device) auth helpers.
 *
 * There are no built-in accounts or default passwords. The only way to sign in without the
 * backend is with the exact credentials of someone who already signed in successfully online
 * on this device: a salted PBKDF2 hash of their password is cached at that moment.
 * Offline sessions cannot call the backend; once it is reachable again the backend rejects
 * the offline token and the user signs in normally.
 */

// Cached user directory (names, emails, roles) for display when the backend is offline.
// Never contains passwords.
export type StoredLocalUser = User;

const LOCAL_USERS_KEY = 'vms_local_users_v4';
const LEGACY_USER_KEYS = ['vms_local_users_v3'];
const OFFLINE_CREDS_KEY = 'vms_offline_credentials_v1';
const LOCAL_SESSION_PREFIX = 'vms_loc_sess_';
const DELETED_USERS_KEY = 'vms_deleted_user_emails_v3';
const PBKDF2_ITERATIONS = 150000;

interface OfflineCredential {
  user: User;
  salt: string;
  hash: string;
  iterations: number;
  savedAt: string;
}

// Remove the old v3 store, which held plain-text and default passwords.
try {
  LEGACY_USER_KEYS.forEach((k) => localStorage.removeItem(k));
} catch {}

export function isLocalSessionToken(token: string | null | undefined): boolean {
  return String(token || '').startsWith(LOCAL_SESSION_PREFIX);
}

export function getDeletedUserEmails(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_USERS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.map((e) => String(e).toLowerCase().trim()));
    }
  } catch {}
  return new Set<string>();
}

export function recordDeletedUserEmail(email: string): void {
  const clean = String(email || '').toLowerCase().trim();
  if (!clean) return;
  const set = getDeletedUserEmails();
  set.add(clean);
  try {
    localStorage.setItem(DELETED_USERS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export function deleteLocalUserByEmail(email: string): void {
  const clean = String(email || '').toLowerCase().trim();
  if (!clean) return;
  recordDeletedUserEmail(clean);
  saveLocalUsers(getLocalUsers().filter((u) => u.email.toLowerCase().trim() !== clean));
  const creds = readOfflineCredentials().filter((c) => c.user.email.toLowerCase().trim() !== clean);
  writeOfflineCredentials(creds);
}

export function getLocalUsers(): StoredLocalUser[] {
  const deleted = getDeletedUserEmails();
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((u: User) => u && u.email && !deleted.has(u.email.toLowerCase().trim()));
  } catch {
    return [];
  }
}

export function saveLocalUsers(users: User[]): void {
  try {
    const clean = users.map((u) => ({
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      created: u.created,
      permissions: u.permissions,
    }));
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(clean));
  } catch (e) {
    console.warn('Failed to save local users to localStorage:', e);
  }
}

function readOfflineCredentials(): OfflineCredential[] {
  try {
    const raw = localStorage.getItem(OFFLINE_CREDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOfflineCredentials(creds: OfflineCredential[]): void {
  try {
    localStorage.setItem(OFFLINE_CREDS_KEY, JSON.stringify(creds));
  } catch {}
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function pbkdf2(password: string, saltHex: string, iterations: number): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Secure offline sign-in is not available in this browser.');
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
    key,
    256
  );
  return toHex(bits);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Called after a successful online sign-in so the same person can sign in offline later. */
export async function rememberOfflineCredential(user: User, password: string): Promise<void> {
  if (!user || !user.email || !password) return;
  try {
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
    const email = user.email.toLowerCase().trim();
    const creds = readOfflineCredentials().filter((c) => c.user.email.toLowerCase().trim() !== email);
    creds.push({
      user: { name: user.name, email: user.email, role: user.role, status: user.status || 'Approved' },
      salt,
      hash,
      iterations: PBKDF2_ITERATIONS,
      savedAt: new Date().toISOString(),
    });
    writeOfflineCredentials(creds);
  } catch (e) {
    console.warn('Could not cache offline credential:', e);
  }
}

export function forgetOfflineCredential(email: string): void {
  const clean = String(email || '').toLowerCase().trim();
  writeOfflineCredentials(readOfflineCredentials().filter((c) => c.user.email.toLowerCase().trim() !== clean));
}

export async function localLogin(
  rawIdentifier: string,
  rawPassword: string
): Promise<{ success: boolean; token: string; user: User; offline: true; message: string }> {
  const id = String(rawIdentifier || '').trim().toLowerCase();
  const password = String(rawPassword || '');
  if (!id || !password) {
    throw new Error('User ID / Email and password are required.');
  }

  const deleted = getDeletedUserEmails();
  const cred = readOfflineCredentials().find((c) => {
    const email = (c.user.email || '').toLowerCase().trim();
    return !deleted.has(email) && (email === id || email.split('@')[0] === id);
  });

  const offlineMsg =
    'The server cannot be reached. Offline sign-in only works for accounts that have signed in online on this device before.';
  if (!cred) throw new Error(offlineMsg);

  const hash = await pbkdf2(password, cred.salt, cred.iterations || PBKDF2_ITERATIONS);
  if (!constantTimeEqual(hash, cred.hash)) {
    throw new Error('Incorrect password. Please verify your password and Caps Lock.');
  }

  const token = `${LOCAL_SESSION_PREFIX}${Date.now()}_${toHex(crypto.getRandomValues(new Uint8Array(8)))}`;
  return {
    success: true,
    token,
    user: { ...cred.user },
    offline: true,
    message: 'Signed in offline. Uploads and admin actions resume after you sign in online.',
  };
}

export function syncLocalUserWithRemote(remoteUser: User): void {
  if (!remoteUser || !remoteUser.email) return;
  const users = getLocalUsers();
  const index = users.findIndex((u) => u.email.toLowerCase() === remoteUser.email.toLowerCase());
  if (index >= 0) {
    users[index] = { ...users[index], ...remoteUser };
  } else {
    users.push(remoteUser as StoredLocalUser);
  }
  saveLocalUsers(users);
}

export function syncAllLocalUsers(remoteUsers: User[]): void {
  if (!Array.isArray(remoteUsers) || remoteUsers.length === 0) return;
  // The backend list is authoritative: replace the cache rather than merging.
  saveLocalUsers(remoteUsers.filter((u) => u && u.email));
}
