import { User, UserRole, AdminPermissions } from '../types';

export const DEFAULT_MASTER_ADMIN_PERMISSIONS: AdminPermissions = {
  canDeleteData: true,
  canManageUsers: true,
  canManageSettings: true,
  canManageBranding: true,
  canAccessSearch: true,
  canAccessReports: true,
  canAccessAnalytics: true,
  canAccessHealth: true,
};

export const DEFAULT_ADMIN_PERMISSIONS: AdminPermissions = {
  canDeleteData: false,      // By default, non-master admins cannot delete data unless granted
  canManageUsers: false,     // By default, cannot create/manage other users unless granted
  canManageSettings: false,  // By default, cannot change backend/drive settings unless granted
  canManageBranding: false,  // By default, cannot change branding unless granted
  canAccessSearch: true,     // By default, allowed to search recorded orders
  canAccessReports: true,    // By default, allowed to generate reports
  canAccessAnalytics: true,  // By default, allowed to view analytics
  canAccessHealth: true,     // By default, allowed to view health
};

export const DEFAULT_USER_PERMISSIONS: AdminPermissions = {
  canDeleteData: false,
  canManageUsers: false,
  canManageSettings: false,
  canManageBranding: false,
  canAccessSearch: false,
  canAccessReports: false,
  canAccessAnalytics: false,
  canAccessHealth: false,
};

const PERMISSIONS_STORAGE_KEY = 'vms_admin_permissions_map_v1';

export function getStoredPermissionsMap(): Record<string, AdminPermissions> {
  try {
    const raw = localStorage.getItem(PERMISSIONS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

export function saveUserPermissionsLocally(email: string, permissions: AdminPermissions): void {
  try {
    const map = getStoredPermissionsMap();
    map[email.trim().toLowerCase()] = permissions;
    localStorage.setItem(PERMISSIONS_STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent('ops_permissions_updated', { detail: { email, permissions } }));
  } catch (e) {}
}

export function isMasterAdmin(user: User | null | undefined): boolean {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase().replace(/[\s_-]/g, '');
  const email = String(user.email || '').toLowerCase().trim();
  return (
    role === 'masteradmin' ||
    role === 'superadmin' ||
    email === 'admin@ops.local' ||
    email === 'master@vms.local' ||
    email === 'askroshan.2002@gmail.com'
  );
}

export function isAdmin(user: User | null | undefined): boolean {
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  const role = String(user.role || '').toLowerCase();
  return role === 'admin';
}

export function isStandardUser(user: User | null | undefined): boolean {
  if (!user) return true;
  return !isAdmin(user) && !isMasterAdmin(user);
}

export function getUserPermissions(user: User | null | undefined): AdminPermissions {
  if (!user) return DEFAULT_USER_PERMISSIONS;
  if (isMasterAdmin(user)) return DEFAULT_MASTER_ADMIN_PERMISSIONS;
  if (user.role === 'User') return DEFAULT_USER_PERMISSIONS;

  // Check locally saved permissions map as well
  const localMap = getStoredPermissionsMap();
  const localPerms = localMap[String(user.email || '').toLowerCase().trim()];

  return {
    ...DEFAULT_ADMIN_PERMISSIONS,
    ...(user.permissions || {}),
    ...(localPerms || {}),
  };
}

export function canUserDeleteData(user: User | null | undefined): boolean {
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  if (user.role === 'User') return false;
  return getUserPermissions(user).canDeleteData === true;
}

export function canUserManageUsers(user: User | null | undefined): boolean {
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  if (user.role === 'User') return false;
  return isAdmin(user) || getUserPermissions(user).canManageUsers === true;
}

export function canUserManageSettings(user: User | null | undefined): boolean {
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  if (user.role === 'User') return false;
  return isAdmin(user) || getUserPermissions(user).canManageSettings === true;
}

export function canUserManageBranding(user: User | null | undefined): boolean {
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  if (user.role === 'User') return false;
  return isAdmin(user) || getUserPermissions(user).canManageBranding === true;
}

export function canUserAccessSearch(user: User | null | undefined): boolean {
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  if (user.role === 'User') return false;
  return getUserPermissions(user).canAccessSearch === true;
}

export function canUserAccessReports(user: User | null | undefined): boolean {
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  if (user.role === 'User') return false;
  return getUserPermissions(user).canAccessReports === true;
}

export function canUserAccessAnalytics(user: User | null | undefined): boolean {
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  if (user.role === 'User') return false;
  return getUserPermissions(user).canAccessAnalytics === true;
}

export function canUserAccessHealth(user: User | null | undefined): boolean {
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  if (user.role === 'User') return false;
  return getUserPermissions(user).canAccessHealth === true;
}

export function canUserAccessAdminPanel(user: User | null | undefined): boolean {
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  if (user.role === 'User') return false;
  return true; // All Admins can see the panel
}
