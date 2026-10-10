import { Conversation } from '../types';
import { CustomTag } from '../lib/conversationTags';
import { CustomerPanel } from './CustomerPanel';
import { ConversationTagManager } from './ConversationTagManager';
import { ContactCacheCard } from './ContactCacheCard';

interface Props {
  conversation: Conversation;
  allTags: CustomTag[];
  assignedTags: CustomTag[];
  onTagsChanged: () => void;
  onClose: () => void;
  onFillComposer: (text: string) => void;
  onContactChanged?: () => void;
}

export function CustomerPanelWithTags({ conversation, allTags, assignedTags, onTagsChanged, onClose, onFillComposer, onContactChanged }: Props) {
  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <div className="min-h-0 flex-1 overflow-hidden">
        <CustomerPanel conversation={conversation} onClose={onClose} onFillComposer={onFillComposer} />
      </div>
      {conversation.channel === 'whatsapp' && <ContactCacheCard conversation={conversation} onSaved={onContactChanged} />}
      <div className="border-t border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Urus Custom Tag</p>
        <ConversationTagManager conversationId={conversation.id} allTags={allTags} assignedTags={assignedTags} onChanged={onTagsChanged} />
      </div>
    </div>
  );
}
