import { useState } from 'react';
import { Bot, Plus, Tag, UserRound, X } from 'lucide-react';
import { assignTag, createAndAssignTag, CustomTag, removeTag } from '../lib/conversationTags';

interface Props {
  conversationId: string;
  allTags: CustomTag[];
  assignedTags: CustomTag[];
  onChanged: () => void;
}

function SourceIcon({ source }: { source?: string }) {
  if (source === 'ai') return <Bot size={10} className="text-violet-300" />;
  if (source === 'manual') return <UserRound size={10} className="text-emerald-300" />;
  return <Tag size={10} className="text-sky-300" />;
}

function sourceLabel(source?: string): string {
  if (source === 'ai') return 'AI';
  if (source === 'manual') return 'Manual';
  if (source === 'external') return 'External';
  return source || 'System';
}

export function ConversationTagManager({ conversationId, allTags, assignedTags, onChanged }: Props) {
  const [newTag, setNewTag] = useState('');
  const [busy, setBusy] = useState(false);
  const assignedIds = new Set(assignedTags.map((tag) => tag.id));

  async function createTag() {
    if (!newTag.trim() || busy) return;
    setBusy(true);
    try {
      await createAndAssignTag(conversationId, newTag);
      setNewTag('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function toggleTag(tag: CustomTag) {
    if (busy) return;
    setBusy(true);
    try {
      if (assignedIds.has(tag.id)) await removeTag(conversationId, tag.id);
      else await assignTag(conversationId, tag.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {assignedTags.length === 0 && <span className="text-xs text-[#8696a0]">Belum ada tag</span>}
        {assignedTags.map((tag) => (
          <span
            key={tag.id}
            title={`${sourceLabel(tag.assignmentSource)}${tag.assignedAt ? ` · ${new Date(tag.assignedAt).toLocaleString('ms-MY')}` : ''}`}
            className="inline-flex items-center gap-1 rounded-full bg-[#2a3942] px-2 py-1 text-xs text-white"
          >
            <SourceIcon source={tag.assignmentSource} /> {tag.name}
            <span className="text-[9px] text-[#8696a0]">{sourceLabel(tag.assignmentSource)}</span>
            <button onClick={() => toggleTag(tag)} disabled={busy} aria-label={`Buang ${tag.name}`}><X size={11} /></button>
          </span>
        ))}
      </div>

      {allTags.length > 0 && (
        <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
          {allTags.filter((tag) => !assignedIds.has(tag.id)).map((tag) => (
            <button key={tag.id} onClick={() => toggleTag(tag)} disabled={busy} className="rounded-full border border-[#3b4a54] px-2 py-1 text-xs text-[#aebac1] hover:border-[#00a884] hover:text-[#00a884]">
              + {tag.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input value={newTag} onChange={(event) => setNewTag(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createTag(); }} placeholder="Cipta tag baru" className="min-w-0 flex-1 rounded-lg border border-[#3b4a54] bg-[#202c33] px-3 py-2 text-xs text-white outline-none focus:border-[#00a884]" />
        <button onClick={() => void createTag()} disabled={!newTag.trim() || busy} className="inline-flex items-center gap-1 rounded-lg bg-[#00a884] px-3 py-2 text-xs font-medium text-white disabled:opacity-40"><Plus size={13} /> Tambah</button>
      </div>
    </div>
  );
}

