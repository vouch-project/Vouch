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

  // AppKit and its dependencies use browser-only APIs.  Bundling them for SSR
  // (noExternal) gives Vite full control over their ESM graph and avoids
  // "require() of ES module" errors that can arise when Node tries to resolve
  // CJS wrappers for these packages.
  ssr: {
    noExternal: ['@reown/appkit', '@reown/appkit-adapter-ethers', 'ethers'],
  },
});
