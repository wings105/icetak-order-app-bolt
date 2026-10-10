import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Message } from '../types';
import { formatTime } from '../utils/timeUtils';
import {
  AlertCircle, Clock3, Check, CheckCheck, Copy, Download, FileText, ImageIcon, Loader2,
  Mic, Minus, Plus, RotateCcw, SmilePlus, Video, X,
} from 'lucide-react';
import { useMediaUrl } from '../lib/mediaProxy';
import { MESSAGE_REACTIONS, reactToMessage } from '../lib/messageReactions';

interface MessageBubbleProps {
  message: Message;
  searchQuery?: string;
  isCurrentMatch?: boolean;
}

interface ImageLightboxProps {
  url: string;
  filename: string;
  alt: string;
  onClose: () => void;
}

const registry = new Map<string, Message>();
const listeners = new Set<() => void>();
function notifyRegistry() { listeners.forEach((listener) => listener()); }

const statusIcons = {
  pending: <Clock3 size={14} className="text-[var(--text-secondary)]" aria-label="Sedang dihantar" />,
  failed: <AlertCircle size={14} className="text-red-500" aria-label="Gagal dihantar" />,
  unknown: <AlertCircle size={14} className="text-amber-600" aria-label="Status penghantaran belum disahkan" />,
  sent: <Check size={14} className="text-[var(--text-secondary)]" />,
  delivered: <CheckCheck size={14} className="text-[var(--text-secondary)]" />,
  read: <CheckCheck size={14} className="text-[#53bdeb]" />,
};

const PLACEHOLDER_LABELS = new Set(['[Image]', '[Document]', '[Audio]', '[Video]', '[Sticker]', '[Business app message]', '[Unknown message]']);
const MEDIA_TYPES = new Set(['image', 'sticker', 'audio', 'video', 'document']);

function HighlightedContent({ text, query, isCurrentMatch }: { text: string; query: string; isCurrentMatch: boolean }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return <>{parts.map((part, i) => regex.test(part) ? <mark key={i} className={`rounded-[2px] px-[1px] text-inherit ${isCurrentMatch ? 'bg-orange-400 dark:bg-orange-500' : 'bg-yellow-300 dark:bg-yellow-600/70'}`}>{part}</mark> : <span key={i}>{part}</span>)}</>;
}

function safeFilename(value: string): string {
  const clean = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || `icetak-image-${Date.now()}`;
}

async function blobAsPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas tidak tersedia.');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Gagal menukar gambar ke PNG.')), 'image/png');
    });
  } finally {
    bitmap.close();
  }
}

