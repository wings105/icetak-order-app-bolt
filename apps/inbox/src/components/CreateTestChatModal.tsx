import { FormEvent, useState } from 'react';
import { FlaskConical, Loader2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `60${digits.slice(1)}`;
  return digits;
}

export function CreateTestChatModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('Zaim Test');
  const [phone, setPhone] = useState('60129554732');
  const [courier, setCourier] = useState('SPX');
  const [tracking, setTracking] = useState('SPX123456789');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const normalizedPhone = normalizePhone(phone);
      if (!name.trim() || normalizedPhone.length < 10) throw new Error('Nama dan nombor sendiri diperlukan.');

      const { data: found } = await supabase
        .from('customer_identities')
        .select('customer_id')
        .eq('channel', 'whatsapp')
        .eq('normalized_phone', normalizedPhone)
        .maybeSingle();

      let customerId = found?.customer_id as string | undefined;
      if (!customerId) {
        const { data: customer, error: customerError } = await supabase
          .from('customers')
          .insert({ display_name: name.trim(), notes: 'TEST CHAT' })
          .select('id')
          .single();
        if (customerError) throw customerError;
        customerId = customer.id;

        const { error: identityError } = await supabase.from('customer_identities').insert({
          customer_id: customerId,
          channel: 'whatsapp',
          external_id: normalizedPhone,
          normalized_phone: normalizedPhone,
          is_verified: true,
          match_confidence: 'test',
          metadata: { test_chat: true },
        });
        if (identityError) throw identityError;
      }

      const oldTime = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
      const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .insert({
          customer_id: customerId,
          channel: 'whatsapp',
          external_conversation_id: `test-wa-${Date.now()}`,
          external_customer_id: normalizedPhone,
          status: 'open',
          priority: 'normal',
          last_message_at: oldTime,
          last_inbound_at: oldTime,
          last_message_sender: 'customer',
          unread_count: 1,
          needs_reply: true,
          archived: false,
          metadata: { test_chat: true, courier, tracking_number: tracking.trim() },
        })
        .select('id')
        .single();
      if (conversationError) throw conversationError;

      const { error: messageError } = await supabase.from('messages').insert({
        conversation_id: conversation.id,
        channel: 'whatsapp',
        provider_message_id: `test-${Date.now()}`,
        direction: 'inbound',
        sender_type: 'customer',
        message_type: 'text',
        text_content: `TEST CHAT: update tracking ${courier} ${tracking.trim()}`,
        status: 'received',
        sent_at: oldTime,
        created_at: oldTime,
      });
      if (messageError) throw messageError;

      onCreated();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Gagal mencipta test chat.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
    <form onSubmit={submit} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
        <div><h2 className="font-semibold">Cipta Test Chat</h2><p className="mt-1 text-xs text-[var(--text-secondary)]">Gunakan nombor sendiri. Window ditetapkan tamat 26 jam.</p></div>
        <button type="button" onClick={onClose} className="p-2 text-[var(--text-secondary)]"><X size={18} /></button>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nama" className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm" />
        <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Nombor sendiri" className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm" />
        <select value={courier} onChange={(event) => setCourier(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm"><option>SPX</option><option>J&amp;T</option><option>PosLaju</option></select>
        <input value={tracking} onChange={(event) => setTracking(event.target.value)} placeholder="Tracking number" className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm" />
      </div>
      {error && <p className="mx-5 mb-4 rounded-lg bg-red-950/40 p-3 text-xs text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4"><button type="button" onClick={onClose} className="rounded-lg bg-[var(--surface-muted)] px-4 py-2 text-sm">Batal</button><button disabled={busy} className="flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />} Cipta Test Chat</button></div>
    </form>
  </div>;
}

