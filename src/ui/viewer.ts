import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HEXA_FACES, handedness, toWorld, type Hexa, type Placement } from '../core/geom';
import { getSpecies } from '../core/species';
import type { Finish, Model, Part } from '../core/types';

/** Builds triangle soup (flat-shaded) for a set of hexahedra in world space. */
function hexaGeometry(hexas: Hexa[], placement: Placement): THREE.BufferGeometry {
  const flip = handedness(placement) < 0;
  const pos: number[] = [];
  for (const h of hexas) {
    const w = h.map((p) => toWorld(placement, p));
    for (const [a, b, c, d] of HEXA_FACES) {
      const tris = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
      for (const i of tris) pos.push(...w[i]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function finishColor(base: string, finish: Finish): THREE.Color {
  const c = new THREE.Color(base);
  if (finish === 'paint') return new THREE.Color('#e8e3d8');
  if (finish === 'oil') return c.offsetHSL(0, 0.05, -0.06);
  if (finish === 'stain') return c.offsetHSL(0, 0.08, -0.14);
  return c.offsetHSL(0, -0.04, 0.04);
}

interface PartView {
  part: Part;
  group: THREE.Group;
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
  private views: PartView[] = [];
  private cutoutMaterial = new THREE.MeshBasicMaterial({ color: '#d0452f', transparent: true, opacity: 0.55, depthWrite: false });
  private edgeMaterial = new THREE.LineBasicMaterial({ color: '#2b2118', transparent: true, opacity: 0.45 });
  private center = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hovered: PartView | null = null;
  private explode = 0;
  private xray = false;
  private firstFit = true;

  constructor(
    private container: HTMLElement,
    private tooltip: HTMLElement,
    private describe: (part: Part) => string,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight('#fff8ee', '#5a4a3a', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.8);
    sun.position.set(60, 120, 80);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#ffffff', 0.5);
    fill.position.set(-80, 40, -60);
    this.scene.add(fill);
    this.scene.add(this.root);

    new ResizeObserver(() => this.resize()).observe(container);
    this.renderer.domElement.addEventListener('pointermove', (e) => this.onPointer(e));
    this.renderer.domElement.addEventListener('pointerleave', () => this.setHover(null));
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
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
    this.views = [];
    this.hovered = null;

    const all = new THREE.Box3();
    model.parts.forEach((part, i) => {
      const base = finishColor(getSpecies(part.species).color, model.spec.finish);
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: base.clone().offsetHSL(0, 0, ((i % 3) - 1) * 0.025),
        roughness: model.spec.finish === 'paint' ? 0.5 : 0.75,
        flatShading: true,
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
      this.views.push({ part, group, home: box.getCenter(new THREE.Vector3()), bodyMaterial, tenonMaterial });
      this.root.add(group);
    });
    all.getCenter(this.center);
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

  resetView(): void {
    this.fit(new THREE.Box3().setFromObject(this.root));
  }

  private applyModes(): void {
    for (const v of this.views) {
      const dir = v.home.clone().sub(this.center);
      v.group.position.copy(dir.multiplyScalar(this.explode * 0.6));
      for (const m of [v.bodyMaterial, v.tenonMaterial]) {
        if (m.transparent !== this.xray) m.needsUpdate = true;
        m.transparent = this.xray;
        m.opacity = this.xray ? (m === v.tenonMaterial ? 0.85 : 0.18) : 1;
        m.depthWrite = !this.xray;
        m.emissive.set(v === this.hovered ? '#553311' : '#000000');
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
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.position.copy(center).add(new THREE.Vector3(0.75, 0.55, 1).normalize().multiplyScalar(dist * 0.9));
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
  }
}
