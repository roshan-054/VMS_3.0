import React, { useState, useEffect } from 'react';
import {
  Camera,
  UploadCloud,
  FileClock,
  Search,
  FileSpreadsheet,
  BarChart3,
  Activity,
  Shield,
  Settings,
  LogOut,
  Wifi,
  WifiOff,
  Video,
  CheckCircle2,
  AlertCircle,
  Info,
  Menu,
  X,
  ChevronRight
} from 'lucide-react';
import { User, QueueItem } from './types';
import { getStoredToken, setStoredToken, dbGetAllQueue } from './lib/storage';
import { getStoredBranding, subscribeBranding, applyFavicon, BrandingConfig } from './lib/branding';
import { initUploadWorker } from './lib/uploadWorker';
import { ScanRecord } from './components/ScanRecord';
import { UploadQueue } from './components/UploadQueue';
import { UploadLogs } from './components/UploadLogs';
import { SearchOrders } from './components/SearchOrders';
import { Reports } from './components/Reports';
import { Analytics } from './components/Analytics';
import { SystemHealth } from './components/SystemHealth';
import { AdminPanel } from './components/AdminPanel';
import { SetupModal } from './components/SetupModal';
import { AuthView } from './components/AuthView';
import { MobileScannerView } from './components/MobileScannerView';

import {
  isMasterAdmin,
  canUserAccessSearch,
  canUserAccessReports,
  canUserAccessAnalytics,
  canUserAccessHealth,
  canUserAccessAdminPanel
} from './lib/permissions';

