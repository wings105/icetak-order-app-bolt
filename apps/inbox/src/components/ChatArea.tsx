import { useEffect, useRef, useState, useCallback } from 'react';
import { Conversation } from '../types';
import { MessageBubble } from './MessageBubble';
import { ChatHeader } from './ChatHeader';
import { WindowBadge } from './WindowBadge';
import { TemplateSendModal } from './TemplateSendModal';
import { isSameDay, formatDaySeparator } from '../utils/timeUtils';
import {
  MessageCircle, Loader2, ChevronUp, ChevronDown, X,
  Send, AlertCircle, LayoutTemplate, Copy, ImageIcon,
} from 'lucide-react';
import { getMatchingMessageIds } from '../lib/hooks';

interface ChatAreaProps {
  conversation: Conversation | null;
  messagesLoading?: boolean;
  onArchiveToggle: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onUrgentToggle: (id: string) => void;
  onShowCustomerPanel: () => void;
  onBack?: () => void;
  showCustomerPanel: boolean;
  composerText: string;
  onComposerChange: (text: string) => void;
  onSend: (text: string, file?: File | null) => Promise<void>;
  onMarkReplied: (id: string) => Promise<void>;
  searchQuery?: string;
  initialMatchMessageId?: string;
  orderOnly?: boolean;
}

interface ChatScrollState {
  scrollTop: number;
  distanceFromBottom: number;
  atBottom: boolean;
  anchorMessageId: string | null;
  anchorOffset: number;
  updatedAt: number;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CHAT_SCROLL_STORAGE_KEY = 'icetak-chat-scroll-memory-v2';
const BOTTOM_THRESHOLD_PX = 96;
const MAX_SCROLL_MEMORY_ITEMS = 120;

function readScrollMemory(): Record<string, ChatScrollState> {
  try {
    const raw = window.sessionStorage.getItem(CHAT_SCROLL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ChatScrollState>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getStoredScroll(conversationId: string): ChatScrollState | null {
  return readScrollMemory()[conversationId] ?? null;
}

function storeScroll(conversationId: string, state: ChatScrollState): void {
  try {
    const memory = readScrollMemory();
    memory[conversationId] = state;
    const entries = Object.entries(memory)
      .sort(([, first], [, second]) => second.updatedAt - first.updatedAt)
      .slice(0, MAX_SCROLL_MEMORY_ITEMS);
    window.sessionStorage.setItem(CHAT_SCROLL_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Scroll memory is an enhancement; chat continues normally if storage is unavailable.
  }
}

function distanceFromBottom(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop);
}

function isNearBottom(element: HTMLElement): boolean {
  return distanceFromBottom(element) <= BOTTOM_THRESHOLD_PX;
}

function captureAnchor(element: HTMLElement): { messageId: string | null; offset: number } {
  const containerTop = element.getBoundingClientRect().top;
  const messages = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]'));
  const visible = messages.find((message) => message.getBoundingClientRect().bottom >= containerTop + 2);
  if (!visible) return { messageId: null, offset: 0 };
  return {
    messageId: visible.dataset.messageId ?? null,
    offset: visible.getBoundingClientRect().top - containerTop,
  };
}

export function ChatArea({
  conversation,
  messagesLoading = false,
  onArchiveToggle,
  onMarkUnread,
  onUrgentToggle,
  onShowCustomerPanel,
  onBack,
  showCustomerPanel,
  composerText,
  onComposerChange,
  onSend,
  onMarkReplied,
  searchQuery = '',
  initialMatchMessageId,
  orderOnly = false,
}: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveFrameRef = useRef<number | null>(null);
  const restoringRef = useRef(false);
  const atBottomRef = useRef(true);
  const latestScrollStateRef = useRef<ChatScrollState | null>(null);
  const latestSaveCallbackRef = useRef<() => void>(() => undefined);
  const messageCountByConversationRef = useRef<Record<string, number>>({});
  const [pendingSends, setPendingSends] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateSentNotice, setTemplateSentNotice] = useState(false);
  const [queuedImage, setQueuedImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [draftText, setDraftText] = useState(composerText);

  const conversationId = conversation?.id ?? null;

  const saveCurrentScroll = useCallback(() => {
    const element = scrollAreaRef.current;
    if (!element || !conversationId || messagesLoading) return;
    const atBottom = isNearBottom(element);
    const anchor = atBottom ? { messageId: null, offset: 0 } : captureAnchor(element);
    const state: ChatScrollState = {
      scrollTop: element.scrollTop,
      distanceFromBottom: distanceFromBottom(element),
      atBottom,
      anchorMessageId: anchor.messageId,
      anchorOffset: anchor.offset,
      updatedAt: Date.now(),
    };
    atBottomRef.current = atBottom;
    latestScrollStateRef.current = state;
    storeScroll(conversationId, state);
  }, [conversationId, messagesLoading]);

  useEffect(() => {
    latestSaveCallbackRef.current = saveCurrentScroll;
  }, [saveCurrentScroll]);

  const scheduleScrollSave = useCallback(() => {
    if (saveFrameRef.current !== null) window.cancelAnimationFrame(saveFrameRef.current);
    saveFrameRef.current = window.requestAnimationFrame(() => {
      saveFrameRef.current = null;
      saveCurrentScroll();
    });
  }, [saveCurrentScroll]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const element = scrollAreaRef.current;
    if (!element) return;
    restoringRef.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior });
    atBottomRef.current = true;
    window.requestAnimationFrame(() => {
      restoringRef.current = false;
      scheduleScrollSave();
    });
  }, [scheduleScrollSave]);

