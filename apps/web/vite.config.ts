import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],

  // AppKit and its dependencies use browser-only APIs.  Bundling them for SSR
  // (noExternal) gives Vite full control over their ESM graph and avoids
  // "require() of ES module" errors that can arise when Node tries to resolve
  // CJS wrappers for these packages.
  ssr: {
    noExternal: ['@reown/appkit', '@reown/appkit-adapter-ethers', 'ethers'],
  },
});
