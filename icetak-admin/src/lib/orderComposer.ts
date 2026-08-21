import {
  ADMIN_PRODUCTS,
  DELIVERY,
  adminProductPrice,
  adminProductStyles,
  normalizeMalaysiaPhone,
  type AdminProductKind,
  type DeliveryKind,
  type ProductReview,
} from './orderProducts.ts';

export type ComposerPaymentMode = 'prepaid' | 'cash_counter';
export type ComposerAction = 'save_draft' | 'send_customer' | 'confirm_pickup' | 'confirm_paid' | 'confirm_qrpay';

export type ComposerItem = {
  id: string;
  kind: AdminProductKind;
  title: string;
  customItem: boolean;
  qty: number;
  process: string;
  size: string;
  style: string;
  review: ProductReview;
  wording: string;
  referenceUrl: string;
  sellerDealPrice: string;
  priceReason: string;
};

export type ComposerAdjustments = {
  customAddon: string;
  customAddonReason: string;
  discountType: 'amount' | 'percent';
  discountValue: string;
  discountReason: string;
  rounding: string;
  roundingReason: string;
};

export type ComposerCustomer = {
  name: string;
  phone: string;
  bsuid: string;
  username: string;
  addressLine1: string;
  addressLine2: string;
  postcode: string;
  city: string;
  state: string;
};

export type ComposerTotals = {
  catalogSubtotal: number;
  itemSubtotal: number;
  sellerDealSavings: number;
  addon: number;
  discountAmount: number;
  shipping: number;
  rounding: number;
  total: number;
};

export const EMPTY_CUSTOMER: ComposerCustomer = {
  name: '', phone: '', bsuid: '', username: '', addressLine1: '', addressLine2: '', postcode: '', city: '', state: '',
};

export const EMPTY_ADJUSTMENTS: ComposerAdjustments = {
  customAddon: '', customAddonReason: '', discountType: 'amount', discountValue: '', discountReason: '', rounding: '', roundingReason: '',
};

const amount = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const rounded = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const isValidWhatsAppUserId = (value: string) => /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/i.test(String(value || '').trim());

export function makeComposerItem(kind: AdminProductKind = 'edible', customItem = false): ComposerItem {
  const product = ADMIN_PRODUCTS[kind];
  return {
    id: crypto.randomUUID(),
    kind,
    title: customItem ? '' : product.label,
    customItem,
    qty: 1,
    process: product.process[0],
    size: product.defaultSize,
    style: product.defaultStyle,
    review: product.defaultReview,
    wording: '',
    referenceUrl: '',
    sellerDealPrice: '',
    priceReason: '',
  };
}

export function normalizeComposerItem(item: ComposerItem, patch: Partial<ComposerItem> = {}): ComposerItem {
  const next = { ...item, ...patch };
  const product = ADMIN_PRODUCTS[next.kind];
  if (!product.process.includes(next.process)) next.process = product.process[0];
  if (!product.sizes.includes(next.size)) next.size = product.defaultSize;
  const styles = adminProductStyles(next.kind, next.size);
  if (!styles.includes(next.style)) next.style = styles[0] || product.defaultStyle;
  if (next.review !== 'Need Review' && next.review !== 'No Review') next.review = product.defaultReview;
  if (!next.customItem) next.title = product.label;
  next.qty = Math.max(1, Math.floor(amount(next.qty) || 1));
  return next;
}

export function composerCatalogPrice(item: ComposerItem) {
  return adminProductPrice(item.kind, item.process, item.size, item.style, item.review);
}

export function composerEffectivePrice(item: ComposerItem) {
  return item.sellerDealPrice.trim() === ''
    ? composerCatalogPrice(item)
    : rounded(Math.max(0, amount(item.sellerDealPrice)));
}

