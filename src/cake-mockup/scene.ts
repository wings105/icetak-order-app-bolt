import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { type Config, type View, layout, fmt } from './model';
import { productCanvas } from './texture';

function productTexture(c: Config) {
  const texture = new T.CanvasTexture(productCanvas(c));
  texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

function disposeGroup(group: T.Group) {
  const textures = new Set<T.Texture>();
  group.traverse(o => {
    if (o instanceof T.Mesh || o instanceof T.Line || o instanceof T.Sprite) {
      if ('geometry' in o) o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const map = (m as T.MeshBasicMaterial).map;
        if (map) textures.add(map);
        m.dispose();
      }
    }
  });
  textures.forEach(t => t.dispose());
  group.clear();
}


function curvedImage(width: number, height: number, radius: number, angle: number) {
  const segments = Math.min(240, Math.max(32, Math.ceil(width / radius * 40)));
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let row = 0; row < 2; row++) for (let i = 0; i <= segments; i++) {
    const u = i / segments, a = angle + (u - 0.5) * width / radius;
    positions.push(Math.sin(a) * radius, (row - 0.5) * height, Math.cos(a) * radius);
    uv.push(u, row);
  }
  for (let i = 0; i < segments; i++) { const a = i, b = i + 1, d = i + segments + 1, e = d + 1; indices.push(a, d, b, b, d, e); }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices); geo.computeVertexNormals(); return geo;
}

export class CakeScene {
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.OrthographicCamera(-7, 7, 7, -7, 0.01, 500);
  private controls: OrbitControls;
  private models = new T.Group();
  private annotations = new T.Group();
  private resizeObserver: ResizeObserver;
  private cfg: Config | null = null;
  private view: View = '3d';
  private disposed = false;
  private extent = 12;
  private zoom = 1;
  private center = 2;
  private renderPending = false;

