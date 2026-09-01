import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  KeyRound,
  CheckCircle,
  XCircle,
  Trash2,
  RefreshCw,
  Search,
  UserCheck,
  Palette,
  Upload,
  Image as ImageIcon,
  Globe,
  RotateCcw,
  Sparkles,
  Check,
  Eye,
  HardDrive,
  FolderSync,
  Sliders,
  Zap,
  AlertCircle,
  Link2,
  ExternalLink,
  Save,
  Server,
  EyeOff,
  Lock,
  Edit3,
  UserCog
} from 'lucide-react';
import { User, UserRole, UserStatus, AdminPermissions } from '../types';
import { requestApi, checkBackendHealth, uploadBrandingImage, repairSheetPlaybackUrls, runSystemSetup } from '../lib/api';
import {
  isMasterAdmin,
  getUserPermissions,
  saveUserPermissionsLocally,
  canUserManageUsers,
  canUserManageSettings,
  canUserManageBranding
} from '../lib/permissions';
import {
  getStoredBranding,
  setStoredBranding,
  resetStoredBranding,
  BrandingConfig,
  DEFAULT_BRANDING
} from '../lib/branding';
import {
  getStoredApiUrl,
  setStoredApiUrl,
  getStoredDriveFolderId,
  setStoredDriveFolderId,
  getStoredChunkSizeMb,
  setStoredChunkSizeMb,
  getStoredAutoUpload,
  setStoredAutoUpload,
  getStoredAutoResume,
  setStoredAutoResume,
  getStoredDuplicatePolicy,
  setStoredDuplicatePolicy,
  DuplicatePolicy,
  clearAllApplicationCacheAndStorage
} from '../lib/storage';

