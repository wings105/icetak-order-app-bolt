import { useEffect, useState } from 'react';
import { Save, UserRound } from 'lucide-react';
import type { Conversation } from '../types';
import { getGoogleContactCacheByPhone, GoogleContactCacheRow, normalizePhone, saveGoogleContactCache } from '../lib/googleContactCache';

interface Props {
  conversation: Conversation;
  onSaved?: () => void;
}

export function ContactCacheCard({ conversation, onSaved }: Props) {
  const phone = conversation.customer.phone ?? '';
  const normalized = normalizePhone(phone);
  const [row, setRow] = useState<GoogleContactCacheRow | null>(null);
  const [name, setName] = useState(conversation.customer.name || '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!phone) return;
      try {
        const existing = await getGoogleContactCacheByPhone(phone);
        if (cancelled) return;
        setRow(existing);
        setName(existing?.display_name || conversation.customer.name || '');
      } catch {
        if (!cancelled) setStatus('Gagal baca cache.');
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [phone, conversation.customer.name]);

  async function handleSave() {
    if (!phone) return;
    setBusy(true);
    setStatus(null);
    try {
      await saveGoogleContactCache({ id: row?.id, display_name: name, phone_raw: phone, google_contact_id: row?.google_contact_id ?? null });
      const latest = await getGoogleContactCacheByPhone(phone);
      setRow(latest);
      setStatus('Cache disimpan.');
      onSaved?.();
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'Gagal simpan cache.');
    } finally {
      setBusy(false);
    }
  }

  if (!phone) return null;

  return <div className="border-t border-[#2a3942] bg-[#111b21] p-3">
    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#8696a0]"><UserRound size={13} /> Contact Cache</div>
    <div className="space-y-2">
      <div className="text-[11px] text-[#667781]">Phone: {phone} · {normalized}</div>
      <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-[#3b4a54] bg-[#202c33] px-3 py-2 text-sm text-white outline-none focus:border-[#00a884]" placeholder="Nama contact" />
      <button onClick={handleSave} disabled={busy || !name.trim()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Save size={13} /> {busy ? 'Menyimpan...' : row ? 'Update cache name' : 'Save cache name'}</button>
      {status && <p className={`text-[11px] ${status.includes('Gagal') ? 'text-red-400' : 'text-[#8696a0]'}`}>{status}</p>}
    </div>
  </div>;
}

