import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DynamicTemplateSender } from './DynamicTemplateSender';
import { TemplateManager } from './TemplateManager';

type Template = {
  name?: string;
  status?: string;
  language?: string | Record<string, unknown>;
  components?: Record<string, unknown>[];
};

function extract(payload: unknown): Template[] {
  if (Array.isArray(payload)) return payload as Template[];
  if (!payload || typeof payload !== 'object') return [];
  const value = payload as Record<string, unknown>;
  for (const key of ['templates', 'data', 'items', 'results']) if (Array.isArray(value[key])) return value[key] as Template[];
  return [];
}

export function TemplateManagerV2() {
  const [tab, setTab] = useState<'send' | 'manage'>('send');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesi staf tamat.');
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wasapflow-templates?action=list`, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Error ${response.status}`);
      setTemplates(extract(payload));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Gagal mendapatkan template.');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  return <div className="h-full overflow-y-auto bg-[#0b141a] text-[#e9edef]">
    <div className="sticky top-0 z-30 flex items-center justify-between border-b border-[#2a3942] bg-[#111b21] px-4 py-3">
      <div className="flex gap-2">
        <button onClick={() => setTab('send')} className={`rounded-lg px-4 py-2 text-sm ${tab === 'send' ? 'bg-[#00a884] text-white' : 'bg-[#202c33] text-[#aebac1]'}`}>Hantar Template</button>
        <button onClick={() => setTab('manage')} className={`rounded-lg px-4 py-2 text-sm ${tab === 'manage' ? 'bg-[#00a884] text-white' : 'bg-[#202c33] text-[#aebac1]'}`}>Cipta & Urus</button>
      </div>
      <button onClick={load} className="flex items-center gap-2 rounded-lg bg-[#202c33] px-3 py-2 text-xs"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Sync</button>
    </div>

    {tab === 'manage' ? <TemplateManager /> : <div className="mx-auto max-w-xl p-4 sm:p-6">
      {loading ? <div className="flex justify-center py-16 text-[#8696a0]"><Loader2 className="animate-spin" /></div> : error ? <div className="rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div> : <DynamicTemplateSender templates={templates} />}
    </div>}
  </div>;
}

