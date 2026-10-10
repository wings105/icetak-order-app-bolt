import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, AtSign, Check, Copy, Edit3, ExternalLink, Mail,
  MapPin, MessageCircle, Phone, Save, ShieldCheck, UserRound, X,
} from 'lucide-react';
import type { Conversation } from '../../types';
import type { CustomTag } from '../../lib/conversationTags';
import {
  updateWorkspaceAddress,
  updateWorkspaceCustomer,
  type WorkspaceAddress,
  type WorkspaceIdentity,
  type WorkspaceRelatedConversation,
} from '../../lib/conversationWorkspace';
import { ChannelBadge } from '../ChannelBadge';
import { ContactCacheCard } from '../ContactCacheCard';
import { ConversationTagManager } from '../ConversationTagManager';

interface Props {
  conversation: Conversation;
  identities: WorkspaceIdentity[];
  addresses: WorkspaceAddress[];
  relatedConversations: WorkspaceRelatedConversation[];
  allTags: CustomTag[];
  assignedTags: CustomTag[];
  onTagsChanged: () => void;
  onContactChanged?: () => void;
  onOpenConversation: (conversationId: string) => void;
  onReload: () => Promise<void>;
}

interface AddressDraft {
  recipient_name: string;
  address_line_1: string;
  address_line_2: string;
  postcode: string;
  city: string;
  state: string;
  country: string;
}

const EMPTY_ADDRESS: AddressDraft = {
  recipient_name: '',
  address_line_1: '',
  address_line_2: '',
  postcode: '',
  city: '',
  state: '',
  country: 'Malaysia',
};

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function identityLabel(identity: WorkspaceIdentity): string {
  if (identity.channel === 'whatsapp') return identity.normalized_phone || identity.external_id;
  if (identity.channel === 'shopee') return identity.username ? `@${identity.username}` : identity.external_id;
  return identity.username || identity.normalized_phone || identity.external_id;
}

