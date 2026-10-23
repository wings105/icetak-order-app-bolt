import { defineConfig } from 'vite';
import path from 'path';
import { execFileSync } from 'node:child_process';

export default defineConfig({
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
    // The root mounts Admin V2; both package installs must share one React runtime.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@appdeploy/client': path.resolve(__dirname, 'src/appdeploy-client.ts'),
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      maxParallelFileOps: 128,
      input: { main: path.resolve(__dirname, 'index.html'), mockup: path.resolve(__dirname, 'mockup/index.html'), 'acrylic-production': path.resolve(__dirname, 'acrylic-production/index.html'), roadmap: path.resolve(__dirname, 'roadmap/index.html'), 'task-workspace': path.resolve(__dirname, 'task-workspace/index.html') },
    },
  },
});
