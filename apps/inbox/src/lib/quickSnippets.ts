import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface QuickSnippet {
  id: string;
  shortcut: string;
  title: string;
  message: string;
  category?: string | null;
  active: boolean;
  sort_order: number;
  image_path?: string | null;
  image_name?: string | null;
  image_mime?: string | null;
}

function normalizeShortcut(value: string) {
  return value.trim().replace(/^\/+/, '').toLowerCase().replace(/\s+/g, '-');
}

const selectFields = 'id,shortcut,title,message,category,active,sort_order,image_path,image_name,image_mime';

export function useQuickSnippets() {
  const [snippets, setSnippets] = useState<QuickSnippet[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('quick_snippets').select(selectFields).order('sort_order').order('shortcut');
    if (error) throw error;
    setSnippets((data ?? []) as QuickSnippet[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload().catch(() => setLoading(false));
    const channel = supabase.channel('icetak-quick-snippets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quick_snippets' }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [reload]);

  return { snippets, loading, reload };
}

export async function uploadSnippetImage(file: File): Promise<{ path: string; name: string; mime: string }> {
  if (!file.type.startsWith('image/')) throw new Error('Hanya fail gambar diterima.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Gambar terlalu besar. Had maksimum 5 MB.');
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `${Date.now()}-${crypto.randomUUID()}-${safe || `image.${ext}`}`;
  const { error } = await supabase.storage.from('snippet-media').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return { path, name: file.name, mime: file.type };
}

export async function removeSnippetImage(path?: string | null) {
  if (!path) return;
  const { error } = await supabase.storage.from('snippet-media').remove([path]);
  if (error) throw error;
}

export async function getSnippetImageUrl(path?: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('snippet-media').createSignedUrl(path, 60 * 30);
  if (error) throw error;
  return data.signedUrl;
}

export async function saveSnippet(input: Partial<QuickSnippet> & Pick<QuickSnippet, 'shortcut' | 'title' | 'message'>) {
  const payload = {
    shortcut: normalizeShortcut(input.shortcut),
    title: input.title.trim(),
    message: input.message,
    category: input.category?.trim() || null,
    active: input.active ?? true,
    sort_order: input.sort_order ?? 0,
    image_path: input.image_path ?? null,
    image_name: input.image_name ?? null,
    image_mime: input.image_mime ?? null,
    updated_at: new Date().toISOString(),
  };
  if (!payload.shortcut || !payload.title || (!payload.message.trim() && !payload.image_path)) throw new Error('Shortcut, tajuk dan mesej atau gambar diperlukan.');

  if (input.id) {
    const { error } = await supabase.from('quick_snippets').update(payload).eq('id', input.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('quick_snippets').insert(payload);
  if (error) throw error;
}

export async function deleteSnippet(id: string, imagePath?: string | null) {
  const { error } = await supabase.from('quick_snippets').delete().eq('id', id);
  if (error) throw error;
  if (imagePath) await removeSnippetImage(imagePath).catch(() => undefined);
}

