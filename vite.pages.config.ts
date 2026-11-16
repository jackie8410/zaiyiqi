import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: root + 'web',
  publicDir: root + 'public',
  envDir: false,
  plugins: [react()],
  resolve: {alias: {'@': root}},
  define: {'__ALBUM_API_ORIGIN__': JSON.stringify('https://album-api.learnforeverything.com')},
  css: {postcss: root},
  build: {
    outDir: root + 'dist-pages',
    emptyOutDir: true,
    rollupOptions: {input: {
      home: root + 'web/index.html',
      account: root + 'web/account/index.html',
      privacy: root + 'web/privacy/index.html',
    }},
  },
});
