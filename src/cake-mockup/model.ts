export type Unit = 'inch' | 'cm';
export type Shape = 'round' | 'rect';
export type View = '3d' | 'top' | 'front';
export type Tier = { width: number; depth: number; height: number };
export type Product = {
  kind: 'edible' | 'acrylic'; shape: Shape; width: number; height: number;
  placement: 'top' | 'side'; tier: number; x: number; y: number; rotation: number;
  lift: number; color: string; wording: string; image: HTMLImageElement | null;
  imageName: string; lockRatio: boolean;
};
export type Config = { unit: Unit; shape: Shape; tiers: Tier[]; cakeColor: string; product: Product; measures: boolean };
export const factor = (unit: Unit) => unit === 'cm' ? 2.54 : 1;
export const round = (n: number) => Math.round(n * 100) / 100;
export const fmt = (inches: number, unit: Unit) => `${round(inches * factor(unit))} ${unit}`;
export const defaults = (): Config => ({
  unit: 'inch', shape: 'round', tiers: [{ width: 6, depth: 6, height: 4 }], cakeColor: '#fffdf9', measures: true,
  product: { kind: 'edible', shape: 'round', width: 5, height: 5, placement: 'top', tier: 0,
    x: 0, y: 0, rotation: 0, lift: 0.6, color: '#c69b48', wording: 'Happy Birthday', image: null, imageName: '', lockRatio: true },
});
export function layout(c: Config) {
  const tierIndex = Math.min(c.product.tier, c.tiers.length - 1);
  const tier = c.tiers[tierIndex];
  const bottom = c.tiers.slice(0, tierIndex).reduce((v, t) => v + t.height, 0) + 0.16;
  const top = bottom + tier.height;
  const p = c.product;
  const h = p.kind === 'edible' && p.shape === 'round' ? p.width : p.height;
  const ox = p.x / 100 * tier.width / 2;
  const oz = p.y / 100 * (c.shape === 'round' ? tier.width : tier.depth) / 2;
  return { tier, tierIndex, bottom, top, h, ox, oz, total: c.tiers.reduce((v, t) => v + t.height, 0) + 0.16 };
}
export function assessment(c: Config) {
  const { tier: t, h, ox, oz, tierIndex } = layout(c);
  const p = c.product;
  const warnings: string[] = [];
  let margin: number | null = null;
  let detail = '';
  if (p.kind === 'edible' && p.placement === 'top') {
    const a = p.rotation * Math.PI / 180;
    if (c.shape === 'round' && p.shape === 'round') margin = t.width / 2 - p.width / 2 - Math.hypot(ox, oz);
    else if (c.shape === 'round') {
      let furthest = 0;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const x = sx * p.width / 2, y = sy * h / 2;
        furthest = Math.max(furthest, Math.hypot(ox + x * Math.cos(a) - y * Math.sin(a), oz + x * Math.sin(a) + y * Math.cos(a)));
      }
      margin = t.width / 2 - furthest;
    } else {
      const w = p.shape === 'round' ? p.width : Math.abs(p.width * Math.cos(a)) + Math.abs(h * Math.sin(a));
      const d = p.shape === 'round' ? p.width : Math.abs(p.width * Math.sin(a)) + Math.abs(h * Math.cos(a));
      margin = Math.min(t.width / 2 - Math.abs(ox) - w / 2, t.depth / 2 - Math.abs(oz) - d / 2);
    }
    if (margin < -0.001) warnings.push(`Design terkeluar daripada permukaan kek (${fmt(-margin, c.unit)}).`);
    detail = margin >= 0 ? `Ruang tepi paling kecil: ${fmt(margin, c.unit)}.` : 'Kecilkan design atau ubah kedudukan.';
    if (tierIndex < c.tiers.length - 1) {
      const next = c.tiers[tierIndex + 1];
      const overlap = c.shape === 'round'
        ? Math.hypot(ox, oz) < next.width / 2 + Math.hypot(p.width, h) / 2
        : Math.abs(ox) < (next.width + p.width) / 2 && Math.abs(oz) < (next.depth + h) / 2;
      if (overlap) warnings.push('Sebahagian edible boleh terlindung oleh tier di atas. Semak pandangan Atas.');
    }
  } else if (p.placement === 'side') {
    const center = t.height / 2 + p.y / 100 * t.height / 2;
    const a = p.kind === 'acrylic' || c.shape === 'rect' ? p.rotation * Math.PI / 180 : 0;
    const vertical = Math.abs(p.width * Math.sin(a)) + Math.abs(h * Math.cos(a));
    if (center + vertical / 2 > t.height + 0.001 || center - vertical / 2 < -0.001)
      warnings.push('Design melebihi tinggi dinding kek pada kedudukan ini.');
    const span = c.shape === 'round' && p.kind === 'edible' ? Math.PI * t.width : t.width;
    if (p.width > span + 0.001) warnings.push(c.shape === 'round' && p.kind === 'edible' ? 'Edible lebih panjang daripada satu keliling kek; hujung akan bertindih.' : 'Design lebih lebar daripada bahagian depan kek.');
    if (c.shape === 'rect' && Math.abs(ox) + (Math.abs(p.width * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2 > t.width / 2 + 0.001)
      warnings.push('Design terkeluar dari tepi dinding kek.');
    detail = c.shape === 'round' && p.kind === 'edible'
      ? `Lebar ${fmt(p.width, c.unit)} diukur sepanjang lengkungan. Keliling kek: ${fmt(Math.PI * t.width, c.unit)}.`
      : p.kind === 'acrylic' && c.shape === 'round' ? 'Acrylic rata; hujungnya tidak melengkung mengikut dinding kek.' : `Tinggi dinding tier: ${fmt(t.height, c.unit)}.`;
  } else {
    detail = `Lebar topper ${fmt(p.width, c.unit)} berbanding kek ${fmt(t.width, c.unit)}.`;
    if (p.width > t.width) warnings.push('Topper lebih lebar daripada kek. Ini pilihan rupa; semak kestabilan pemasangan dengan baker.');
    if (c.shape === 'round' ? Math.hypot(ox, oz) > t.width / 2 : Math.abs(ox) > t.width / 2 || Math.abs(oz) > t.depth / 2)
      warnings.push('Batang topper berada di luar permukaan kek.');
    if (tierIndex < c.tiers.length - 1) warnings.push('Topper pada tier bawah boleh bertembung dengan tier di atas. Semak 3D.');
  }
  c.tiers.forEach((t, i) => {
    if (i && (t.width > c.tiers[i - 1].width || c.shape === 'rect' && t.depth > c.tiers[i - 1].depth)) warnings.push(`Tier ${i + 1} lebih besar daripada tier di bawah.`);
  });
  const short = Math.min(p.width, h), long = Math.max(p.width, h);
  if (p.kind === 'edible') {
    if (short > 7.5 + 0.001 || long > 11 + 0.001) warnings.push('Ukuran melebihi satu helaian edible A4 (7.5 × 11 inch). Perlu semakan kedai.');
  } else if (short > 14 / 2.54 + 0.001 || long > 20 / 2.54 + 0.001) warnings.push('Ukuran melebihi preset acrylic A5. Perlu semakan kedai.');
  return { warnings: [...new Set(warnings)], margin, detail };
}
export function summary(c: Config) {
  const p = c.product, h = layout(c).h;
  return [
    'Berminat dengan pilihan Cake Mockup:',
    `Kek: ${c.shape === 'round' ? 'Bulat' : 'Petak'} · ${c.tiers.length} tier`,
    ...c.tiers.map((t, i) => `Tier ${i + 1} (${i === 0 ? 'bawah' : 'atas'}): ${fmt(t.width, c.unit)}${c.shape === 'rect' ? ` × ${fmt(t.depth, c.unit)}` : ''} · tinggi ${fmt(t.height, c.unit)}`),
    `Produk: ${p.kind === 'edible' ? 'Edible image' : 'Acrylic topper'}`,
    `Saiz design: ${fmt(p.width, c.unit)} × ${fmt(h, c.unit)}${p.kind === 'edible' && p.shape === 'round' ? ' (bulat)' : ''}`,
    `Lokasi: ${p.placement === 'top' ? 'Atas' : 'Sisi'} kek · Tier ${p.tier + 1}`,
    ...(p.kind === 'acrylic' ? [`Wording: ${p.wording}`, `Ukuran design tidak termasuk batang.`] : []),
    `Tarikh perlu: __/__/____`,
    'Boleh semak kesesuaian dan cara nak proceed? Saya boleh lampirkan gambar mockup.',
  ].join('\n');
}