function formatRelatedTime(value: string | null): string {
  if (!value) return 'Tiada mesej';
  return new Date(value).toLocaleString('ms-MY', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function copyText(value: string): void {
  void navigator.clipboard.writeText(value);
}

export function CustomerWorkspaceTab({
  conversation,
  identities,
  addresses,
  relatedConversations,
  allTags,
  assignedTags,
  onTagsChanged,
  onContactChanged,
  onOpenConversation,
  onReload,
}: Props) {
  const primaryAddress = addresses[0];
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(conversation.customer.name);
  const [email, setEmail] = useState(conversation.customer.email ?? '');
  const [notes, setNotes] = useState(conversation.customer.notes ?? '');
  const [address, setAddress] = useState<AddressDraft>(EMPTY_ADDRESS);

  useEffect(() => {
    setName(conversation.customer.name);
    setEmail(conversation.customer.email ?? '');
    setNotes(conversation.customer.notes ?? '');
    setAddress(primaryAddress ? {
      recipient_name: primaryAddress.recipient_name,
      address_line_1: primaryAddress.address_line_1,
      address_line_2: primaryAddress.address_line_2 ?? '',
      postcode: primaryAddress.postcode,
      city: primaryAddress.city,
      state: primaryAddress.state,
      country: primaryAddress.country,
    } : {
      ...EMPTY_ADDRESS,
      recipient_name: conversation.customer.name,
      address_line_1: conversation.customer.address ?? '',
      postcode: conversation.customer.postcode ?? '',
      city: conversation.customer.city ?? '',
      state: conversation.customer.state ?? '',
    });
    setEditing(false);
    setError(null);
  }, [conversation.id, conversation.customer, primaryAddress]);

  const fullAddress = useMemo(() => [
    primaryAddress?.address_line_1 || conversation.customer.address,
    primaryAddress?.address_line_2,
    [primaryAddress?.postcode || conversation.customer.postcode, primaryAddress?.city || conversation.customer.city].filter(Boolean).join(' '),
    primaryAddress?.state || conversation.customer.state,
  ].filter(Boolean).join(', '), [conversation.customer, primaryAddress]);

  async function saveCustomer() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateWorkspaceCustomer(conversation.id, name, email, notes);
      const hasAddress = Object.entries(address).some(([key, value]) => key !== 'country' && value.trim().length > 0);
      if (hasAddress) {
        await updateWorkspaceAddress(conversation.id, {
          recipient_name: address.recipient_name,
          address_line_1: address.address_line_1,
          address_line_2: address.address_line_2 || null,
          postcode: address.postcode,
          city: address.city,
          state: address.state,
          country: address.country,
        });
      }
      await onReload();
      onContactChanged?.();
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Gagal menyimpan customer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface)] pb-6">
      <div className="flex flex-col items-center border-b border-[var(--border)] px-4 py-5 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#00a884] text-xl font-semibold text-white">
          {initials(conversation.customer.name)}
        </div>
        <p className="mt-3 text-base font-semibold text-[var(--text)]">{conversation.customer.name}</p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
          <ChannelBadge channel={conversation.channel} size="sm" />
          {conversation.isUrgent && <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-300"><AlertTriangle size={10} />Urgent</span>}
          {(conversation.aiPriorityScore ?? 0) > 0 && <span className="rounded-full bg-[#00a884]/20 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">P{conversation.aiPriorityScore}</span>}
        </div>
        {conversation.aiRemark && <p className="mt-3 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-left text-xs leading-relaxed text-[var(--text)]">{conversation.aiRemark}</p>}
      </div>

      <section className="border-b border-[var(--border)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Maklumat Customer</h3>
          <button
            onClick={() => setEditing((value) => !value)}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-muted)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text)]"
          >
            {editing ? <X size={12} /> : <Edit3 size={12} />}{editing ? 'Batal' : 'Edit'}
          </button>
        </div>

        {editing ? (
          <div className="space-y-2.5">
            <Field label="Nama" value={name} onChange={setName} />
            <Field label="E-mel" value={email} onChange={setEmail} type="email" />
            <Field label="Nota customer" value={notes} onChange={setNotes} multiline />
            <div className="my-3 border-t border-[var(--border)]" />
            <Field label="Nama penerima" value={address.recipient_name} onChange={(value) => setAddress((current) => ({ ...current, recipient_name: value }))} />
            <Field label="Alamat" value={address.address_line_1} onChange={(value) => setAddress((current) => ({ ...current, address_line_1: value }))} multiline />
            <Field label="Alamat tambahan" value={address.address_line_2} onChange={(value) => setAddress((current) => ({ ...current, address_line_2: value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Poskod" value={address.postcode} onChange={(value) => setAddress((current) => ({ ...current, postcode: value }))} />
              <Field label="Bandar" value={address.city} onChange={(value) => setAddress((current) => ({ ...current, city: value }))} />
            </div>
            <Field label="Negeri" value={address.state} onChange={(value) => setAddress((current) => ({ ...current, state: value }))} />
            {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
            <button
              onClick={saveCustomer}
              disabled={saving || !name.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saved ? <Check size={14} /> : <Save size={14} />}{saved ? 'Disimpan' : saving ? 'Menyimpan…' : 'Simpan Maklumat'}
            </button>
          </div>
        ) : (
          <div className="space-y-2.5 text-xs">
            {conversation.customer.phone && <InfoRow icon={<Phone size={14} />} label="Telefon" value={conversation.customer.phone} onCopy={() => copyText(conversation.customer.phone ?? '')} />}
            {conversation.customer.email && <InfoRow icon={<Mail size={14} />} label="E-mel" value={conversation.customer.email} onCopy={() => copyText(conversation.customer.email ?? '')} />}
            {fullAddress && <InfoRow icon={<MapPin size={14} />} label="Alamat" value={fullAddress} onCopy={() => copyText(fullAddress)} multiline />}
            {conversation.customer.notes && <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-[var(--text)]"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Nota</p><p className="whitespace-pre-wrap leading-relaxed">{conversation.customer.notes}</p></div>}
            {!conversation.customer.phone && !conversation.customer.email && !fullAddress && !conversation.customer.notes && <p className="py-3 text-center text-[var(--text-secondary)]">Belum ada maklumat tambahan.</p>}
          </div>
        )}
      </section>

      <section className="border-b border-[var(--border)] p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Identiti Channel</h3>
        <div className="space-y-2">
          {identities.map((identity) => (
            <div key={identity.id} className="flex items-center gap-3 rounded-lg bg-[var(--surface-muted)] p-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[#00a884]">
                {identity.channel === 'whatsapp' ? <Phone size={14} /> : identity.channel === 'shopee' ? <AtSign size={14} /> : <UserRound size={14} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5"><p className="text-xs font-medium capitalize text-[var(--text)]">{identity.channel}</p>{identity.is_verified && <ShieldCheck size={12} className="text-emerald-700 dark:text-emerald-400" />}</div>
                <p className="truncate text-[11px] text-[var(--text-secondary)]">{identityLabel(identity)}</p>
              </div>
              <button onClick={() => copyText(identityLabel(identity))} className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"><Copy size={13} /></button>
            </div>
          ))}
          {identities.length === 0 && <p className="py-2 text-center text-xs text-[var(--text-secondary)]">Tiada identiti lain dipadankan.</p>}
        </div>
      </section>

      <section className="border-b border-[var(--border)] p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Tag Conversation</h3>
        <ConversationTagManager conversationId={conversation.id} allTags={allTags} assignedTags={assignedTags} onChanged={onTagsChanged} />
      </section>

      {conversation.channel === 'whatsapp' && (
        <div className="border-b border-[var(--border)]"><ContactCacheCard conversation={conversation} onSaved={onContactChanged} /></div>
      )}

      <section className="p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Conversation Berkaitan</h3>
        <div className="space-y-2">
          {relatedConversations.map((related) => (
            <button
              key={related.id}
              onClick={() => onOpenConversation(related.id)}
              className="flex w-full items-center gap-3 rounded-lg bg-[var(--surface-muted)] p-3 text-left hover:bg-[var(--surface-hover)]"
            >
              <MessageCircle size={15} className="text-[#00a884]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="text-xs font-medium capitalize text-white">{related.channel}</span>{related.archived && <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[9px] text-[var(--text-secondary)]">Arkib</span>}{related.needs_reply && <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[9px] text-orange-700 dark:text-orange-300">Perlu balas</span>}</div>
                <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">{formatRelatedTime(related.last_message_at)}</p>
              </div>
              <ExternalLink size={13} className="text-[var(--text-secondary)]" />
            </button>
          ))}
          {relatedConversations.length === 0 && <p className="py-3 text-center text-xs text-[var(--text-secondary)]">Tiada conversation lain untuk customer ini.</p>}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, multiline = false, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; type?: string }) {
  const className = 'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[#00a884]';
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{label}</span>
      {multiline
        ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} className={`${className} resize-none`} />
        : <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className={className} />}
    </label>
  );
}

function InfoRow({ icon, label, value, onCopy, multiline = false }: { icon: React.ReactNode; label: string; value: string; onCopy: () => void; multiline?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-[var(--surface-muted)] p-3">
      <span className="mt-0.5 text-[#00a884]">{icon}</span>
      <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{label}</p><p className={`mt-0.5 text-xs text-[var(--text)] ${multiline ? 'whitespace-pre-wrap' : 'truncate'}`}>{value}</p></div>
      <button onClick={onCopy} className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"><Copy size={12} /></button>
    </div>
  );
}
