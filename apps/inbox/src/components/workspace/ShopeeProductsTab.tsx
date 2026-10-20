import {useEffect, useState} from 'react';
import {ChevronLeft, ChevronRight, ExternalLink, Loader2, Search, Send, ShoppingBag} from 'lucide-react';
import type {Conversation, Message} from '../../types';
import {searchShopeeProducts, type CardSelection, type ShopeeCatalogProduct} from '../../lib/shopeeCardSend';
import {ShopeeCardDialog} from './ShopeeCardDialog';

export function ShopeeProductsTab({conversation, onSent}: {conversation: Conversation; onSent: (message: Message, warning?: string) => void}) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{items: ShopeeCatalogProduct[]; total: number; shop: string}>({items: [], total: 0, shop: ''});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CardSelection | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      void searchShopeeProducts(conversation.id, query.trim(), offset, controller.signal).then(result => {
        if (!controller.signal.aborted) setState({items: result.items, total: result.total, shop: result.shop_id});
      }).catch(reason => {if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Carian gagal.');})
        .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    }, query ? 300 : 0);
    return () => {window.clearTimeout(timer); controller.abort();};
  }, [conversation.id, query, offset, retry]);
  return <section className="h-full overflow-y-auto p-4" aria-label="Katalog produk Shopee">
    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Produk iCetak</h3>
    <div className="relative my-3"><Search size={14} className="absolute left-3 top-3 text-[var(--text-secondary)]"/><input aria-label="Cari produk Shopee" value={query} maxLength={120} onChange={event => {setLoading(true); setQuery(event.target.value); setOffset(0);}} placeholder="Cari nama, SKU atau Product ID…" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] py-2.5 pl-9 pr-3 text-xs outline-none focus:border-[#00a884]"/></div>
    <p className="mb-3 text-[10px] text-[var(--text-secondary)]">Katalog iCetak · Kedai {state.shop || String(conversation.metadata?.shop_id || '—')}</p>
    {error ? <div role="alert" className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">{error}<button onClick={() => {setLoading(true); setRetry(value => value + 1);}} className="ml-2 underline">Cuba semula</button></div> : loading ? <div role="status" className="flex items-center justify-center gap-2 py-8 text-xs"><Loader2 size={16} className="animate-spin"/>Mencari produk…</div> : <>
      <p className="mb-2 text-xs text-[var(--text-secondary)]">{state.total} produk{state.total > 0 ? ` · ${offset + 1}–${Math.min(offset + 20, state.total)}` : ''}</p>
      <div className="space-y-2">{state.items.map(product => <article key={product.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
        <div className="flex gap-3">{product.image_url ? <img src={product.image_url} alt="" loading="lazy" className="h-14 w-14 flex-shrink-0 rounded object-cover"/> : <ShoppingBag size={40} className="flex-shrink-0 text-[var(--text-secondary)]"/>}<div className="min-w-0"><p className="line-clamp-3 text-xs font-medium leading-5">{product.name}</p><p className="mt-1 text-xs font-semibold text-[var(--accent)]">{product.price == null ? 'Harga belum sync' : `${product.currency === 'MYR' ? 'RM' : product.currency + ' '}${Number(product.price).toFixed(2)}${product.max_price != null && Number(product.max_price) > Number(product.price) ? ` – ${Number(product.max_price).toFixed(2)}` : ''}`}</p></div></div>
        <p className="mt-2 text-[10px] text-[var(--text-secondary)]">ID {product.item_id} · Harga snapshot katalog</p>
        <div className="mt-2 flex items-center justify-end gap-2">{product.product_url && /^https:\/\/shopee\.(com\.my|sg)\//.test(product.product_url) && <a href={product.product_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1.5 text-[10px] text-[var(--text-secondary)]"><ExternalLink size={12}/>Lihat</a>}<button onClick={() => setSelected({type: 'product', id: product.id, title: product.name, image: product.image_url || undefined, itemId: product.item_id})} className="inline-flex items-center gap-1.5 rounded-md bg-[#00a884] px-3 py-1.5 text-[10px] font-semibold text-white"><Send size={12}/>Hantar produk</button></div>
      </article>)}</div>
      {state.items.length === 0 && <p className="py-8 text-center text-xs text-[var(--text-secondary)]">Tiada produk sepadan dalam kedai ini.</p>}
      {state.total > 20 && <div className="mt-4 flex items-center justify-between"><button aria-label="Produk sebelumnya" disabled={offset === 0} onClick={() => {setLoading(true); setOffset(value => Math.max(0, value - 20));}} className="rounded border border-[var(--border)] p-2 disabled:opacity-30"><ChevronLeft size={16}/></button><span className="text-xs">Halaman {Math.floor(offset / 20) + 1}</span><button aria-label="Produk seterusnya" disabled={offset + 20 >= state.total} onClick={() => {setLoading(true); setOffset(value => value + 20);}} className="rounded border border-[var(--border)] p-2 disabled:opacity-30"><ChevronRight size={16}/></button></div>}
    </>}
    {selected && <ShopeeCardDialog conversation={conversation} selection={selected} onClose={() => setSelected(null)} onSent={onSent}/>}
  </section>;
}
