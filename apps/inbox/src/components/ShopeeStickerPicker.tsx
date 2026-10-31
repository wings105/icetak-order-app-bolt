import { useRef, useState } from 'react';
import { Loader2, Sticker, X } from 'lucide-react';
import { ORANGUTAN_STICKERS, ShopeeSticker } from '../lib/shopeeStickers';

export function ShopeeStickerPicker({onSend, recipient}: {onSend:(sticker:ShopeeSticker)=>Promise<void>; recipient:string}) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const busy = useRef(false);
  async function send(sticker: ShopeeSticker) {
    if (busy.current || failedImages.includes(sticker.sticker_id)) return;
    busy.current = true;
    setSending(true);
    setError('');
    try { await onSend(sticker); setOpen(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Sticker gagal dihantar.'); }
    finally { busy.current = false; setSending(false); }
  }
  return <div className="relative flex-shrink-0">
    <button type="button" aria-label="Pilih sticker orangutan" title="Sticker orangutan" aria-expanded={open} onClick={()=>setOpen(value=>!value)} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[#00a884]">
      <Sticker size={19}/>
    </button>
    {open && <section aria-label={`Sticker rasmi orangutan untuk ${recipient}`} aria-busy={sending} className="absolute bottom-12 -left-2 z-30 w-[min(320px,calc(100vw-32px))] rounded-xl border border-[var(--border)] bg-white dark:bg-[var(--surface)] shadow-xl text-[var(--text)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="text-sm font-semibold">Orangutan · Shopee</span>
        <button type="button" aria-label="Tutup sticker" onClick={()=>setOpen(false)} className="p-1"><X size={17}/></button>
      </div>
      <div className="grid grid-cols-4 gap-1 overflow-y-auto p-2 max-h-[min(250px,36dvh)]">
        {ORANGUTAN_STICKERS.map(sticker=><button type="button" key={sticker.sticker_id} aria-label={`Hantar ${sticker.label}`} disabled={sending||failedImages.includes(sticker.sticker_id)} onClick={()=>void send(sticker)} className="flex aspect-square items-center justify-center rounded-lg border-2 border-transparent p-1 hover:bg-gray-100 dark:hover:bg-[var(--surface-hover)] disabled:opacity-30">
          <img src={sticker.url} alt={sticker.label} loading="lazy" decoding="async" className="h-full w-full object-contain" onError={()=>setFailedImages(ids=>ids.includes(sticker.sticker_id)?ids:[...ids,sticker.sticker_id])}/>
        </button>)}
      </div>
      {error && <p role="alert" className="px-3 py-2 text-xs text-red-600">{error}</p>}
      <p role="status" className="flex items-center gap-2 border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)]">{sending ? <><Loader2 size={14} className="animate-spin"/>Menghantar…</> : 'Tekan sticker untuk terus hantar.'}</p>
    </section>}
  </div>;
}
