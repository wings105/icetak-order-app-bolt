import { type Config, type View, layout, fmt } from './model';
import { productCanvas } from './texture';
import { productName, ediblePriceText } from './edible';

/** Orthographic top/front sizing preview when WebGL is unavailable. */
export class CanvasScene {
  private canvas = document.createElement('canvas');
  private observer: ResizeObserver;
  private cfg: Config | null = null;
  private artwork: HTMLCanvasElement | null = null;
  private view: View = 'top';
  private requestedView: View = '3d';
  private zoom = 1;
  constructor(private container: HTMLElement) {
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Mockup kek 2D mengikut ukuran');
    container.appendChild(this.canvas);
    this.observer = new ResizeObserver(() => this.draw()); this.observer.observe(container);
  }
  update(c: Config) { this.cfg = c; this.artwork = productCanvas(c); this.setView(this.requestedView); }
  setView(v: View) { this.requestedView = v; this.view = v === '3d' ? this.cfg?.product.kind === 'edible' && this.cfg.product.placement === 'top' ? 'top' : 'front' : v; this.draw(); }
  setZoom(v: number) { this.zoom = v; this.draw(); }
  private draw(target = this.canvas, width = this.container.clientWidth, height = this.container.clientHeight) {
    if (!this.cfg || !width || !height) return;
    const dpr = target === this.canvas ? Math.min(devicePixelRatio, 2) : 1;
    target.width = Math.round(width * dpr); target.height = Math.round(height * dpr);
    const ctx = target.getContext('2d')!; ctx.scale(dpr, dpr);
    ctx.fillStyle = '#eaf3ff'; ctx.fillRect(0, 0, width, height);
    const c = this.cfg, p = c.product, l = layout(c), front = this.view === 'front';
    const maxW = Math.max(...c.tiers.map(t => t.width)), maxD = Math.max(...c.tiers.map(t => c.shape === 'round' ? t.width : t.depth));
    const topY = p.kind === 'acrylic' && p.placement === 'top' ? Math.max(l.total, l.top + p.lift + l.h) : l.total;
    const extentW = Math.max(maxW + 1.2, p.width + Math.abs(l.ox) * 2 + 0.8);
    const extentH = front ? Math.max(topY + 0.5, l.h + 0.5) : Math.max(maxD + 1.2, l.h + Math.abs(l.oz) * 2 + 0.8);
    const ui = target === this.canvas ? 1 : width / this.container.clientWidth;
    const scale = Math.min((width - 90 * ui) / extentW, (height - 85 * ui) / extentH) * this.zoom;
    const X = (x: number) => width / 2 + x * scale;
    const Y = (y: number) => front ? height / 2 + topY * scale / 2 - y * scale : height / 2 + y * scale;
    const outline = (w: number, d: number, color: string, at = 0) => {
      ctx.beginPath();
      if (!front && c.shape === 'round') ctx.ellipse(X(0), Y(0), w * scale / 2, d * scale / 2, 0, 0, Math.PI * 2);
      else ctx.rect(X(-w / 2), front ? Y(at + d) : Y(-d / 2), w * scale, d * scale);
      ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#bcc9da'; ctx.lineWidth = 1; ctx.stroke();
    };
    const design = (x: number, y: number, w: number, h: number, angle = 0, compress = 1) => {
      ctx.save(); ctx.translate(X(x), Y(y)); ctx.scale(compress, 1); ctx.rotate(angle);
      ctx.drawImage(this.artwork!, -w * scale / 2, -h * scale / 2, w * scale, h * scale); ctx.restore();
    };
    ctx.save(); ctx.shadowColor = '#7890b633'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 6;
    outline(maxW + 1.1, front ? 0.16 : maxD + 1.1, '#ffffff'); ctx.restore();
    let bottom = 0.16;
    c.tiers.forEach((t, i) => {
      outline(t.width, front ? t.height : c.shape === 'round' ? t.width : t.depth, c.cakeColor, bottom);
      if (i === l.tierIndex) {
        if (front) {
          if (p.placement === 'top' && p.kind === 'acrylic') {
            ctx.fillStyle = p.color; ctx.fillRect(X(l.ox - 0.05), Y(l.top + p.lift), 0.1 * scale, (p.lift + 0.45) * scale);
            design(l.ox, l.top + p.lift + l.h / 2, p.width, l.h, 0, Math.cos(p.rotation * Math.PI / 180));
          } else if (p.placement === 'side') {
            const center = l.bottom + t.height / 2 + p.y / 100 * t.height / 2;
            const angle = p.x / 100 * Math.PI;
            if (c.shape === 'round' && p.kind === 'edible') {
              // Each source column maps to its true cylindrical arc; only the front hemisphere is visible.
              const r = t.width / 2 + 0.024, strips = 256;
              for (let s = 0; s < strips; s++) {
                const a = angle + (s / strips - 0.5) * p.width / r;
                const b = angle + ((s + 1) / strips - 0.5) * p.width / r;
                if (Math.cos((a + b) / 2) <= 0) continue;
                const x1 = X(Math.sin(a) * r), x2 = X(Math.sin(b) * r);
                ctx.drawImage(this.artwork!, s * this.artwork!.width / strips, 0, this.artwork!.width / strips, this.artwork!.height,
                  Math.min(x1, x2), Y(center + l.h / 2), Math.abs(x2 - x1) + 0.4, l.h * scale);
              }
            } else if (c.shape === 'rect' || Math.cos(angle) > 0) {
              design(c.shape === 'round' ? Math.sin(angle) * (t.width / 2 + 0.04) : l.ox, center, p.width, l.h,
                -p.rotation * Math.PI / 180, c.shape === 'round' ? Math.cos(angle) : 1);
            }
          } else {
            ctx.strokeStyle = '#e795b0'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(X(l.ox - p.width / 2), Y(l.top)); ctx.lineTo(X(l.ox + p.width / 2), Y(l.top)); ctx.stroke();
          }
        } else if (p.placement === 'top' && p.kind === 'edible') {
          design(l.ox, l.oz, p.width, l.h, p.rotation * Math.PI / 180);
        } else {
          // A vertical acrylic or side design appears edge-on in a top elevation.
          ctx.strokeStyle = p.kind === 'acrylic' ? p.color : '#e795b0'; ctx.lineWidth = 3;
          ctx.beginPath();
          if (p.placement === 'side' && c.shape === 'round' && p.kind === 'edible') {
            const r = t.width / 2 + 0.024, angle = p.x / 100 * Math.PI;
            for (let n = 0; n <= 128; n++) { const a = angle + (n / 128 - 0.5) * p.width / r;
              const x = X(Math.sin(a) * r), y = Y(Math.cos(a) * r); n ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          } else {
            const angle = p.placement === 'side' && c.shape === 'round' ? p.x / 100 * Math.PI : p.rotation * Math.PI / 180;
            const cx = p.placement === 'top' ? l.ox : c.shape === 'round' ? Math.sin(angle) * (t.width / 2 + 0.04) : l.ox;
            const cy = p.placement === 'top' ? l.oz : c.shape === 'round' ? Math.cos(angle) * (t.width / 2 + 0.04) : t.depth / 2 + 0.024;
            ctx.moveTo(X(cx - Math.cos(angle) * p.width / 2), Y(cy + Math.sin(angle) * p.width / 2));
            ctx.lineTo(X(cx + Math.cos(angle) * p.width / 2), Y(cy - Math.sin(angle) * p.width / 2));
          }
          ctx.stroke();
        }
      }
      bottom += t.height;
    });
    if (c.measures) {
      const dimension = (x1: number, y1: number, x2: number, y2: number, text: string, vertical = false) => {
        ctx.strokeStyle = '#516989'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        if (vertical) { ctx.moveTo(x1 - 4, y1); ctx.lineTo(x1 + 4, y1); ctx.moveTo(x2 - 4, y2); ctx.lineTo(x2 + 4, y2); }
        else { ctx.moveTo(x1, y1 - 4); ctx.lineTo(x1, y1 + 4); ctx.moveTo(x2, y2 - 4); ctx.lineTo(x2, y2 + 4); }
        ctx.stroke(); ctx.save(); ctx.font = `600 ${12 * ui}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.translate((x1 + x2) / 2, (y1 + y2) / 2); if (vertical) ctx.rotate(-Math.PI / 2);
        const labelW = ctx.measureText(text).width; ctx.fillStyle = '#eaf3ff'; ctx.fillRect(-labelW / 2 - 4 * ui, -9 * ui, labelW + 8 * ui, 18 * ui);
        ctx.fillStyle = '#10214f'; ctx.fillText(text, 0, 0); ctx.restore();
      };
      const y = (front ? Y(l.bottom) : Y((c.shape === 'round' ? l.tier.width : l.tier.depth) / 2)) + 22 * ui;
      dimension(X(-l.tier.width / 2), y, X(l.tier.width / 2), y, `${fmt(l.tier.width, c.unit)} · kek`);
      const x = X(l.tier.width / 2) + 23 * ui;
      dimension(x, front ? Y(l.top) : Y(-(c.shape === 'round' ? l.tier.width : l.tier.depth) / 2), x,
        front ? Y(l.bottom) : Y((c.shape === 'round' ? l.tier.width : l.tier.depth) / 2),
        `${fmt(front ? l.tier.height : c.shape === 'round' ? l.tier.width : l.tier.depth, c.unit)}${front ? ' tinggi' : ''}`, true);
    }
  }
  async export(c: Config): Promise<Blob> {
    const cv = document.createElement('canvas'), image = document.createElement('canvas');
    const h = Math.round(1600 * this.container.clientHeight / this.container.clientWidth);
    this.draw(image, 1600, h); cv.width = 1600; cv.height = h + 180;
    const ctx = cv.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(image, 0, 0);
    ctx.fillStyle = '#10214f'; ctx.font = 'bold 30px Arial'; ctx.fillText('decocake.my · Cake Mockup · Preview 2D', 36, h + 45);
    ctx.font = '24px Arial'; ctx.fillText(`${productName(c.product)} ${fmt(c.product.width, c.unit)} × ${fmt(layout(c).h, c.unit)} · ${c.product.placement === 'top' ? 'Atas' : 'Sisi'} · Tier ${c.product.tier + 1}${c.product.kind === 'edible' ? ` · ${ediblePriceText(c.product)}` : ''}`, 36, h + 88);
    ctx.fillText(`Kek ${c.tiers.map(t => `${fmt(t.width, c.unit)}${c.shape === 'rect' ? ` × ${fmt(t.depth, c.unit)}` : ''}, tinggi ${fmt(t.height, c.unit)}`).join(' / ')}`, 36, h + 124);
    ctx.fillStyle = '#556581'; ctx.font = '21px Arial'; ctx.fillText('Anggaran visual. Ukur ruang selepas hiasan; ukuran acrylic tidak termasuk batang.', 36, h + 160);
    return new Promise((resolve, reject) => cv.toBlob(b => b ? resolve(b) : reject(new Error('Gambar tidak dapat disimpan.')), 'image/png'));
  }
  dispose() { this.observer.disconnect(); this.canvas.remove(); }
}
