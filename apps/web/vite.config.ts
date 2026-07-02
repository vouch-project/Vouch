import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { defineConfig } from 'vite';

const watchEnv = {
  name: 'watch-root-env',
  configureServer(server: import('vite').ViteDevServer) {
    const envFile = path.resolve(__dirname, '../../.env');
    server.watcher.add(envFile);
    server.watcher.on('change', (file) => {
      if (file === envFile) {
        server.restart();
      }
    });
  },
};

export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), watchEnv],

  // Force a single instance of AppKit's controllers and Lit. These packages keep
  // module-level singleton stores (e.g. the EIP-6963 connector/wallet registry).
  // If Vite's dev graph loads two copies, the listener that discovers browser
  // wallets populates one store while the modal UI reads the other — so installed
  // extensions like MetaMask appear "undetected". Deduping also silences the
  // "Multiple versions of Lit loaded" warning.
  resolve: {
    dedupe: [
      '@reown/appkit',
      '@reown/appkit-controllers',
      '@reown/appkit-adapter-ethers',
      'lit',
      'lit-html',
      'lit-element',
      '@lit/reactive-element',
    ],
  },

  // AppKit and its dependencies use browser-only APIs.  Bundling them for SSR
  // (noExternal) gives Vite full control over their ESM graph and avoids
  // "require() of ES module" errors that can arise when Node tries to resolve
  // CJS wrappers for these packages.
  ssr: {
    noExternal: ['@reown/appkit', '@reown/appkit-adapter-ethers', 'ethers', 'bits-ui', '@lucide/svelte'],
  },
});
