export type ProductType =
  | 'business_card'
  | 'flyer'
  | 'banner'
  | 'brochure'
  | 'sticker'
  | 'letterhead'
  | 'envelope'
  | 'notebook'
  | 'calendar'
  | 'poster'
  | 'custom';

export interface ProductOption {
  label: string;
  sizes: string[];
  defaultQty: number;
  pricePerUnit: number;
}

export const PRODUCT_CATALOG: Record<ProductType, ProductOption> = {
  business_card: {
    label: 'Business Card',
    sizes: ['85x55mm', '90x55mm', '90x54mm'],
    defaultQty: 100,
    pricePerUnit: 0.25,
  },
  flyer: {
    label: 'Flyer',
    sizes: ['A4', 'A5', 'A6', 'DL'],
    defaultQty: 100,
    pricePerUnit: 0.5,
  },
  banner: {
    label: 'Banner',
    sizes: ['1x2m', '1x3m', '2x3m', '2x4m', 'custom'],
    defaultQty: 1,
    pricePerUnit: 35,
  },
  brochure: {
    label: 'Brochure',
    sizes: ['A4 Tri-fold', 'A5 Bi-fold', 'DL Tri-fold'],
    defaultQty: 100,
    pricePerUnit: 0.8,
  },
  sticker: {
    label: 'Sticker',
    sizes: ['A4 sheet', '50x50mm', '70x70mm', '100x100mm', 'custom'],
    defaultQty: 50,
    pricePerUnit: 0.6,
  },
  letterhead: {
    label: 'Letterhead',
    sizes: ['A4'],
    defaultQty: 100,
    pricePerUnit: 0.4,
  },
  envelope: {
    label: 'Envelope',
    sizes: ['DL', 'C5', 'C4'],
    defaultQty: 100,
    pricePerUnit: 0.3,
  },
  notebook: {
    label: 'Notebook',
    sizes: ['A5 50pp', 'A5 100pp', 'A4 50pp', 'A4 100pp'],
    defaultQty: 10,
    pricePerUnit: 8,
  },
  calendar: {
    label: 'Calendar',
    sizes: ['A3 Wall', 'A4 Wall', 'A5 Desk'],
    defaultQty: 10,
    pricePerUnit: 12,
  },
  poster: {
    label: 'Poster',
    sizes: ['A3', 'A2', 'A1', 'A0'],
    defaultQty: 10,
    pricePerUnit: 3,
  },
  custom: {
    label: 'Custom / Other',
    sizes: ['custom'],
    defaultQty: 1,
    pricePerUnit: 0,
  },
};

export const PRODUCT_TYPES = Object.keys(PRODUCT_CATALOG) as ProductType[];

export function getProductLabel(type: string): string {
  return PRODUCT_CATALOG[type as ProductType]?.label ?? type;
}