function ImageLightbox({ url, filename, alt, onClose }: ImageLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const [downloadBusy, setDownloadBusy] = useState(false);

  const copyImage = useCallback(async () => {
    if (copyState === 'copying') return;
    setCopyState('copying');
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Browser tidak menyokong salin gambar.');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Gagal mengambil gambar (${response.status}).`);
      const png = await blobAsPng(await response.blob());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2500);
    }
  }, [copyState, url]);

  const downloadImage = useCallback(async () => {
    if (downloadBusy) return;
    setDownloadBusy(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Gagal mengambil gambar (${response.status}).`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${safeFilename(filename)}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } finally {
      setDownloadBusy(false);
    }
  }, [downloadBusy, filename, url]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      else if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(4, value + 0.25));
      else if (event.key === '-') setZoom((value) => Math.max(0.5, value - 0.25));
      else if (event.key === '0') setZoom(1);
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        void copyImage();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [copyImage, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/95 text-[var(--text)]" role="dialog" aria-modal="true" aria-label="Paparan penuh gambar">
      <div className="relative z-10 flex min-h-14 items-center justify-between gap-3 border-b border-white/10 bg-black/60 px-3 py-2 backdrop-blur sm:px-5">
        <div className="min-w-0"><p className="truncate text-sm font-medium">{alt || 'Gambar customer'}</p><p className="text-[10px] text-[var(--text)]/55">{Math.round(zoom * 100)}% · Esc untuk tutup</p></div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} disabled={zoom <= 0.5} className="rounded-full p-2.5 text-[var(--text)]/80 hover:bg-white/10 hover:text-[var(--text)] disabled:opacity-30" title="Zoom keluar"><Minus size={18} /></button>
          <button onClick={() => setZoom(1)} className="rounded-full p-2.5 text-[var(--text)]/80 hover:bg-white/10 hover:text-[var(--text)]" title="Saiz asal"><RotateCcw size={17} /></button>
          <button onClick={() => setZoom((value) => Math.min(4, value + 0.25))} disabled={zoom >= 4} className="rounded-full p-2.5 text-[var(--text)]/80 hover:bg-white/10 hover:text-[var(--text)] disabled:opacity-30" title="Zoom masuk"><Plus size={18} /></button>
          <div className="mx-1 h-6 w-px bg-white/15" />
          <button onClick={() => void copyImage()} disabled={copyState === 'copying'} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition ${copyState === 'copied' ? 'bg-emerald-500 text-white' : copyState === 'error' ? 'bg-red-500/80 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`} title="Salin gambar untuk paste ke Photoshop">
            {copyState === 'copying' ? <Loader2 size={15} className="animate-spin" /> : copyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}
            <span className="hidden sm:inline">{copyState === 'copied' ? 'Disalin' : copyState === 'error' ? 'Gagal salin' : 'Salin gambar'}</span>
          </button>
          <button onClick={() => void downloadImage()} disabled={downloadBusy} className="rounded-full p-2.5 text-[var(--text)]/80 hover:bg-white/10 hover:text-[var(--text)]" title="Download gambar">{downloadBusy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}</button>
          <button onClick={onClose} className="rounded-full p-2.5 text-[var(--text)]/80 hover:bg-white/10 hover:text-[var(--text)]" title="Tutup"><X size={22} /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="flex min-h-full min-w-full items-center justify-center p-4 sm:p-7" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          <img src={url} alt={alt || 'Gambar customer'} draggable={false} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => { event.stopPropagation(); setZoom((value) => value === 1 ? 2 : 1); }} className="max-h-[calc(100vh-7rem)] max-w-[calc(100vw-2rem)] select-none object-contain transition-transform duration-150" style={{ transform: `scale(${zoom})` }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MediaViewer({ message }: { message: Message }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const type = (message.messageType ?? '').toLowerCase();
  const { objectUrl, loading } = useMediaUrl(message.mediaUrl, shouldLoad || viewerOpen);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || shouldLoad) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: '180px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldLoad]);

  const placeholderIcon = type === 'audio' ? <Mic size={24} /> : type === 'video' ? <Video size={24} /> : type === 'document' ? <FileText size={24} /> : <ImageIcon size={24} />;

  if (!shouldLoad) {
    return <div ref={containerRef} className="flex h-36 w-52 items-center justify-center rounded-md bg-black/10 text-[var(--text-secondary)] dark:bg-white/10 dark:text-[var(--text-secondary)]">{placeholderIcon}</div>;
  }
  if (loading) return <div ref={containerRef} className="flex h-36 w-52 items-center justify-center rounded-md bg-black/10 animate-pulse dark:bg-white/10">{placeholderIcon}</div>;
  if (!objectUrl) return <div ref={containerRef} className="flex h-20 w-52 items-center justify-center rounded-md bg-black/10 text-xs text-[var(--text-secondary)] dark:bg-white/10 dark:text-[var(--text-secondary)]">Media tidak tersedia</div>;

  if (type === 'image') {
    const label = message.content && message.content !== '[Image]' ? message.content : 'Gambar customer';
    return <div ref={containerRef}>
      <button type="button" onClick={() => setViewerOpen(true)} className="block w-full cursor-zoom-in overflow-hidden rounded-md text-left" aria-label="Buka gambar penuh">
        <img src={objectUrl} alt={label} loading="lazy" decoding="async" className="max-h-72 w-full object-cover" />
      </button>
      {viewerOpen && <ImageLightbox url={objectUrl} filename={`icetak-${message.id}`} alt={label} onClose={() => setViewerOpen(false)} />}
    </div>;
  }
  if (type === 'sticker') return <div ref={containerRef}><img src={objectUrl} alt="Sticker" loading="lazy" decoding="async" className="max-h-32 w-auto" /></div>;
  if (type === 'audio') return <div ref={containerRef}><audio controls preload="none" src={objectUrl} className="h-10 w-full max-w-[240px]" /></div>;
  if (type === 'video') return <div ref={containerRef}><video controls preload="metadata" src={objectUrl} className="max-h-72 max-w-full rounded-md" /></div>;
  if (type === 'document') return <div ref={containerRef}><a href={objectUrl} download className="flex max-w-[220px] items-center gap-2 text-[13.5px] hover:underline"><FileText size={20} /><span className="flex-1 truncate">{message.content || 'Document'}</span><Download size={16} /></a></div>;
  return null;
}

function quoteLabel(message: Message) {
  const type = (message.messageType ?? 'text').toLowerCase();
  if (type === 'image') return message.content && message.content !== '[Image]' ? message.content : '📷 Gambar';
  if (type === 'document') return message.content || '📄 Dokumen';
  if (type === 'video') return message.content || '🎥 Video';
  if (type === 'audio') return '🎤 Audio';
  if (type === 'sticker') return 'Sticker';
  return message.content || 'Mesej';
}

function jumpToMessage(messageId: string) {
  const element = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.animate([{ boxShadow: '0 0 0 0 rgba(0,168,132,.8)' }, { boxShadow: '0 0 0 6px rgba(0,168,132,.25)' }, { boxShadow: '0 0 0 0 rgba(0,168,132,0)' }], { duration: 1100 });
}

function getStoredReaction(message: Message): string | null {
  const reactions = (message as unknown as { reactions?: Record<string, string> }).reactions;
  return reactions?.seller ?? null;
}

export function MessageBubble({ message, searchQuery = '', isCurrentMatch = false }: MessageBubbleProps) {
  const [showReactions, setShowReactions] = useState(false);
  const [sendingReaction, setSendingReaction] = useState(false);
  const [localReaction, setLocalReaction] = useState<string | null>(getStoredReaction(message));
  const [, setRegistryVersion] = useState(0);

  useEffect(() => { setLocalReaction(getStoredReaction(message)); }, [message]);
  useEffect(() => {
    if (message.providerMessageId) { registry.set(message.providerMessageId, message); notifyRegistry(); }
    const listener = () => setRegistryVersion((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); if (message.providerMessageId && registry.get(message.providerMessageId)?.id === message.id) registry.delete(message.providerMessageId); };
  }, [message]);

  const repliedMessage = message.replyToProviderMessageId ? registry.get(message.replyToProviderMessageId) : undefined;
  const isOut = message.direction === 'outbound';
  const type = (message.messageType ?? '').toLowerCase();
  const hasMedia = Boolean(message.mediaUrl) && MEDIA_TYPES.has(type);
  const hasCaption = !PLACEHOLDER_LABELS.has(message.content) && Boolean(message.content);
  const showText = !hasMedia || (hasCaption && type !== 'document');
  const hasMatch = searchQuery.trim().length >= 2 && message.content.toLowerCase().includes(searchQuery.trim().toLowerCase());
  const bubbleBg = isOut ? 'bg-[#d9fdd3] dark:bg-[var(--bubble-out)] text-[var(--text)] dark:text-[var(--text)] rounded-br-none' : 'bg-white dark:bg-[var(--surface-muted)] text-[var(--text)] dark:text-[var(--text)] rounded-bl-none';

  async function sendReaction(emoji: string) {
    setSendingReaction(true);
    try {
      await reactToMessage(message.id, emoji);
      setLocalReaction(emoji);
      setShowReactions(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Gagal menghantar reaction.');
    } finally {
      setSendingReaction(false);
    }
  }

  return <div className={`group flex w-full ${isOut ? 'justify-end' : 'justify-start'}`} data-message-id={message.id}>
    <div className={`flex w-full items-end gap-1 ${isOut ? 'justify-end' : 'justify-start'}`}>
      {!isOut && message.providerMessageId && <button type="button" onClick={() => setShowReactions((value) => !value)} className="mb-1 rounded-full p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] sm:opacity-0 sm:group-hover:opacity-100" aria-label="React"><SmilePlus size={15} /></button>}
      <div className={`relative max-w-[75%] overflow-visible rounded-lg shadow-sm transition-all sm:max-w-[65%] ${bubbleBg} ${isCurrentMatch ? 'ring-2 ring-orange-400 ring-offset-1 dark:ring-orange-500' : ''} ${hasMedia && !showText ? 'p-1' : 'px-3 py-2'}`}>
        {message.replyToProviderMessageId && <button type="button" onClick={() => repliedMessage && jumpToMessage(repliedMessage.id)} className="mb-1.5 block w-full rounded-md border-l-4 border-[#00a884] bg-black/10 px-2.5 py-2 text-left dark:bg-black/20"><span className="block text-[11px] font-semibold text-[#00a884]">{repliedMessage ? (repliedMessage.direction === 'outbound' ? 'Anda' : 'Customer') : 'Quoted message'}</span><span className="block truncate text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{repliedMessage ? quoteLabel(repliedMessage) : 'Mesej asal tidak ada dalam sejarah inbox'}</span></button>}
        {hasMedia && <MediaViewer message={message} />}
        {showText && <p className={`break-words whitespace-pre-wrap text-[13.5px] leading-[1.5] ${hasMedia ? 'mt-1 px-2' : ''}`}>{hasMatch ? <HighlightedContent text={message.content} query={searchQuery} isCurrentMatch={isCurrentMatch} /> : message.content}</p>}
        <div className={`mt-1 flex items-center gap-1 ${isOut ? 'justify-end' : 'justify-start'} ${hasMedia && !showText ? 'px-2 pb-1' : ''}`}><span className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{formatTime(message.timestamp)}</span>{isOut && message.status && statusIcons[message.status]}</div>
        {showReactions && <div className={`absolute bottom-full z-30 mb-1 flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xl ${isOut ? 'right-0' : 'left-0'}`}>{MESSAGE_REACTIONS.map((emoji) => <button key={emoji} type="button" disabled={sendingReaction} onClick={() => void sendReaction(emoji)} className="rounded-full px-1.5 py-1 text-lg hover:bg-[var(--surface-hover)] disabled:opacity-40">{emoji}</button>)}</div>}
        {localReaction && <span className={`absolute -bottom-3 ${isOut ? 'left-2' : 'right-2'} rounded-full bg-[var(--surface)] px-2 py-0.5 text-sm shadow`}>{localReaction}</span>}
      </div>
    </div>
  </div>;
}
