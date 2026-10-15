import { useRef, useState } from 'react';
import { Loader2, Send, Sticker, X } from 'lucide-react';
import { ORANGUTAN_STICKERS, ShopeeSticker } from '../lib/shopeeStickers';

export function ShopeeStickerPicker({onSend, recipient}: {onSend:(sticker:ShopeeSticker)=>Promise<void>; recipient:string}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ShopeeSticker | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const busy = useRef(false);
  async function send() {
    if (!selected || busy.current) return;
    busy.current = true;
    setSending(true);
    setError('');
    try { await onSend(selected); setSelected(null); setOpen(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Sticker gagal dihantar.'); }
    finally { busy.current = false; setSending(false); }
  }
  return <div className="relative flex-shrink-0">
    <button type="button" aria-label="Pilih sticker orangutan" title="Sticker orangutan" aria-expanded={open} onClick={()=>setOpen(value=>!value)} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[#00a884]">
      <Sticker size={19}/>
    </button>
    {open && <section aria-label="Sticker rasmi orangutan" className="absolute bottom-12 -left-2 z-30 w-[min(320px,calc(100vw-32px))] rounded-xl border border-[var(--border)] bg-white dark:bg-[var(--surface)] shadow-xl text-[var(--text)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="text-sm font-semibold">Orangutan · Shopee</span>
        <button type="button" aria-label="Tutup sticker" onClick={()=>setOpen(false)} className="p-1"><X size={17}/></button>
      </div>
      <div className="grid grid-cols-4 gap-1 overflow-y-auto p-2 max-h-[min(250px,36dvh)]">
        {ORANGUTAN_STICKERS.map(sticker=><button type="button" key={sticker.sticker_id} aria-label={`Pilih ${sticker.label}`} aria-pressed={selected?.sticker_id===sticker.sticker_id} disabled={sending||failedImages.includes(sticker.sticker_id)} onClick={()=>{setSelected(sticker);setError('');}} className={`flex aspect-square items-center justify-center rounded-lg border-2 p-1 disabled:opacity-30 ${selected?.sticker_id===sticker.sticker_id?'border-[#00a884] bg-emerald-50 dark:bg-emerald-950':'border-transparent hover:bg-gray-100 dark:hover:bg-[var(--surface-hover)]'}`}>
          <img src={sticker.url} alt={sticker.label} loading="lazy" decoding="async" className="h-full w-full object-contain" onError={()=>setFailedImages(ids=>ids.includes(sticker.sticker_id)?ids:[...ids,sticker.sticker_id])}/>
        </button>)}
      </div>
      {error && <p role="alert" className="px-3 py-2 text-xs text-red-600">{error}</p>}
      {selected ? <div className="border-t border-[var(--border)] p-3">
        <div className="flex items-center gap-2 mb-2"><img src={selected.url} alt={`Preview ${selected.label}`} className="h-14 w-14 object-contain"/><span className="min-w-0 truncate text-xs">Kepada {recipient}</span></div>
        <button type="button" onClick={()=>void send()} disabled={sending||failedImages.includes(selected.sticker_id)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{sending?<Loader2 size={16} className="animate-spin"/>:<Send size={16}/>} {sending?'Menghantar…':'Hantar sticker'}</button>
      </div> : <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)]">Pilih sticker untuk lihat sebelum hantar.</p>}
    </section>}
  </div>;
}