export function calculateComposerTotals(items: ComposerItem[], delivery: DeliveryKind, adjustments: ComposerAdjustments): ComposerTotals {
  const catalogSubtotal = rounded(items.reduce((total, item) => total + composerCatalogPrice(item) * Math.max(1, item.qty), 0));
  const itemSubtotal = rounded(items.reduce((total, item) => total + composerEffectivePrice(item) * Math.max(1, item.qty), 0));
  const addon = rounded(Math.max(0, amount(adjustments.customAddon)));
  const discountValue = Math.max(0, amount(adjustments.discountValue));
  const discountAmount = adjustments.discountType === 'percent'
    ? rounded((itemSubtotal + addon) * Math.min(discountValue, 100) / 100)
    : rounded(Math.min(discountValue, itemSubtotal + addon));
  const shipping = rounded(DELIVERY[delivery]?.fee || 0);
  const rounding = rounded(amount(adjustments.rounding));
  const total = rounded(Math.max(0, itemSubtotal + addon - discountAmount + shipping + rounding));
  return {
    catalogSubtotal,
    itemSubtotal,
    sellerDealSavings: rounded(catalogSubtotal - itemSubtotal),
    addon,
    discountAmount,
    shipping,
    rounding,
    total,
  };
}

export function createComposerPayload(input: {
  customer: ComposerCustomer;
  items: ComposerItem[];
  adjustments: ComposerAdjustments;
  delivery: DeliveryKind;
  paymentMode: ComposerPaymentMode;
  dateNeed: string;
  source: string;
  note: string;
  notifyWhatsapp: boolean;
}) {
  const { customer, items, adjustments, delivery, paymentMode } = input;
  const phone = normalizeMalaysiaPhone(customer.phone);
  const bsuid = customer.bsuid.trim();
  const username = customer.username.trim().replace(/^@+/, '');
  const mappedItems = items.map((raw) => {
    const item = normalizeComposerItem(raw);
    const catalog = composerCatalogPrice(item);
    const deal = item.sellerDealPrice.trim() === '' ? null : rounded(Math.max(0, amount(item.sellerDealPrice)));
    const wording = item.wording.trim();
    const reference = item.referenceUrl.trim();
    const title = item.customItem ? item.title.trim() : ADMIN_PRODUCTS[item.kind].label;
    const pricing = { catalog_price: catalog, seller_deal_price: deal, price_reason: item.priceReason.trim(), price_source: deal === null ? 'catalog' : 'seller_deal' };
    return {
      k: item.kind,
      kind: item.kind,
      product_type: item.kind,
      title,
      is_custom_item: item.customItem,
      process: item.process,
      review: item.review,
      review_required: item.review === 'Need Review',
      size: item.size,
      style: item.style,
      qty: Math.max(1, item.qty),
      price: catalog,
      catalog_price: catalog,
      seller_deal_price: deal,
      price_reason: item.priceReason.trim(),
      wording,
      customText: wording,
      custom_text: wording,
      referenceUrl: reference,
      customization: {
        admin_process: item.process,
        admin_reviewed: true,
        manual_custom_item: item.customItem,
        pricing,
        ...(reference ? { reference_url: reference } : {}),
      },
      product_snapshot: {
        quick_arrange_kind: item.kind,
        ...(reference ? { image_url: reference } : {}),
      },
    };
  });
  return {
    customer: {
      name: customer.name.trim(),
      phone,
      address_line1: customer.addressLine1.trim(),
      address_line2: customer.addressLine2.trim(),
      postcode: customer.postcode.trim(),
      city: customer.city.trim(),
      state: customer.state.trim(),
    },
    whatsapp_identity: {
      phone: phone || null,
      bsuid: bsuid || null,
      username: username || null,
    },
    items: mappedItems,
    date_need: input.dateNeed || null,
    delivery,
    delivery_fee: DELIVERY[delivery]?.fee || 0,
    payment_mode: paymentMode,
    source_type: 'admin_manual',
    order_source: input.source,
    admin_remark: input.note.trim(),
    notify_whatsapp: input.notifyWhatsapp,
    price_adjustments: {
      custom_addon: rounded(Math.max(0, amount(adjustments.customAddon))),
      custom_addon_reason: adjustments.customAddonReason.trim(),
      discount_type: adjustments.discountType,
      discount_value: rounded(Math.max(0, amount(adjustments.discountValue))),
      discount_reason: adjustments.discountReason.trim(),
      rounding: rounded(amount(adjustments.rounding)),
      rounding_reason: adjustments.roundingReason.trim(),
    },
    evidence: {
      source: 'admin_order_composer',
      manual_order: true,
      whatsapp_identity: { phone: phone || null, bsuid: bsuid || null, username: username || null },
    },
  };
}
