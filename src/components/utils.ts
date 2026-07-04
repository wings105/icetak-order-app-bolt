import type { OrderStatus, PaymentStatus } from '../lib/types';

export function fmtCurrency(v: number): string {
  return `RM ${Number(v).toFixed(2)}`;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-MY', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-MY', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function statusClass(s: string): string {
  const map: Record<string, string> = {
    pending:       'pill-yellow',
    confirmed:     'pill-blue',
    in_production: 'pill-orange',
    ready:         'pill-purple',
    shipped:       'pill-cyan',
    delivered:     'pill-green',
    cancelled:     'pill-red',
  };
  return map[s] ?? 'pill-gray';
}

export function statusLabel(s: string): string {
  const map: Record<string, string> = {
    pending:       'Pending',
    confirmed:     'Confirmed',
    in_production: 'In Production',
    ready:         'Ready',
    shipped:       'Shipped',
    delivered:     'Delivered',
    cancelled:     'Cancelled',
  };
  return map[s] ?? s;
}

export function paymentClass(s: PaymentStatus | string): string {
  const map: Record<string, string> = {
    unpaid:   'pill-red',
    partial:  'pill-yellow',
    paid:     'pill-green',
    refunded: 'pill-gray',
    matched:  'pill-green',
    pending:  'pill-yellow',
    failed:   'pill-red',
  };
  return map[s] ?? 'pill-gray';
}

export function paymentLabel(s: PaymentStatus | string): string {
  const map: Record<string, string> = {
    unpaid:   'Unpaid',
    partial:  'Partial',
    paid:     'Paid',
    refunded: 'Refunded',
    matched:  'Matched',
    pending:  'Pending',
    failed:   'Failed',
  };
  return map[s] ?? s;
}

export const ALL_STATUSES: OrderStatus[] = [
  'pending', 'confirmed', 'in_production', 'ready', 'shipped', 'delivered', 'cancelled',
];
