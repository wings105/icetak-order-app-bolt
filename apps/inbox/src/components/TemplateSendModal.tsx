import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Send, X } from 'lucide-react';
import type { Conversation } from '../types';
import { supabase } from '../lib/supabase';
import { buildTrackingUrl, countTemplateVariables, inferTemplateField, SmartField } from '../lib/templateFields';

interface TemplateRecord {
  name?: string;
  status?: string;
  category?: string;
  components?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface TemplateSendModalProps {
  conversation: Conversation;
  onClose: () => void;
  onSent?: () => void;
}

function extractTemplates(payload: unknown): TemplateRecord[] {
  if (Array.isArray(payload)) return payload as TemplateRecord[];
  if (!payload || typeof payload !== 'object') return [];
  const object = payload as Record<string, unknown>;
  for (const key of ['templates', 'data', 'items', 'results']) if (Array.isArray(object[key])) return object[key] as TemplateRecord[];
  return [];
}

function describe(template?: TemplateRecord) {
  const components = template?.components ?? [];
  const body = components.find((component) => String(component.type ?? '').toUpperCase() === 'BODY');
  const bodyText = typeof body?.text === 'string' ? body.text : '';
  const fields: SmartField[] = [];
  for (let index = 1; index <= countTemplateVariables(bodyText); index += 1) fields.push(inferTemplateField(bodyText, index));
  const buttonGroup = components.find((component) => String(component.type ?? '').toUpperCase() === 'BUTTONS');
  const buttons = Array.isArray(buttonGroup?.buttons) ? buttonGroup!.buttons as Record<string, unknown>[] : [];
  buttons.forEach((button, buttonIndex) => {
    if (String(button.type ?? '').toUpperCase() !== 'URL') return;
    for (let index = 1; index <= countTemplateVariables(button.url); index += 1) fields.push({ key: `u${buttonIndex}-${index}`, label: `Dynamic URL button ${buttonIndex + 1}`, hint: 'Isi bahagian dinamik sahaja', kind: 'url_suffix' });
  });
  return { bodyText, fields };
}

function renderBody(body: string, fields: SmartField[], values: Record<string, string>) {
  let cursor = 0;
  const bodyFields = fields.filter((field) => field.key.startsWith('b'));
  return body.replace(/\{\{\d+\}\}/g, () => values[bodyFields[cursor++]?.key] || '[belum isi]');
}

function providerMessageId(payload: Record<string, unknown>): string | null {
  const values = [
    payload.message_id,
    payload.id,
    (payload.data as Record<string, unknown> | undefined)?.message_id,
    ((payload.messages as Array<Record<string, unknown>> | undefined)?.[0])?.id,
  ];
  const found = values.find((value) => typeof value === 'string' && value.trim());
  return found ? String(found) : null;
}

async function loadApprovedTemplates() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sesi staf tamat.');
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wasapflow-templates?action=list`, {
    headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Error ${response.status}`);
  return extractTemplates(payload).filter((template) => String(template.status ?? '').toUpperCase() === 'APPROVED');
}

