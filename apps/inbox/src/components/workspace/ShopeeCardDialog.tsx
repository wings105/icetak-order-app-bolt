import {useEffect, useRef, useState} from 'react';
import {Loader2, Send, X} from 'lucide-react';
import type {Conversation, Message} from '../../types';
import {CardSendError, sendShopeeCard, type CardSelection} from '../../lib/shopeeCardSend';

export function ShopeeCardDialog({conversation, selection, onClose, onSent}: {
  conversation: Conversation; selection: CardSelection; onClose: () => void;
  onSent: (message: Message, warning?: string) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus();
  }, []);
  const requestId = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  async function send() {
    if (inFlight.current || uncertain) return;
    inFlight.current = true; setBusy(true); setError('');
    try {const message = await sendShopeeCard(conversation.id, selection, requestId.current); onSent(message, message.sendWarning); onClose();}
    catch (reason) {setError(reason instanceof Error ? reason.message : 'Kad gagal dihantar.'); setUncertain(reason instanceof CardSendError && reason.uncertain);}
    finally {inFlight.current = false; setBusy(false);}
  }
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => {if (!busy) onClose();}}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="shopee-card-title" className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl" onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)');
        if (controls?.length) {
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
          else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
        }
      }
    }}>
      <div className="flex items-center justify-between gap-3"><h3 id="shopee-card-title" className="font-semibold text-[var(--text)]">Hantar kad {selection.type === 'order' ? 'order' : 'produk'}</h3><button autoFocus disabled={busy} onClick={onClose} aria-label="Tutup pratonton kad" className="rounded p-2 hover:bg-[var(--surface-hover)]"><X size={16}/></button></div>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">Kepada <strong>{conversation.customer.shopeeUsername || conversation.customer.name}</strong> · Shopee</p>
      <div className="my-4 flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
        {selection.image && <img src={selection.image} alt="" className="h-16 w-16 rounded object-cover"/>}
        <div className="min-w-0"><p className="break-words text-sm font-medium">{selection.title}</p><p className="mt-2 break-all text-xs text-[var(--text-secondary)]">{selection.type === 'order' ? selection.orderNo : `Product ID ${selection.itemId}`}</p></div>
      </div>
      {error && <p role="alert" className="mb-3 text-xs text-red-600 dark:text-red-300">{error}</p>}
      <div className="flex justify-end gap-2"><button disabled={busy} onClick={onClose} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">Batal</button><button disabled={busy || uncertain} onClick={() => void send()} className="inline-flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>} {busy ? 'Menghantar…' : 'Hantar kad'}</button></div>
    </section>
  </div>;
}
