export type SmartField = {
  key: string;
  label: string;
  hint: string;
  kind: 'name' | 'courier' | 'tracking' | 'tracking_url' | 'text' | 'url_suffix';
};

export function countTemplateVariables(text: unknown): number {
  if (typeof text !== 'string') return 0;
  const values = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  return values.length ? Math.max(...values) : 0;
}

function nearestLabel(body: string, token: string) {
  const position = body.indexOf(token);
  if (position < 0) return '';
  const before = body.slice(0, position);
  const lines = before.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (lines[lines.length - 1] ?? '').toLowerCase();
}

export function inferTemplateField(body: string, index: number): SmartField {
  const token = `{{${index}}}`;
  const label = nearestLabel(body, token);

  if (index === 1 && /hai|hello|nama|customer|pelanggan/.test(label)) {
    return { key: `b${index}`, label: 'Nama customer', hint: 'Contoh: Zaim', kind: 'name' };
  }
  if (/status penghantaran|semak status|pautan|link/.test(label)) {
    return { key: `b${index}`, label: 'Tracking URL', hint: 'Auto selepas courier dan tracking diisi', kind: 'tracking_url' };
  }
  if (/tracking|no\.? tracking|nombor tracking/.test(label)) {
    return { key: `b${index}`, label: 'Tracking number', hint: 'Contoh: SPX123456', kind: 'tracking' };
  }
  if (/courier|kurier|melalui/.test(label)) {
    return { key: `b${index}`, label: 'Courier', hint: 'Contoh: SPX', kind: 'courier' };
  }

  return { key: `b${index}`, label: `Body {{${index}}}`, hint: `Isi nilai untuk {{${index}}}`, kind: 'text' };
}

export function buildTrackingUrl(courier: string, tracking: string): string {
  const c = courier.trim().toLowerCase();
  const t = tracking.trim();
  if (!t) return '';
  if (c.includes('spx') || c.includes('shopee')) return `https://spx.com.my/track?${encodeURIComponent(t)}`;
  if (c.includes('j&t') || c.includes('jnt')) return `https://www.jtexpress.my/tracking/${encodeURIComponent(t)}`;
  if (c.includes('pos')) return `https://tracking.pos.com.my/tracking/${encodeURIComponent(t)}`;
  return t;
}

