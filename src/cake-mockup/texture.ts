import { type Config, layout } from './model';

export function productCanvas(c: Config) {
  const p = c.product, h = layout(c).h;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(64, Math.min(4096, Math.round(1024 * h / p.width)));
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, ch = canvas.height;
  if (p.kind === 'edible') {
    if (p.shape === 'round') { ctx.beginPath(); ctx.ellipse(w / 2, ch / 2, w / 2, ch / 2, 0, 0, Math.PI * 2); ctx.clip(); }
    ctx.fillStyle = '#fce0e6'; ctx.fillRect(0, 0, w, ch);
  }
  if (p.image) {
    // Contain the image without distorting it. Edible background fills unused space.
    const s = Math.min(w / p.image.naturalWidth, ch / p.image.naturalHeight);
    const dw = p.image.naturalWidth * s, dh = p.image.naturalHeight * s;
    ctx.drawImage(p.image, (w - dw) / 2, (ch - dh) / 2, dw, dh);
  } else {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = p.kind === 'acrylic' ? p.color : '#10214f';
    let lines = p.wording.trim().split(/\n/).filter(Boolean);
    if (!lines.length) lines = ['Happy Birthday'];
    if (lines.length === 1 && lines[0] === 'Happy Birthday') lines = ['Happy', 'Birthday'];
    let size = Math.min(ch / (lines.length + 0.7), 210);
    ctx.font = `italic bold ${size}px Georgia, serif`;
    while (Math.max(...lines.map(l => ctx.measureText(l).width)) > w * 0.92 && size > 8) { size -= 2; ctx.font = `italic bold ${size}px Georgia, serif`; }
    lines.forEach((l, i) => ctx.fillText(l, w / 2, ch / 2 + (i - (lines.length - 1) / 2) * size * 1.1));
    if (p.kind === 'edible') {
      ctx.strokeStyle = '#e795b0'; ctx.lineWidth = w * 0.008;
      ctx.beginPath(); ctx.ellipse(w / 2, ch / 2, w * 0.44, ch * 0.44, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  let output = canvas;
  if (p.kind === 'acrylic' && !p.image) {
    // The sample wording's outer bounds occupy the selected design dimensions.
    const pixels = ctx.getImageData(0, 0, w, ch).data;
    let left = w, right = -1, top = ch, bottom = -1;
    for (let y = 0; y < ch; y++) for (let x = 0; x < w; x++) if (pixels[(y * w + x) * 4 + 3] > 16) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right >= left) { output = document.createElement('canvas'); output.width = right - left + 1; output.height = bottom - top + 1;
      output.getContext('2d')!.drawImage(canvas, left, top, output.width, output.height, 0, 0, output.width, output.height); }
  }
  return output;
}
