import React, { useState } from 'react';
import {
  Settings,
  Link2,
  CheckCircle,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  Code,
  FolderSync,
  HardDrive,
  Zap
} from 'lucide-react';
import {
  getStoredApiUrl,
  setStoredApiUrl,
  getStoredDriveFolderId,
  setStoredDriveFolderId,
  getStoredChunkSizeMb,
  setStoredChunkSizeMb
} from '../lib/storage';
import { checkBackendHealth } from '../lib/api';

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export const SetupModal: React.FC<SetupModalProps> = ({ isOpen, onClose, onShowToast }) => {
  const [apiUrl, setApiUrl] = useState(getStoredApiUrl());
  const [driveFolderId, setDriveFolderId] = useState(getStoredDriveFolderId());
  const [chunkSizeMb, setChunkSizeMb] = useState<number>(getStoredChunkSizeMb());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  if (!isOpen) return null;

  const handleSaveAndTest = async () => {
    if (!apiUrl.trim().startsWith('https://script.google.com/macros/s/')) {
      setTestResult({
        success: false,
        message: 'Please enter a valid Google Apps Script Web App /exec URL.',
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    const health = await checkBackendHealth(apiUrl.trim());
    setTesting(false);

    // Save all parameters
    setStoredApiUrl(apiUrl.trim());
    setStoredDriveFolderId(driveFolderId.trim());
    setStoredChunkSizeMb(chunkSizeMb);

    if (health.online) {
      setTestResult({
        success: true,
        message: `Connected successfully! Backend service is online (Version ${health.version || '2.9'}).`,
      });
      onShowToast('Google Apps Script & Drive settings saved!', 'success');
    } else {
      setTestResult({
        success: false,
        message: `Connection failed: ${health.error || 'Check that Web App is deployed with "Anyone" access.'}`,
      });
    }
  };

  const handleCopyCode = () => {
    const codeGs = `// Paste into your Google Apps Script Code.gs
// See /backend/Code.gs in this project for the full backend code!`;
    navigator.clipboard.writeText(codeGs);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
    onShowToast('Setup instructions & Code.gs reference copied!', 'info');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-800">Apps Script & Drive Setup</h3>
              <p className="text-xs text-slate-400">Connect VMS 3.0 to your Google Cloud & Sheet backend</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-sm font-semibold p-1"
          >
            ✕
          </button>
        </div>

        {/* 3 Step Guide */}
        <div className="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
          <div className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
            <FolderSync className="w-3.5 h-3.5 text-blue-600" />
            3-Step Integration Setup
          </div>
          <div className="flex items-start gap-2 text-slate-600">
            <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[10px]">
              1
            </span>
            <span>Open your Google Sheet and click <b>Extensions → Apps Script</b>.</span>
          </div>
          <div className="flex items-start gap-2 text-slate-600">
            <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[10px]">
              2
            </span>
            <span>Paste <code>backend/Code.gs</code> and run <code>setupSystem()</code> to create Drive folders & Sheets automatically.</span>
          </div>
          <div className="flex items-start gap-2 text-slate-600">
            <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[10px]">
              3
            </span>
            <span>Click <b>Deploy → Web app</b> (Execute as: <i>Me</i>, Who has access: <i>Anyone</i>) and paste the URL below.</span>
          </div>
        </div>

        {/* Apps Script URL Input */}
        <div>
          <label htmlFor="setupApiUrlInput" className="block text-xs font-semibold text-slate-700 mb-1">
            Apps Script Web App Exec URL
          </label>
          <input
            id="setupApiUrlInput"
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Google Drive Root Folder ID */}
        <div>
          <label htmlFor="setupDriveFolderInput" className="block text-xs font-semibold text-slate-700 mb-1">
            Google Drive Root Folder ID (Optional)
          </label>
          <input
            id="setupDriveFolderInput"
            type="text"
            value={driveFolderId}
            onChange={(e) => setDriveFolderId(e.target.value)}
            placeholder="e.g. 1ukj0fkTayl7rX8ib13sO-wD_jQSa2Izy"
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <p className="text-[10px] text-slate-400 mt-0.5">
            Leave blank to use default <code>VMS_Packing_Videos</code> root folder.
          </p>
        </div>

        {/* Chunk Size Limit */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-semibold text-slate-700">
              Upload Chunk Limit
            </label>
            <span className="text-xs font-bold text-blue-600">
              {chunkSizeMb} MB / slice
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {[4, 8, 16, 32, 64].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setChunkSizeMb(size)}
                className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition cursor-pointer ${
                  chunkSizeMb === size
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {size}MB {size === 16 && '★'}
              </button>
            ))}
          </div>
        </div>

        {testResult && (
          <div
            className={`p-3 rounded-lg text-xs flex items-center gap-2 border ${
              testResult.success
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}
          >
            {testResult.success ? (
              <CheckCircle className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleCopyCode}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition flex items-center gap-1.5"
          >
            {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedCode ? 'Copied!' : 'Copy Code.gs'}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition"
            >
              Cancel
            </button>
            <button
              id="test-save-connection-btn"
              onClick={handleSaveAndTest}
              disabled={testing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1.5 cursor-pointer"
            >
              <Link2 className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
              {testing ? 'Testing…' : 'Test & Save Configuration'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
