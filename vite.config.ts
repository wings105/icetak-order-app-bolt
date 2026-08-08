import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@appdeploy/client': path.resolve(__dirname, 'src/appdeploy-client.ts'),
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: { maxParallelFileOps: 128 },
  },
});
