import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Loader2, LockKeyhole, LogOut } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    }).catch(() => {
      if (!mounted) return;
      setSession(null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) return;

    setSubmitting(true);
    setError(null);
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (loginError) setError(loginError.message);
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--surface)] text-[var(--text-secondary)]">
        <Loader2 className="animate-spin" size={30} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface)] px-4">
        <form onSubmit={handleLogin} className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-6 shadow-xl">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-full bg-[var(--bubble-out)] p-3 text-[#00d9a3]">
              <LockKeyhole size={24} />
            </div>
            <div>
              <h1 className="font-semibold text-[var(--text)]">Log masuk staf ICETAK</h1>
              <p className="text-xs text-[var(--text-secondary)]">Diperlukan untuk Test Mode dan operasi database.</p>
            </div>
          </div>

          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">E-mel</label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="mb-4 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[#00a884]"
            placeholder="staf@decocake.my"
          />

          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Kata laluan</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[#00a884]"
            placeholder="••••••••"
          />

          {error && <p className="mt-3 text-xs text-red-700 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#008f72] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            Log masuk
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="relative h-screen">
      <button
        onClick={() => supabase.auth.signOut()}
        title="Log keluar"
        className="absolute right-3 top-3 z-[100] rounded-full bg-[var(--surface-muted)] p-2 text-[var(--text-secondary)] shadow hover:text-[var(--text)]"
      >
        <LogOut size={16} />
      </button>
      {children}
    </div>
  );
}

