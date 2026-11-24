import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig, type Plugin} from 'vite';

// Preview-only: compiles backend/Code.gs into a real module so the demo backend
// runs without eval (artifact/CSP hosts block 'unsafe-eval').
const GAS_SERVICES = ['SpreadsheetApp', 'PropertiesService', 'CacheService', 'LockService', 'Utilities', 'Session', 'Logger', 'DriveApp', 'Drive', 'ScriptApp', 'UrlFetchApp', 'ContentService', 'HtmlService', 'MailApp'];
function codeGsFactory(): Plugin {
  const id = 'virtual:code-gs-factory';
  return {
    name: 'code-gs-factory',
    resolveId: (s) => (s === id ? '\0' + id : null),
    load(s) {
      if (s !== '\0' + id) return null;
      const code = fs.readFileSync(path.resolve(__dirname, 'backend/Code.gs'), 'utf8');
      return `export const SERVICE_NAMES = ${JSON.stringify(GAS_SERVICES)};\nexport default function (s) {\n  const { ${GAS_SERVICES.join(', ')} } = s;\n${code}\n;return { doPost };\n}`;
    },
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss(), codeGsFactory()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
