import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, MessageCircle, Plus, RefreshCw, Save, Search, Trash2, Upload, UserRound, X } from 'lucide-react';
import type { Conversation } from '../types';
import { deleteGoogleContactCache, GoogleContactCacheRow, normalizePhone, saveGoogleContactCache, searchGoogleContactCache } from '../lib/googleContactCache';
import { useConversations } from '../lib/hooks';

const emptyForm = {
  id: '', google_contact_id: '', display_name: '', given_name: '', family_name: '', phone_raw: '', email: '', company: '',
};

interface ContactsPageProps { onOpenConversation?: (conversationId: string) => void; }

interface BulkContactInput {
  display_name: string;
  phone_raw: string;
  email: string;
  company: string;
  google_contact_id: string;
}

function conversationByPhone(conversations: Conversation[]) {
  const map: Record<string, Conversation> = {};
  for (const conversation of conversations) {
    const phone = normalizePhone(conversation.customer.phone);
    if (phone && !map[phone]) map[phone] = conversation;
  }
  return map;
}

function parseBulkContacts(text: string): BulkContactInput[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed);
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    const rows: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(record?.contacts)
        ? record.contacts
        : [parsed];
    return rows.map((value) => {
      const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
      return {
        display_name: String(item.display_name ?? item.name ?? item.full_name ?? item.contact_name ?? '').trim(),
        phone_raw: String(item.phone ?? item.phone_raw ?? item.number ?? item.mobile ?? '').trim(),
        email: String(item.email ?? '').trim(),
        company: String(item.company ?? item.organization ?? '').trim(),
        google_contact_id: String(item.google_contact_id ?? item.resourceName ?? item.resource_name ?? '').trim(),
      };
    });
  }
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const start = lines[0]?.toLowerCase().includes('name') || lines[0]?.toLowerCase().includes('phone') ? 1 : 0;
  return lines.slice(start).map((line) => {
    const parts = line.split(',').map((part) => part.trim());
    return { display_name: parts[0] ?? '', phone_raw: parts[1] ?? '', email: parts[2] ?? '', company: parts[3] ?? '', google_contact_id: '' };
  });
}

const appsScriptSample = `function syncContactsToIcetak() {
  const endpoint = 'https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/google-contacts-cache-upsert';
  const contacts = ContactsApp.getContacts().flatMap(function(c) {
    const name = c.getFullName();
    return c.getPhones().map(function(p) {
      return { display_name: name, phone: p.getPhoneNumber(), email: c.getEmails()[0]?.getAddress() || '' };
    });
  }).filter(function(x) { return x.display_name && x.phone; });
  UrlFetchApp.fetch(endpoint, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ contacts: contacts }) });
}`;

