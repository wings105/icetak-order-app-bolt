import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const INBOX_URL = 'https://uujcqcsfghqkukaydruc.supabase.co';
const INBOX_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1amNxY3NmZ2hxa3VrYXlkcnVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzQ1NDksImV4cCI6MjA5NzcxMDU0OX0._9-_BUhp5eeoi_pB_aIZcWv-pSBNQ0y3bPvvScJgpko';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_INBOX_');
  const url = env.VITE_INBOX_SUPABASE_URL || INBOX_URL;
  const key = env.VITE_INBOX_SUPABASE_ANON_KEY || INBOX_ANON_KEY;
  if (new URL(url).hostname !== new URL(INBOX_URL).hostname) {
    throw new Error('Inbox must use its own Supabase project, not the shop database.');
  }
  return {
    base: '/inbox/',
    plugins: [react()],
    envPrefix: 'VITE_INBOX_',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(key),
    },
    build: { outDir: '../../dist/inbox', emptyOutDir: true },
  };
});
