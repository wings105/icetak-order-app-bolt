import { FormEvent, useEffect, useState } from 'react';
import { Loader2, Save, Webhook } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function WebhookForwardSettings() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.functions.invoke('webhook-forward-settings', { method: 'GET' }).then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) setError(loadError.message);
      else setUrl(String(data?.url || ''));
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    const { data, error: saveError } = await supabase.functions.invoke('webhook-forward-settings', {
      body: { url: url.trim() },
    });
    if (saveError || data?.error) setError(data?.error || saveError?.message || 'Gagal menyimpan webhook URL');
    else {
      setUrl(String(data?.url || ''));
      setNotice(data?.url ? 'Webhook forward URL disimpan.' : 'Webhook forward dimatikan.');
    }
    setSaving(false);
  }

  return <div className="h-full overflow-y-auto bg-[#0b141a] p-4 sm:p-6">
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center gap-3">
        <div className="rounded-xl bg-[#005c4b] p-3 text-[#00d9a3]"><Webhook size={24} /></div>
        <div><h1 className="text-xl font-semibold text-[#e9edef]">Webhook Forward</h1><p className="text-sm text-[#8696a0]">Hantar salinan payload raw WasapFlow ke automation luar.</p></div>
      </div>
      <form onSubmit={save} className="rounded-2xl border border-[#2a3942] bg-[#202c33] p-5 shadow-xl">
        <label className="mb-2 block text-sm font-medium text-[#d1d7db]">External Webhook URL</label>
        <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} disabled={loading || saving} placeholder="https://automation.example.com/webhook/..." className="w-full rounded-lg border border-[#3b4a54] bg-[#111b21] px-3 py-2.5 text-sm text-[#e9edef] outline-none focus:border-[#00a884] disabled:opacity-60" />
        <p className="mt-2 text-xs text-[#8696a0]">Kosongkan URL dan simpan untuk hentikan forward. Payload dihantar terus sebagai POST JSON tanpa custom header.</p>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {notice && <p className="mt-3 text-sm text-[#00d9a3]">{notice}</p>}
        <button type="submit" disabled={loading || saving} className="mt-5 flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#008f72] disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{saving ? 'Menyimpan...' : 'Simpan URL'}
        </button>
      </form>
    </div>
  </div>;
}