export function TemplateSendModal({ conversation, onClose, onSent }: TemplateSendModalProps) {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadApprovedTemplates().then((approved) => {
      setTemplates(approved);
      if (approved[0]?.name) setSelectedName(String(approved[0].name));
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Gagal memuatkan template.')).finally(() => setLoading(false));
  }, []);

  const selected = useMemo(() => templates.find((template) => template.name === selectedName), [templates, selectedName]);
  const info = useMemo(() => describe(selected), [selected]);

  useEffect(() => {
    const metadata = conversation.metadata ?? {};
    const metadataCourier = String(metadata.courier ?? metadata.shipping_provider ?? '');
    const metadataTracking = String(metadata.tracking_number ?? metadata.trackingNumber ?? '');
    const orderTracking = conversation.shopeeOrder?.trackingNumber ?? '';
    const defaults: Record<string, string> = {};

    info.fields.forEach((field) => {
      if (field.kind === 'name') defaults[field.key] = conversation.customer.name;
      else if (field.kind === 'courier') defaults[field.key] = metadataCourier;
      else if (field.kind === 'tracking') defaults[field.key] = metadataTracking || orderTracking;
      else if (field.kind === 'text') defaults[field.key] = conversation.orderId ?? conversation.shopeeOrder?.orderId ?? '';
      else defaults[field.key] = '';
    });
    setValues(defaults);
  }, [selectedName, info.fields.length, conversation.id]);

  const courierField = info.fields.find((field) => field.kind === 'courier');
  const trackingField = info.fields.find((field) => field.kind === 'tracking');
  const urlField = info.fields.find((field) => field.kind === 'tracking_url');
  const courier = courierField ? values[courierField.key] ?? '' : '';
  const tracking = trackingField ? values[trackingField.key] ?? '' : '';

  useEffect(() => {
    if (!urlField) return;
    const url = buildTrackingUrl(courier, tracking);
    if (!url) return;
    setValues((current) => current[urlField.key] === url ? current : { ...current, [urlField.key]: url });
  }, [courier, tracking, urlField?.key]);

  async function handleSend() {
    if (!selected?.name || !conversation.customer.phone) return;
    const ordered = info.fields.map((field) => values[field.key] ?? '');
    if (ordered.some((value) => !value.trim())) return setError('Lengkapkan semua variable template.');

    setSending(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesi staf tamat.');
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wasapflow-template-send`, {
        method: 'POST',
        headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: conversation.customer.phone, name: selected.name, values: ordered }),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(String(payload.error || `Error ${response.status}`));

      const now = new Date().toISOString();
      const rendered = renderBody(info.bodyText || `[Template: ${selected.name}]`, info.fields, values);
      const providerId = providerMessageId(payload);
      const { error: insertError } = await supabase.from('messages').insert({
        conversation_id: conversation.id,
        order_id: conversation.orderId ?? null,
        channel: 'whatsapp',
        provider_message_id: providerId,
        direction: 'outbound',
        sender_type: 'seller',
        message_type: 'template',
        text_content: rendered,
        status: 'sent',
        sent_at: now,
        created_at: now,
      });
      if (insertError) throw insertError;

      const metadata = {
        ...(conversation.metadata ?? {}),
        courier,
        tracking_number: tracking,
        last_template_name: selected.name,
        last_outbound_provider_id: providerId,
      };
      const { error: updateError } = await supabase.from('conversations').update({
        last_message_at: now,
        last_outbound_at: now,
        last_message_sender: 'seller',
        needs_reply: false,
        unread_count: 0,
        metadata,
        updated_at: now,
      }).eq('id', conversation.id);
      if (updateError) throw updateError;

      onSent?.();
      onClose();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Template gagal dihantar.');
    } finally { setSending(false); }
  }

  return <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
    <div className="w-full max-w-2xl rounded-2xl border border-[#2a3942] bg-[#111b21] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-[#2a3942] px-5 py-4"><div><h2 className="font-semibold text-[#e9edef]">Pilih Template WhatsApp</h2><p className="mt-1 text-xs text-[#8696a0]">APPROVED sahaja. Maklumat order diisi automatik bila tersedia.</p></div><button onClick={onClose} className="rounded p-2 text-[#8696a0] hover:bg-[#202c33]"><X size={18} /></button></div>
      <div className="grid gap-4 p-5 md:grid-cols-[0.9fr_1.1fr]">
        <div>
          {loading ? <div className="flex h-24 items-center justify-center text-[#8696a0]"><Loader2 className="animate-spin" /></div> : templates.length === 0 ? <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-300">Belum ada template APPROVED.</div> : <select value={selectedName} onChange={(event) => setSelectedName(event.target.value)} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm text-[#e9edef]">{templates.map((template) => <option key={String(template.name)} value={String(template.name)}>{String(template.name)} · {String(template.category ?? '—')}</option>)}</select>}
          <div className="mt-4 space-y-3">{info.fields.map((field) => <div key={field.key}><label className="mb-1 block text-xs text-[#aebac1]">{field.label}</label><input value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.hint} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm text-[#e9edef]" /></div>)}</div>
        </div>
        <div className="rounded-xl border border-[#2a3942] bg-[#0b141a] p-4"><p className="mb-3 text-xs font-medium uppercase tracking-wide text-[#8696a0]">Preview</p><div className="ml-auto max-w-[92%] rounded-lg bg-[#005c4b] px-3 py-2 text-sm leading-relaxed text-white shadow"><div className="whitespace-pre-wrap">{renderBody(info.bodyText || 'Pilih template untuk melihat preview.', info.fields, values)}</div><div className="mt-2 text-right text-[10px] text-[#9cc7bd]">sekarang ✓</div></div><div className="mt-5 rounded-lg bg-[#202c33] p-3 text-xs text-[#aebac1]"><p><span className="text-[#8696a0]">Kepada:</span> {conversation.customer.name}</p><p className="mt-1"><span className="text-[#8696a0]">Telefon:</span> {conversation.customer.phone ?? 'Tiada nombor'}</p>{conversation.orderId && <p className="mt-1"><span className="text-[#8696a0]">Order:</span> {conversation.orderId}</p>}</div></div>
      </div>
      {error && <div className="mx-5 mb-4 flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-xs text-red-300"><AlertCircle size={15} />{error}</div>}
      <div className="flex justify-end gap-2 border-t border-[#2a3942] px-5 py-4"><button onClick={onClose} className="rounded-lg bg-[#202c33] px-4 py-2 text-sm text-[#e9edef]">Batal</button><button onClick={handleSend} disabled={loading || sending || !selected?.name || !conversation.customer.phone} className="flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Hantar Template</button></div>
    </div>
  </div>;
}

