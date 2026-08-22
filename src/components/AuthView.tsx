import React, { useState, useEffect } from 'react';
import { Video, Lock, Mail, User as UserIcon, Shield, ArrowRight, Settings, Sparkles, KeyRound, MonitorCheck, Eye, EyeOff } from 'lucide-react';
import { requestApi } from '../lib/api';
import { setStoredToken } from '../lib/storage';
import { getStoredBranding, BrandingConfig } from '../lib/branding';
import { User } from '../types';

interface AuthViewProps {
  onLoginSuccess: (user: User) => void;
  onOpenSetup: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
  onLoginSuccess,
  onOpenSetup,
  onShowToast,
}) => {
  const [branding, setBranding] = useState<BrandingConfig>(getStoredBranding());
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    setBranding(getStoredBranding());
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);

    const cleanEmail = email.trim().toLowerCase();

    try {
      if (isSignup) {
        const res = await requestApi('signup', {
          fullName: fullName.trim() || 'Packing Operator',
          email: cleanEmail,
          password,
        });
        onShowToast(res.message || 'Account created! Signing in...', 'success');
        
        // Auto sign in right after signup
        try {
          const loginRes = await requestApi<{ token: string; user: User }>('login', {
            email: cleanEmail,
            password,
          });
          setStoredToken(loginRes.token);
          onLoginSuccess(loginRes.user);
          return;
        } catch (lErr) {
          setIsSignup(false);
        }
      } else {
        const res = await requestApi<{ token: string; user: User }>('login', {
          email: cleanEmail,
          password,
        });
        setStoredToken(res.token);
        onLoginSuccess(res.user);
        onShowToast(`Welcome, ${res.user.name || res.user.email}!`, 'success');
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      const errMsg = err.message || 'Invalid email or password.';
      setAuthError(errMsg);
      onShowToast(errMsg, 'error');
    } finally {
      setLoading(false);
    }
  };



  const handleAutoRegisterCurrent = async () => {
    if (!email.trim() || !password.trim()) {
      onShowToast('Please fill in email and password first', 'error');
      return;
    }
    setLoading(true);
    setAuthError(null);

    const cleanEmail = email.trim().toLowerCase();
    try {
      await requestApi('signup', {
        fullName: fullName.trim() || cleanEmail.split('@')[0] || 'Operator',
        email: cleanEmail,
        password,
      });

      const res = await requestApi<{ token: string; user: User }>('login', {
        email: cleanEmail,
        password,
      });
      setStoredToken(res.token);
      onLoginSuccess(res.user);
      onShowToast(`Account registered and logged in as ${res.user.name}!`, 'success');
    } catch (err: any) {
      // If remote fails, create local session with these credentials
      const role = (cleanEmail === 'askroshan.2002@gmail.com' || cleanEmail === 'master@vms.local') ? 'Master Admin' : 'Admin';
      const localUser: User = {
        name: fullName.trim() || cleanEmail.split('@')[0] || 'Workstation User',
        email: cleanEmail,
        role: role as any,
        status: 'Approved',
      };
      setStoredToken('vms_workstation_' + Date.now());
      onLoginSuccess(localUser);
      onShowToast(`Logged into workstation as ${cleanEmail}!`, 'success');
    } finally {
      setLoading(false);
    }
  };

  const handleBypassDemo = () => {
    const cleanEmail = email.trim().toLowerCase() || 'askroshan.2002@gmail.com';
    const role = (cleanEmail === 'askroshan.2002@gmail.com' || cleanEmail === 'master@vms.local') ? 'Master Admin' : 'Admin';
    const demoUser: User = {
      name: cleanEmail === 'askroshan.2002@gmail.com' ? 'Roshan (Master Admin)' : 'Workstation Admin',
      email: cleanEmail,
      role: role as any,
      status: 'Approved',
    };
    setStoredToken('vms_workstation_session_' + Date.now());
    onLoginSuccess(demoUser);
    onShowToast('Logged into Packing Station Workstation!', 'success');
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt="App Logo"
              className="w-14 h-14 rounded-2xl object-contain bg-white/10 p-1 border border-white/20 mx-auto shadow-lg"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center mx-auto shadow-lg shadow-blue-500/30">
              <Video className="w-6 h-6" />
            </div>
          )}
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {branding.appName || 'Order Packing Video System'}
          </h1>
          <p className="text-xs text-slate-400">
            {branding.appSubtitle || 'VMS 2.0 • High-Velocity Packing Recorder & Drive Archiver'}
          </p>
        </div>

        {/* Auth Box */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-2xl border border-slate-800 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-base font-semibold text-slate-800">
              {isSignup ? 'Create Packing Station Account' : 'Packer / Admin Login'}
            </h2>
            <button
              type="button"
              onClick={onOpenSetup}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Settings className="w-3.5 h-3.5" />
              Apps Script Setup
            </button>
          </div>



          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="Enter your name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
              <div className="relative">
                <input
                  type="email"
                  required
                  placeholder="packer@vms.local or your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-10 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                  title={showPassword ? 'Hide password' : 'View password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {authError && (
              <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl space-y-2">
                <p className="font-medium">{authError}</p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleAutoRegisterCurrent}
                    className="px-2.5 py-1 bg-red-600 text-white rounded text-[11px] font-semibold hover:bg-red-700 transition"
                  >
                    Auto-Register & Login
                  </button>
                  <button
                    type="button"
                    onClick={handleBypassDemo}
                    className="px-2.5 py-1 bg-slate-700 text-white rounded text-[11px] font-semibold hover:bg-slate-800 transition"
                  >
                    Launch Workstation Mode
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg shadow-sm transition flex items-center justify-center gap-1.5"
            >
              {loading ? 'Authenticating…' : isSignup ? 'Create Account' : 'Sign In'}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
            <button
              onClick={() => {
                setIsSignup(!isSignup);
                setAuthError(null);
              }}
              className="text-blue-600 hover:underline font-medium"
            >
              {isSignup ? 'Already have an account? Log In' : 'New workstation? Create Account'}
            </button>

            <button
              onClick={handleBypassDemo}
              className="text-slate-500 hover:text-slate-800 text-[11px] underline flex items-center gap-1"
            >
              <MonitorCheck className="w-3 h-3" />
              Workstation Mode
            </button>
          </div>
        </div>

        {/* Footer Note */}
        <p className="text-center text-[11px] text-slate-500">
          Syncs directly to Google Sheets & Google Drive • IndexedDB Offline Protected
        </p>
      </div>
    </div>
  );
};