export function ContactsPage({ onOpenConversation }: ContactsPageProps) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<GoogleContactCacheRow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [bulkText, setBulkText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const normalizedPreview = normalizePhone(form.phone_raw);
  const { conversations } = useConversations();
  const conversationsByPhone = useMemo(() => conversationByPhone(conversations), [conversations]);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await searchGoogleContactCache(query)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Gagal memuatkan contacts.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  function edit(row: GoogleContactCacheRow) {
    setForm({ id: row.id, google_contact_id: row.google_contact_id ?? '', display_name: row.display_name, given_name: row.given_name ?? '', family_name: row.family_name ?? '', phone_raw: row.phone_raw, email: row.email ?? '', company: row.company ?? '' });
    setError(null);
  }

  function reset() { setForm(emptyForm); setError(null); }

  async function submit() {
    setSaving(true); setError(null);
    try { await saveGoogleContactCache(form); reset(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Gagal simpan contact.'); }
    finally { setSaving(false); }
  }

  async function importBulk() {
    setImporting(true); setBulkStatus(null); setError(null);
    try {
      const parsed = parseBulkContacts(bulkText).filter((item) => item.display_name && item.phone_raw);
      for (const item of parsed) await saveGoogleContactCache(item);
      setBulkStatus(`Import selesai: ${parsed.length} contact cache.`);
      setBulkText('');
      await load();
    } catch (reason) {
      setBulkStatus(reason instanceof Error ? reason.message : 'Gagal import bulk contact.');
    } finally { setImporting(false); }
  }

  async function remove(row: GoogleContactCacheRow) {
    if (!window.confirm(`Padam cache contact ${row.display_name}?`)) return;
    await deleteGoogleContactCache(row.id);
    if (form.id === row.id) reset();
    await load();
  }

  function waLink(phone: string) { return `https://wa.me/${normalizePhone(phone)}`; }

  return <div className="h-full overflow-y-auto bg-[#0b141a] p-4 text-[#e9edef] sm:p-6">
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">Contacts</h1><p className="mt-1 text-sm text-[#8696a0]">Google Contacts cache untuk matching nama dalam Inbox.</p></div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg bg-[#202c33] px-3 py-2 text-sm text-[#aebac1] hover:bg-[#2a3942]"><RefreshCw size={15} /> Refresh</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <div className="rounded-xl border border-[#2a3942] bg-[#111b21] p-4">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">{form.id ? 'Edit cache contact' : 'Tambah cache contact'}</h2>{form.id && <button onClick={reset} className="text-[#8696a0]"><X size={17} /></button>}</div>
            <div className="space-y-3">
              <label className="block text-xs text-[#8696a0]">Nama contact<input value={form.display_name} onChange={(event) => setForm((old) => ({ ...old, display_name: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#3b4a54] bg-[#202c33] px-3 py-2 text-sm outline-none focus:border-[#00a884]" placeholder="cs@eiS sarahaziera" /></label>
              <label className="block text-xs text-[#8696a0]">Phone<input value={form.phone_raw} onChange={(event) => setForm((old) => ({ ...old, phone_raw: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#3b4a54] bg-[#202c33] px-3 py-2 text-sm outline-none focus:border-[#00a884]" placeholder="012-6034232" />{normalizedPreview && <span className="mt-1 block text-[11px] text-[#667781]">Normalized: {normalizedPreview}</span>}</label>
              <div className="grid grid-cols-2 gap-2"><label className="block text-xs text-[#8696a0]">First name<input value={form.given_name} onChange={(event) => setForm((old) => ({ ...old, given_name: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#3b4a54] bg-[#202c33] px-3 py-2 text-sm outline-none focus:border-[#00a884]" /></label><label className="block text-xs text-[#8696a0]">Last name<input value={form.family_name} onChange={(event) => setForm((old) => ({ ...old, family_name: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#3b4a54] bg-[#202c33] px-3 py-2 text-sm outline-none focus:border-[#00a884]" /></label></div>
              <label className="block text-xs text-[#8696a0]">Email<input value={form.email} onChange={(event) => setForm((old) => ({ ...old, email: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#3b4a54] bg-[#202c33] px-3 py-2 text-sm outline-none focus:border-[#00a884]" /></label>
              <label className="block text-xs text-[#8696a0]">Company<input value={form.company} onChange={(event) => setForm((old) => ({ ...old, company: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#3b4a54] bg-[#202c33] px-3 py-2 text-sm outline-none focus:border-[#00a884]" /></label>
              <label className="block text-xs text-[#8696a0]">Google contact ID<input value={form.google_contact_id} onChange={(event) => setForm((old) => ({ ...old, google_contact_id: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#3b4a54] bg-[#202c33] px-3 py-2 text-sm outline-none focus:border-[#00a884]" placeholder="people/c123..." /></label>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button onClick={submit} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{form.id ? <Save size={15} /> : <Plus size={15} />}{saving ? 'Menyimpan...' : form.id ? 'Simpan cache' : 'Tambah cache'}</button>
            </div>
          </div>

          <div className="rounded-xl border border-[#2a3942] bg-[#111b21] p-4">
            <h2 className="mb-2 font-medium">Bulk import</h2>
            <p className="mb-2 text-xs text-[#8696a0]">Paste JSON atau CSV ringkas: name,phone,email,company</p>
            <textarea value={bulkText} onChange={(event) => setBulkText(event.target.value)} className="h-28 w-full rounded-lg border border-[#3b4a54] bg-[#202c33] px-3 py-2 text-xs outline-none focus:border-[#00a884]" placeholder={'Sarah,0126034232\nRonica,0163414326'} />
            <button onClick={importBulk} disabled={importing || !bulkText.trim()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#202c33] px-3 py-2 text-xs font-semibold text-[#d1d7db] hover:bg-[#2a3942] disabled:opacity-50"><Upload size={13} /> {importing ? 'Importing...' : 'Import ke cache'}</button>
            {bulkStatus && <p className="mt-2 text-[11px] text-[#8696a0]">{bulkStatus}</p>}
          </div>

          <details className="rounded-xl border border-[#2a3942] bg-[#111b21] p-4 text-xs text-[#aebac1]">
            <summary className="cursor-pointer font-medium text-white">Apps Script sync sample</summary>
            <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-[#0b141a] p-3 font-mono text-[11px] text-[#00a884]">{appsScriptSample}</pre>
            <p className="mt-2 text-[#8696a0]">Nota: ini sync masuk cache sahaja. Write balik ke Google Contacts belum aktif dalam app.</p>
          </details>
        </div>

        <div>
          <div className="mb-4 rounded-xl border border-[#2a3942] bg-[#111b21] p-3"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama contact atau phone..." className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#00a884]" /></div></div>
          <div className="overflow-hidden rounded-xl border border-[#2a3942] bg-[#111b21]">
            {loading ? <div className="flex items-center justify-center gap-2 p-10 text-sm text-[#8696a0]"><Loader2 className="animate-spin" size={17} /> Memuatkan contacts...</div> : error ? <div className="p-8 text-center text-sm text-red-400">{error}</div> : rows.length === 0 ? <div className="p-10 text-center text-sm text-[#8696a0]"><UserRound className="mx-auto mb-3" size={28} />Belum ada contact cache.</div> : rows.map((row) => {
              const matchedConversation = conversationsByPhone[row.phone_normalized];
              return <div key={row.id} className="flex items-start gap-3 border-b border-[#202c33] p-4 last:border-b-0"><button onClick={() => edit(row)} className="min-w-0 flex-1 text-left"><p className="font-medium text-white">{row.display_name}</p>{row.company && <p className="text-xs text-[#8696a0]">{row.company}</p>}<div className="mt-1 flex flex-wrap gap-3 text-xs text-[#8696a0]"><span>{row.phone_raw}</span><span>Normalized: {row.phone_normalized}</span></div><p className="mt-1 text-[11px] text-[#667781]">{new Date(row.last_synced_at).toLocaleString('ms-MY')}</p></button><div className="flex flex-col gap-2">{matchedConversation && onOpenConversation ? <button onClick={() => onOpenConversation(matchedConversation.id)} className="inline-flex items-center gap-1 rounded-lg bg-[#00a884] px-2.5 py-1.5 text-xs font-semibold text-white"><MessageCircle size={14} /> Open</button> : <a href={waLink(row.phone_normalized)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-[#202c33] px-2.5 py-1.5 text-xs text-[#aebac1] hover:bg-[#2a3942]"><ExternalLink size={14} /> WA</a>}<button onClick={() => void remove(row)} className="rounded-lg p-2 text-[#8696a0] hover:bg-red-500/10 hover:text-red-400"><Trash2 size={16} /></button></div></div>;
            })}
          </div>
        </div>
      </div>
    </div>
  </div>;
}

