import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaults, factor, fmt, layout, assessment, round, summary, type Config, type Product, type Unit, type View } from './model';
import { CakeScene } from './scene';
import './style.css';

const cakeColors = ['#fffdf9', '#fff0cf', '#ffc3d5', '#b5dafa', '#bce5ce', '#d8c2ab', '#70432d', '#d4c2f0', '#d5d8df', '#292929'];
const acrylicColors = [{ label: 'Gold', value: '#c69b48' }, { label: 'Silver', value: '#9ba3b0' }, { label: 'Black', value: '#20232a' }, { label: 'Rose gold', value: '#bb796f' }];

function Segments<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="segments" role="group" aria-label={label}>{options.map(([id, title]) => <button type="button" key={id} aria-pressed={value === id} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>{title}</button>)}</div>;
}
function Measure({ label, value, unit, onChange, min = 0.25, max = 30 }: { label: string; value: number; unit: Unit; onChange: (v: number) => void; min?: number; max?: number }) {
  const [raw, setRaw] = useState(String(round(value * factor(unit))));
  useEffect(() => { setRaw(String(round(value * factor(unit)))); }, [value, unit]);
  const valid = raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= min * factor(unit) - 0.005 && Number(raw) <= max * factor(unit) + 0.005;
  return <label className="measure"><span>{label}</span><div className="input-unit"><input type="number" inputMode="decimal" aria-label={label} aria-invalid={!valid} step="0.1" min={round(min * factor(unit))} max={round(max * factor(unit))} value={raw} onChange={e => {
    setRaw(e.target.value); const v = e.target.value === '' ? NaN : Number(e.target.value) / factor(unit);
    if (Number.isFinite(v) && v >= min - 0.002 && v <= max + 0.002) onChange(v);
  }} onBlur={() => { if (!valid) setRaw(String(round(value * factor(unit)))); }} /><span>{unit}</span></div>{!valid ? <small className="error">Masukkan {round(min * factor(unit))}–{round(max * factor(unit))} {unit}.</small> : null}</label>;
}
function Slider({ label, value, onChange, min = -100, max = 100, suffix = '%' }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string }) {
  return <label className="slider"><span>{label}<output>{round(value)}{suffix}</output></span><input type="range" aria-label={label} min={min} max={max} step="1" value={value} onChange={e => onChange(Number(e.target.value))} /></label>;
}

function Preview({ config, sceneRef, view, setView, zoom, setZoom }: { config: Config; sceneRef: React.MutableRefObject<CakeScene | null>; view: View; setView: (v: View) => void; zoom: number; setZoom: (v: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    try { sceneRef.current = new CakeScene(host.current!, () => setView('3d'), setZoom); }
    catch (e) { setFailed('Preview 3D perlukan WebGL 2. Cuba Chrome, Safari atau Edge terkini dengan hardware acceleration aktif.'); console.error('[cake-mockup]', e); }
    return () => { sceneRef.current?.dispose(); sceneRef.current = null; };
  }, [sceneRef, setView, setZoom]);
  useEffect(() => { sceneRef.current?.update(config); }, [config, sceneRef]);
  useEffect(() => { sceneRef.current?.setView(view); }, [view, sceneRef]);
  useEffect(() => { sceneRef.current?.setZoom(zoom); }, [zoom, sceneRef]);
  const l = layout(config);
  return <section className="preview" aria-label="Preview kek">
    <div className="view-switch"><Segments label="Sudut pandangan" value={view} onChange={setView} options={[['3d', '3D'], ['top', 'Atas'], ['front', 'Depan']]} /></div>
    <div className="stage" ref={host} data-testid="cake-stage">{failed ? <div className="webgl-error" role="alert">{failed}</div> : null}</div>
    <div className="preview-caption">{config.tiers.length} tier · {config.product.kind === 'edible' ? 'Edible' : 'Acrylic'} {fmt(config.product.width, config.unit)} × {fmt(l.h, config.unit)}</div>
    <div className="preview-toolbar"><label className="zoom">−<input aria-label="Zoom" type="range" min="0.7" max="2" step="0.05" value={zoom} onChange={e => setZoom(Number(e.target.value))} />+</label><span>Putar dengan jari / mouse</span></div>
    <label className="measure-toggle"><input type="checkbox" checked={config.measures} onChange={() => window.dispatchEvent(new Event('cake-toggle-measures'))} /> Tunjuk ukuran</label>
  </section>;
}

