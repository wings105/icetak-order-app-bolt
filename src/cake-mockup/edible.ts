export type EdibleShape = 'round' | 'square' | 'rect' | 'heart';
export type Orientation = 'landscape' | 'portrait';
export type EdiblePreset = { id: string; shape: EdibleShape; width: number; height: number; price: number; name?: string; perPc?: boolean; capacity?: number };
type Dimensions = { kind: 'edible' | 'acrylic'; shape: EdibleShape; width: number; height: number };
export const shapeLabels: Record<EdibleShape, string> = { round: 'Bulat', square: 'Square', rect: 'Rectangular', heart: 'Love' };
const sizes = [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5];
export const edibleCatalog: EdiblePreset[] = [
  { id: 'cupcake-1.8', shape: 'round', width: 1.8, height: 1.8, price: 1.2, name: 'Cupcake', perPc: true, capacity: 24 },
  ...(['round', 'square', 'heart'] as const).flatMap(shape => sizes.map(size => ({
    id: `${shape}-${size}`, shape, width: size, height: size,
    price: size <= (shape === 'square' ? 3.5 : 4) ? 6 : size <= 5.5 ? 12 : 24,
  }))),
  { id: 'rect-a6', shape: 'rect', width: 5.5, height: 3.7, price: 6, name: 'A6' },
  { id: 'rect-a5', shape: 'rect', width: 7.5, height: 5.5, price: 12, name: 'Half A4' },
  { id: 'rect-a4', shape: 'rect', width: 11, height: 7.5, price: 24, name: 'A4' },
];
const close = (a: number, b: number) => Math.abs(a - b) < 0.002;
export const orientation = (p: Dimensions): Orientation => p.width >= p.height ? 'landscape' : 'portrait';
export function presetDimensions(preset: EdiblePreset, direction: Orientation) {
  return preset.shape === 'rect' && direction === 'portrait' ? { width: preset.height, height: preset.width } : { width: preset.width, height: preset.height };
}
export function edibleChoice(p: Dimensions) {
  if (p.kind !== 'edible') return null;
  return edibleCatalog.find(s => s.shape === p.shape && (close(s.width, p.width) && close(s.height, p.height)
    || p.shape === 'rect' && close(s.width, p.height) && close(s.height, p.width))) || null;
}
export const money = (price: number) => `RM${price.toFixed(2)}`;
export function ediblePriceText(p: Dimensions) {
  const s = edibleChoice(p);
  return s ? `${money(s.price)} / ${s.perPc ? 'pc' : 'keping'}` : 'Saiz custom · semak harga';
}
export function productName(p: Dimensions) {
  if (p.kind === 'acrylic') return 'Acrylic';
  return `Edible · ${shapeLabels[p.shape]}${p.shape === 'rect' ? ` (${orientation(p) === 'landscape' ? 'Landscape' : 'Portrait'})` : ''}`;
}

// Normalized heart has exact width/height bounds 0..1. Canvas and fit checks share this outline.
const heartStart = [0.5, 0.22] as const;
const heartCurves: [number, number, number, number, number, number][] = [
  [0.45, 0.04, 0.30, 0, 0.22, 0], [0.08, 0, 0, 0.12, 0, 0.26],
  [0, 0.55, 0.24, 0.78, 0.5, 1], [0.76, 0.78, 1, 0.55, 1, 0.26],
  [1, 0.12, 0.92, 0, 0.78, 0], [0.70, 0, 0.55, 0.04, 0.5, 0.22],
];
export function traceHeart(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.beginPath(); ctx.save(); ctx.scale(width, height); ctx.moveTo(...heartStart);
  heartCurves.forEach(curve => ctx.bezierCurveTo(...curve)); ctx.closePath(); ctx.restore();
}
const heartPoints: [number, number][] = [];
let start: readonly number[] = heartStart;
for (const curve of heartCurves) {
  for (let i = 0; i <= 64; i++) {
    const t = i / 64, q = 1 - t;
    heartPoints.push([q ** 3 * start[0] + 3 * q ** 2 * t * curve[0] + 3 * q * t ** 2 * curve[2] + t ** 3 * curve[4] - 0.5,
      q ** 3 * start[1] + 3 * q ** 2 * t * curve[1] + 3 * q * t ** 2 * curve[3] + t ** 3 * curve[5] - 0.5]);
  }
  start = curve.slice(4);
}
export function rotatedOutline(shape: EdibleShape, width: number, height: number, angle: number) {
  const points: readonly (readonly number[])[] = shape === 'heart' ? heartPoints : [[-0.5, -0.5], [-0.5, 0.5], [0.5, -0.5], [0.5, 0.5]];
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return points.map(([x, y]) => [x * width * cos - y * height * sin, x * width * sin + y * height * cos] as const);
}
