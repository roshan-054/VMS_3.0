import { User, AdminPermissions } from '../types';

/**
 * Roles: Super Admin > Admin > User.
 * Each user's permissions come from the backend (Users sheet), starting from their role's
 * defaults below. Only the Super Admin can change them, and the backend enforces them; these
 * helpers decide what the app shows. No account is privileged by its email address.
 */

export const PERMISSION_KEYS: (keyof AdminPermissions)[] = [
  'canAccessRecord', 'canAccessProcessing', 'canAccessQueue', 'canAccessLogs',
  'canAccessSearch', 'canAccessReports', 'canAccessAnalytics', 'canAccessHealth',
  'canDeleteData', 'canManageUsers', 'canManageSettings', 'canManageBranding',
];

export const PERMISSION_GROUPS: { title: string; items: { key: keyof AdminPermissions; label: string; desc: string }[] }[] = [
  {
    title: 'Pages they can see',
    items: [
      { key: 'canAccessRecord', label: 'Scan & Record', desc: 'Record packing and return videos' },
      { key: 'canAccessProcessing', label: 'Order Processing', desc: 'Assign orders and see order products' },
      { key: 'canAccessQueue', label: 'Upload Queue', desc: 'See and retry uploads from this station' },
      { key: 'canAccessLogs', label: 'Upload Logs', desc: 'See uploaded videos and their status' },
      { key: 'canAccessSearch', label: 'Search Videos', desc: 'Search recorded orders' },
      { key: 'canAccessReports', label: 'Reports', desc: 'Generate and download reports' },
      { key: 'canAccessAnalytics', label: 'Analytics', desc: 'See charts and packing statistics' },
      { key: 'canAccessHealth', label: 'Health & Diagnostics', desc: 'See technical diagnostics' },
    ],
  },
  {
    title: 'Actions they can take',
    items: [
      { key: 'canDeleteData', label: 'Delete logs & videos', desc: 'Remove log rows, clean duplicates and move old videos to Drive Trash' },
      { key: 'canManageUsers', label: 'Manage users', desc: 'Add, edit, approve, disable and reset passwords of users' },
      { key: 'canManageSettings', label: 'Manage settings', desc: 'Settings page, Drive folder, backend update and sheet tools' },
      { key: 'canManageBranding', label: 'Manage branding', desc: 'Change the app name, logo and favicon' },
    ],
  },
];

const all = (v: boolean): AdminPermissions =>
  Object.fromEntries(PERMISSION_KEYS.map((k) => [k, v])) as unknown as AdminPermissions;

export const DEFAULT_MASTER_ADMIN_PERMISSIONS: AdminPermissions = all(true);
export const DEFAULT_ADMIN_PERMISSIONS: AdminPermissions = all(true);
export const DEFAULT_USER_PERMISSIONS: AdminPermissions = {
  ...all(false),
  canAccessRecord: true,
  canAccessProcessing: true,
  canAccessQueue: true,
  canAccessLogs: true,
};

const roleKey = (user: User | null | undefined) => String(user?.role || '').toLowerCase().replace(/[\s_-]/g, '');

export function isSuperAdmin(user: User | null | undefined): boolean {
  const r = roleKey(user);
  return r === 'superadmin' || r === 'masteradmin';
}

/** Kept for older callers: the top role is now called Super Admin. */
export const isMasterAdmin = isSuperAdmin;

/** Admin or Super Admin. */
export function isAdmin(user: User | null | undefined): boolean {
  if (!user) return false;
  const r = roleKey(user);
  return isSuperAdmin(user) || r === 'admin' || r === 'administrator';
}

export function isStandardUser(user: User | null | undefined): boolean {
  return !isAdmin(user);
}

export function roleDefaultPermissions(user: User | null | undefined): AdminPermissions {
  return isAdmin(user) ? { ...DEFAULT_ADMIN_PERMISSIONS } : { ...DEFAULT_USER_PERMISSIONS };
}

export function getUserPermissions(user: User | null | undefined): AdminPermissions {
  if (!user) return { ...all(false) };
  if (isSuperAdmin(user)) return all(true);
  const out = roleDefaultPermissions(user);
  const fromBackend = (user.permissions || {}) as Partial<AdminPermissions>;
  for (const k of PERMISSION_KEYS) if (typeof fromBackend[k] === 'boolean') out[k] = fromBackend[k] as boolean;
  return out;
}

const can = (k: keyof AdminPermissions) => (user: User | null | undefined) => !!user && getUserPermissions(user)[k] === true;

export const canUserAccessRecord = can('canAccessRecord');
export const canUserAccessProcessing = can('canAccessProcessing');
export const canUserAccessQueue = can('canAccessQueue');
export const canUserAccessLogs = can('canAccessLogs');
export const canUserDeleteData = can('canDeleteData');
export const canUserManageUsers = can('canManageUsers');
export const canUserManageSettings = can('canManageSettings');
export const canUserManageBranding = can('canManageBranding');
export const canUserAccessSearch = can('canAccessSearch');
export const canUserAccessReports = can('canAccessReports');
export const canUserAccessAnalytics = can('canAccessAnalytics');
export const canUserAccessHealth = can('canAccessHealth');

/** Admin & Users page (Users & Roles). */
export function canUserAccessAdminPanel(user: User | null | undefined): boolean {
  return canUserManageUsers(user);
}

/** Settings page: app, Drive, logo and data tools (the Supabase section is for the Super Admin only). */
export function canUserAccessSettingsPage(user: User | null | undefined): boolean {
  return canUserManageSettings(user) || canUserManageBranding(user);
}

/** Only the Super Admin can change other users' permissions or see Supabase settings. */
export const canUserEditPermissions = isSuperAdmin;
export const canUserSeeSupabaseSettings = isSuperAdmin;