async function loadUpload(file: File, crop: boolean): Promise<HTMLImageElement> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Pilih fail PNG, JPG atau WEBP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Fail maksimum 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const cv = document.createElement('canvas'); const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    cv.width = Math.max(1, Math.round(img.naturalWidth * scale)); cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = cv.getContext('2d')!; ctx.drawImage(img, 0, 0, cv.width, cv.height);
    let result = cv;
    if (crop) {
      const pixels = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let left = cv.width, right = -1, top = cv.height, bottom = -1;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        if (pixels[(y * cv.width + x) * 4 + 3] > 16) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
      }
      if (right < left) throw new Error('Gambar kosong atau sepenuhnya transparent.');
      result = document.createElement('canvas'); result.width = right - left + 1; result.height = bottom - top + 1;
      result.getContext('2d')!.drawImage(cv, left, top, result.width, result.height, 0, 0, result.width, result.height);
    }
    const out = new Image(); out.src = result.toDataURL('image/png'); await out.decode(); return out;
  } finally { URL.revokeObjectURL(url); }
}

function App() {
  const [c, setC] = useState<Config>(defaults);
  const [view, setView] = useState<View>('3d');
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const sceneRef = useRef<CakeScene | null>(null);
  const sample = useRef<HTMLImageElement | null>(null);
  const assets = useRef<{ edible: HTMLImageElement | null; acrylic: HTMLImageElement | null; edibleName: string; acrylicName: string }>({ edible: null, acrylic: null, edibleName: '', acrylicName: '' });
  const configRef = useRef(c); configRef.current = c;
  useEffect(() => {
    document.title = 'Cake Mockup | DecoCake.my';
    const toggle = () => setC(v => ({ ...v, measures: !v.measures }));
    window.addEventListener('cake-toggle-measures', toggle);
    const image = new Image(); image.src = '/mockup/example-edible.png';
    image.onload = () => { sample.current = image; setC(v => v.product.kind === 'edible' && !v.product.image ? ({ ...v, product: { ...v.product, image } }) : v); };
    return () => { window.removeEventListener('cake-toggle-measures', toggle); image.onload = null; };
  }, []);
  useEffect(() => { return () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); }; }, [downloadUrl]);
  useEffect(() => { setDownloadUrl(''); }, [c]);
  const patch = (v: Partial<Config>) => setC(old => ({ ...old, ...v }));
  const product = (v: Partial<Product>) => setC(old => ({ ...old, product: { ...old.product, ...v } }));
  const dimension = (key: 'width' | 'height', n: number) => setC(old => {
    const p = old.product;
    if (p.kind === 'edible' && p.shape === 'round') return { ...old, product: { ...p, width: n, height: n } };
    const ratio = p.height / p.width;
    return { ...old, product: { ...p, [key]: n, ...(p.lockRatio ? key === 'width' ? { height: Math.max(0.25, Math.min(30, n * ratio)) } : { width: Math.max(0.25, Math.min(30, n / ratio)) } : {}) } };
  });
  const updateTier = (i: number, value: Partial<Config['tiers'][number]>) => setC(old => ({ ...old, tiers: old.tiers.map((t, n) => n === i ? { ...t, ...value } : t) }));
  const changeCount = (count: number) => setC(old => {
    const tiers = old.tiers.slice(0, count);
    while (tiers.length < count) { const last = tiers[tiers.length - 1]; tiers.push({ width: Math.max(2, last.width - 2), depth: Math.max(2, last.depth - 2), height: last.height }); }
    return { ...old, tiers, product: { ...old.product, tier: Math.min(old.product.tier, count - 1) } };
  });
  const chooseKind = (kind: Product['kind']) => {
    if (kind === c.product.kind) return;
    const stored = assets.current[kind];
    const scale = stored && kind === 'acrylic' ? Math.min(14 / 2.54 / stored.naturalWidth, 10 / 2.54 / stored.naturalHeight) : 0;
    product({ kind, shape: kind === 'edible' ? 'round' : 'rect', width: stored && scale ? stored.naturalWidth * scale : kind === 'edible' ? 5 : 14 / 2.54, height: stored && scale ? stored.naturalHeight * scale : kind === 'edible' ? 5 : 10 / 2.54,
      placement: 'top', x: 0, y: 0, rotation: 0, lockRatio: true, image: assets.current[kind] || (kind === 'edible' ? sample.current : null), imageName: assets.current[`${kind}Name`] });
  };
  const p = c.product, l = layout(c), info = assessment(c);
  const isRound = p.kind === 'edible' && p.shape === 'round';
  async function upload(file?: File) {
    if (!file) return;
    setUploadBusy(true); setNotice(''); const kind = p.kind;
    try {
      const img = await loadUpload(file, kind === 'acrylic');
      assets.current[kind] = img; assets.current[`${kind}Name`] = file.name;
      setC(old => old.product.kind !== kind ? old : ({ ...old, product: { ...old.product, image: img, imageName: file.name,
        ...(old.product.shape !== 'round' && old.product.lockRatio ? { height: Math.max(0.25, Math.min(30, old.product.width * img.naturalHeight / img.naturalWidth)) } : {}) } }));
      setNotice('Design dimuatkan. Gambar ini diproses dalam browser anda sahaja.');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Gambar tidak dapat dibaca.'); }
    finally { setUploadBusy(false); }
  }
  async function save() {
    if (!sceneRef.current) { setNotice('Preview belum tersedia.'); return; }
    setBusy(true); setNotice('');
    try {
      const blob = await sceneRef.current.export(configRef.current), url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      const a = document.createElement('a'); a.href = url; a.download = 'decocake-mockup.png'; a.click();
      setNotice('Gambar siap. Jika download tidak bermula, tekan “Download PNG”.');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Gambar tidak dapat disimpan.'); }
    finally { setBusy(false); }
  }
  return <>
    <header className="app-header"><a className="brand" href="/">decocake.my</a><h1>Cake Mockup</h1><a className="home" href="/">⌂ <span>Home</span></a></header>
    <main className="workspace">
      <section className="panel cake-panel" aria-labelledby="cake-heading">
        <h2 id="cake-heading">Kek anda</h2>
        <div className="field"><h3>Unit ukuran</h3><Segments label="Unit ukuran" value={c.unit} options={[['inch', 'Inch'], ['cm', 'Cm']]} onChange={unit => patch({ unit })} /></div>
        <div className="field"><h3>Bentuk kek</h3><Segments label="Bentuk kek" value={c.shape} options={[['round', '◯  Bulat'], ['rect', '▢  Petak']]} onChange={shape => patch({ shape })} /></div>
        <div className="field"><h3>Bilangan tier</h3><div className="stepper"><button aria-label="Kurangkan tier" disabled={c.tiers.length === 1} onClick={() => changeCount(c.tiers.length - 1)}>−</button><output aria-label="Bilangan tier">{c.tiers.length}</output><button aria-label="Tambah tier" disabled={c.tiers.length === 4} onClick={() => changeCount(c.tiers.length + 1)}>+</button><span>maks. 4</span></div></div>
        <div className="tiers">{c.tiers.map((t, i) => <div className={`tier ${p.tier === i ? 'selected-tier' : ''}`} key={i}>
          <div className="tier-heading"><h3>Tier {i + 1} <small>{i === 0 ? 'bawah' : 'atas'}</small></h3><button aria-label={`Letak produk pada tier ${i + 1}`} aria-pressed={p.tier === i} onClick={() => product({ tier: i })}>{p.tier === i ? 'Dipilih' : 'Pilih'}</button></div>
          <div className="tier-fields"><Measure label={`Lebar kek${c.shape === 'round' ? ' (diameter)' : ''} · Tier ${i + 1}`} value={t.width} unit={c.unit} min={2} onChange={width => updateTier(i, { width })} />
          {c.shape === 'rect' ? <Measure label={`Panjang kek · Tier ${i + 1}`} value={t.depth} unit={c.unit} min={2} onChange={depth => updateTier(i, { depth })} /> : null}
          <Measure label={`Tinggi kek · Tier ${i + 1}`} value={t.height} unit={c.unit} min={1} max={20} onChange={height => updateTier(i, { height })} /></div>
        </div>)}</div>
        <div className="field"><h3>Warna kek</h3><div className="swatches" role="group" aria-label="Warna kek">{cakeColors.map((color, i) => <button type="button" key={color} aria-label={`Warna kek ${i + 1}`} aria-pressed={c.cakeColor === color} style={{ backgroundColor: color }} className={c.cakeColor === color ? 'selected' : ''} onClick={() => patch({ cakeColor: color })} />)}</div><label className="custom-color">Warna lain <input aria-label="Warna kek custom" type="color" value={c.cakeColor} onChange={e => patch({ cakeColor: e.target.value })} /></label></div>
        <p className="help">Masukkan ukuran kek selepas salutan. Ruang untuk cream dan hiasan perlu diambil kira.</p>
        <button className="text-button" onClick={() => { const d = defaults(); d.product.image = sample.current; setC(d); setView('3d'); setZoom(1); setNotice(''); }}>Reset semua</button>
      </section>
      <Preview config={c} sceneRef={sceneRef} view={view} setView={setView} zoom={zoom} setZoom={setZoom} />
      <section className="panel product-panel" aria-labelledby="product-heading">
        <h2 id="product-heading">Produk anda</h2>
        <Segments label="Jenis produk" value={p.kind} options={[['edible', 'Edible image'], ['acrylic', 'Acrylic']]} onChange={chooseKind} />
        <div className="field"><h3>Lokasi design</h3><Segments label="Lokasi design" value={p.placement} options={[['top', 'Atas kek'], ['side', 'Sisi kek']]} onChange={placement => { product({ placement, x: 0, y: 0, rotation: 0 }); setView(placement === 'side' ? 'front' : '3d'); }} /></div>
        {c.tiers.length > 1 ? <label className="field select-field"><span>Letak pada tier</span><select aria-label="Letak pada tier" value={p.tier} onChange={e => product({ tier: Number(e.target.value) })}>{c.tiers.map((_, i) => <option key={i} value={i}>Tier {i + 1} {i === 0 ? '(bawah)' : '(atas)'}</option>)}</select></label> : null}
        {p.kind === 'edible' ? <div className="field"><h3>Bentuk design</h3><Segments label="Bentuk design" value={p.shape} options={[['round', '◯  Bulat'], ['rect', '▢  Petak / segi empat']]} onChange={shape => product({ shape, height: shape === 'round' ? p.width : p.height })} /></div> : null}
        <label className="field select-field"><span>Saiz pilihan</span><select aria-label="Saiz pilihan" value="custom" onChange={e => {
          if (e.target.value === 'custom') return;
          const dims = e.target.value.split(',').map(Number);
          if (p.kind === 'edible' && isRound) product({ width: dims[0], height: dims[0] });
          else if (p.image && p.lockRatio) { const ratio = p.image.naturalHeight / p.image.naturalWidth; const scale = Math.min(dims[0] / p.image.naturalWidth, dims[1] / p.image.naturalHeight); product({ width: p.image.naturalWidth * scale, height: p.image.naturalHeight * scale }); void ratio; }
          else product({ width: dims[0], height: dims[1] });
        }}><option value="custom">Custom · {fmt(p.width, c.unit)}{!isRound ? ` × ${fmt(l.h, c.unit)}` : ''}</option>
          {p.kind === 'acrylic' ? <><option value={`${10 / 2.54},${7 / 2.54}`}>A7 · 10 × 7 cm</option><option value={`${14 / 2.54},${10 / 2.54}`}>A6 · 14 × 10 cm</option><option value={`${20 / 2.54},${14 / 2.54}`}>A5 · 20 × 14 cm</option></> : isRound ? [2, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5].map(n => <option value={n} key={n}>{fmt(n, c.unit)}</option>) : <><option value="5.5,3.7">A6 · 5.5 × 3.7 inch</option><option value="7.5,5.5">A5 · 7.5 × 5.5 inch</option><option value="11,7.5">A4 · 11 × 7.5 inch</option></>}
        </select></label>
        <Measure label={isRound ? 'Saiz design (diameter)' : 'Lebar design'} value={p.width} unit={c.unit} onChange={n => dimension('width', n)} />
        {!isRound ? <><Measure label="Tinggi design" value={p.height} unit={c.unit} onChange={n => dimension('height', n)} /><label className="checkbox-label"><input type="checkbox" checked={p.lockRatio} onChange={e => product({ lockRatio: e.target.checked })} /> Kekalkan nisbah design</label></> : null}
        {p.kind === 'acrylic' ? <><p className="help">Ukuran bahagian design sahaja, tanpa batang. Preset ialah had maksimum; bentuk design menentukan ukuran akhir.</p><div className="field"><h3>Warna acrylic</h3><div className="acrylic-colors">{acrylicColors.map(co => <button key={co.value} aria-pressed={p.color === co.value} onClick={() => product({ color: co.value })}><i style={{ background: co.value }} />{co.label}</button>)}</div></div><label className="wording"><span>Wording contoh</span><textarea aria-label="Wording contoh" value={p.wording} rows={2} maxLength={80} onChange={e => product({ wording: e.target.value, image: null, imageName: '' })} /></label></> : null}
        <div className="field position-fields"><h3>Kedudukan design</h3><Slider label={p.placement === 'side' && c.shape === 'round' ? 'Keliling kek' : 'Kiri / Kanan'} value={p.x} onChange={x => product({ x })} />
          <Slider label={p.placement === 'side' ? 'Atas / Bawah' : 'Depan / Belakang'} value={p.y} onChange={y => product({ y })} />
          {p.kind === 'edible' && p.placement === 'side' && c.shape === 'round' ? null : <Slider label={p.kind === 'acrylic' && p.placement === 'top' ? 'Arah topper' : 'Putaran design'} value={p.rotation} min={-180} max={180} suffix="°" onChange={rotation => product({ rotation })} />}
          {p.kind === 'acrylic' && p.placement === 'top' ? <Measure label="Jarak design dari atas kek" value={p.lift} min={0} max={6} unit={c.unit} onChange={lift => product({ lift })} /> : null}
          <button className="text-button" onClick={() => product({ x: 0, y: 0, rotation: 0 })}>Letak di tengah</button>
        </div>
        <div className="upload-section"><h3>Muat naik design</h3><label className={`upload-button ${uploadBusy ? 'disabled' : ''}`}><span>♧</span><div>{uploadBusy ? 'Memproses…' : 'Upload design'}<small>PNG, JPG atau WEBP · maks. 10 MB</small></div><input aria-label="Upload design" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadBusy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
          {p.imageName ? <div className="file-selected"><span>{p.imageName}</span><button aria-label="Buang design upload" onClick={() => { assets.current[p.kind] = null; assets.current[`${p.kind}Name`] = ''; product({ image: p.kind === 'edible' ? sample.current : null, imageName: '' }); }}>×</button></div> : null}
          {p.kind === 'acrylic' ? <p className="help">PNG transparent tanpa batang beri gambaran paling jelas. Warna gambar upload dikekalkan.</p> : <p className="help">Gambar dikekalkan nisbahnya; ruang kosong menggunakan latar pink.</p>}
        </div>
        <div className={`result ${info.warnings.length ? 'has-warning' : ''}`} aria-live="polite"><strong>{info.margin !== null && info.margin >= 0 ? `Ruang tepi ${fmt(info.margin, c.unit)}` : info.warnings.length ? 'Semak kesesuaian' : 'Gambaran mengikut ukuran'}</strong><p>{info.detail}</p>{info.warnings.length ? <ul>{info.warnings.map(w => <li key={w}>{w}</li>)}</ul> : null}<small>Anggaran visual sahaja. Ukuran perlu disahkan dengan baker.</small></div>
        <button className="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Menyediakan gambar…' : '↓  Simpan gambar'}</button>
        {downloadUrl ? <a className="download-link" href={downloadUrl} download="decocake-mockup.png">Download PNG</a> : null}
        <a className="whatsapp" href={`https://wa.me/60179860656?text=${encodeURIComponent(summary(c))}`} target="_blank" rel="noopener noreferrer">Tanya iCetak di WhatsApp</a>
        {notice ? <p className="notice" role="status">{notice}</p> : null}
      </section>
    </main>
  </>;
}

const root = document.getElementById('app');
if (root) createRoot(root).render(<App />);
