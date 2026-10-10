import { useEffect, useState } from 'react';
import { Archive, Palette, Plus, RotateCcw, Save, Tag as TagIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ManagedTag {
  id: string;
  name: string;
  slug: string;
  color: string;
  archived: boolean;
  usage_count?: number;
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function TagManager() {
  const [tags, setTags] = useState<ManagedTag[]>([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#667781');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    const [{ data: tagRows, error: tagError }, { data: links, error: linkError }] = await Promise.all([
      supabase.from('tags').select('id,name,slug,color,archived').order('name'),
      supabase.from('conversation_tags').select('tag_id'),
    ]);
    if (tagError) throw tagError;
    if (linkError) throw linkError;
    const counts = new Map<string, number>();
    for (const row of links ?? []) counts.set(row.tag_id, (counts.get(row.tag_id) ?? 0) + 1);
    setTags((tagRows ?? []).map((tag) => ({ ...tag, usage_count: counts.get(tag.id) ?? 0 })) as ManagedTag[]);
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((reason) => { setError(reason.message); setLoading(false); });
    const channel = supabase.channel('tag-manager-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tags' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_tags' }, reload)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function createTag() {
    const clean = name.trim().replace(/\s+/g, ' ');
    const slug = slugify(clean);
    if (!clean || !slug) return;
    setError(null);
    const { error: insertError } = await supabase.from('tags').insert({ name: clean, slug, color, archived: false });
    if (insertError) { setError(insertError.message); return; }
    setName('');
    setColor('#667781');
    await reload();
  }

  async function saveTag(tag: ManagedTag) {
    const clean = tag.name.trim().replace(/\s+/g, ' ');
    const slug = slugify(clean);
    if (!clean || !slug) return;
    setBusyId(tag.id);
    setError(null);
    const { error: updateError } = await supabase.from('tags').update({ name: clean, slug, color: tag.color, updated_at: new Date().toISOString() }).eq('id', tag.id);
    if (updateError) setError(updateError.message);
    await reload();
    setBusyId(null);
  }

  async function toggleArchive(tag: ManagedTag) {
    setBusyId(tag.id);
    const { error: updateError } = await supabase.from('tags').update({ archived: !tag.archived, updated_at: new Date().toISOString() }).eq('id', tag.id);
    if (updateError) setError(updateError.message);
    await reload();
    setBusyId(null);
  }

  const visible = tags.filter((tag) => showArchived || !tag.archived);

  return (
    <div className="h-full overflow-y-auto bg-[var(--canvas)] p-4 text-[var(--text)] sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-xl font-semibold">Custom Tags</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Rename, tukar warna dan archive tag. Urgent kekal sistem berasingan.</p></div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Tunjuk archived</label>
        </div>

        <div className="mb-4 grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-[1fr_130px_auto]">
          <input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createTag(); }} placeholder="Nama tag baru" className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm outline-none focus:border-[#00a884]" />
          <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text-secondary)]"><Palette size={15} /><input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-6 w-8 cursor-pointer border-0 bg-transparent" /></label>
          <button onClick={() => void createTag()} disabled={!name.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#00a884] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"><Plus size={15} /> Cipta</button>
        </div>

        {error && <div className="mb-3 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>}

        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          {loading ? <div className="p-10 text-center text-sm text-[var(--text-secondary)]">Memuatkan...</div> : visible.length === 0 ? <div className="p-10 text-center text-sm text-[var(--text-secondary)]">Tiada tag.</div> : visible.map((tag) => (
            <div key={tag.id} className={`grid gap-3 border-b border-[#202c33] p-4 last:border-b-0 sm:grid-cols-[1fr_125px_90px_auto_auto] sm:items-center ${tag.archived ? 'opacity-55' : ''}`}>
              <div className="flex items-center gap-2"><span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: tag.color }} /><input value={tag.name} onChange={(event) => setTags((rows) => rows.map((row) => row.id === tag.id ? { ...row, name: event.target.value } : row))} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm outline-none focus:border-[#00a884]" /></div>
              <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1.5 text-xs"><input type="color" value={tag.color} onChange={(event) => setTags((rows) => rows.map((row) => row.id === tag.id ? { ...row, color: event.target.value } : row))} className="h-6 w-8 bg-transparent" /> {tag.color}</label>
              <span className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]"><TagIcon size={13} /> {tag.usage_count} chat</span>
              <button onClick={() => void saveTag(tag)} disabled={busyId === tag.id} className="inline-flex items-center justify-center gap-1 rounded-lg bg-[var(--surface-hover)] px-3 py-2 text-xs text-[var(--text)] hover:bg-[#3b4a54]"><Save size={13} /> Simpan</button>
              <button onClick={() => void toggleArchive(tag)} disabled={busyId === tag.id} className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs ${tag.archived ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'}`}>{tag.archived ? <RotateCcw size={13} /> : <Archive size={13} />}{tag.archived ? 'Aktifkan' : 'Archive'}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

