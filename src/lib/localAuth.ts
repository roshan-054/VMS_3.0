import { User, UserRole, UserStatus } from '../types';

export interface StoredLocalUser extends User {
  passwordHash: string;
}

const LOCAL_USERS_KEY = 'vms_local_users_v3';
const LOCAL_SESSION_PREFIX = 'vms_loc_sess_';

export async function hashPassword(str: string): Promise<string> {
  const clean = String(str || '').trim();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(clean);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // fallback
    }
  }
  // Simple fallback hash
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  return 'h_' + Math.abs(hash);
}

export function getDefaultLocalUsers(): StoredLocalUser[] {
  return [
    {
      name: 'Master Admin',
      email: 'askroshan.2002@gmail.com',
      role: 'Master Admin',
      status: 'Approved',
      created: new Date().toISOString(),
      passwordHash: 'Admin@123', // Matches plain or hashed
    },
    {
      name: 'Workstation Admin',
      email: 'admin@ops.local',
      role: 'Admin',
      status: 'Approved',
      created: new Date().toISOString(),
      passwordHash: 'Admin@123',
    },
  ];
}

export function getLocalUsers(): StoredLocalUser[] {
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    if (!raw) {
      const defaults = getDefaultLocalUsers();
      localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(defaults));
      return defaults;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    const defaults = getDefaultLocalUsers();
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(defaults));
    return defaults;
  } catch {
    return getDefaultLocalUsers();
  }
}

export function saveLocalUsers(users: StoredLocalUser[]): void {
  try {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  } catch (e) {
    console.warn('Failed to save local users to localStorage:', e);
  }
}

export async function localLogin(
  rawIdentifier: string,
  rawPassword: string
): Promise<{ success: boolean; token: string; user: User; message?: string }> {
  const id = String(rawIdentifier || '').trim().toLowerCase();
  const password = String(rawPassword || '').trim();

  if (!id || !password) {
    throw new Error('User ID / Email and password are required.');
  }

  const users = getLocalUsers();
  const passwordHash = await hashPassword(password);

  // Match by exact email, prefix before @, or name
  const user = users.find((u) => {
    const uEmail = (u.email || '').toLowerCase().trim();
    const uPrefix = uEmail.split('@')[0];
    const uName = (u.name || '').toLowerCase().trim();
    return uEmail === id || uPrefix === id || uName === id;
  });

  if (!user) {
    // If master admin or admin identifier is used for the very first time with default password
    if (id === 'admin' || id === 'admin@ops.local' || id === 'askroshan.2002@gmail.com') {
      if (password === 'Admin@123') {
        const adminUser: User = {
          name: id === 'askroshan.2002@gmail.com' ? 'Master Admin' : 'Workstation Admin',
          email: id.includes('@') ? id : `${id}@ops.local`,
          role: id === 'askroshan.2002@gmail.com' ? 'Master Admin' : 'Admin',
          status: 'Approved',
          created: new Date().toISOString(),
        };
        const token = `${LOCAL_SESSION_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
        return { success: true, token, user: adminUser };
      }
    }
    throw new Error(`Account not found for "${rawIdentifier}". Click "Create Account" below to register this ID.`);
  }

  // Check password match (plain text or SHA-256)
  const isMatch =
    user.passwordHash === password ||
    user.passwordHash === passwordHash ||
    user.passwordHash.toLowerCase() === passwordHash.toLowerCase();

  if (!isMatch) {
    throw new Error('Incorrect password. Please verify your password and Caps Lock.');
  }

  if (user.status === 'Disabled' || user.status === 'Rejected') {
    throw new Error('Your account has been disabled. Please contact the administrator.');
  }

  if (user.status === 'Pending') {
    throw new Error('Your account is pending administrator approval.');
  }

  const token = `${LOCAL_SESSION_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const cleanUser: User = {
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    created: user.created,
  };

  return { success: true, token, user: cleanUser };
}

export async function localSignup(
  fullName: string,
  email: string,
  password: string
): Promise<{ success: boolean; token: string; user: User; message: string }> {
  const cleanName = String(fullName || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPass = String(password || '').trim();

  if (!cleanName || !cleanEmail || !cleanPass) {
    throw new Error('All fields (Full Name, User ID/Email, and Password) are required.');
  }

  if (cleanPass.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const users = getLocalUsers();
  const existing = users.find((u) => u.email.toLowerCase() === cleanEmail);

  if (existing) {
    throw new Error('An account with this User ID / Email already exists. Please sign in instead.');
  }

  const passwordHash = await hashPassword(cleanPass);
  const isMaster = cleanEmail === 'askroshan.2002@gmail.com';
  const isFirstAdmin = users.length <= 2;
  const role: UserRole = isMaster ? 'Master Admin' : isFirstAdmin ? 'Admin' : 'User';

  const newUser: StoredLocalUser = {
    name: cleanName,
    email: cleanEmail,
    role,
    status: 'Approved',
    created: new Date().toISOString(),
    passwordHash,
  };

  users.push(newUser);
  saveLocalUsers(users);

  const token = `${LOCAL_SESSION_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const cleanUser: User = {
    name: newUser.name,
    email: newUser.email,
    role: newUser.role,
    status: newUser.status,
    created: newUser.created,
  };

  return {
    success: true,
    token,
    user: cleanUser,
    message: `Account created successfully! Signed in as ${cleanName}.`,
  };
}

export function syncLocalUserWithRemote(remoteUser: User): void {
  if (!remoteUser || !remoteUser.email) return;
  const users = getLocalUsers();
  const index = users.findIndex((u) => u.email.toLowerCase() === remoteUser.email.toLowerCase());
  if (index >= 0) {
    users[index] = {
      ...users[index],
      name: remoteUser.name || users[index].name,
      role: remoteUser.role || users[index].role,
      status: remoteUser.status || users[index].status,
    };
  } else {
    users.push({
      ...remoteUser,
      passwordHash: 'synced_remote',
    });
  }
  saveLocalUsers(users);
}

export function syncAllLocalUsers(remoteUsers: User[]): void {
  if (!Array.isArray(remoteUsers) || remoteUsers.length === 0) return;
  const localUsers = getLocalUsers();
  const localMap = new Map<string, StoredLocalUser>();
  localUsers.forEach((u) => localMap.set(u.email.toLowerCase(), u));

  remoteUsers.forEach((ru) => {
    const key = (ru.email || '').toLowerCase();
    if (!key) return;
    const existing = localMap.get(key);
    localMap.set(key, {
      name: ru.name || existing?.name || 'Operator',
      email: ru.email,
      role: ru.role || existing?.role || 'User',
      status: ru.status || existing?.status || 'Approved',
      created: ru.created || existing?.created || new Date().toISOString(),
      passwordHash: existing?.passwordHash || 'synced_remote',
      permissions: ru.permissions || existing?.permissions,
    });
  });

  saveLocalUsers(Array.from(localMap.values()));
}
