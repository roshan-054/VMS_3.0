import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

// Build stamp: shown in the sidebar and written to version.json so open tabs can tell
// when a newer version has been published and offer a reload.
const BUILD = {
  id: (process.env.GITHUB_SHA || '').slice(0, 7) || `dev-${Date.now().toString(36)}`,
  time: new Date().toISOString(),
};
function versionFile(): Plugin {
  return {
    name: 'vms-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) });
    },
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss(), versionFile()],
    define: { __APP_BUILD__: JSON.stringify(BUILD) },
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
