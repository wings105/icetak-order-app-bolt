import { useEffect, useState } from 'react';
import { ImageIcon, Plus, Save, Trash2, X } from 'lucide-react';
import { deleteSnippet, getSnippetImageUrl, QuickSnippet, removeSnippetImage, saveSnippet, uploadSnippetImage, useQuickSnippets } from '../lib/quickSnippets';

const emptyForm = { id: '', shortcut: '', title: '', message: '', category: '', active: true, image_path: '', image_name: '', image_mime: '' };

export function QuickSnippetManager() {
  const { snippets, loading, reload } = useQuickSnippets();
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!imageFile) return;
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  async function edit(snippet: QuickSnippet) {
    setImageFile(null);
    setForm({
      id: snippet.id,
      shortcut: snippet.shortcut,
      title: snippet.title,
      message: snippet.message,
      category: snippet.category ?? '',
      active: snippet.active,
      image_path: snippet.image_path ?? '',
      image_name: snippet.image_name ?? '',
      image_mime: snippet.image_mime ?? '',
    });
    setImagePreview(await getSnippetImageUrl(snippet.image_path).catch(() => null));
  }

  function reset() {
    setForm(emptyForm);
    setImageFile(null);
    setImagePreview(null);
    setError(null);
  }

  async function clearImage() {
    if (form.image_path) await removeSnippetImage(form.image_path).catch(() => undefined);
    setForm((old) => ({ ...old, image_path: '', image_name: '', image_mime: '' }));
    setImageFile(null);
    setImagePreview(null);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    let uploadedPath: string | null = null;
    try {
      let image = { path: form.image_path, name: form.image_name, mime: form.image_mime };
      if (imageFile) {
        const uploaded = await uploadSnippetImage(imageFile);
        uploadedPath = uploaded.path;
        image = uploaded;
      }
      await saveSnippet({ ...form, image_path: image.path || null, image_name: image.name || null, image_mime: image.mime || null });
      if (imageFile && form.image_path && form.image_path !== image.path) await removeSnippetImage(form.image_path).catch(() => undefined);
      reset();
      await reload();
    } catch (reason) {
      if (uploadedPath) await removeSnippetImage(uploadedPath).catch(() => undefined);
      setError(reason instanceof Error ? reason.message : 'Gagal simpan snippet.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(snippet: QuickSnippet) {
    if (!window.confirm('Padam snippet ini?')) return;
    await deleteSnippet(snippet.id, snippet.image_path);
    if (form.id === snippet.id) reset();
    await reload();
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--canvas)] p-4 text-[var(--text)] sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5"><h1 className="text-xl font-semibold">Quick Snippets</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Taip / dalam chat untuk masukkan teks atau gambar.</p></div>
        <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">{form.id ? 'Edit snippet' : 'Snippet baru'}</h2>{form.id && <button onClick={reset} className="text-[var(--text-secondary)]"><X size={17} /></button>}</div>
            <div className="space-y-3">
              <label className="block text-xs text-[var(--text-secondary)]">Shortcut<div className="mt-1 flex rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]"><span className="px-3 py-2 text-[var(--text-secondary)]">/</span><input value={form.shortcut} onChange={(event) => setForm((old) => ({ ...old, shortcut: event.target.value }))} className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none" placeholder="payment" /></div></label>
              <label className="block text-xs text-[var(--text-secondary)]">Tajuk<input value={form.title} onChange={(event) => setForm((old) => ({ ...old, title: event.target.value }))} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm outline-none focus:border-[#00a884]" /></label>
              <label className="block text-xs text-[var(--text-secondary)]">Kategori<input value={form.category} onChange={(event) => setForm((old) => ({ ...old, category: event.target.value }))} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm outline-none focus:border-[#00a884]" /></label>
              <label className="block text-xs text-[var(--text-secondary)]">Mesej<textarea rows={6} value={form.message} onChange={(event) => setForm((old) => ({ ...old, message: event.target.value }))} className="mt-1 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm outline-none focus:border-[#00a884]" placeholder="Boleh kosong jika gambar sahaja" /></label>

              <div>
                <p className="mb-1 text-xs text-[var(--text-secondary)]">Gambar pilihan</p>
                {imagePreview ? (
                  <div className="relative w-fit"><img src={imagePreview} alt="Snippet" className="max-h-36 max-w-full rounded-lg border border-[var(--border)] object-contain" /><button onClick={clearImage} className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white"><X size={12} /></button></div>
                ) : (
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-3 py-5 text-xs text-[var(--text-secondary)] hover:border-[#00a884]"><ImageIcon size={17} /> Pilih gambar<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /></label>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(event) => setForm((old) => ({ ...old, active: event.target.checked }))} /> Aktif</label>
              {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
              <button onClick={submit} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{form.id ? <Save size={15} /> : <Plus size={15} />}{saving ? 'Menyimpan...' : form.id ? 'Simpan perubahan' : 'Tambah snippet'}</button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            {loading ? <div className="p-8 text-center text-sm text-[var(--text-secondary)]">Memuatkan...</div> : snippets.length === 0 ? <div className="p-8 text-center text-sm text-[var(--text-secondary)]">Belum ada snippet.</div> : snippets.map((snippet) => (
              <div key={snippet.id} className="flex items-start gap-3 border-b border-[#202c33] p-4 last:border-b-0">
                <button onClick={() => void edit(snippet)} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-[#00a884]/15 px-2 py-1 font-mono text-sm font-semibold text-[#00a884]">/{snippet.shortcut}</span><span className="font-medium">{snippet.title}</span>{snippet.image_path && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-700 dark:text-sky-400">Gambar</span>}{snippet.category && <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">{snippet.category}</span>}{!snippet.active && <span className="text-[10px] text-amber-700 dark:text-amber-400">Tidak aktif</span>}</div>
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{snippet.message || '[Gambar sahaja]'}</p>
                </button>
                <button onClick={() => void remove(snippet)} className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-red-500/10 hover:text-red-400"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