export function App() {
  const [branding, setBranding] = useState<BrandingConfig>(getStoredBranding());

  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const token = getStoredToken();
    if (token) {
      try {
        const storedUser = localStorage.getItem('vms_current_user');
        if (storedUser) {
          return JSON.parse(storedUser);
        }
      } catch (e) {}
      return {
        name: 'Master Admin',
        email: 'askroshan.2002@gmail.com',
        role: 'Master Admin',
        status: 'Approved',
      };
    }
    return null;
  });

  const updateCurrentUser = (user: User | null) => {
    setCurrentUser(user);
    if (user) {
      localStorage.setItem('vms_current_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('vms_current_user');
    }
  };

  const [activeTab, setActiveTab] = useState<
    'record' | 'queue' | 'logs' | 'search' | 'reports' | 'analytics' | 'health' | 'admin'
  >('record');

  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [toastInfo, setToastInfo] = useState<{
    id: number;
    msg: string;
    type: 'info' | 'success' | 'error';
  } | null>(null);

  // Initialize and subscribe to branding updates (Logo, Favicon, App Title)
  useEffect(() => {
    const initial = getStoredBranding();
    setBranding(initial);
    applyFavicon(initial.faviconUrl);
    if (initial.appName) {
      document.title = `${initial.appName} - Order Packing Video System`;
    }

    const unsubscribe = subscribeBranding((updated) => {
      setBranding(updated);
    });
    return () => unsubscribe();
  }, []);

  // Monitor network status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast('Network connected. Upload queue resuming.', 'success');
    };
    const handleOffline = () => {
      setIsOnline(false);
      showToast('Offline mode active. Recordings will save locally to queue.', 'info');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Update queue badge count
  const refreshQueueBadge = async () => {
    try {
      const items = await dbGetAllQueue();
      const pending = items.filter((i) => i.status === 'pending' || i.status === 'uploading').length;
      setPendingQueueCount(pending);
    } catch (e) {}
  };

  // Initialize global background upload worker and queue sync
  useEffect(() => {
    const cleanupWorker = initUploadWorker((msg, type) => {
      showToast(msg, type);
    });

    const handleQueueChange = () => {
      refreshQueueBadge();
    };

    window.addEventListener('ops_queue_updated', handleQueueChange);
    refreshQueueBadge();
    const timer = setInterval(refreshQueueBadge, 4000);

    return () => {
      cleanupWorker();
      window.removeEventListener('ops_queue_updated', handleQueueChange);
      clearInterval(timer);
    };
  }, []);

  const showToast = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = Date.now();
    setToastInfo({ id, msg, type });
    setTimeout(() => {
      setToastInfo((prev) => (prev?.id === id ? null : prev));
    }, 4500);
  };

  const handleLogout = () => {
    setStoredToken('');
    updateCurrentUser(null);
    showToast('Logged out of workstation', 'info');
  };

  // Check if this window was opened as a Mobile Wireless Barcode Scanner
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const isMobileScanner = searchParams.get('mobile_scanner') === '1';
  const stationParam = searchParams.get('station') || 'STATION-1';

  if (isMobileScanner) {
    return (
      <MobileScannerView
        stationSessionId={stationParam}
        onExit={() => {
          window.location.search = '';
        }}
      />
    );
  }

  if (!currentUser) {
    return (
      <>
        <AuthView
          onLoginSuccess={(user) => {
            updateCurrentUser(user);
          }}
          onOpenSetup={() => setIsSetupOpen(true)}
          onShowToast={showToast}
        />
        <SetupModal
          isOpen={isSetupOpen}
          onClose={() => setIsSetupOpen(false)}
          onShowToast={showToast}
        />
      </>
    );
  }

  const navItems = [
    { id: 'record', label: 'Scan & Record', icon: Camera },
    { id: 'queue', label: 'Upload Queue', icon: UploadCloud, badge: pendingQueueCount },
    { id: 'logs', label: 'Upload Logs', icon: FileClock },
    ...(canUserAccessSearch(currentUser) ? [{ id: 'search', label: 'Search Videos', icon: Search }] : []),
    ...(canUserAccessReports(currentUser) ? [{ id: 'reports', label: 'Reports', icon: FileSpreadsheet }] : []),
    ...(canUserAccessAnalytics(currentUser) ? [{ id: 'analytics', label: 'Analytics', icon: BarChart3 }] : []),
    ...(canUserAccessHealth(currentUser) ? [{ id: 'health', label: 'Health & Diagnostics', icon: Activity }] : []),
    ...(canUserAccessAdminPanel(currentUser)
      ? [{ id: 'admin', label: 'Admin & Users', icon: Shield }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col md:flex-row text-slate-800">
      {/* Mobile Top App Bar with Hamburger */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-40 shadow-xs">
        <div className="flex items-center gap-2.5">
          <button
            id="mobile-nav-toggle-btn"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Toggle navigation menu"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt="App Logo"
                className="w-8 h-8 rounded-lg object-contain bg-slate-50 border border-slate-200 p-0.5"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
                <Video className="w-4 h-4" />
              </div>
            )}
            <div>
              <span className="font-bold text-slate-900 tracking-tight text-sm">
                {branding.appName || 'VMS 3.0'}
              </span>
              <span className="ml-1.5 bg-blue-50 text-blue-700 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-blue-200">
                Drive
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
              isOnline
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}
          >
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          </span>
          <button
            onClick={() => setIsSetupOpen(true)}
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
            title="Setup"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mobile Drawer Backdrop */}
      {isMobileMenuOpen && (
        <div
          id="mobile-drawer-backdrop"
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-40 md:hidden transition-opacity"
        />
      )}

      {/* Left Sidebar (Desktop fixed/docked, Mobile slide-out drawer) */}
      <aside
        id="app-left-sidebar"
        className={`fixed md:sticky top-0 left-0 bottom-0 z-50 md:z-30 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out md:translate-x-0 ${
          isMobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        } h-screen shrink-0`}
      >
        {/* Brand Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt="App Logo"
                className="w-9 h-9 rounded-xl object-contain bg-slate-50 border border-slate-200 p-0.5 shadow-xs"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
                <Video className="w-5 h-5" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-900 tracking-tight text-base truncate max-w-[120px]">
                  {branding.appName || 'VMS 3.0'}
                </span>
                <span className="bg-blue-50 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-200">
                  DRIVE
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate max-w-[140px]">
                {branding.appSubtitle || 'Order Packing System'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Network & Cloud Status Bar */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-medium flex items-center gap-1.5">
            {isOnline ? (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-amber-500" />
            )}
            {isOnline ? 'Cloud Synced' : 'Offline Queue'}
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            {isOnline ? 'Online' : 'Local'}
          </span>
        </div>

        {/* Navigation Items on Left Side */}
        <nav id="left-sidebar-navigation" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`nav-item-${tab.id}`}
                onClick={() => {
                  setActiveTab(tab.id as any);
                  setIsMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                  <span>{tab.label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isActive
                          ? 'bg-white text-blue-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                  {isActive && <ChevronRight className="w-3.5 h-3.5 opacity-80" />}
                </div>
              </button>
            );
          })}
        </nav>

        {/* User Footer Profile & Actions */}
        <div className="p-3 border-t border-slate-100 bg-slate-50/50 space-y-2">
          <button
            onClick={() => setIsSetupOpen(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
          >
            <Settings className="w-4 h-4 text-slate-400" />
            <span>Drive & Script Config</span>
          </button>

          <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between px-2">
            <div className="truncate mr-2">
              <div className="text-xs font-bold text-slate-800 truncate">{currentUser.name}</div>
              <div className="text-[10px] text-slate-400 font-mono truncate">{currentUser.role}</div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition shrink-0"
              title="Log Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-100">
        <main className="flex-1 w-full px-4 sm:px-6 lg:px-10 xl:px-12 py-6 transition-all duration-200">
          {activeTab === 'record' && (
            <ScanRecord
              onQueueUpdated={refreshQueueBadge}
              onShowToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'queue' && (
            <UploadQueue
              onQueueChanged={refreshQueueBadge}
              onShowToast={showToast}
              onNavigateToLogs={() => setActiveTab('logs')}
            />
          )}

          {activeTab === 'logs' && (
            <UploadLogs
              onShowToast={showToast}
              onNavigateToQueue={() => setActiveTab('queue')}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'search' && <SearchOrders onShowToast={showToast} />}

          {activeTab === 'reports' && <Reports onShowToast={showToast} />}

          {activeTab === 'analytics' && <Analytics onShowToast={showToast} />}

          {activeTab === 'health' && <SystemHealth onShowToast={showToast} />}

          {activeTab === 'admin' && (
            <AdminPanel onShowToast={showToast} currentUser={currentUser} />
          )}
        </main>
      </div>

      {/* Toast Notification Container */}
      {toastInfo && (
        <div className="fixed bottom-5 right-5 z-50 transition-all transform ease-out duration-300">
          <div
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-xs font-medium border ${
              toastInfo.type === 'success'
                ? 'bg-emerald-900 text-emerald-100 border-emerald-700'
                : toastInfo.type === 'error'
                ? 'bg-red-900 text-red-100 border-red-700'
                : 'bg-slate-900 text-slate-100 border-slate-700'
            }`}
          >
            {toastInfo.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : toastInfo.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-blue-400 shrink-0" />
            )}
            <span>{toastInfo.msg}</span>
          </div>
        </div>
      )}

      {/* Apps Script Setup Modal */}
      <SetupModal
        isOpen={isSetupOpen}
        onClose={() => setIsSetupOpen(false)}
        onShowToast={showToast}
      />
    </div>
  );
}
export default App;