interface AdminPanelProps {
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  currentUser: { name: string; email: string; role: string } | null;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ onShowToast, currentUser }) => {
  const disableSettings = !canUserManageSettings(currentUser as User);
  const disableBranding = !canUserManageBranding(currentUser as User);
  const disableUsers = !canUserManageUsers(currentUser as User);

  const [adminTab, setAdminTab] = useState<'users' | 'branding' | 'settings'>(
    disableUsers ? (disableBranding ? 'settings' : 'branding') : 'users'
  );
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // New User Form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newRole, setNewRole] = useState<UserRole>('User');
  const [newStatus, setNewStatus] = useState<UserStatus>('Approved');

  // Reset Password Modal State
  const [resetModalUser, setResetModalUser] = useState<User | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [showResetPasswordValue, setShowResetPasswordValue] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  // Edit User Modal State
  const [editModalUser, setEditModalUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('User');
  const [editStatus, setEditStatus] = useState<UserStatus>('Approved');
  const [editPassword, setEditPassword] = useState('');
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [savingEditUser, setSavingEditUser] = useState(false);

  // Delete User Confirmation State
  const [deleteModalUser, setDeleteModalUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  // Permissions Modal State
  const [permissionsModalUser, setPermissionsModalUser] = useState<User | null>(null);
  const [permissionsModalValues, setPermissionsModalValues] = useState<any>({});
  const [savingPermissions, setSavingPermissions] = useState(false);

  // Branding Form State
  const [branding, setBranding] = useState<BrandingConfig>(getStoredBranding());
  const [logoInputType, setLogoInputType] = useState<'upload' | 'url'>('upload');
  const [faviconInputType, setFaviconInputType] = useState<'upload' | 'url'>('upload');
  const [logoUrlInput, setLogoUrlInput] = useState('');
  const [faviconUrlInput, setFaviconUrlInput] = useState('');
  const [appNameInput, setAppNameInput] = useState(branding.appName);
  const [appSubtitleInput, setAppSubtitleInput] = useState(branding.appSubtitle);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);

  // Settings & Drive Integration State
  const [apiUrlInput, setApiUrlInput] = useState(getStoredApiUrl());
  const [driveFolderIdInput, setDriveFolderIdInput] = useState(getStoredDriveFolderId());
  const [chunkSizeMbInput, setChunkSizeMbInput] = useState<number>(getStoredChunkSizeMb());
  const [autoUploadInput, setAutoUploadInput] = useState<boolean>(getStoredAutoUpload());
  const [autoResumeInput, setAutoResumeInput] = useState<boolean>(getStoredAutoResume());
  const [duplicatePolicyInput, setDuplicatePolicyInput] = useState<DuplicatePolicy>(getStoredDuplicatePolicy());
  const [clearingCache, setClearingCache] = useState(false);
  const [testingHealth, setTestingHealth] = useState(false);
  const [repairingUrls, setRepairingUrls] = useState(false);
  const [runningSetup, setRunningSetup] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{
    tested: boolean;
    online: boolean;
    version?: string;
    error?: string;
  } | null>(null);

  const logoFileInputRef = useRef<HTMLInputElement | null>(null);
  const faviconFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const current = getStoredBranding();
    setBranding(current);
    setLogoUrlInput(current.logoUrl);
    setFaviconUrlInput(current.faviconUrl);
    setAppNameInput(current.appName);
    setAppSubtitleInput(current.appSubtitle);

    setApiUrlInput(getStoredApiUrl());
    setDriveFolderIdInput(getStoredDriveFolderId());
    setChunkSizeMbInput(getStoredChunkSizeMb());
    setAutoUploadInput(getStoredAutoUpload());
    setAutoResumeInput(getStoredAutoResume());
    setDuplicatePolicyInput(getStoredDuplicatePolicy());
  }, []);

  const handleClearAllCache = async () => {
    if (!window.confirm('Are you sure you want to clear all local application cache, IndexedDB queue, and stored session settings? This will reset local storage to defaults.')) {
      return;
    }
    try {
      setClearingCache(true);
      await clearAllApplicationCacheAndStorage();
      onShowToast('All local cache and storage cleared successfully. Reloading…', 'success');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err) {
      onShowToast('Failed to clear cache', 'error');
    } finally {
      setClearingCache(false);
    }
  };

  const handleTestBackendConnection = async () => {
    if (!apiUrlInput.trim().startsWith('https://script.google.com/macros/s/')) {
      onShowToast('Please enter a valid Google Apps Script /exec URL', 'error');
      setHealthStatus({
        tested: true,
        online: false,
        error: 'URL must start with https://script.google.com/macros/s/',
      });
      return;
    }

    setTestingHealth(true);
    setHealthStatus(null);

    const res = await checkBackendHealth(apiUrlInput.trim());
    setTestingHealth(false);
    setHealthStatus({
      tested: true,
      online: res.online,
      version: res.version,
      error: res.error,
    });

    if (res.online) {
      onShowToast(`Backend Connected! Version: ${res.version || '2.9'}`, 'success');
    } else {
      onShowToast(`Connection test failed: ${res.error || 'Check Web App permissions'}`, 'error');
    }
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setStoredApiUrl(apiUrlInput.trim());
    setStoredDriveFolderId(driveFolderIdInput.trim());
    setStoredChunkSizeMb(chunkSizeMbInput);
    setStoredAutoUpload(autoUploadInput);
    setStoredAutoResume(autoResumeInput);
    setStoredDuplicatePolicy(duplicatePolicyInput);

    onShowToast(
      `Drive & System configuration saved! Duplicate policy: ${
        duplicatePolicyInput === 'strict_block' ? 'Strict Block' : duplicatePolicyInput === 'admin_override' ? 'Admin Override' : 'Warning Only'
      }.`,
      'success'
    );
  };

  const handleRepairPlaybackUrls = async () => {
    setRepairingUrls(true);
    try {
      const res = await repairSheetPlaybackUrls();
      if (res.success) {
        onShowToast(res.message || 'Playback URLs repaired in Google Sheet! Column F links are now clickable.', 'success');
      } else {
        onShowToast(res.error || 'Failed to repair URLs', 'error');
      }
    } catch (err: any) {
      onShowToast(err?.message || 'Repair request failed', 'error');
    } finally {
      setRepairingUrls(false);
    }
  };

  const handleRunGoogleSheetSetup = async () => {
    setRunningSetup(true);
    try {
      const res = await runSystemSetup();
      if (res.success) {
        onShowToast(res.message || 'Google Sheet setup completed & ReturnLog tab synchronized!', 'success');
      } else {
        onShowToast(res.error || 'Setup failed', 'error');
      }
    } catch (err: any) {
      onShowToast(err?.message || 'Setup request failed', 'error');
    } finally {
      setRunningSetup(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await requestApi<{ users: User[] }>('getUsers', {});
      setUsers(res.users || []);
    } catch (err: any) {
      console.warn('Failed to load users:', err);
      // Fallback mock admin for preview if Google Sheet is freshly initializing
      if (users.length === 0) {
        setUsers([
          {
            name: currentUser?.name || 'Administrator',
            email: currentUser?.email || 'admin@vms.local',
            role: 'Admin',
            status: 'Approved',
            created: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await requestApi('adminCreateUser', {
        name: newName,
        email: newEmail,
        password: newPassword,
        role: newRole,
        status: newStatus,
      });
      onShowToast('User created successfully!', 'success');
      setIsCreateOpen(false);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      fetchUsers();
    } catch (err: any) {
      onShowToast(err.message || 'Create user failed', 'error');
    }
  };

  const handleToggleStatus = async (u: User) => {
    const nextStatus = u.status === 'Approved' ? 'Disabled' : 'Approved';
    try {
      await requestApi('adminManageUser', {
        row: u.row,
        name: u.name,
        role: u.role,
        status: nextStatus,
        expectedEmail: u.email,
      });
      onShowToast(`User status updated to ${nextStatus}`, 'success');
      fetchUsers();
    } catch (err: any) {
      onShowToast(err.message || 'Update failed', 'error');
    }
  };

  const handleResetPassword = (u: User) => {
    setResetModalUser(u);
    setResetPasswordValue('');
    setShowResetPasswordValue(false);
  };

  const handleOpenEditUser = (u: User) => {
    setEditModalUser(u);
    setEditName(u.name || '');
    setEditEmail(u.email || '');
    setEditRole(u.role || 'User');
    setEditStatus(u.status || 'Approved');
    setEditPassword('');
    setShowEditPassword(false);
  };

  const handleConfirmEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalUser) return;
    if (!editName.trim()) {
      onShowToast('Name cannot be empty.', 'error');
      return;
    }

    setSavingEditUser(true);
    try {
      await requestApi('adminManageUser', {
        row: editModalUser.row,
        name: editName.trim(),
        role: editRole,
        status: editStatus,
        expectedEmail: editModalUser.email,
      });

      if (editPassword.trim()) {
        if (editPassword.trim().length < 6) {
          onShowToast('Password must be at least 6 characters.', 'error');
          setSavingEditUser(false);
          return;
        }
        await requestApi('adminResetPassword', {
          row: editModalUser.row,
          password: editPassword.trim(),
        });
      }

      onShowToast(`User "${editName}" updated successfully!`, 'success');
      setEditModalUser(null);
      fetchUsers();
    } catch (err: any) {
      onShowToast(err.message || 'Failed to update user', 'error');
    } finally {
      setSavingEditUser(false);
    }
  };

  const handleOpenDeleteUser = (u: User) => {
    if (u.email.toLowerCase().trim() === currentUser?.email?.toLowerCase().trim()) {
      onShowToast('You cannot delete your own active administrator account.', 'error');
      return;
    }
    setDeleteModalUser(u);
  };

  const handleConfirmDeleteUser = async () => {
    if (!deleteModalUser) return;
    setDeletingUser(true);
    try {
      await requestApi('adminDeleteUser', {
        row: deleteModalUser.row,
      });
      onShowToast(`User account for ${deleteModalUser.email} was removed.`, 'success');
      setDeleteModalUser(null);
      fetchUsers();
    } catch (err: any) {
      onShowToast(err.message || 'Failed to delete user', 'error');
    } finally {
      setDeletingUser(false);
    }
  };

  const handleConfirmResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalUser) return;
    if (resetPasswordValue.length < 6) {
      onShowToast('Password must be at least 6 characters.', 'error');
      return;
    }

    setResettingPassword(true);
    try {
      await requestApi('adminResetPassword', {
        row: resetModalUser.row,
        password: resetPasswordValue,
      });
      onShowToast(`Password for ${resetModalUser.email} reset successfully!`, 'success');
      setResetModalUser(null);
      setResetPasswordValue('');
    } catch (err: any) {
      onShowToast(err.message || 'Password reset failed', 'error');
    } finally {
      setResettingPassword(false);
    }
  };

  const handleEditPermissions = (u: User) => {
    setPermissionsModalUser(u);
    setPermissionsModalValues(getUserPermissions(u));
  };

  const handleSavePermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permissionsModalUser) return;

    setSavingPermissions(true);
    try {
      await requestApi('adminManageUser', {
        row: permissionsModalUser.row,
        name: permissionsModalUser.name,
        role: permissionsModalUser.role,
        status: permissionsModalUser.status,
        expectedEmail: permissionsModalUser.email,
        permissions: permissionsModalValues
      });
      // Also save locally just in case
      saveUserPermissionsLocally(permissionsModalUser.email, permissionsModalValues);
      
      onShowToast(`Permissions updated for ${permissionsModalUser.email}`, 'success');
      setPermissionsModalUser(null);
      fetchUsers();
    } catch (err: any) {
      // If backend fails or doesn't support it, fallback to local storage
      console.warn('Backend permission save failed, saving locally:', err);
      saveUserPermissionsLocally(permissionsModalUser.email, permissionsModalValues);
      onShowToast(`Saved permissions locally (Backend update failed)`, 'info');
      setPermissionsModalUser(null);
      fetchUsers();
    } finally {
      setSavingPermissions(false);
    }
  };

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      onShowToast('Please upload a valid image file (PNG, JPG, SVG, WebP)', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      onShowToast('Image size should be less than 5MB', 'error');
      return;
    }

    setIsUploadingLogo(true);
    onShowToast('Uploading logo to Google Drive "VMS_Branding" folder & saving to Google Sheet...', 'info');

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      try {
        const res = await uploadBrandingImage({
          type: 'logo',
          fileName: file.name,
          mimeType: file.type,
          base64: base64,
        });

        if (res.success && res.url) {
          setLogoUrlInput(res.url);
          const updated = setStoredBranding({
            logoUrl: res.url,
            faviconUrl: faviconUrlInput.trim(),
            appName: appNameInput.trim() || 'VMS 3.0',
            appSubtitle: appSubtitleInput.trim() || 'Order Packing System',
          });
          setBranding(updated);
          onShowToast('Logo stored in Google Drive "VMS_Branding" folder and saved permanently in Google Sheet!', 'success');
        } else {
          setLogoUrlInput(base64);
          onShowToast('Logo loaded locally. Click "Save Branding Changes" to persist.', 'info');
        }
      } catch (err: any) {
        setLogoUrlInput(base64);
        onShowToast(`Logo loaded locally: ${err?.message || 'Drive upload offline, saved locally.'}`, 'info');
      } finally {
        setIsUploadingLogo(false);
      }
    };
    reader.onerror = () => {
      setIsUploadingLogo(false);
      onShowToast('Failed to read image file', 'error');
    };
    reader.readAsDataURL(file);
  };

  const handleFaviconFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/') && !file.name.endsWith('.ico')) {
      onShowToast('Please upload a valid icon file (ICO, PNG, SVG, JPG)', 'error');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      onShowToast('Favicon file should be less than 2MB', 'error');
      return;
    }

    setIsUploadingFavicon(true);
    onShowToast('Uploading favicon to Google Drive "VMS_Branding" folder & saving to Google Sheet...', 'info');

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      try {
        const res = await uploadBrandingImage({
          type: 'favicon',
          fileName: file.name,
          mimeType: file.type || 'image/x-icon',
          base64: base64,
        });

        if (res.success && res.url) {
          setFaviconUrlInput(res.url);
          const updated = setStoredBranding({
            logoUrl: logoUrlInput.trim(),
            faviconUrl: res.url,
            appName: appNameInput.trim() || 'VMS 3.0',
            appSubtitle: appSubtitleInput.trim() || 'Order Packing System',
          });
          setBranding(updated);
          onShowToast('Favicon stored in Google Drive "VMS_Branding" folder and saved permanently in Google Sheet!', 'success');
        } else {
          setFaviconUrlInput(base64);
          onShowToast('Favicon loaded locally. Click "Save Branding Changes" to apply.', 'info');
        }
      } catch (err: any) {
        setFaviconUrlInput(base64);
        onShowToast(`Favicon loaded locally: ${err?.message || 'Drive upload offline, saved locally.'}`, 'info');
      } finally {
        setIsUploadingFavicon(false);
      }
    };
    reader.onerror = () => {
      setIsUploadingFavicon(false);
      onShowToast('Failed to read favicon file', 'error');
    };
    reader.readAsDataURL(file);
  };

  const handleSaveBranding = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = setStoredBranding({
      logoUrl: logoUrlInput.trim(),
      faviconUrl: faviconUrlInput.trim(),
      appName: appNameInput.trim() || 'VMS 3.0',
      appSubtitle: appSubtitleInput.trim() || 'Order Packing System',
    });
    setBranding(updated);
    onShowToast('Branding & Favicon saved permanently! Synced with Google Sheet and applied across the app.', 'success');
  };

  const handleResetToDefaultBranding = () => {
    if (confirm('Are you sure you want to reset the Logo, Favicon, and App Name to defaults?')) {
      const def = resetStoredBranding();
      setBranding(def);
      setLogoUrlInput(def.logoUrl);
      setFaviconUrlInput(def.faviconUrl);
      setAppNameInput(def.appName);
      setAppSubtitleInput(def.appSubtitle);
      onShowToast('Branding reset to system default.', 'info');
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div id="admin-panel-container" className="space-y-6">
      {/* Top Admin Navigation Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              Administrator Control Center
            </h2>
            <span className="bg-purple-100 text-purple-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-purple-200">
              Admin Exclusive
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Manage workstation operator credentials, permissions, system branding, logo, and browser favicon.
          </p>
        </div>

        {/* Sub-tab Navigation Switcher */}
        <div className="flex flex-wrap items-center bg-slate-200/80 p-1 rounded-xl gap-1">
          <button
            id="admin-tab-users-btn"
            onClick={() => setAdminTab('users')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
              adminTab === 'users'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Users & Roles ({users.length})
          </button>
          <button
            id="admin-tab-branding-btn"
            onClick={() => setAdminTab('branding')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
              adminTab === 'branding'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Palette className="w-3.5 h-3.5 text-blue-600" />
            Logo & Favicon
          </button>
          <button
            id="admin-tab-settings-btn"
            onClick={() => setAdminTab('settings')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
              adminTab === 'settings'
                ? 'bg-white text-purple-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5 text-purple-600" />
            Apps Script & Drive Settings
          </button>
        </div>
      </div>

      {/* SETTINGS & DRIVE INTEGRATION TAB */}
      {adminTab === 'settings' && (
        <div className="space-y-6">
          {/* Header Notice */}
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-2xl p-5 flex items-start gap-3.5 shadow-xs">
            <div className="w-9 h-9 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0">
              <HardDrive className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                Google Apps Script & Google Drive Settings
                <span className="bg-purple-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">
                  STORAGE & SYNC
                </span>
              </h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Configure your Google Apps Script Web App webhook, target Google Drive folder destination, and high-speed chunked upload limits.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveSettings} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 7 Columns: Form Controls */}
            <div className="lg:col-span-7 space-y-5">
              {/* 1. Apps Script Web App URL */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs">
                      1
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">Apps Script Web App Exec URL</h4>
                      <p className="text-[11px] text-slate-500">The backend webhook that manages uploads, logs, and authentication</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleTestBackendConnection}
                    disabled={testingHealth}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingHealth ? 'animate-spin' : ''}`} />
                    {testingHealth ? 'Testing…' : 'Test Connection'}
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Web App URL (/exec)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const defaultUrl = 'https://script.google.com/macros/s/AKfycbwZFm2t3o2vLFC7blM1AOzmgDMxB0UiZ_scWkLYasPGn7iB9XPoCCIi3mggjObpaMP_/exec';
                        setApiUrlInput(defaultUrl);
                        setStoredApiUrl(defaultUrl);
                        onShowToast('Reset API URL to clean /exec endpoint', 'success');
                      }}
                      className="text-[11px] text-blue-600 hover:underline font-medium cursor-pointer"
                    >
                      Reset to Default /exec URL
                    </button>
                  </div>
                  <input
                    type="url"
                    required
                    disabled={disableSettings}
                    value={apiUrlInput}
                    onChange={(e) => setApiUrlInput(e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Must be deployed with <i>Execute as: Me</i> and <i>Who has access: Anyone</i>.
                  </p>
                </div>

                {healthStatus && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                      healthStatus.online
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-red-50 text-red-800 border-red-200'
                    }`}
                  >
                    {healthStatus.online ? (
                      <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    )}
                    <span>
                      {healthStatus.online
                        ? `Backend connected successfully! (Script Version: ${healthStatus.version || '2.9'})`
                        : `Connection Failed: ${healthStatus.error || 'Check Web App URL and deployment access'}`}
                    </span>
                  </div>
                )}
              </div>

              {/* 2. Google Drive Root Folder ID */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center font-bold text-xs">
                    2
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Google Drive Root Folder ID</h4>
                    <p className="text-[11px] text-slate-500">Parent folder where all platform, recording type, and date subfolders are created</p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Drive Folder ID (Optional / Custom)
                  </label>
                  <input
                    type="text"
                    disabled={disableSettings}
                    value={driveFolderIdInput}
                    onChange={(e) => setDriveFolderIdInput(e.target.value)}
                    placeholder="e.g. 1ukj0fkTayl7rX8ib13sO-wD_jQSa2Izy"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Leave blank to automatically use the default <code>VMS_Packing_Videos</code> root folder in your Drive.
                  </p>
                </div>
              </div>

              {/* 3. Chunk Upload Size Limit */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-xs">
                      3
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">Video Upload Chunk Size</h4>
                      <p className="text-[11px] text-slate-500">Configure slice size for fast & resumable video uploads</p>
                    </div>
                  </div>

                  <span className="bg-blue-50 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-lg border border-blue-200 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    {chunkSizeMbInput} MB / Chunk
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Select Upload Chunk Size Limit
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {[4, 8, 16, 32, 64].map((size) => (
                      <button
                        key={size}
                        type="button"
                        disabled={disableSettings}
                        onClick={() => setChunkSizeMbInput(size)}
                        className={`py-2.5 px-2 rounded-xl text-xs font-bold border transition flex flex-col items-center justify-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          chunkSizeMbInput === size
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <span>{size} MB</span>
                        {size === 8 && (
                          <span className={`text-[9px] uppercase tracking-wider ${chunkSizeMbInput === size ? 'text-blue-100' : 'text-blue-600'}`}>
                            Default
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">
                    <strong>8 MB</strong> is the optimal balance between high upload speed and resilient resumability for warehouse packing stations.
                  </p>
                </div>
              </div>

              {/* 4. Automated Upload & Resume Toggles */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-xs">
                    4
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Automation Policies</h4>
                    <p className="text-[11px] text-slate-500">Auto-upload and interruption recovery preferences</p>
                  </div>
                </div>

                <div className="space-y-3 pt-1">
                  <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-50 rounded-xl">
                    <div>
                      <span className="text-xs font-semibold text-slate-800 block">
                        Automatic Background Upload
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Immediately begin Drive upload as soon as video downloads to local drive
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      disabled={disableSettings}
                      checked={autoUploadInput}
                      onChange={(e) => setAutoUploadInput(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-50 rounded-xl">
                    <div>
                      <span className="text-xs font-semibold text-slate-800 block">
                        Auto-Resume on Interruption
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Automatically resume failed/paused uploads from the exact stopped byte
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      disabled={disableSettings}
                      checked={autoResumeInput}
                      onChange={(e) => setAutoResumeInput(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </label>
                </div>
              </div>

              {/* 5. Duplicate Order ID Recording Policy */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <div className="w-7 h-7 rounded-lg bg-red-50 text-red-600 flex items-center justify-center font-bold text-xs">
                    5
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Duplicate Order ID Recording Policy</h4>
                    <p className="text-[11px] text-slate-500">Enforce duplicate order detection across Google Drive & Sheet logs</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <label
                    className={`flex items-start gap-3 p-3 rounded-xl border transition cursor-pointer ${
                      duplicatePolicyInput === 'strict_block'
                        ? 'bg-red-50/70 border-red-300'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="duplicatePolicy"
                      value="strict_block"
                      checked={duplicatePolicyInput === 'strict_block'}
                      onChange={() => setDuplicatePolicyInput('strict_block')}
                      className="mt-0.5 text-red-600 focus:ring-red-500"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">Strict Block (No Duplicates Allowed)</span>
                        <span className="bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.2 rounded-full">
                          RECOMMENDED
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                        Completely locks the "Start Recording" button when an Order ID has already been recorded. Operators cannot bypass this block.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-3 rounded-xl border transition cursor-pointer ${
                      duplicatePolicyInput === 'admin_override'
                        ? 'bg-amber-50/70 border-amber-300'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="duplicatePolicy"
                      value="admin_override"
                      checked={duplicatePolicyInput === 'admin_override'}
                      onChange={() => setDuplicatePolicyInput('admin_override')}
                      className="mt-0.5 text-amber-600 focus:ring-amber-500"
                    />
                    <div className="flex-1">
                      <span className="text-xs font-bold text-slate-900 block">Admin Authorization Required</span>
                      <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                        Operators are blocked from duplicate recording; only logged-in Administrators can review existing logs and override the lock.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-3 rounded-xl border transition cursor-pointer ${
                      duplicatePolicyInput === 'warn_only'
                        ? 'bg-blue-50/70 border-blue-300'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="duplicatePolicy"
                      value="warn_only"
                      checked={duplicatePolicyInput === 'warn_only'}
                      onChange={() => setDuplicatePolicyInput('warn_only')}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <span className="text-xs font-bold text-slate-900 block">Warning Alert Only (Allow Operator Override)</span>
                      <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                        Displays a duplicate alert and link to the previous video, but permits the operator to click "Proceed & Record Anyway".
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* 6. Google Sheet Maintenance & Playback Links Repair */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs">
                    6
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Google Sheet Maintenance & Repair</h4>
                    <p className="text-[11px] text-slate-500">Auto-fix playback URLs in ReturnLog/OrderLog & sync sheet tabs</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-xs font-semibold text-slate-800 block">
                        Fix Non-Clickable Playback URLs (Column F)
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Scans OrderLog & ReturnLog sheets, converting plain file names in Column F to clickable Google Drive preview links
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={repairingUrls}
                      onClick={handleRepairPlaybackUrls}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0 ml-3"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${repairingUrls ? 'animate-spin' : ''}`} />
                      {repairingUrls ? 'Repairing…' : 'Repair Links Now'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-xs font-semibold text-slate-800 block">
                        Run Sheet Setup & Create ReturnLog Tab
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Initializes or updates Google Sheet headers, adds ReturnLog tab, and applies duplicate highlights
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={runningSetup}
                      onClick={handleRunGoogleSheetSetup}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0 ml-3"
                    >
                      <Server className={`w-3.5 h-3.5 ${runningSetup ? 'animate-spin' : ''}`} />
                      {runningSetup ? 'Running…' : 'Run Setup'}
                    </button>
                  </div>
                </div>
              </div>

              {/* 7. Cache & Storage Management */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <div className="w-7 h-7 rounded-lg bg-red-50 text-red-600 flex items-center justify-center font-bold text-xs">
                    7
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Cache & Storage Management</h4>
                    <p className="text-[11px] text-slate-500">Remove cached application state and local queue data</p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-800 block">
                      Clear All Local Cache & Storage
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Wipes local storage configs, temporary session flags, and IndexedDB upload queues
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={clearingCache}
                    onClick={handleClearAllCache}
                    className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className={`w-4 h-4 ${clearingCache ? 'animate-spin' : ''}`} />
                    {clearingCache ? 'Clearing…' : 'Clear All Cache'}
                  </button>
                </div>
              </div>

              {/* Submit / Save Bar */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="submit"
                  disabled={disableSettings}
                  className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-2 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  Save Apps Script & Drive Settings
                </button>
              </div>
            </div>

            {/* Right 5 Columns: Visual Hierarchy & Guide */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <FolderSync className="w-4 h-4 text-purple-400" />
                    Drive Folder Hierarchy
                  </span>
                  <span className="text-[10px] text-purple-400 font-mono">Auto-Organized</span>
                </div>

                <div className="space-y-2 font-mono text-[11px] text-slate-300 bg-slate-800/80 p-3.5 rounded-xl border border-slate-700 leading-relaxed">
                  <div className="text-purple-400 flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>{driveFolderIdInput ? `[Custom Folder: ${driveFolderIdInput.slice(0, 10)}…]` : 'VMS_Packing_Videos /'}</span>
                  </div>
                  <div className="pl-4 text-blue-300 border-l border-slate-700">
                    ├── 📁 <b>Amazon</b> / <b>D2C</b> / <b>JioMart</b> / <b>Custom</b>
                  </div>
                  <div className="pl-8 text-amber-300 border-l border-slate-700">
                    ├── 📁 <b>Forward</b> / <b>Return</b>
                  </div>
                  <div className="pl-12 text-emerald-300 border-l border-slate-700">
                    ├── 📁 <b>2026-08-21</b> (Date)
                  </div>
                  <div className="pl-16 text-slate-200 border-l border-slate-700">
                    └── 🎬 <b>ORD12345_Amazon_Forward.mp4</b>
                  </div>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  All recorded videos are organized automatically into this hierarchy on Google Drive, and indexed with direct view links in Google Sheets.
                </p>
              </div>

              {/* Quick Code Reference */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
                <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Link2 className="w-4 h-4 text-blue-600" />
                  Code.gs Synchronization
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  The latest <code>backend/Code.gs</code> includes support for 16MB chunking, folder hierarchy auto-creation, and Google Sheets logging.
                </p>
              </div>
            </div>
          </form>
        </div>
      )}
      {adminTab === 'branding' && (
        <div className="space-y-6">
          {/* Information Notice */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3 shadow-xs">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
              <Palette className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                Permanent Custom Branding
                <span className="bg-blue-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded">
                  PERSISTENT
                </span>
              </h3>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Logos, browser favicons, and workstation titles saved here are stored in persistent local storage and will <strong>never change or reset</strong> unless you manually modify or reset them from this Admin panel.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveBranding} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Configuration Controls */}
            <div className="lg:col-span-7 space-y-5">
              {/* 1. Logo Customization Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs">
                      1
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">Application Logo</h4>
                      <p className="text-[11px] text-slate-500">Displayed in sidebar, mobile header, and login screen</p>
                    </div>
                  </div>

                  <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[11px]">
                    <button
                      type="button"
                      disabled={disableBranding}
                      onClick={() => setLogoInputType('upload')}
                      className={`px-2.5 py-1 rounded-md font-medium transition disabled:opacity-50 ${
                        logoInputType === 'upload' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
                      }`}
                    >
                      File Upload
                    </button>
                    <button
                      type="button"
                      disabled={disableBranding}
                      onClick={() => setLogoInputType('url')}
                      className={`px-2.5 py-1 rounded-md font-medium transition disabled:opacity-50 ${
                        logoInputType === 'url' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
                      }`}
                    >
                      Image URL
                    </button>
                  </div>
                </div>

                {logoInputType === 'upload' ? (
                  <div>
                    <input
                      ref={logoFileInputRef}
                      type="file"
                      accept="image/png, image/jpeg, image/svg+xml, image/webp"
                      onChange={handleLogoFileUpload}
                      className="hidden"
                      id="logo-file-input"
                    />
                    <div
                      onClick={() => { if(!disableBranding && !isUploadingLogo) logoFileInputRef.current?.click(); }}
                      className={`border-2 border-dashed border-slate-300 rounded-xl p-5 text-center transition flex flex-col items-center justify-center gap-2 group ${disableBranding || isUploadingLogo ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-500 hover:bg-blue-50/50 cursor-pointer'}`}
                    >
                      <div className="w-10 h-10 rounded-full bg-slate-100 group-hover:bg-blue-100 text-slate-500 group-hover:text-blue-600 flex items-center justify-center transition">
                        {isUploadingLogo ? (
                          <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
                        ) : (
                          <Upload className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-blue-600 hover:underline">
                          {isUploadingLogo ? 'Uploading to Drive "VMS_Branding" folder...' : 'Click to browse and upload company logo'}
                        </span>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          PNG, SVG, JPG, or WebP (Saved to Drive & Google Sheet permanently)
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Direct Logo Image URL
                    </label>
                    <input
                      type="url"
                      disabled={disableBranding}
                      placeholder="https://example.com/assets/logo.png"
                      value={logoUrlInput}
                      onChange={(e) => setLogoUrlInput(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>
                )}

                {logoUrlInput && (
                  <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <div className="flex items-center gap-3 truncate">
                      <img
                        src={logoUrlInput}
                        alt="Logo preview thumbnail"
                        className="w-8 h-8 rounded-lg object-contain bg-white border border-slate-200 p-0.5"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      <span className="text-xs text-slate-600 truncate font-mono">
                        {logoUrlInput.startsWith('data:') ? 'Custom uploaded image (embedded)' : logoUrlInput}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLogoUrlInput('')}
                      className="text-xs text-red-600 hover:text-red-700 font-semibold shrink-0 ml-2"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {/* 2. Favicon Customization Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs">
                      2
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">Browser Favicon</h4>
                      <p className="text-[11px] text-slate-500">Displayed on the browser tab header</p>
                    </div>
                  </div>

                  <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[11px]">
                    <button
                      type="button"
                      disabled={disableBranding}
                      onClick={() => setFaviconInputType('upload')}
                      className={`px-2.5 py-1 rounded-md font-medium transition disabled:opacity-50 ${
                        faviconInputType === 'upload' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
                      }`}
                    >
                      File Upload
                    </button>
                    <button
                      type="button"
                      disabled={disableBranding}
                      onClick={() => setFaviconInputType('url')}
                      className={`px-2.5 py-1 rounded-md font-medium transition disabled:opacity-50 ${
                        faviconInputType === 'url' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
                      }`}
                    >
                      Icon URL
                    </button>
                  </div>
                </div>

                {faviconInputType === 'upload' ? (
                  <div>
                    <input
                      ref={faviconFileInputRef}
                      type="file"
                      accept="image/x-icon, image/png, image/svg+xml, image/jpeg"
                      onChange={handleFaviconFileUpload}
                      className="hidden"
                      id="favicon-file-input"
                    />
                    <div
                      onClick={() => { if (!disableBranding && !isUploadingFavicon) faviconFileInputRef.current?.click(); }}
                      className={`border-2 border-dashed border-slate-300 rounded-xl p-5 text-center transition flex flex-col items-center justify-center gap-2 group ${disableBranding || isUploadingFavicon ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-500 hover:bg-blue-50/50 cursor-pointer'}`}
                    >
                      <div className="w-10 h-10 rounded-full bg-slate-100 group-hover:bg-blue-100 text-slate-500 group-hover:text-blue-600 flex items-center justify-center transition">
                        {isUploadingFavicon ? (
                          <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
                        ) : (
                          <Globe className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-blue-600 hover:underline">
                          {isUploadingFavicon ? 'Uploading to Drive "VMS_Branding" folder...' : 'Click to browse and upload browser favicon'}
                        </span>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          ICO, PNG, or SVG (Saved to Drive & Google Sheet permanently)
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Direct Favicon URL
                    </label>
                    <input
                      type="url"
                      disabled={disableBranding}
                      placeholder="https://example.com/assets/favicon.ico"
                      value={faviconUrlInput}
                      onChange={(e) => setFaviconUrlInput(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>
                )}

                {faviconUrlInput && (
                  <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <div className="flex items-center gap-3 truncate">
                      <img
                        src={faviconUrlInput}
                        alt="Favicon preview thumbnail"
                        className="w-6 h-6 rounded-sm object-contain bg-white border border-slate-200 p-0.5"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      <span className="text-xs text-slate-600 truncate font-mono">
                        {faviconUrlInput.startsWith('data:') ? 'Custom uploaded icon (embedded)' : faviconUrlInput}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFaviconUrlInput('')}
                      className="text-xs text-red-600 hover:text-red-700 font-semibold shrink-0 ml-2"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {/* 3. System Titles */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs">
                    3
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Workstation Title & Subtitle</h4>
                    <p className="text-[11px] text-slate-500">Custom name for your packing station brand</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      App Name
                    </label>
                    <input
                      type="text"
                      required
                      disabled={disableBranding}
                      value={appNameInput}
                      onChange={(e) => setAppNameInput(e.target.value)}
                      placeholder="e.g. VMS 3.0 or ACME Packing"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Subtitle / Department
                    </label>
                    <input
                      type="text"
                      disabled={disableBranding}
                      value={appSubtitleInput}
                      onChange={(e) => setAppSubtitleInput(e.target.value)}
                      placeholder="e.g. Order Packing System"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  disabled={disableBranding}
                  onClick={handleResetToDefaultBranding}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-xl transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset to Defaults
                </button>

                <button
                  type="submit"
                  disabled={disableBranding}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition flex items-center gap-2 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  Save Branding Changes
                </button>
              </div>
            </div>

            {/* Right Column: Live Interactive Mockup Previews */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-blue-400" />
                    Live Visual Preview
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Real-Time UI Preview</span>
                </div>

                {/* Preview 1: Browser Tab / Favicon Simulator */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Browser Tab Preview
                  </div>
                  <div className="bg-slate-800 rounded-t-lg p-2 flex items-center gap-2 border border-slate-700 max-w-xs">
                    {faviconUrlInput ? (
                      <img
                        src={faviconUrlInput}
                        alt="Favicon preview"
                        className="w-4 h-4 rounded-xs object-contain"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-4 h-4 rounded-xs bg-blue-500 flex items-center justify-center text-[9px] font-bold text-white">
                        V
                      </div>
                    )}
                    <span className="text-xs text-slate-200 font-medium truncate">
                      {appNameInput || 'VMS 3.0'} - Order Packing Video
                    </span>
                    <span className="text-slate-500 text-xs ml-auto">✕</span>
                  </div>
                </div>

                {/* Preview 2: Sidebar Header Mockup */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Sidebar / Navigation Brand Preview
                  </div>
                  <div className="bg-white text-slate-900 rounded-xl p-3.5 border border-slate-200 flex items-center gap-3">
                    {logoUrlInput ? (
                      <img
                        src={logoUrlInput}
                        alt="Logo preview"
                        className="w-9 h-9 rounded-xl object-contain bg-slate-50 border border-slate-100 p-0.5"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                        V
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 tracking-tight text-sm">
                          {appNameInput || 'VMS 3.0'}
                        </span>
                        <span className="bg-blue-50 text-blue-700 text-[10px] font-bold px-1.5 py-0.2 rounded border border-blue-200">
                          DRIVE
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-medium">
                        {appSubtitleInput || 'Order Packing System'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Preview 3: Mobile Top Bar Mockup */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Mobile Header Preview
                  </div>
                  <div className="bg-white text-slate-900 rounded-lg px-3 py-2 border border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 flex items-center justify-center text-slate-600">☰</div>
                      {logoUrlInput ? (
                        <img
                          src={logoUrlInput}
                          alt="Mobile logo"
                          className="w-7 h-7 rounded-md object-contain bg-slate-50 border border-slate-100 p-0.5"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-md bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                          V
                        </div>
                      )}
                      <span className="font-bold text-slate-900 text-xs">
                        {appNameInput || 'VMS 3.0'}
                      </span>
                    </div>
                    <span className="bg-emerald-50 text-emerald-700 text-[10px] font-medium px-2 py-0.5 rounded-full border border-emerald-200">
                      Online
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* USERS TAB */}
      {adminTab === 'users' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* Search Filter */}
            <div className="relative max-w-sm w-full">
              <input
                type="text"
                placeholder="Search users by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsCreateOpen(true)}
                disabled={disableUsers}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
              >
                <UserPlus className="w-4 h-4" />
                Add New User
              </button>
              <button
                onClick={fetchUsers}
                disabled={loading}
                className="p-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Users Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map((u, i) => (
                    <tr key={i} className="hover:bg-slate-50/75">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{u.name}</div>
                        <div className="text-slate-500 font-mono text-[11px]">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                            u.role === 'Master Admin'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : u.role === 'Admin'
                              ? 'bg-purple-50 text-purple-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
                            u.status === 'Approved'
                              ? 'bg-emerald-50 text-emerald-700'
                              : u.status === 'Pending'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-[11px]">
                        {u.created ? new Date(u.created).toLocaleDateString() : 'Active'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleOpenEditUser(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-lg text-[11px] transition shadow-2xs cursor-pointer"
                            title="Edit user details (Name, Role, Status, Password)"
                          >
                            <Edit3 className="w-3 h-3" />
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={() => handleResetPassword(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-[11px] transition shadow-2xs cursor-pointer"
                            title="Reset password"
                          >
                            <KeyRound className="w-3 h-3" />
                            Password
                          </button>

                          {u.email !== currentUser?.email && (
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(u)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 font-semibold rounded-lg text-[11px] transition shadow-2xs cursor-pointer ${
                                u.status === 'Approved'
                                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-700'
                                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                              }`}
                              title={u.status === 'Approved' ? 'Disable user access' : 'Approve user access'}
                            >
                              {u.status === 'Approved' ? <XCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                              {u.status === 'Approved' ? 'Disable' : 'Approve'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleEditPermissions(u)}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 font-semibold rounded-lg text-[11px] transition shadow-2xs cursor-pointer"
                            title="Granular permissions"
                          >
                            <Shield className="w-3 h-3" />
                            Perms
                          </button>

                          {u.email !== currentUser?.email && (
                            <button
                              type="button"
                              onClick={() => handleOpenDeleteUser(u)}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 font-semibold rounded-lg text-[11px] transition shadow-2xs cursor-pointer"
                              title="Delete user account"
                            >
                              <Trash2 className="w-3 h-3" />
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-800">Create New User Account</h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. John Packer"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="packer@vms.local"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full pl-3 pr-10 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                    title={showNewPassword ? 'Hide password' : 'View password'}
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Minimum 6 characters. Click the eye icon to view or verify typed password.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="User">User / Packer</option>
                    <option value="Admin">Administrator</option>
                    <option value="Master Admin">Master Admin</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Initial Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as UserStatus)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="Approved">Approved</option>
                    <option value="Pending">Pending</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal with View Password Option */}
      {resetModalUser && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Reset Operator Password</h3>
                  <p className="text-[11px] text-slate-500 font-mono">{resetModalUser.email}</p>
                </div>
              </div>
              <button
                onClick={() => setResetModalUser(null)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Password (min 6 chars)
                </label>
                <div className="relative">
                  <input
                    type={showResetPasswordValue ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full pl-3 pr-10 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPasswordValue(!showResetPasswordValue)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                    title={showResetPasswordValue ? 'Hide password' : 'View password'}
                  >
                    {showResetPasswordValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetModalUser(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resettingPassword}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {resettingPassword ? 'Updating…' : 'Save New Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Granular Permissions Modal (Master Admin Only) */}
      {permissionsModalUser && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Edit User Permissions</h3>
                  <p className="text-[11px] text-slate-500 font-mono">{permissionsModalUser.email}</p>
                </div>
              </div>
              <button
                onClick={() => setPermissionsModalUser(null)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePermissions} className="space-y-4">
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                {[
                  { key: 'canDeleteData', label: 'Delete Logs & Data', desc: 'Allow user to permanently remove logs and trash Drive files' },
                  { key: 'canManageUsers', label: 'Manage Users', desc: 'Allow user to create, edit, or disable other users' },
                  { key: 'canManageSettings', label: 'Manage Settings', desc: 'Allow user to change Google Apps Script URL and Drive settings' },
                  { key: 'canManageBranding', label: 'Manage Branding', desc: 'Allow user to change app logo and favicon' },
                  { key: 'canAccessSearch', label: 'Search Videos', desc: 'Allow user to access the Search page' },
                  { key: 'canAccessReports', label: 'View Reports', desc: 'Allow user to generate and view CSV reports' },
                  { key: 'canAccessAnalytics', label: 'Access Analytics', desc: 'Allow user to view system analytics and charts' },
                  { key: 'canAccessHealth', label: 'Access System Health', desc: 'Allow user to view technical diagnostics' },
                ].map((perm) => (
                  <label key={perm.key} className="flex items-start justify-between cursor-pointer p-2.5 hover:bg-slate-50 rounded-xl border border-transparent hover:border-slate-100">
                    <div className="pr-4">
                      <span className="text-xs font-semibold text-slate-800 block">
                        {perm.label}
                      </span>
                      <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">
                        {perm.desc}
                      </span>
                    </div>
                    <div className="pt-1">
                      <input
                        type="checkbox"
                        checked={!!permissionsModalValues[perm.key]}
                        onChange={(e) => setPermissionsModalValues({ ...permissionsModalValues, [perm.key]: e.target.checked })}
                        className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
                        disabled={isMasterAdmin(permissionsModalUser) && permissionsModalUser.email === currentUser?.email}
                      />
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPermissionsModalUser(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPermissions}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Shield className="w-3.5 h-3.5" />
                  {savingPermissions ? 'Saving…' : 'Save Permissions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editModalUser && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <UserCog className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Edit User Details</h3>
                  <p className="text-[11px] text-slate-500 font-mono">{editModalUser.email}</p>
                </div>
              </div>
              <button
                onClick={() => setEditModalUser(null)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmEditUser} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. Roshan K"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  disabled
                  value={editEmail}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-500 cursor-not-allowed"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Email identifier is linked to Google Sheet row</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    System Role
                  </label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                  >
                    <option value="User">User / Operator</option>
                    <option value="Admin">Administrator</option>
                    <option value="Master Admin">Master Admin</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Account Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as UserStatus)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                  >
                    <option value="Approved">Approved (Active)</option>
                    <option value="Pending">Pending Approval</option>
                    <option value="Disabled">Disabled</option>
                  </select>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Update Password (Optional)
                </label>
                <div className="relative">
                  <input
                    type={showEditPassword ? 'text' : 'password'}
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Leave blank to keep existing password"
                    minLength={6}
                    className="w-full pl-3 pr-10 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword(!showEditPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                    title={showEditPassword ? 'Hide password' : 'View password'}
                  >
                    {showEditPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <span className="text-[10px] text-slate-400 mt-0.5 block">Only fill this if you wish to reset their password</span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditModalUser(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEditUser}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingEditUser ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {deleteModalUser && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Delete User Account</h3>
                <p className="text-xs text-slate-500 mt-0.5">This action will remove the user from the system.</p>
              </div>
            </div>

            <div className="p-3 bg-red-50/70 border border-red-100 rounded-xl text-xs text-red-800 space-y-1">
              <p className="font-semibold">Are you sure you want to remove this user?</p>
              <p className="font-mono text-[11px] text-red-700">
                {deleteModalUser.name} ({deleteModalUser.email})
              </p>
              <p className="text-[11px] text-red-600 pt-1">
                Their login credentials will be removed from the Users sheet.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteModalUser(null)}
                disabled={deletingUser}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteUser}
                disabled={deletingUser}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deletingUser ? 'Deleting…' : 'Yes, Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
