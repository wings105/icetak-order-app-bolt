import { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Image as ImageIcon,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Video,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface TemplateRecord {
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  quality_score?: string;
  components?: unknown[];
  [key: string]: unknown;
}

type HeaderType = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
type ButtonType = 'NONE' | 'URL' | 'PHONE_NUMBER' | 'QUICK_REPLY';

const META_TEMPLATE_MANAGER_URL = 'https://business.facebook.com/wa/manage/message-templates/';

function extractTemplates(payload: unknown): TemplateRecord[] {
  if (Array.isArray(payload)) return payload as TemplateRecord[];
  if (!payload || typeof payload !== 'object') return [];
  const object = payload as Record<string, unknown>;
  for (const key of ['templates', 'data', 'items', 'results']) {
    if (Array.isArray(object[key])) return object[key] as TemplateRecord[];
  }
  return [];
}

async function callTemplateFunction(action: string, init?: RequestInit, extraQuery = '') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sesi staf tidak ditemui. Sila log masuk semula.');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const response = await fetch(
    `${supabaseUrl}/functions/v1/wasapflow-templates?action=${encodeURIComponent(action)}${extraQuery}`,
    {
      ...init,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : `WasapFlow error ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function renderPreview(body: string, examplesText: string) {
  const examples = examplesText.split('\n').map((value) => value.trim()).filter(Boolean);
  return body.replace(/\{\{(\d+)\}\}/g, (_match, rawIndex) => {
    const index = Number(rawIndex) - 1;
    return examples[index] || `[var${index + 1}]`;
  });
}

function TemplatePhonePreview(props: {
  headerType: HeaderType;
  headerText: string;
  headerUrl: string;
  body: string;
  examples: string;
  footer: string;
  buttonType: ButtonType;
  buttonText: string;
  language: string;
  category: string;
}) {
  const previewBody = renderPreview(props.body, props.examples);
  return (
    <div className="rounded-3xl border-4 border-[#25333b] bg-black p-2 shadow-2xl">
      <div className="overflow-hidden rounded-[1.35rem] bg-[#0b141a]">
        <div className="flex items-center gap-3 border-b border-[#22323b] bg-[#202c33] px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00a884] text-sm font-semibold text-white">CP</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Customer Preview</p>
            <p className="text-[10px] text-[#8696a0]">WhatsApp Template Preview</p>
          </div>
        </div>
        <div className="min-h-[380px] bg-[#0b141a] p-4">
          <p className="mb-2 text-center text-[10px] text-[#8696a0]">Template Preview</p>
          <div className="ml-auto max-w-[90%] overflow-hidden rounded-lg bg-[#005c4b] shadow">
            {props.headerType === 'TEXT' && props.headerText && (
              <div className="px-3 pt-3 text-sm font-semibold text-white">{props.headerText}</div>
            )}
            {props.headerType === 'IMAGE' && (
              <div className="flex h-36 items-center justify-center bg-[#12332e] text-[#b8d8d1]">
                {props.headerUrl ? <img src={props.headerUrl} alt="Header preview" className="h-full w-full object-cover" /> : <ImageIcon size={34} />}
              </div>
            )}
            {props.headerType === 'VIDEO' && <div className="flex h-32 items-center justify-center bg-[#12332e] text-[#b8d8d1]"><Video size={34} /></div>}
            {props.headerType === 'DOCUMENT' && <div className="flex h-24 items-center justify-center gap-2 bg-[#12332e] text-[#b8d8d1]"><FileText size={28} /><span className="text-xs">Document</span></div>}
            <div className="whitespace-pre-wrap px-3 py-2 text-sm leading-relaxed text-white">{previewBody || 'Tulis body template...'}</div>
            {props.footer && <div className="px-3 pb-2 text-[11px] text-[#aebac1]">{props.footer}</div>}
            <div className="px-3 pb-2 text-right text-[10px] text-[#8eb8ae]">10:24 PM ✓✓</div>
            {props.buttonType !== 'NONE' && props.buttonText && (
              <div className="border-t border-white/10 px-3 py-2 text-center text-xs font-medium text-[#53bdeb]">{props.buttonText}</div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between px-1 text-[10px] text-[#8696a0]">
        <span>Ini hanya simulasi paparan customer.</span>
        <span>{props.language} · {props.category}</span>
      </div>
    </div>
  );
}

export function TemplateManager() {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [showCreate, setShowCreate] = useState(false);

  const [createName, setCreateName] = useState('order_confirmed');
  const [createLanguage, setCreateLanguage] = useState('ms');
  const [createCategory, setCreateCategory] = useState('UTILITY');
  const [headerType, setHeaderType] = useState<HeaderType>('NONE');
  const [headerText, setHeaderText] = useState('');
  const [headerUrl, setHeaderUrl] = useState('');
  const [bodyText, setBodyText] = useState('Hai {{1}}, order {{2}} telah diterima.');
  const [bodyExamples, setBodyExamples] = useState('Ali\nORD123');
  const [footerText, setFooterText] = useState('Terima kasih kerana memilih ICETAK.');
  const [buttonType, setButtonType] = useState<ButtonType>('NONE');
  const [buttonText, setButtonText] = useState('Lihat Order');
  const [buttonValue, setButtonValue] = useState('https://decocake.my/order/{{1}}');
  const [creating, setCreating] = useState(false);

  const [testTemplate, setTestTemplate] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [testVariables, setTestVariables] = useState('');
  const [sending, setSending] = useState(false);

  async function loadTemplates() {
    setLoading(true);
    setError(null);
    try {
      const payload = await callTemplateFunction('list', { method: 'GET' });
      setTemplates(extractTemplates(payload));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Gagal mendapatkan template.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTemplates(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((template) => {
      const templateStatus = String(template.status ?? '').toUpperCase();
      if (status !== 'ALL' && templateStatus !== status) return false;
      if (!q) return true;
      return [template.name, template.language, template.category, template.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [templates, query, status]);

  async function handleCreateTemplate() {
    const name = createName.trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(name)) {
      setError('Nama template hanya boleh guna huruf kecil, nombor dan underscore.');
      return;
    }

    const placeholders = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
    const parameterCount = placeholders.length ? Math.max(...placeholders) : 0;
    const examples = bodyExamples.split('\n').map((value) => value.trim()).filter(Boolean);
    if (parameterCount !== examples.length) {
      setError(`Body ada ${parameterCount} variable tetapi contoh ada ${examples.length}.`);
      return;
    }

    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      let headerHandle: string | undefined;
      if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) {
        if (!headerUrl.trim()) throw new Error('URL sample header diperlukan.');
        const mimeType = headerType === 'IMAGE' ? 'image/jpeg' : headerType === 'VIDEO' ? 'video/mp4' : 'application/pdf';
        const upload = await callTemplateFunction('upload-header', {
          method: 'POST',
          body: JSON.stringify({ url: headerUrl.trim(), mime_type: mimeType }),
        });
        headerHandle = String(upload.header_handle ?? upload.data?.header_handle ?? '');
        if (!headerHandle) throw new Error('WasapFlow tidak memulangkan header_handle.');
      }

      const components: Record<string, unknown>[] = [];
      if (headerType === 'TEXT' && headerText.trim()) {
        components.push({ type: 'HEADER', format: 'TEXT', text: headerText.trim() });
      } else if (headerHandle) {
        components.push({ type: 'HEADER', format: headerType, example: { header_handle: [headerHandle] } });
      }

      components.push({
        type: 'BODY',
        text: bodyText.trim(),
        ...(parameterCount > 0 ? { example: { body_text: [examples] } } : {}),
      });

      if (footerText.trim()) components.push({ type: 'FOOTER', text: footerText.trim() });

      if (buttonType !== 'NONE' && buttonText.trim()) {
        const button: Record<string, unknown> = { type: buttonType, text: buttonText.trim() };
        if (buttonType === 'URL') button.url = buttonValue.trim();
        if (buttonType === 'PHONE_NUMBER') button.phone_number = buttonValue.trim();
        components.push({ type: 'BUTTONS', buttons: [button] });
      }

      const payload = await callTemplateFunction('create', {
        method: 'POST',
        body: JSON.stringify({
          name,
          language: createLanguage,
          category: createCategory,
          parameter_format: 'POSITIONAL',
          components,
        }),
      });

      setNotice(`Template dihantar untuk approval. ${JSON.stringify(payload)}`);
      await loadTemplates();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Gagal mencipta template.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteTemplate(name: string) {
    if (!window.confirm(`Delete template ${name}?`)) return;
    setError(null);
    setNotice(null);
    try {
      await callTemplateFunction('delete', { method: 'DELETE' }, `&name=${encodeURIComponent(name)}`);
      setNotice(`Template ${name} telah dipadam.`);
      await loadTemplates();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Gagal delete template.');
    }
  }

  async function handleTestSend() {
    if (!testTemplate.trim() || !testPhone.trim()) return;
    setSending(true);
    setNotice(null);
    setError(null);
    try {
      const parameters = testVariables.split('\n').map((value) => value.trim()).filter(Boolean).map((text) => ({ type: 'text', text }));
      const payload = await callTemplateFunction('send', {
        method: 'POST',
        body: JSON.stringify({
          to: testPhone,
          template: {
            name: testTemplate.trim(),
            language: createLanguage,
            components: parameters.length > 0 ? [{ type: 'body', parameters }] : [],
          },
        }),
      });
      setNotice(`Template dihantar untuk ujian. ${JSON.stringify(payload)}`);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Template gagal dihantar.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0b141a] p-4 sm:p-6 text-[#e9edef]">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-xl font-semibold">WhatsApp Templates</h1>
            <p className="mt-1 text-sm text-[#8696a0]">Create, preview, sync dan test template daripada satu tempat.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowCreate((value) => !value)} className="flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2 text-sm text-white hover:bg-[#008f72]"><Plus size={15} /> Cipta Template</button>
            <a href={META_TEMPLATE_MANAGER_URL} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-[#2a3942] bg-[#111b21] px-4 py-2 text-sm hover:bg-[#202c33]"><ExternalLink size={15} /> Buka dalam Meta</a>
            <button onClick={loadTemplates} disabled={loading} className="flex items-center gap-2 rounded-lg bg-[#202c33] px-4 py-2 text-sm hover:bg-[#2a3942] disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Sync Templates</button>
          </div>
        </div>

        {showCreate && (
          <div className="mb-6 grid gap-5 rounded-xl border border-[#00a884]/50 bg-[#111b21] p-4 lg:grid-cols-[1.35fr_0.65fr]">
            <div className="space-y-4">
              <h2 className="font-semibold">Template Builder</h2>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="md:col-span-1"><label className="mb-1 block text-xs text-[#aebac1]">Nama template</label><input value={createName} onChange={(event) => setCreateName(event.target.value)} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm" /></div>
                <div><label className="mb-1 block text-xs text-[#aebac1]">Bahasa</label><select value={createLanguage} onChange={(event) => setCreateLanguage(event.target.value)} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm"><option value="ms">ms</option><option value="en_US">en_US</option></select></div>
                <div><label className="mb-1 block text-xs text-[#aebac1]">Kategori</label><select value={createCategory} onChange={(event) => setCreateCategory(event.target.value)} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm"><option value="UTILITY">UTILITY</option><option value="MARKETING">MARKETING</option><option value="AUTHENTICATION">AUTHENTICATION</option></select></div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div><label className="mb-1 block text-xs text-[#aebac1]">Jenis header</label><select value={headerType} onChange={(event) => setHeaderType(event.target.value as HeaderType)} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm"><option value="NONE">Tiada</option><option value="TEXT">Text</option><option value="IMAGE">Image</option><option value="VIDEO">Video</option><option value="DOCUMENT">Document</option></select></div>
                {headerType === 'TEXT' ? <div><label className="mb-1 block text-xs text-[#aebac1]">Header text</label><input value={headerText} onChange={(event) => setHeaderText(event.target.value)} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm" /></div>
                  : headerType !== 'NONE' ? <div><label className="mb-1 block text-xs text-[#aebac1]">Sample public URL</label><input value={headerUrl} onChange={(event) => setHeaderUrl(event.target.value)} placeholder="https://domain.com/sample.jpg" className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm" /></div> : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div><label className="mb-1 block text-xs text-[#aebac1]">Body template</label><textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} rows={6} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm" /><p className="mt-1 text-[11px] text-[#8696a0]">{bodyText.length} aksara · variable: {'{{1}}'}, {'{{2}}'}</p></div>
                <div><label className="mb-1 block text-xs text-[#aebac1]">Contoh variable</label><textarea value={bodyExamples} onChange={(event) => setBodyExamples(event.target.value)} rows={6} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm" /><p className="mt-1 text-[11px] text-[#8696a0]">Satu contoh setiap baris.</p></div>
              </div>

              <div><label className="mb-1 block text-xs text-[#aebac1]">Footer</label><input value={footerText} onChange={(event) => setFooterText(event.target.value)} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm" /></div>

              <div className="grid gap-3 md:grid-cols-3">
                <div><label className="mb-1 block text-xs text-[#aebac1]">Button</label><select value={buttonType} onChange={(event) => setButtonType(event.target.value as ButtonType)} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm"><option value="NONE">Tiada</option><option value="URL">URL</option><option value="PHONE_NUMBER">Call</option><option value="QUICK_REPLY">Quick Reply</option></select></div>
                {buttonType !== 'NONE' && <div><label className="mb-1 block text-xs text-[#aebac1]">Button text</label><input value={buttonText} onChange={(event) => setButtonText(event.target.value)} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm" /></div>}
                {['URL', 'PHONE_NUMBER'].includes(buttonType) && <div><label className="mb-1 block text-xs text-[#aebac1]">URL / phone</label><input value={buttonValue} onChange={(event) => setButtonValue(event.target.value)} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm" /></div>}
              </div>

              <button onClick={handleCreateTemplate} disabled={creating || !createName.trim() || !bodyText.trim()} className="flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Hantar untuk Approval</button>
            </div>

            <TemplatePhonePreview headerType={headerType} headerText={headerText} headerUrl={headerUrl} body={bodyText} examples={bodyExamples} footer={footerText} buttonType={buttonType} buttonText={buttonText} language={createLanguage} category={createCategory} />
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
          <div className="rounded-xl border border-[#2a3942] bg-[#111b21] p-4">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama, bahasa, kategori..." className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] py-2.5 pl-9 pr-3 text-sm" /></div><select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm"><option value="ALL">Semua status</option><option value="APPROVED">Approved</option><option value="PENDING">Pending</option><option value="REJECTED">Rejected</option><option value="PAUSED">Paused</option></select></div>
            {loading ? <div className="flex justify-center py-16 text-[#8696a0]"><Loader2 className="animate-spin" /></div> : filtered.length === 0 ? <div className="py-16 text-center text-sm text-[#8696a0]">Tiada template ditemui.</div> : <div className="space-y-2">{filtered.map((template, index) => { const name = String(template.name ?? 'Tanpa nama'); const templateStatus = String(template.status ?? 'UNKNOWN').toUpperCase(); return <div key={`${name}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-[#202c33] bg-[#182229] px-4 py-3"><button onClick={() => setTestTemplate(name)} className="min-w-0 flex-1 text-left"><p className="truncate font-medium">{name}</p><p className="mt-1 text-xs text-[#8696a0]">{String(template.language ?? '—')} · {String(template.category ?? '—')}</p></button><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${templateStatus === 'APPROVED' ? 'bg-emerald-950 text-emerald-400' : templateStatus === 'REJECTED' ? 'bg-red-950 text-red-400' : 'bg-amber-950 text-amber-400'}`}>{templateStatus}</span><button onClick={() => handleDeleteTemplate(name)} className="rounded p-2 text-[#8696a0] hover:bg-red-950 hover:text-red-400"><Trash2 size={15} /></button></div>; })}</div>}
          </div>

          <div className="rounded-xl border border-[#2a3942] bg-[#111b21] p-4">
            <div className="mb-4 flex items-center gap-2"><ShieldCheck size={18} className="text-[#00a884]" /><h2 className="font-semibold">Test Send</h2></div>
            <p className="mb-4 text-xs text-[#8696a0]">Gunakan nombor sendiri dahulu. Template mesti APPROVED.</p>
            <label className="mb-1 block text-xs text-[#aebac1]">Nama template</label><input value={testTemplate} onChange={(event) => setTestTemplate(event.target.value)} className="mb-3 w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm" />
            <label className="mb-1 block text-xs text-[#aebac1]">Nombor WhatsApp</label><input value={testPhone} onChange={(event) => setTestPhone(event.target.value)} className="mb-3 w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm" placeholder="60129554732" />
            <label className="mb-1 block text-xs text-[#aebac1]">Body variables</label><textarea value={testVariables} onChange={(event) => setTestVariables(event.target.value)} rows={4} className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2.5 text-sm" placeholder={'Satu variable setiap baris\nZaim\nORD123'} />
            <button onClick={handleTestSend} disabled={sending || !testTemplate.trim() || !testPhone.trim()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Hantar ke Nombor Ujian</button>
          </div>
        </div>

        {notice && <div className="mt-4 rounded-lg border border-emerald-900 bg-emerald-950/30 p-3 text-xs text-emerald-300">{notice}</div>}
        {error && <div className="mt-4 rounded-lg border border-red-900 bg-red-950/30 p-3 text-xs text-red-300">{error}</div>}
      </div>
    </div>
  );
}

