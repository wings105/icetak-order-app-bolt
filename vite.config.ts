import { defineConfig } from 'vite';
import path from 'path';
import { execFileSync } from 'node:child_process';

export default defineConfig({
  // Absolute asset URLs are required for nested routes such as /roadmap/.
  base: '/',
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
    rollupOptions: {
      maxParallelFileOps: 128,
      input: {
        main: path.resolve(__dirname, 'index.html'),
        roadmap: path.resolve(__dirname, 'roadmap/index.html'),
      },
    },
  },
});