  constructor(private container: HTMLElement, private onOrbit: () => void, private onZoom: (zoom: number) => void) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!context) throw new Error('WebGL 2 unavailable');
    this.renderer = new T.WebGLRenderer({ canvas, context, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor('#eaf3ff');
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.6;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Mockup kek 3D mengikut ukuran');
    this.renderer.domElement.setAttribute('role', 'img');
    container.appendChild(this.renderer.domElement);
    this.scene.add(this.models, this.annotations);
    this.scene.add(new T.HemisphereLight('#ffffff', '#b5c3db', 1.7));
    const light = new T.DirectionalLight('#ffffff', 1.8);
    light.position.set(-10, 25, 18); light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.left = -40; light.shadow.camera.right = 40;
    light.shadow.camera.top = 40; light.shadow.camera.bottom = -40;
    light.shadow.bias = -0.0003; light.shadow.normalBias = 0.02;
    this.scene.add(light);
    const fill = new T.DirectionalLight('#d2e4ff', 0.7); fill.position.set(15, 6, -10); this.scene.add(fill);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.enablePan = false;
    this.controls.enableZoom = true;
    this.controls.minZoom = 0.7;
    this.controls.maxZoom = 2;
    this.controls.minPolarAngle = 0.001;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.addEventListener('change', () => {
      if (Math.abs(this.camera.zoom - this.zoom) > 0.001) { this.zoom = this.camera.zoom; this.onZoom(this.zoom); }
      this.requestRender();
    });
    this.controls.addEventListener('start', () => { if (this.view !== '3d') { this.view = '3d'; this.onOrbit(); } });
    // Orbit handles rotation; the UI and pinch/wheel share a single zoom value.
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container);
    this.setView('3d');
  }

  private contextLost = (e: Event) => { e.preventDefault(); this.container.setAttribute('data-context-lost', 'true'); };
  private requestRender() {
    if (this.renderPending || this.disposed) return;
    this.renderPending = true;
    requestAnimationFrame(() => { this.renderPending = false; if (!this.disposed) this.renderer.render(this.scene, this.camera); });
  }
  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    const half = Math.max(this.extent / 2, this.extent / 2 / aspect);
    this.camera.left = -half * aspect; this.camera.right = half * aspect;
    this.camera.top = half; this.camera.bottom = -half;
    this.camera.zoom = this.zoom; this.camera.updateProjectionMatrix(); this.requestRender();
  }
  setZoom(zoom: number) { this.zoom = zoom; this.resize(); }
  setView(view: View) {
    this.view = view;
    this.camera.up.set(0, 1, 0);
    const target = new T.Vector3(0, this.center, 0);
    this.controls.target.copy(target);
    const offset = view === 'top' ? new T.Vector3(0, 50, 0.001) : view === 'front' ? new T.Vector3(0, 0, 50) : new T.Vector3(22, 17, 32);
    this.camera.position.copy(target).add(offset); this.camera.lookAt(target);
    this.controls.update(); this.requestRender();
  }
  private label(text: string, at: T.Vector3) {
    const cv = document.createElement('canvas'); cv.width = 768; cv.height = 128;
    const cx = cv.getContext('2d')!; cx.font = '600 52px Arial, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    const textWidth = cx.measureText(text).width;
    cx.fillStyle = '#eaf3ffee'; cx.fillRect((768 - textWidth) / 2 - 16, 28, textWidth + 32, 72);
    cx.fillStyle = '#10214f'; cx.fillText(text, 384, 64);
    const map = new T.CanvasTexture(cv); map.colorSpace = T.SRGBColorSpace;
    const s = new T.Sprite(new T.SpriteMaterial({ map, depthTest: false, transparent: true }));
    s.position.copy(at); s.scale.set(this.extent * 0.32, this.extent * 0.0533, 1); s.renderOrder = 20; this.annotations.add(s);
  }
  private dimension(a: T.Vector3, b: T.Vector3, text: string, textPos: T.Vector3, tick: T.Vector3) {
    const points = [a, b, a.clone().sub(tick), a.clone().add(tick), b.clone().sub(tick), b.clone().add(tick)];
    const g = new T.BufferGeometry().setFromPoints(points);
    const l = new T.LineSegments(g, new T.LineBasicMaterial({ color: '#10214f', depthTest: false, transparent: true, opacity: 0.75 }));
    l.renderOrder = 19; this.annotations.add(l); this.label(text, textPos);
  }
  update(c: Config) {
    const oldTotal = this.cfg ? layout(this.cfg).total : null;
    const oldKind = this.cfg?.product.kind;
    this.cfg = c;
    const oldCenter = this.center;
    disposeGroup(this.models); disposeGroup(this.annotations);
    const l = layout(c), p = c.product;
    const maxWidth = Math.max(...c.tiers.map(t => Math.max(t.width, c.shape === 'rect' ? t.depth : t.width)));
    const topExtent = p.kind === 'acrylic' && p.placement === 'top' ? Math.max(l.total, l.top + p.lift + l.h) : l.total;
    this.extent = Math.max(maxWidth + 3, topExtent + 2, p.width + 2, l.h + 2) * 1.16;
    this.center = topExtent / 2;
    let bottom = 0.16;
    c.tiers.forEach((t, i) => {
      const geo = c.shape === 'round' ? new T.CylinderGeometry(t.width / 2, t.width / 2, t.height, 96) : new T.BoxGeometry(t.width, t.height, t.depth);
      const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ color: c.cakeColor, roughness: 0.72, metalness: 0 }));
      mesh.name = `tier-${i + 1}`; mesh.position.y = bottom + t.height / 2;
      mesh.castShadow = true; mesh.receiveShadow = true; this.models.add(mesh);
      if (c.shape === 'round') {
        const rim = new T.Mesh(new T.TorusGeometry(t.width / 2 - 0.022, 0.028, 8, 96), new T.MeshStandardMaterial({ color: c.cakeColor, roughness: 0.8 }));
        rim.rotation.x = Math.PI / 2; rim.position.y = bottom + t.height - 0.028; this.models.add(rim);
      }
      bottom += t.height;
    });
    const board = new T.Mesh(c.shape === 'round' ? new T.CylinderGeometry(maxWidth / 2 + 0.55, maxWidth / 2 + 0.55, 0.16, 96) : new T.BoxGeometry(maxWidth + 1.1, 0.16, maxWidth + 1.1), new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }));
    board.position.y = 0.08; board.castShadow = true; board.receiveShadow = true; this.models.add(board);
    const floor = new T.Mesh(new T.PlaneGeometry(300, 300), new T.ShadowMaterial({ opacity: 0.08 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.015; floor.receiveShadow = true; this.models.add(floor);
    const mat = new T.MeshStandardMaterial({ map: productTexture(c), transparent: true, alphaTest: 0.02, side: T.DoubleSide,
      roughness: p.kind === 'acrylic' ? 0.25 : 0.8, metalness: p.kind === 'acrylic' ? 0.35 : 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const image = new T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>(new T.PlaneGeometry(p.width, l.h), mat); image.name = 'product';
    if (p.placement === 'top') {
      if (p.kind === 'edible') {
        image.rotation.set(-Math.PI / 2, 0, -p.rotation * Math.PI / 180);
        image.position.set(l.ox, l.top + 0.025, l.oz);
      } else {
        image.position.set(l.ox, l.top + p.lift + l.h / 2, l.oz);
        image.rotation.y = p.rotation * Math.PI / 180;
        const stick = new T.Mesh(new T.BoxGeometry(0.1, p.lift + 0.45, 0.045), new T.MeshStandardMaterial({ color: p.color, metalness: 0.5, roughness: 0.3 }));
        stick.name = 'topper-stick'; stick.position.set(l.ox, l.top + (p.lift - 0.45) / 2, l.oz); stick.rotation.y = image.rotation.y; this.models.add(stick);
      }
    } else {
      const centerY = l.bottom + l.tier.height / 2 + p.y / 100 * l.tier.height / 2;
      if (c.shape === 'round') {
        const angle = p.x / 100 * Math.PI;
        if (p.kind === 'edible') { image.geometry.dispose(); image.geometry = curvedImage(p.width, l.h, l.tier.width / 2 + 0.024, angle); image.position.y = centerY; }
        else { const r = l.tier.width / 2 + 0.04; image.position.set(Math.sin(angle) * r, centerY, Math.cos(angle) * r); image.rotation.set(0, angle, p.rotation * Math.PI / 180); }
      } else { image.position.set(l.ox, centerY, l.tier.depth / 2 + 0.024); image.rotation.z = p.rotation * Math.PI / 180; }
    }
    image.castShadow = p.kind === 'acrylic'; this.models.add(image);
    if (c.measures) {
      const z = (c.shape === 'round' ? l.tier.width : l.tier.depth) / 2 + 0.5;
      const y = l.top + (p.kind === 'edible' && p.placement === 'top' ? 0.65 : 0.4);
      this.dimension(new T.Vector3(-l.tier.width / 2, y, z), new T.Vector3(l.tier.width / 2, y, z), `${fmt(l.tier.width, c.unit)} · kek`, new T.Vector3(0, y + 0.35, z), new T.Vector3(0, 0.12, 0));
      const x = l.tier.width / 2 + 0.65;
      const sideZ = -(c.shape === 'round' ? l.tier.width : l.tier.depth) / 2 - 0.35;
      this.dimension(new T.Vector3(x, l.bottom, sideZ), new T.Vector3(x, l.top, sideZ), `${fmt(l.tier.height, c.unit)} tinggi`, new T.Vector3(x - 0.35, (l.top + l.bottom) / 2, sideZ), new T.Vector3(0.12, 0, 0));
    }
    if (oldTotal !== l.total || oldKind !== p.kind) this.setView(this.view);
    else { this.camera.position.y += this.center - oldCenter; this.controls.target.set(0, this.center, 0); this.controls.update(); }
    this.resize();
  }
  async export(c: Config): Promise<Blob> {
    // Render a larger frame for sharing; restore the live viewport after capture.
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const exportW = 1600, exportH = Math.round(exportW * h / w);
    this.renderer.setPixelRatio(1); this.renderer.setSize(exportW, exportH, false);
    this.renderer.render(this.scene, this.camera);
    const cv = document.createElement('canvas'); cv.width = exportW; cv.height = exportH + 180;
    const ctx = cv.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(this.renderer.domElement, 0, 0);
    ctx.fillStyle = '#10214f'; ctx.font = 'bold 30px Arial'; ctx.fillText('decocake.my · Cake Mockup', 36, exportH + 45);
    ctx.font = '24px Arial';
    ctx.fillText(`${c.product.kind === 'edible' ? 'Edible image' : 'Acrylic'} ${fmt(c.product.width, c.unit)} × ${fmt(layout(c).h, c.unit)} · ${c.product.placement === 'top' ? 'Atas' : 'Sisi'} · Tier ${c.product.tier + 1}`, 36, exportH + 88);
    ctx.fillText(`Kek ${c.tiers.map(t => `${fmt(t.width, c.unit)}${c.shape === 'rect' ? ` × ${fmt(t.depth, c.unit)}` : ''}, tinggi ${fmt(t.height, c.unit)}`).join(' / ')}`, 36, exportH + 124);
    ctx.fillStyle = '#556581'; ctx.font = '21px Arial'; ctx.fillText('Anggaran visual. Ukur ruang selepas hiasan; ukuran acrylic tidak termasuk batang.', 36, exportH + 160);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.setSize(w, h); this.requestRender();
    return new Promise((resolve, reject) => cv.toBlob(b => b ? resolve(b) : reject(new Error('Gambar tidak dapat disimpan.')), 'image/png'));
  }
  dispose() {
    this.disposed = true; this.resizeObserver.disconnect(); this.controls.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    disposeGroup(this.models); disposeGroup(this.annotations); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
