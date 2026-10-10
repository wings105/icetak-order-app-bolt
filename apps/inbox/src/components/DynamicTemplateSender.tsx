import { useEffect, useMemo, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { buildTrackingUrl, countTemplateVariables, inferTemplateField, SmartField } from '../lib/templateFields';

type Template = {
  name?: string;
  status?: string;
  language?: string | Record<string, unknown>;
  components?: Record<string, unknown>[];
};

function schema(template?: Template) {
  const parts = template?.components ?? [];
  const fields: SmartField[] = [];
  const body = parts.find((x) => String(x.type).toUpperCase() === 'BODY');
  const bodyText = typeof body?.text === 'string' ? body.text : '';
  for (let i = 1; i <= countTemplateVariables(bodyText); i++) fields.push(inferTemplateField(bodyText, i));
  const group = parts.find((x) => String(x.type).toUpperCase() === 'BUTTONS');
  const buttons = Array.isArray(group?.buttons) ? group!.buttons as Record<string, unknown>[] : [];
  buttons.forEach((button, buttonIndex) => {
    if (String(button.type).toUpperCase() !== 'URL') return;
    for (let i = 1; i <= countTemplateVariables(button.url); i++) {
      fields.push({ key: `u${buttonIndex}-${i}`, label: `Dynamic URL button ${buttonIndex + 1}`, hint: 'Isi bahagian dinamik sahaja', kind: 'url_suffix' });
    }
  });
  return { fields, body: bodyText };
}

function lang(template?: Template) {
  const value = template?.language;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return String(value.code ?? value.language_code ?? 'ms');
  return 'ms';
}

export function DynamicTemplateSender({ templates }: { templates: Template[] }) {
  const approved = useMemo(() => templates.filter((x) => String(x.status).toUpperCase() === 'APPROVED'), [templates]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('60129554732');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { if (!name && approved[0]?.name) setName(String(approved[0].name)); }, [approved, name]);
  const selected = approved.find((x) => x.name === name);
  const info = useMemo(() => schema(selected), [selected]);
  useEffect(() => setValues(Object.fromEntries(info.fields.map((f) => [f.key, '']))), [name]);

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

  const ordered = info.fields.map((f) => values[f.key] ?? '');
  let previewIndex = 0;
  const preview = info.body.replace(/\{\{\d+\}\}/g, () => ordered[previewIndex++] || '[belum isi]');

  async function submit() {
    if (!selected || ordered.some((v) => !v.trim())) return setMessage('Lengkapkan semua variable.');
    setBusy(true); setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesi staf tamat.');
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wasapflow-template-send`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, name: selected.name, values: ordered }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Error ${response.status}`);
      const providerId = payload.message_id ?? payload.messages?.[0]?.id ?? payload.data?.message_id ?? payload.id;
      setMessage(providerId ? `Berjaya dihantar. Message ID: ${providerId}` : 'Berjaya dihantar ke nombor ujian.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal menghantar.');
    } finally { setBusy(false); }
  }

  return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)]">
    <h2 className="font-semibold">Test Send Pintar</h2>
    <p className="mt-1 text-xs text-[var(--text-secondary)]">Variable dan tracking URL dikesan automatik.</p>
    <select value={name} onChange={(e) => setName(e.target.value)} className="mt-4 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm">
      {approved.map((x) => <option key={String(x.name)} value={String(x.name)}>{String(x.name)} · {lang(x)}</option>)}
    </select>
    <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm" placeholder="Nombor WhatsApp" />
    <div className="mt-3 space-y-3">{info.fields.map((field) => <div key={field.key}><label className="mb-1 block text-xs text-[var(--text-secondary)]">{field.label}</label><input value={values[field.key] ?? ''} onChange={(e) => setValues((old) => ({ ...old, [field.key]: e.target.value }))} placeholder={field.hint} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm" /></div>)}</div>
    <div className="mt-4 rounded-lg bg-[var(--canvas)] p-3 text-sm whitespace-pre-wrap">{preview || 'Template tiada body variable.'}</div>
    <button onClick={submit} disabled={busy || !selected} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Hantar ke Nombor Ujian</button>
    {message && <p className="mt-3 break-words text-xs text-amber-700 dark:text-amber-300">{message}</p>}
  </div>;
}
