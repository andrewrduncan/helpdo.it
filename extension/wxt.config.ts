import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Build to a VISIBLE folder (default `.output` is hidden by the leading dot,
  // so it doesn't show in the macOS "Load unpacked" picker). Load `dist/chrome-mv3`.
  outDir: 'dist',
  // rsocket-core references the Node `global` identifier; map it to globalThis
  // for the browser/service-worker bundle.
  vite: () => ({
    define: { global: 'globalThis' },
  }),
  manifest: {
    name: 'helpdo.it',
    description:
      'AI-driven in-context help. Ask how to do something, right where you are, and get shown how.',
    // webNavigation lets the recorder log page changes (loads/redirects/SPA routes)
    // in the tab being recorded.
    permissions: ['activeTab', 'storage', 'identity', 'webNavigation'],
    // tabs.captureVisibleTab needs host access to the tab being captured.
    // <all_urls> lets the widget snapshot any page (it runs everywhere).
    host_permissions: ['<all_urls>'],
    // Enterprise managed config (GPO/Intune) can push instanceUrl; read-only in-app.
    storage: { managed_schema: 'managed_schema.json' },
  },
});
