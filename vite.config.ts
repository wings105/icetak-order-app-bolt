import { defineConfig } from 'vite';
import path from 'path';
import { execFileSync } from 'node:child_process';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'build-isolated-inbox',
    apply: 'build',
    closeBundle() {
      const cwd = path.resolve(__dirname, 'apps/inbox');
      execFileSync('npm', ['ci', '--include=dev'], { cwd, stdio: 'inherit' });
      execFileSync('npm', ['run', 'build'], { cwd, stdio: 'inherit' });
    },
  }],
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
