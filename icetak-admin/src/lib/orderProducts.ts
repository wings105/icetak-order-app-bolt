export type AdminProductKind = 'edible' | 'burnaway' | 'wafer' | 'printed' | 'mirror' | 'acrylic';
export type ProductReview = 'No Review' | 'Need Review';
export type DeliveryKind = 'pickup' | 'spx' | 'jnt' | 'ninja';

export type AdminProductConfig = {
  label: string;
  shortLabel: string;
  tag: string;
  image: string;
  process: string[];
  sizes: string[];
  styles: string[];
  defaultSize: string;
  defaultStyle: string;
  defaultReview: ProductReview;
};

export const ADMIN_PRODUCTS: Record<AdminProductKind, AdminProductConfig> = {
  edible: {
    label: 'Edible Image', shortLabel: 'Edible', tag: 'Custom Print',
    image: 'https://cf.shopee.com.my/file/sg-11134201-23010-92ucf0wnrrlv85.jpg',
    process: ['Pre-order', 'Urgent'],
    sizes: ['3 inch', '3.5 inch', '4 inch', '4.5 inch', '5 inch', '5.5 inch', '6 inch', '6.5 inch', '7 inch', '7.5 inch', 'A6', 'A5', 'A4', 'Cupcake'],
    styles: ['Round / Bulat', 'Square / Petak', 'Love Shape / Hati', 'Full Landscape', 'Full Portrait', 'Custom'],
    defaultSize: '3 inch', defaultStyle: 'Round / Bulat', defaultReview: 'No Review',
  },
  burnaway: {
    label: 'Burn Away Combo', shortLabel: 'Burn Away', tag: '2 Layer',
    image: 'https://cf.shopee.com.my/file/my-11134207-7r98u-lrmqbo2qxw531d.jpg',
    process: ['Pre-order', 'Urgent'],
    sizes: ['3 inch', '4 inch', '5 inch', '5.5 inch', '6 inch', '6.5 inch', '7 inch', '7.5 inch', 'Custom A5', 'Custom A4'],
    styles: ['Round / Bulat', 'Square / Petak', 'Love Shape / Hati'],
    defaultSize: '5 inch', defaultStyle: 'Round / Bulat', defaultReview: 'No Review',
  },
  wafer: {
    label: 'Wafer Paper Only', shortLabel: 'Wafer', tag: 'Wafer Only',
    image: 'https://cf.shopee.com.my/file/my-11134207-7r992-lrwi64nt1t6fff.jpg',
    process: ['Pre-order', 'Urgent'],
    sizes: ['3 inch', '3.5 inch', '4 inch', '4.5 inch', '5 inch', '5.5 inch', '6 inch', '6.5 inch', '7 inch', '7.5 inch', '8 inch'],
    styles: ['Round / Bulat', 'Square / Petak', 'Love Shape / Hati'],
    defaultSize: '3 inch', defaultStyle: 'Round / Bulat', defaultReview: 'No Review',
  },
  printed: {
    label: 'Cake Topper', shortLabel: 'Topper', tag: 'Custom Name',
    image: 'https://icetak.myshopify.com/cdn/shop/products/15bace3254888672b80c9d166c4792e9_d2bf378c-423b-414b-be67-6b8455feed5a_360x.jpg',
    process: ['Pre-order'], sizes: ['1 pc'], styles: ['Custom Name', 'Happy Birthday'],
    defaultSize: '1 pc', defaultStyle: 'Happy Birthday', defaultReview: 'Need Review',
  },
  mirror: {
    label: 'Mirror Gold Artpaper', shortLabel: 'Mirror Gold', tag: 'Premium',
    image: 'https://icetak.myshopify.com/cdn/shop/products/d1e36d97-b781-45d2-aa72-b66ea994ecdb_360x.jpg',
    process: ['Pre-order', 'Urgent'], sizes: ['A7 Mini', 'A6 Standard', 'A5 Large'], styles: ['Gold'],
    defaultSize: 'A7 Mini', defaultStyle: 'Gold', defaultReview: 'No Review',
  },
  acrylic: {
    label: 'Acrylic Cake Topper', shortLabel: 'Acrylic', tag: 'Custom',
    image: 'https://cf.shopee.com.my/file/my-11134207-7qukw-ljwh8grpguaefa.jpg',
    process: ['Pre-order', 'Urgent'], sizes: ['A7 Mini', 'A6 Standard', 'A5 Large'],
    styles: ['Gold', 'Silver', 'Black', 'Rose Gold', 'Clear / Transparent', 'Dark Blue', 'Light Blue', 'Red', 'Yellow', 'Pink', 'Gold Glitter', 'Silver Glitter', 'Lilac / Light Purple', 'Mirror Blue', 'Bronze', 'Green', 'Orange', 'White'],
    defaultSize: 'A7 Mini', defaultStyle: 'Gold', defaultReview: 'No Review',
  },
};

export const DELIVERY: Record<DeliveryKind, { label: string; fee: number }> = {
  pickup: { label: 'Pickup', fee: 0 },
  spx: { label: 'Pos SPX', fee: 4.5 },
  jnt: { label: 'J&T', fee: 5.9 },
  ninja: { label: 'Ninja Van', fee: 6.9 },
};

export function adminProductStyles(kind: AdminProductKind, size: string) {
  if (kind === 'edible' && ['4 inch', '4.5 inch', '5 inch', '5.5 inch'].includes(size)) {
    return ['Round / Bulat', 'Square / Petak', 'Love Shape / Hati', 'Custom'];
  }
  return ADMIN_PRODUCTS[kind].styles;
}

function edibleBase(size: string, style = '') {
  if (size === 'A4' || size === 'Cupcake') return 24;
  if (size === 'A5') return 12;
  if (size === 'A6') return 6;
  const inches = Number.parseFloat(size);
  if (style === 'Square / Petak' && size === '4 inch') return 12;
  return inches >= 6 ? 24 : inches >= 4.5 ? 12 : 6;
}

export function adminProductPrice(kind: AdminProductKind, process: string, size: string, style = '', review: ProductReview = 'No Review') {
  if (kind === 'printed') return 10;
  if (kind === 'mirror') return process === 'Urgent' ? 18 : 15;
  if (kind === 'acrylic') {
    if (process === 'Urgent') return size === 'A7 Mini' ? 15 : size === 'A6 Standard' ? 25 : 40;
    return size === 'A7 Mini' ? 12 : size === 'A6 Standard' ? 20 : 35;
  }
  if (kind === 'burnaway') {
    if (size.includes('A4')) return 36;
    if (size.includes('A5')) return 18;
    const inches = Number.parseFloat(size);
    return inches >= 6 ? 30 : inches >= 5 ? 18 : 12;
  }
  if (kind === 'wafer') {
    const base = Number.parseFloat(size) <= 6 ? 6 : 12;
    return base + (process === 'Urgent' && review === 'Need Review' ? 2 : 0);
  }
  const base = edibleBase(size, style);
  if (process === 'Urgent' && review === 'Need Review') return base === 6 ? 7 : base === 12 ? 14 : base === 24 ? 28 : base;
  return base;
}

export function normalizeMalaysiaPhone(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  const normalized = digits.startsWith('60') ? digits : digits.startsWith('0') ? `60${digits.slice(1)}` : digits.startsWith('1') ? `60${digits}` : '';
  return /^601\d{8,9}$/.test(normalized) ? normalized : '';
}
