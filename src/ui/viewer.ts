import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HEXA_FACES, handedness, toWorld, type Hexa, type Placement, type Vec3 } from '../core/geom';
import { getSpecies } from '../core/species';
import type { Finish, Model, Part } from '../core/types';

/**
 * Builds triangle soup (flat-shaded) for a set of hexahedra in world space.
 * Faces two solids share (segments of a slab, wedges of a round) are inside
 * the part, so they're dropped: no hidden triangles and no seam lines.
 */
function hexaGeometry(hexas: Hexa[], placement: Placement): THREE.BufferGeometry {
  const flip = handedness(placement) < 0;
  const faces: { key: string; pts: Vec3[] }[] = [];
  const counts = new Map<string, number>();
  for (const h of hexas) {
    const w = h.map((p) => toWorld(placement, p));
    for (const [a, b, c, d] of HEXA_FACES) {
      const pts = [w[a], w[b], w[c], w[d]];
      const key = pts
        .map((p) => p.map((v) => v.toFixed(4)).join(','))
        .sort()
        .join('|');
      counts.set(key, (counts.get(key) ?? 0) + 1);
      faces.push({ key, pts });
    }
  }
  const pos: number[] = [];
  for (const { key, pts } of faces) {
    if (counts.get(key)! > 1) continue;
    const tris = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const i of tris) pos.push(...pts[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function finishColor(base: string, finish: Finish): THREE.Color {
  const c = new THREE.Color(base);
  if (finish === 'paint') return new THREE.Color('#e8e3d8');
  if (finish === 'oil') return c.offsetHSL(0, 0.05, -0.02);
  if (finish === 'stain') return c.offsetHSL(0, 0.08, -0.14);
  return c.offsetHSL(0, -0.04, 0.04);
}

interface PartView {
  part: Part;
  group: THREE.Group;
  label: HTMLElement;
  home: THREE.Vector3;
  bodyMaterial: THREE.MeshStandardMaterial;
  tenonMaterial: THREE.MeshStandardMaterial;
}

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
  private controls: OrbitControls;
  private root = new THREE.Group();
  /** Chairs and other context: drawn faintly, never picked or exploded. */
  private ghosts = new THREE.Group();
  private ghostMaterial = new THREE.MeshStandardMaterial({ color: '#8c939b', transparent: true, opacity: 0.3, depthWrite: false, roughness: 0.9 });
  private ghostEdges = new THREE.LineBasicMaterial({ color: '#5b6168', transparent: true, opacity: 0.35 });
  private views: PartView[] = [];
  private cutoutMaterial = new THREE.MeshBasicMaterial({ color: '#d0452f', transparent: true, opacity: 0.55, depthWrite: false });
  private edgeMaterial = new THREE.LineBasicMaterial({ color: '#2b2118', transparent: true, opacity: 0.45 });
  private center = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hovered: PartView | null = null;
  private explode = 0;
  private xray = false;
  private showLabels = false;
  private selected = new Set<string>();
  private firstFit = true;
  private labelLayer = document.createElement('div');
  private downAt: { x: number; y: number } | null = null;
  /** Letter shown on each part (cut list key). */
  letters: Record<string, string> = {};
  /** Called when the pointer moves onto or off a part. */
  onHover: (partId: string | null) => void = () => {};
  /** Called when a part is clicked (not dragged); null for empty space. */
  onPick: (partId: string | null) => void = () => {};

  constructor(
    private container: HTMLElement,
    private tooltip: HTMLElement,
    private describe: (part: Part) => string,
  ) {
    this.labelLayer.className = 'part-labels';
    this.labelLayer.hidden = true;
    container.appendChild(this.labelLayer);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight('#fff8ee', '#8a7a6a', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 1.8);
    sun.position.set(60, 120, 80);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#ffffff', 0.5);
    fill.position.set(-80, 40, -60);
    this.scene.add(fill);
    this.scene.add(this.root);
    this.scene.add(this.ghosts);

    new ResizeObserver(() => this.resize()).observe(container);
    this.renderer.domElement.addEventListener('pointermove', (e) => this.onPointer(e));
    this.renderer.domElement.addEventListener('pointerleave', () => this.setHover(null));
    this.renderer.domElement.addEventListener('pointerdown', (e) => (this.downAt = { x: e.clientX, y: e.clientY }));
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 5) {
        this.onPointer(e);
        this.onPick(this.hovered?.part.id ?? null);
      }
      this.downAt = null;
    });
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (this.showLabels) this.placeLabels();
    });
  }

  setModel(model: Model): void {
    for (const v of this.views) {
      v.group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
      });
      v.bodyMaterial.dispose();
      v.tenonMaterial.dispose();
    }
    this.root.clear();
    this.ghosts.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    this.ghosts.clear();
    const identity: Placement = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    for (const g of model.ghosts ?? []) {
      const geo = hexaGeometry(g.solids, identity);
      this.ghosts.add(new THREE.Mesh(geo, this.ghostMaterial), new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), this.ghostEdges));
    }
    this.views = [];
    this.hovered = null;
    this.labelLayer.replaceChildren();

    const all = new THREE.Box3();
    model.parts.forEach((part, i) => {
      const steel = part.material === 'steel';
      const base = steel ? new THREE.Color('#34373b') : finishColor(getSpecies(part.species).color, model.spec.finish);
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: steel ? base : base.clone().offsetHSL(0, 0, ((i % 3) - 1) * 0.025),
        roughness: steel ? 0.45 : model.spec.finish === 'paint' ? 0.5 : 0.75,
        metalness: steel ? 0.6 : 0,
        flatShading: !steel,
      });
      const tenonMaterial = new THREE.MeshStandardMaterial({ color: base.clone().offsetHSL(0, 0, 0.12), roughness: 0.8, flatShading: true });
      const group = new THREE.Group();
      group.userData.partId = part.id;

      const body = hexaGeometry(part.solids.filter((s) => s.kind === 'body').map((s) => s.hexa), part.placement);
      group.add(new THREE.Mesh(body, bodyMaterial));
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(body, 25), this.edgeMaterial));
      const tenons = part.solids.filter((s) => s.kind === 'tenon').map((s) => s.hexa);
      if (tenons.length) group.add(new THREE.Mesh(hexaGeometry(tenons, part.placement), tenonMaterial));
      if (part.cutouts.length) {
        const cut = new THREE.Mesh(hexaGeometry(part.cutouts.map((c) => c.hexa), part.placement), this.cutoutMaterial);
        cut.userData.cutout = true;
        cut.renderOrder = 2;
        group.add(cut);
      }
      const box = new THREE.Box3().setFromObject(group);
      all.union(box);
      const label = document.createElement('span');
      label.textContent = this.letters[part.id] ?? '';
      if (label.textContent) this.labelLayer.appendChild(label);
      this.views.push({ part, group, label, home: box.getCenter(new THREE.Vector3()), bodyMaterial, tenonMaterial });
      this.root.add(group);
    });
    all.getCenter(this.center);
    if (this.ghosts.visible && this.hasGhosts) all.union(new THREE.Box3().setFromObject(this.ghosts));
    this.applyModes();
    if (this.firstFit) {
      this.fit(all);
      this.firstFit = false;
    }
  }

  /** 0 = assembled, 1 = fully exploded. */
  setExplode(amount: number): void {
    this.explode = amount;
    this.applyModes();
  }

  setXray(on: boolean): void {
    this.xray = on;
    this.applyModes();
  }

  /** Whether this model has context like chairs to show. */
  get hasGhosts(): boolean {
    return this.ghosts.children.length > 0;
  }

  setGhosts(on: boolean): void {
    this.ghosts.visible = on;
  }

  setLabels(on: boolean): void {
    this.showLabels = on;
    this.labelLayer.hidden = !on;
  }

  /** Highlight these parts and fade the rest; empty clears the highlight. */
  setSelected(ids: Iterable<string>): void {
    this.selected = new Set(ids);
    this.applyModes();
  }

  private placeLabels(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    const p = new THREE.Vector3();
    for (const v of this.views) {
      if (!v.label.textContent) continue;
      p.copy(v.home).add(v.group.position).project(this.camera);
      const visible = p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
      v.label.hidden = !visible;
      if (visible) v.label.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }

  resetView(): void {
    const box = new THREE.Box3().setFromObject(this.root);
    if (this.ghosts.visible && this.hasGhosts) box.union(new THREE.Box3().setFromObject(this.ghosts));
    this.fit(box);
  }

  private applyModes(): void {
    const focusing = this.selected.size > 0;
    for (const v of this.views) {
      const dir = v.home.clone().sub(this.center);
      v.group.position.copy(dir.multiplyScalar(this.explode * 0.6));
      const isSelected = this.selected.has(v.part.id);
      // Faded: everything in x-ray, or the parts not picked while some are.
      const faded = this.xray || (focusing && !isSelected);
      v.label.classList.toggle('selected', isSelected);
      for (const m of [v.bodyMaterial, v.tenonMaterial]) {
        if (m.transparent !== faded) m.needsUpdate = true;
        m.transparent = faded;
        m.opacity = !faded ? 1 : this.xray && (m === v.tenonMaterial || isSelected) ? 0.85 : focusing && !this.xray ? 0.12 : 0.18;
        m.depthWrite = !faded;
        m.emissive.set(isSelected ? '#6b3510' : v === this.hovered ? '#553311' : '#000000');
      }
      v.group.traverse((o) => {
        if (o.userData.cutout) o.visible = this.xray;
      });
    }
  }

  private fit(box: THREE.Box3): void {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = size.length() / 2;
    // Fit whichever way is tighter: tall phone screens are limited by width.
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dist = radius / Math.sin(Math.min(vFov, hFov) / 2);
    this.camera.position.copy(center).add(new THREE.Vector3(0.75, 0.55, 1).normalize().multiplyScalar(dist * (this.camera.aspect >= 1 ? 0.9 : 1.05)));
    this.camera.near = dist / 100;
    this.camera.far = dist * 10;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private onPointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.views.flatMap((v) => v.group.children.filter((c) => c instanceof THREE.Mesh && !c.userData.cutout));
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    const view = hit ? (this.views.find((v) => v.group === hit.object.parent) ?? null) : null;
    this.setHover(view);
    if (view) {
      this.tooltip.textContent = this.describe(view.part);
      this.tooltip.style.left = `${e.clientX - rect.left + 14}px`;
      this.tooltip.style.top = `${e.clientY - rect.top + 14}px`;
    }
  }

  private setHover(v: PartView | null): void {
    if (v === this.hovered) return;
    this.hovered = v;
    this.tooltip.hidden = !v;
    this.applyModes();
    this.onHover(v?.part.id ?? null);
  }
}
