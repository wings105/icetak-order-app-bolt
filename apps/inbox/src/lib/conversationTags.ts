import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface CustomTag {
  id: string;
  name: string;
  slug: string;
  color: string;
  assignmentSource?: string;
  assignedAt?: string;
}

export interface ConversationTagMap {
  [conversationId: string]: CustomTag[];
}

interface ConversationTagLinkRow {
  conversation_id: string;
  tag_id: string;
  source: string;
  created_at: string;
}

export function useConversationTags() {
  const [tags, setTags] = useState<CustomTag[]>([]);
  const [byConversation, setByConversation] = useState<ConversationTagMap>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [{ data: tagRows, error: tagError }, { data: linkRows, error: linkError }] = await Promise.all([
      supabase.from('tags').select('id,name,slug,color').eq('archived', false).order('name'),
      supabase.from('conversation_tags').select('conversation_id,tag_id,source,created_at'),
    ]);
    if (tagError) throw tagError;
    if (linkError) throw linkError;

    const allTags = (tagRows ?? []) as CustomTag[];
    const tagById = new Map(allTags.map((tag) => [tag.id, tag]));
    const map: ConversationTagMap = {};
    for (const row of (linkRows ?? []) as ConversationTagLinkRow[]) {
      const tag = tagById.get(row.tag_id);
      if (!tag) continue;
      if (!map[row.conversation_id]) map[row.conversation_id] = [];
      map[row.conversation_id].push({ ...tag, assignmentSource: row.source, assignedAt: row.created_at });
    }
    setTags(allTags);
    setByConversation(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload().catch(() => setLoading(false));
    const channel = supabase
      .channel('icetak-custom-tags-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tags' }, () => reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_tags' }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [reload]);

  return { tags, byConversation, loading, reload };
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export async function createAndAssignTag(conversationId: string, name: string): Promise<void> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return;
  const slug = slugify(clean);
  if (!slug) throw new Error('Nama tag tidak sah.');

  let { data: tag, error } = await supabase.from('tags').select('id').eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!tag) {
    const created = await supabase.from('tags').insert({ name: clean, slug }).select('id').single();
    if (created.error) throw created.error;
    tag = created.data;
  }

  const assigned = await supabase.from('conversation_tags').upsert({ conversation_id: conversationId, tag_id: tag.id, source: 'manual' }, { onConflict: 'conversation_id,tag_id', ignoreDuplicates: true });
  if (assigned.error) throw assigned.error;
}

export async function assignTag(conversationId: string, tagId: string): Promise<void> {
  const { error } = await supabase.from('conversation_tags').upsert({ conversation_id: conversationId, tag_id: tagId, source: 'manual' }, { onConflict: 'conversation_id,tag_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function removeTag(conversationId: string, tagId: string): Promise<void> {
  const { error } = await supabase.from('conversation_tags').delete().eq('conversation_id', conversationId).eq('tag_id', tagId);
  if (error) throw error;
}

