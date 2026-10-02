import { supabase } from './supabase';

export async function markConversationReplied(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ needs_reply: false, unread_count: 0 })
    .eq('id', conversationId);
  if (error) throw new Error(error.message);
}

export async function markConversationUnread(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ unread_count: 1 })
    .eq('id', conversationId);
  if (error) throw new Error(error.message);
}

export async function setConversationArchived(conversationId: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ archived, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) throw new Error(error.message);
}

export async function setConversationUrgent(conversationId: string, urgent: boolean): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({
      priority: urgent ? 'urgent' : 'normal',
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);
  if (error) throw new Error(error.message);
}