  const restoreScrollState = useCallback((state: ChatScrollState | null) => {
    const element = scrollAreaRef.current;
    if (!element) return;
    restoringRef.current = true;

    if (!state || state.atBottom) {
      element.scrollTop = element.scrollHeight;
      atBottomRef.current = true;
    } else if (state.anchorMessageId) {
      const escapedId = typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(state.anchorMessageId)
        : state.anchorMessageId.replace(/["\\]/g, '\\$&');
      const anchor = element.querySelector<HTMLElement>(`[data-message-id="${escapedId}"]`);
      if (anchor) {
        const currentOffset = anchor.getBoundingClientRect().top - element.getBoundingClientRect().top;
        element.scrollTop += currentOffset - state.anchorOffset;
      } else {
        element.scrollTop = Math.min(state.scrollTop, Math.max(0, element.scrollHeight - element.clientHeight));
      }
      atBottomRef.current = false;
    } else {
      element.scrollTop = Math.min(state.scrollTop, Math.max(0, element.scrollHeight - element.clientHeight));
      atBottomRef.current = false;
    }

    window.requestAnimationFrame(() => {
      restoringRef.current = false;
    });
  }, []);

  function handleChatScroll() {
    if (restoringRef.current) return;
    const element = scrollAreaRef.current;
    if (element) atBottomRef.current = isNearBottom(element);
    scheduleScrollSave();
  }

  useEffect(() => {
    setDraftText(composerText);
  }, [composerText, conversation?.id]);

  useEffect(() => {
    if (!queuedImage) { setImagePreviewUrl(null); return; }
    const url = URL.createObjectURL(queuedImage);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [queuedImage]);

  useEffect(() => {
    setQueuedImage(null);
  }, [conversation?.id]);

  const matchIds = getMatchingMessageIds(conversation?.messages ?? [], searchQuery);
  const hasMatches = matchIds.length > 0;
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  useEffect(() => { setCurrentMatchIdx(0); }, [conversation?.id, searchQuery]);
  const currentMatchId = hasMatches ? matchIds[currentMatchIdx] : null;

  const scrollToMessage = useCallback((messageId: string) => {
    const escapedId = typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(messageId)
      : messageId.replace(/["\\]/g, '\\$&');
    const element = scrollAreaRef.current?.querySelector<HTMLElement>(`[data-message-id="${escapedId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(scheduleScrollSave, 350);
    }
  }, [scheduleScrollSave]);

  useEffect(() => {
    if (!conversationId || messagesLoading) return;

    if (initialMatchMessageId && hasMatches) {
      const index = matchIds.indexOf(initialMatchMessageId);
      if (index !== -1) setCurrentMatchIdx(index);
      const timer = window.setTimeout(() => scrollToMessage(initialMatchMessageId), 80);
      return () => window.clearTimeout(timer);
    }

    if (searchQuery.trim()) return;

    const stored = getStoredScroll(conversationId);
    latestScrollStateRef.current = stored;
    atBottomRef.current = stored?.atBottom ?? true;

    const frame = window.requestAnimationFrame(() => {
      restoreScrollState(stored);
      window.requestAnimationFrame(() => restoreScrollState(stored));
    });
    const settleTimer = window.setTimeout(() => restoreScrollState(stored), 180);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
    };
  // Restore only when opening the conversation or when its message load completes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messagesLoading]);

  useEffect(() => {
    if (!currentMatchId) return;
    const timer = window.setTimeout(() => scrollToMessage(currentMatchId), 50);
    return () => window.clearTimeout(timer);
  }, [currentMatchId, scrollToMessage]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }, [draftText]);

  useEffect(() => {
    if (!conversationId || messagesLoading || searchQuery.trim()) return;
    const nextCount = conversation?.messages.length ?? 0;
    const previousCount = messageCountByConversationRef.current[conversationId];
    messageCountByConversationRef.current[conversationId] = nextCount;

    if (previousCount !== undefined && nextCount > previousCount && atBottomRef.current) {
      const timer = window.setTimeout(() => scrollToBottom('smooth'), 30);
      return () => window.clearTimeout(timer);
    }
  }, [conversation?.messages.length, conversationId, messagesLoading, scrollToBottom, searchQuery]);

  useEffect(() => {
    const scrollElement = scrollAreaRef.current;
    const contentElement = scrollContentRef.current;
    if (!scrollElement || !contentElement || !conversationId || messagesLoading) return;

    let resizeFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        const state = latestScrollStateRef.current;
        if (state) restoreScrollState(state);
        else if (atBottomRef.current) scrollToBottom('auto');
      });
    });

    observer.observe(scrollElement);
    observer.observe(contentElement);
    return () => {
      observer.disconnect();
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    };
  }, [conversationId, messagesLoading, restoreScrollState, scrollToBottom]);

  useEffect(() => {
    function saveWhenHidden() {
      if (document.visibilityState === 'hidden') saveCurrentScroll();
    }
    function saveBeforeLeaving() { saveCurrentScroll(); }

    document.addEventListener('visibilitychange', saveWhenHidden);
    window.addEventListener('pagehide', saveBeforeLeaving);
    window.addEventListener('blur', saveBeforeLeaving);
    return () => {
      document.removeEventListener('visibilitychange', saveWhenHidden);
      window.removeEventListener('pagehide', saveBeforeLeaving);
      window.removeEventListener('blur', saveBeforeLeaving);
    };
  }, [saveCurrentScroll]);

  useEffect(() => () => {
    if (saveFrameRef.current !== null) window.cancelAnimationFrame(saveFrameRef.current);
    latestSaveCallbackRef.current();
  }, []);

  function enqueueImageFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setSendError('Hanya fail gambar diterima.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setSendError('Gambar terlalu besar. Had maksimum ialah 5 MB.');
      return;
    }
    setQueuedImage(file);
    setSendError(null);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    enqueueImageFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) enqueueImageFile(file);
    e.target.value = '';
  }

  function handleSend() {
    const text = draftText.trim();
    const file = queuedImage;
    if (!text && !file) return;

    // Release the composer immediately. App.tsx queues provider calls in order,
    // while optimistic bubbles appear without waiting for the network response.
    setDraftText('');
    onComposerChange('');
    setQueuedImage(null);
    setSendError(null);
    setPendingSends((count) => count + 1);
    atBottomRef.current = true;
    window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));

    void onSend(text, file)
      .then(() => window.setTimeout(() => scrollToBottom('smooth'), 40))
      .catch((err) => setSendError(err instanceof Error ? err.message : 'Ralat menghantar mesej. Cuba lagi.'))
      .finally(() => setPendingSends((count) => Math.max(0, count - 1)));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function copyDraft() {
    const text = draftText.trim();
    if (!text) return;
    await navigator.clipboard.writeText(text);
  }

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5] dark:bg-[var(--canvas)] gap-4 select-none">
        <div className="w-20 h-20 rounded-full bg-[#d9fdd3] dark:bg-[var(--bubble-out)] flex items-center justify-center">
          <MessageCircle size={36} className="text-[#00a884]" strokeWidth={1.5} />
        </div>
        <div className="text-center">
          <p className="text-xl font-medium text-[#41525d] dark:text-[var(--text)]">ICETAK Inbox</p>
          <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-1">Pilih perbualan untuk mula membaca</p>
          <p className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-0.5">decocake.my</p>
        </div>
      </div>
    );
  }

  const groupedMessages: Array<{ date: Date; messages: typeof conversation.messages }> = [];
  conversation.messages.forEach((msg) => {
    const last = groupedMessages[groupedMessages.length - 1];
    if (!last || !isSameDay(last.date, msg.timestamp)) groupedMessages.push({ date: msg.timestamp, messages: [msg] });
    else last.messages.push(msg);
  });

  const isExpired = conversation.channel === 'whatsapp' && !!conversation.lastInboundAt && Date.now() - conversation.lastInboundAt.getTime() >= 24 * 60 * 60 * 1000;
  const hasContent = draftText.trim().length > 0 || queuedImage !== null;
  const canSend = !isExpired && hasContent;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--chat-bg)] dark:bg-[var(--canvas)]">

      <ChatHeader conversation={conversation} onArchiveToggle={() => onArchiveToggle(conversation.id)} onMarkUnread={() => onMarkUnread(conversation.id)} onUrgentToggle={() => onUrgentToggle(conversation.id)} onShowCustomerPanel={onShowCustomerPanel} onBack={onBack} showCustomerPanel={showCustomerPanel} onMarkReplied={() => onMarkReplied(conversation.id)} orderOnly={orderOnly} />

      {conversation.channel === 'whatsapp' && <div className="sm:hidden px-4 py-2 bg-[#f0f2f5] dark:bg-[var(--surface-muted)]"><WindowBadge lastInboundAt={conversation.lastInboundAt} /></div>}

      {hasMatches && (
        <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-[#fff8e1] dark:bg-[#2d2600] border-b border-[#f0d060] dark:border-[#4a3e00] relative z-20">
          <span className="text-xs text-[#7a6000] dark:text-[#ffd600] font-medium">{matchIds.length} padanan ditemui — {currentMatchIdx + 1} / {matchIds.length}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setCurrentMatchIdx((i) => (i - 1 + matchIds.length) % matchIds.length)} className="p-1 rounded text-[#7a6000] dark:text-[#ffd600]"><ChevronUp size={16} /></button>
            <button onClick={() => setCurrentMatchIdx((i) => (i + 1) % matchIds.length)} className="p-1 rounded text-[#7a6000] dark:text-[#ffd600]"><ChevronDown size={16} /></button>
          </div>
        </div>
      )}

      <div ref={scrollAreaRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-4 sm:px-8 py-4 relative z-10">
        {messagesLoading ? <div className="flex items-center justify-center h-full"><Loader2 size={24} className="animate-spin text-[#00a884]" /></div> : (
          <div ref={scrollContentRef} className="flex flex-col gap-1.5 max-w-3xl mx-auto">
            {groupedMessages.length === 0 && (
              <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-500/10"><MessageCircle size={26} className="text-orange-700 dark:text-orange-400" /></div>
                <div>
                  <p className="text-sm font-semibold text-[#41525d] dark:text-[var(--text)]">Belum ada mesej dengan customer ini</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{orderOnly ? 'Order tetap tersedia walaupun customer tidak pernah chat.' : 'Conversation ini masih kosong.'}</p>
                  {conversation.orderId && <p className="mt-1 text-[11px] font-medium text-orange-700 dark:text-orange-400">Order #{conversation.orderId}</p>}
                </div>
              </div>
            )}
            {groupedMessages.map((group) => (
              <div key={group.date.toISOString()} className="flex flex-col gap-1.5">
                <div className="flex justify-center my-2"><span className="bg-[#ffffff] dark:bg-[#1d282f] text-[#54656f] dark:text-[var(--text-secondary)] text-xs px-3 py-1 rounded-full shadow-sm">{formatDaySeparator(group.date)}</span></div>
                {group.messages.map((msg) => <MessageBubble key={msg.id} message={msg} searchQuery={searchQuery} isCurrentMatch={msg.id === currentMatchId} />)}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="flex flex-col bg-[#f0f2f5] dark:bg-[var(--surface-muted)] border-t border-[#e9edef] dark:border-[var(--border)] relative z-10">
        {sendError && <div className="flex items-center gap-2 px-4 py-1.5 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-800/40"><AlertCircle size={12} className="text-red-500" /><span className="text-xs text-red-600 dark:text-red-400 flex-1">{sendError}</span><button onClick={() => setSendError(null)}><X size={12} /></button></div>}
        {templateSentNotice && <div className="flex items-center justify-between gap-2 border-b border-emerald-800/40 bg-emerald-950/30 px-4 py-2 text-xs text-emerald-700 dark:text-emerald-300"><span>Template berjaya dihantar dan direkodkan.</span><button onClick={() => setTemplateSentNotice(false)}><X size={12} /></button></div>}

        {orderOnly && conversation.channel === 'shopee' && (
          <div className="border-b border-orange-500/20 bg-orange-500/10 px-4 py-2 text-center text-[11px] text-orange-700 dark:text-orange-200">
            Mesej pertama akan dihantar melalui adapter Shopee Chat. Jika endpoint belum dikonfigurasi, mesej tidak akan direkod atau dianggap berjaya.
          </div>
        )}

        {isExpired && (
          <div className="flex flex-col items-center gap-2 px-4 py-3">
            <span className="bg-[#fff9c4] dark:bg-[#3b3b00] text-[#7a6f00] dark:text-[#ffd600] text-xs px-4 py-1.5 rounded-full shadow-sm text-center">Tetingkap 24 jam telah tamat. Free-form tidak dibenarkan.</span>
            {orderOnly && conversation.channel === 'whatsapp' ? (
              <p className="text-center text-[11px] text-[var(--text-secondary)]">Order WhatsApp belum mempunyai conversation aktif. Ia akan menggunakan flow WhatsApp biasa selepas dipautkan melalui nombor telefon.</p>
            ) : <div className="flex flex-wrap justify-center gap-2">
              <button onClick={() => setShowTemplateModal(true)} className="flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2 text-xs font-semibold text-white hover:bg-[#008f72]"><LayoutTemplate size={15} /> Pilih Template</button>
              <button onClick={copyDraft} disabled={!draftText.trim()} className="flex items-center gap-2 rounded-lg bg-[var(--surface-hover)] px-4 py-2 text-xs text-[var(--text)] disabled:opacity-40"><Copy size={15} /> Salin Mesej</button>
            </div>}
          </div>
        )}

        {imagePreviewUrl && !isExpired && (
          <div className="flex flex-col gap-1.5 px-4 pt-3 pb-1">
            <div className="relative w-fit">
              <img src={imagePreviewUrl} alt="Preview" className="max-h-32 max-w-[180px] rounded-lg object-cover border border-[#d1d7db] dark:border-[var(--border)]" />
              <button onClick={() => setQueuedImage(null)} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[var(--surface-hover)] text-white flex items-center justify-center hover:bg-red-500 transition-colors" aria-label="Buang gambar"><X size={11} /></button>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">Gambar sudah masuk queue. Taip caption jika perlu, kemudian tekan Enter atau Send.</p>
          </div>
        )}

        <div className="flex items-end gap-2 px-4 py-3">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          {!isExpired && !orderOnly && (
            <button onClick={() => fileInputRef.current?.click()} className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:text-[#00a884] hover:bg-[#e9edef] dark:hover:bg-[var(--surface-hover)] transition-colors" aria-label="Pilih gambar">
              <ImageIcon size={18} />
            </button>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={handleKeyDown}
            onKeyUp={(e) => e.stopPropagation()}
            onKeyPress={(e) => e.stopPropagation()}
            onPaste={handlePaste}
            placeholder={isExpired ? 'Tulis draft untuk disalin, atau pilih template.' : 'Taip mesej... (Enter untuk hantar, Shift+Enter untuk baris baru)'}
            className="flex-1 resize-none overflow-hidden text-sm rounded-lg px-4 py-2.5 outline-none focus:ring-1 focus:ring-[#00a884] transition-all leading-relaxed bg-white dark:bg-[var(--surface-hover)] text-[var(--text)] dark:text-[var(--text)] placeholder-[#667781] dark:placeholder-[var(--text-secondary)]"
            style={{ minHeight: '40px', maxHeight: '120px' }}
          />
          {!isExpired && (
            <button onClick={handleSend} disabled={!canSend} className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${!canSend ? 'bg-[var(--surface-hover)] text-[var(--text-secondary)]' : 'bg-[#00a884] text-white'}`}>
              {pendingSends > 0 && !hasContent ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          )}
        </div>
      </div>

      {showTemplateModal && <TemplateSendModal conversation={conversation} onClose={() => setShowTemplateModal(false)} onSent={() => setTemplateSentNotice(true)} />}
    </div>
  );
}
