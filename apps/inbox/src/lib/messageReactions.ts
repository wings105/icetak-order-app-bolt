import { supabase } from './supabase';

export const MESSAGE_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export async function reactToMessage(messageId: string, emoji: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Sesi pengguna tidak tersedia.');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const response = await fetch(`${supabaseUrl}/functions/v1/wasapflow-react-message`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message_id: messageId, emoji }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error ?? `Gagal menghantar reaction (${response.status})`));

  await supabase
    .from('messages')
    .update({ reactions: { seller: emoji } })
    .eq('id', messageId);
}

