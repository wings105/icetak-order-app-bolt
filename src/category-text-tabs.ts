type ProductKey = 'edible' | 'printed' | 'acrylic' | 'mirror' | 'burnaway' | 'wafer';

const CATEGORY_LABELS: Record<ProductKey, string> = {
  edible: 'Edible Image',
  printed: 'Cake Topper',
  acrylic: 'Acrylic Topper',
  mirror: 'Artcard Topper',
  burnaway: 'Burn Away',
  wafer: 'Wafer Paper',
};

const CATEGORY_ORDER: ProductKey[] = ['edible', 'printed', 'acrylic', 'mirror', 'burnaway', 'wafer'];

function keyFromButton(button: HTMLButtonElement): ProductKey | null {
  const raw = button.dataset.cat || button.dataset.jump || '';
  return raw in CATEGORY_LABELS ? (raw as ProductKey) : null;
}

function enhanceCategoryNav(nav: Element) {
  const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button[data-cat], button[data-jump]'));
  if (!buttons.length) return;

  nav.classList.add('text-only-category-nav');

  const byKey = new Map<ProductKey, HTMLButtonElement>();
  for (const button of buttons) {
    const key = keyFromButton(button);
    if (!key) continue;
    byKey.set(key, button);

    button.querySelectorAll('img, picture, em, i').forEach((node) => node.remove());

    let span = button.querySelector('span');
    if (!span) {
      span = document.createElement('span');
      button.append(span);
    }
    span.textContent = CATEGORY_LABELS[key];
    button.setAttribute('aria-label', CATEGORY_LABELS[key]);
  }

  for (const key of CATEGORY_ORDER) {
    const button = byKey.get(key);
    if (button) nav.append(button);
  }
}

function injectStyle() {
  if (document.querySelector('#category-text-tabs-style')) return;
  const style = document.createElement('style');
  style.id = 'category-text-tabs-style';
  style.textContent = `
    .text-only-category-nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      overflow-x: auto;
      padding: 10px 12px;
      background: #fff;
    }
    .text-only-category-nav button {
      min-width: auto !important;
      width: auto !important;
      height: auto !important;
      padding: 8px 12px !important;
      border: 1px solid #f1f5f9 !important;
      border-radius: 999px !important;
      background: #fff !important;
      color: #111827 !important;
      font-size: 13px !important;
      font-weight: 700 !important;
      white-space: nowrap;
      box-shadow: none !important;
    }
    .text-only-category-nav button.active,
    .text-only-category-nav button:hover {
      border-color: #ee4d2d !important;
      color: #ee4d2d !important;
      background: #fff7ed !important;
    }
    .text-only-category-nav button span {
      display: inline !important;
      font-size: inherit !important;
      line-height: 1.2 !important;
    }
  `;
  document.head.append(style);
}

function enhanceAllCategoryNavs() {
  injectStyle();
  document.querySelectorAll('.quick-nav, .product-tabs').forEach(enhanceCategoryNav);
}

if (typeof window !== 'undefined') {
  const observer = new MutationObserver(enhanceAllCategoryNavs);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', enhanceAllCategoryNavs);
  enhanceAllCategoryNavs();
}
