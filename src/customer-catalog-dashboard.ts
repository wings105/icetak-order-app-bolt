import { supabase } from './supabase-client';
import './customer-catalog-dashboard.css';

type DashboardItem = {
  id: string;
  title: string;
  size?: string;
  style?: string;
  wording?: string;
  wording_mode?: string;
  image_url?: string;
  catalog_slug?: string;
  product_snapshot?: Record<string, unknown>;
  customization?: Record<string, unknown>;
};
type DashboardResponse = {
  success?: boolean;
  items?: DashboardItem[];
};

const cache = new Map<string, Promise<DashboardResponse | null>>();
let scheduled = false;

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char));
}
function selectedOrderToken() {
  return new URL(location.href).searchParams.get('order') || (history.state as { orderToken?: string } | null)?.orderToken || '';
}
function dashboard(token: string) {
  if (!cache.has(token)) {
    cache.set(token, supabase
      .rpc('icetak_customer_order_dashboard' as never, { p_order_token: token } as never)
      .then(({ data, error }) => {
        if (error) throw error;
        return (data || null) as DashboardResponse | null;
      })
      .catch((error) => {
        console.warn('Customer catalogue dashboard enrichment failed', error);
        cache.delete(token);
        return null;
      }));
  }
  return cache.get(token)!;
}
function itemImage(item?: DashboardItem) {
  const snapshot = item?.product_snapshot || {};
  return String(item?.image_url || snapshot.image_url || '');
}
function selectionText(item: DashboardItem) {
  const wordingLabel = String(item.customization?.wording_label || item.style || '').trim();
  const wording = String(item.wording || item.customization?.custom_text || '').trim();
  const values = [
    item.size ? `Saiz: ${item.size}` : '',
    wordingLabel ? `Pilihan: ${wordingLabel}` : '',
    wording && wording !== wordingLabel ? `Wording: ${wording}` : '',
  ].filter(Boolean);
  return values;
}
async function enrichHistoryCard(card: HTMLElement) {
  if (card.dataset.catalogHydrating || card.dataset.catalogHydrated) return;
  const token = card.dataset.cpOrder || '';
  if (!token) return;
  card.dataset.catalogHydrating = '1';
  const data = await dashboard(token);
  delete card.dataset.catalogHydrating;
  if (!data?.success || !data.items?.length || !document.body.contains(card)) return;
  const images = card.querySelectorAll<HTMLImageElement>('.cp-preview-images img');
  images.forEach((image, index) => {
    const source = itemImage(data.items?.[index]);
    if (source) image.src = source;
  });
  const first = data.items[0];
  const copy = card.querySelector<HTMLElement>('.cp-preview-copy');
  if (copy && first) {
    const values = selectionText(first);
    if (values.length && !copy.querySelector('.cp-catalog-history-meta')) {
      const meta = document.createElement('small');
      meta.className = 'cp-catalog-history-meta';
      meta.textContent = values.join(' • ');
      copy.insertBefore(meta, copy.querySelector('strong'));
    }
  }
  card.dataset.catalogHydrated = '1';
}
async function enrichOrderPage() {
  const token = selectedOrderToken();
  if (!token) return;
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.cp-production .cp-item-card'));
  if (!cards.length) return;
  const data = await dashboard(token);
  if (!data?.success || !data.items?.length) return;
  cards.forEach((card, index) => {
    if (!document.body.contains(card)) return;
    const item = data.items?.[index];
    if (!item) return;
    const image = card.querySelector<HTMLImageElement>('header img');
    const source = itemImage(item);
    if (image && source) image.src = source;
    if (!card.querySelector('.cp-catalog-selection')) {
      const values = selectionText(item);
      if (values.length) {
        const selection = document.createElement('div');
        selection.className = 'cp-catalog-selection';
        selection.innerHTML = values.map((value) => `<span>${esc(value)}</span>`).join('');
        const header = card.querySelector('header');
        header?.insertAdjacentElement('afterend', selection);
      }
    }
  });
}
function run() {
  scheduled = false;
  document.querySelectorAll<HTMLElement>('.cp-order-card[data-cp-order]').forEach((card) => void enrichHistoryCard(card));
  void enrichOrderPage();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(run, 60);
}

const observer = new MutationObserver(schedule);
observer.observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
window.addEventListener('popstate', schedule);
window.addEventListener('hashchange', schedule);
window.setTimeout(schedule);
