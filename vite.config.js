import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

// `vite build --mode demo` (npm run build:preview) builds the sample-data demo
// into one self-contained HTML file. Any build with VITE_DEMO=1 swaps
// src/api.js for the in-memory src/demo/api.js, so supabase-js is not bundled.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const demo = env.VITE_DEMO === '1' || mode === 'demo';
  const realApi = resolve(__dirname, 'src/api.js');
  const demoApi = resolve(__dirname, 'src/demo/api.js');

  const swapApi = {
    name: 'cardfile-demo-api',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || importer === demoApi) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && resolved.id === realApi) return demoApi;
      return null;
    },
  };

  return {
    plugins: [react(), ...(demo ? [swapApi] : []), ...(mode === 'demo' ? [viteSingleFile()] : [])],
    define: demo ? { 'import.meta.env.VITE_DEMO': JSON.stringify('1') } : {},
    build: mode === 'demo' ? { outDir: 'dist-preview', emptyOutDir: true } : {},
    test: { environment: 'node', include: ['src/**/*.test.js'] },
  };
});
