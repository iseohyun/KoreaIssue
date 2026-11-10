import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { BUILD_TAG } from './src/version';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/KoreaIssues/' : '/',
  plugins: [react()],
  server: {
    port: 5174,
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-${BUILD_TAG}-[hash].js`,
        chunkFileNames: `assets/[name]-${BUILD_TAG}-[hash].js`,
        assetFileNames: `assets/[name]-${BUILD_TAG}-[hash].[ext]`,
      },
    },
  },
}));
