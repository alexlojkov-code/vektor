// 3D-объекты лендинга на Three.js. Один WebGL-холст на весь экран; каждый объект рисуется
// в прямоугольник своего «слота» (<div data-obj>) через scissor — так не нужен холст на каждый объект.
// Сборка: npm run build:3d → public/js/scene3d.min.js
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Vector3, Vector2, Quaternion, Color,
  MeshPhysicalMaterial, MeshBasicMaterial, SphereGeometry, CylinderGeometry, ConeGeometry, TorusGeometry,
  ExtrudeGeometry, Shape, LatheGeometry, BoxGeometry, DirectionalLight, PMREMGenerator,
  ACESFilmicToneMapping, SRGBColorSpace, DoubleSide, MathUtils, Box3, Sphere,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const fineMQ = matchMedia('(hover: hover) and (pointer: fine)');
const easeOut = t => 1 - Math.pow(1 - t, 4);
const easeOutBack = t => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const UP = new Vector3(0, 1, 0);

/* ---------- Материалы: глянцевый фиолетовый «пластик-стекло» в палитре бренда ---------- */
const physical = (color, extra = {}) => new MeshPhysicalMaterial({
  color, roughness: 0.16, metalness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05,
  iridescence: 0.45, iridescenceIOR: 1.35, sheen: 0.35, sheenColor: new Color(0xb596ff), ...extra,
});
const M = {
  violet: physical(0x5b2ee6),
  bright: physical(0x7b4dff),
  lavender: physical(0xa98bff, { roughness: 0.22 }),
  deep: physical(0x2a0866, { roughness: 0.28, iridescence: 0.25 }),
  pearl: physical(0xd9ccff, { roughness: 0.24, iridescence: 0.6 }),
};

/* Цилиндр между двумя точками — для «ломаных» форм вроде галочки-стрелки */
function rod(a, b, r, mat) {
  const dir = new Vector3().subVectors(b, a);
  const mesh = new Mesh(new CylinderGeometry(r, r, dir.length(), 40, 1), mat);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

/* ---------- Объекты. Каждый: { group, update(t, s) }, s — прогресс появления 0…1 ---------- */
const OBJECTS = {
  // Растущие столбики графика — метрики и калькулятор
  bars() {
    const group = new Group();
    const base = new Mesh(new RoundedBoxGeometry(2.5, 0.2, 1.1, 4, 0.08), M.deep);
    base.position.y = -1.05;
    group.add(base);
    const heights = [0.8, 1.3, 1.95];
    const mats = [M.lavender, M.bright, M.violet];
    const bars = heights.map((h, i) => {
      const geo = new RoundedBoxGeometry(0.55, 1, 0.55, 4, 0.14);
      geo.translate(0, 0.5, 0);
      const bar = new Mesh(geo, mats[i]);
      bar.position.set(-0.78 + i * 0.78, -0.95, 0);
      group.add(bar);
      return bar;
    });
    const coin = new Mesh(new CylinderGeometry(0.32, 0.32, 0.1, 48), M.pearl);
    coin.rotation.x = Math.PI / 2;
    group.add(coin);
    group.rotation.set(0.25, -0.5, 0);
    return {
      group,
      update(t, s) {
        bars.forEach((bar, i) => {
          const grow = easeOutBack(MathUtils.clamp(s * 1.4 - i * 0.18, 0, 1));
          bar.scale.y = Math.max(0.02, heights[i] * grow * (1 + Math.sin(t * 1.6 + i) * 0.03));
        });
        coin.position.set(0.78, -0.95 + heights[2] * easeOut(s) + 0.55 + Math.sin(t * 2) * 0.08, 0);
        coin.rotation.z = t * 1.5;
        group.rotation.y = -0.5 + Math.sin(t * 0.4) * 0.35;
      },
    };
  },

  // Галочка-стрелка из логотипа — «вектор»
  vector() {
    const group = new Group();
    const A = new Vector3(-1.15, 0.15, 0), B = new Vector3(-0.45, -0.6, 0), C = new Vector3(0.95, 0.95, 0);
    const r = 0.18;
    const dirBC = new Vector3().subVectors(C, B).normalize();
    const tipBase = C.clone().addScaledVector(dirBC, -0.15);
    group.add(rod(A, B, r, M.violet), rod(B, tipBase, r, M.violet));
    const joint = new Mesh(new SphereGeometry(r, 40, 20), M.violet);
    joint.position.copy(B);
    const dot = new Mesh(new SphereGeometry(0.27, 48, 24), M.lavender);
    dot.position.copy(A);
    const head = new Mesh(new ConeGeometry(0.42, 0.7, 48), M.lavender);
    head.position.copy(tipBase).addScaledVector(dirBC, 0.3);
    head.quaternion.setFromUnitVectors(UP, dirBC);
    group.add(joint, dot, head);
    return {
      group,
      update(t, s) {
        group.rotation.y = Math.sin(t * 0.55) * 0.6 + (1 - easeOut(s)) * -1.4;
        group.rotation.x = Math.sin(t * 0.4) * 0.15;
        group.position.y = Math.sin(t * 0.9) * 0.08;
        head.position.copy(tipBase).addScaledVector(dirBC, 0.3 + Math.max(0, Math.sin(t * 2.2)) * 0.12);
      },
    };
  },

  // AI-облачко с «печатающими» точками — чат с ассистентом
  chat() {
    const group = new Group();
    const w = 2.3, h = 1.5, r = 0.45;
    const shape = new Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(-w / 2 + 0.75, -h / 2);
    shape.lineTo(-w / 2 + 0.3, -h / 2 - 0.5);
    shape.lineTo(-w / 2 + 1.15, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const geo = new ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.12, bevelSegments: 8, curveSegments: 24 });
    geo.center();
    group.add(new Mesh(geo, M.pearl));
    const dots = [-0.55, 0, 0.55].map(x => {
      const d = new Mesh(new SphereGeometry(0.16, 32, 16), M.violet);
      d.position.set(x, 0.1, 0.38);
      group.add(d);
      return d;
    });
    return {
      group,
      update(t) {
        dots.forEach((d, i) => {
          const k = Math.max(0, Math.sin(t * 5 - i * 0.9));
          d.position.y = 0.1 + k * 0.2;
          d.scale.setScalar(1 + k * 0.15);
        });
        group.rotation.y = Math.sin(t * 0.5) * 0.4 - 0.25;
        group.rotation.x = 0.12 + Math.sin(t * 0.35) * 0.08;
        group.position.y = Math.sin(t * 0.8) * 0.07;
      },
    };
  },

  // Мишень с прилетающим дротиком — таргетинг и цели
  target() {
    const group = new Group();
    const face = new Group();
    [1.35, 1.05, 0.75, 0.45, 0.18].forEach((rad, i) => {
      const disc = new Mesh(new CylinderGeometry(rad, rad, 0.16, 72), i % 2 ? M.pearl : M.violet);
      disc.rotation.x = Math.PI / 2;
      disc.position.z = i * 0.035;
      face.add(disc);
    });
    group.add(face);
    const dart = new Group();
    const shaftLen = 1.7;
    const shaft = new Mesh(new CylinderGeometry(0.06, 0.06, shaftLen, 24), M.deep);
    shaft.position.y = shaftLen / 2;
    const tip = new Mesh(new ConeGeometry(0.1, 0.32, 24), M.lavender);
    tip.rotation.x = Math.PI;
    tip.position.y = -0.08;
    dart.add(shaft, tip);
    for (let i = 0; i < 3; i++) {
      const fin = new Mesh(new BoxGeometry(0.03, 0.46, 0.28), M.bright);
      fin.position.y = shaftLen - 0.12;
      fin.rotation.y = (i / 3) * Math.PI * 2;
      fin.translateZ(0.14);
      dart.add(fin);
    }
    // Ось дротика направлена в центр мишени под углом
    const stuck = new Vector3(0.05, 0.05, 0.2);
    const axis = new Vector3(1, 0.55, 0.75).normalize(); // сбоку, чтобы дротик был виден
    dart.quaternion.setFromUnitVectors(UP, axis);
    group.add(dart);
    group.rotation.set(0.1, -0.45, 0);
    return {
      group,
      update(t, s, since) {
        const fly = easeOut(MathUtils.clamp((since - 0.35) / 0.6, 0, 1));
        dart.position.copy(stuck).addScaledVector(axis, (1 - fly) * 4.5);
        dart.visible = since > 0.35;
        // Дротик дрожит после попадания и затухает
        const after = Math.max(0, since - 0.95);
        const wobble = after > 0 ? Math.sin(after * 28) * Math.exp(-after * 3.5) * 0.12 : 0;
        dart.quaternion.setFromUnitVectors(UP, axis).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), wobble));
        group.rotation.y = -0.45 + Math.sin(t * 0.45) * 0.3;
        group.position.y = Math.sin(t * 0.7) * 0.06;
      },
    };
  },

  // 3D-диаграмма: сегменты пончика, один выдвигается — «ROMI»
  donut() {
    const group = new Group();
    const parts = [[0.42, M.violet], [0.3, M.lavender], [0.28, M.deep]];
    const gap = 0.07;
    let start = 0;
    const segs = parts.map(([share, mat]) => {
      const arc = share * Math.PI * 2 - gap;
      const mesh = new Mesh(new TorusGeometry(1.05, 0.38, 40, 120, arc), mat);
      mesh.rotation.z = start + gap / 2;
      const mid = start + gap / 2 + arc / 2;
      start += share * Math.PI * 2;
      const pivot = new Group();
      pivot.add(mesh);
      group.add(pivot);
      return { pivot, dir: new Vector2(Math.cos(mid), Math.sin(mid)) };
    });
    group.rotation.x = -0.9;
    return {
      group,
      update(t, s) {
        group.rotation.z = t * 0.25 + (1 - easeOut(s)) * 2;
        group.rotation.x = -0.9 + Math.sin(t * 0.5) * 0.12;
        segs.forEach((seg, i) => {
          const pop = i === 0 ? (0.5 + 0.5 * Math.sin(t * 1.4)) * 0.22 : 0;
          seg.pivot.position.set(seg.dir.x * pop, seg.dir.y * pop, 0);
          seg.pivot.scale.setScalar(easeOutBack(MathUtils.clamp(s * 1.3 - i * 0.12, 0, 1)) || 0.001);
        });
      },
    };
  },

  // Воронка, через которую падают лиды: на выходе — продажи
  funnel() {
    const group = new Group();
    const profile = [[0.22, -1.2], [0.22, -0.55], [0.3, -0.35], [1.25, 0.85], [1.3, 0.95]].map(([x, y]) => new Vector2(x, y));
    const body = new Mesh(new LatheGeometry(profile, 96), physical(0x5b2ee6, { side: DoubleSide }));
    const rim = new Mesh(new TorusGeometry(1.3, 0.07, 20, 96), M.lavender);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.95;
    group.add(body, rim);
    const sale = physical(0xffffff, { emissive: new Color(0x9d7bff), emissiveIntensity: 0.6 });
    const balls = Array.from({ length: 7 }, (_, i) => {
      const mat = i % 2 ? M.pearl : M.lavender;
      const b = new Mesh(new SphereGeometry(0.13, 24, 12), mat);
      group.add(b);
      return { b, mat, phase: i / 7, angle: i * 2.2 };
    });
    group.rotation.x = 0.35;
    return {
      group,
      update(t) {
        for (const ball of balls) {
          const p = (t * 0.18 + ball.phase) % 1;
          // сверху по спирали к горлышку, затем вниз через носик
          const y = 1.9 - p * 3.6;
          const radius = y > 0.85 ? 0.9 : y > -0.4 ? MathUtils.mapLinear(y, 0.85, -0.4, 0.95, 0.05) : 0;
          const a = ball.angle + p * 9;
          ball.b.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
          const out = y < -1.15;
          ball.b.material = out ? sale : ball.mat;
          ball.b.scale.setScalar(p > 0.92 ? (1 - p) / 0.08 : p < 0.06 ? p / 0.06 : 1);
        }
        group.rotation.y = t * 0.3;
        group.position.y = Math.sin(t * 0.7) * 0.06;
      },
    };
  },

  // Рупор с волнами звука — PR и охват
  megaphone() {
    const group = new Group();
    const horn = new Mesh(new CylinderGeometry(0.95, 0.32, 1.7, 64, 1, true), physical(0x5b2ee6, { side: DoubleSide }));
    horn.rotation.z = -Math.PI / 2;
    const rim = new Mesh(new TorusGeometry(0.95, 0.07, 20, 80), M.lavender);
    rim.rotation.y = Math.PI / 2;
    rim.position.x = 0.85;
    const back = new Mesh(new CylinderGeometry(0.34, 0.34, 0.45, 48), M.deep);
    back.rotation.z = -Math.PI / 2;
    back.position.x = -1.05;
    const handle = new Mesh(new RoundedBoxGeometry(0.28, 0.75, 0.28, 4, 0.1), M.deep);
    handle.position.set(-0.45, -0.6, 0);
    handle.rotation.z = 0.25;
    group.add(horn, rim, back, handle);
    const waves = [0, 1, 2].map(i => {
      const mat = new MeshBasicMaterial({ color: 0xcdb8ff, transparent: true, opacity: 0.8, depthWrite: false });
      const w = new Mesh(new TorusGeometry(0.9 + i * 0.35, 0.045, 12, 64, Math.PI * 0.7), mat);
      w.rotation.y = Math.PI / 2;
      w.rotation.z = -Math.PI * 0.35;
      group.add(w);
      return { w, mat, i };
    });
    group.rotation.set(0.15, -0.55, 0.3);
    return {
      group,
      update(t) {
        for (const { w, mat, i } of waves) {
          const p = (t * 0.6 + i / 3) % 1;
          w.position.x = 1.05 + p * 1.1;
          w.scale.setScalar(0.7 + p * 0.6);
          mat.opacity = Math.sin(p * Math.PI) * 0.85;
        }
        group.rotation.y = -0.55 + Math.sin(t * 0.5) * 0.3;
        group.position.y = Math.sin(t * 0.8) * 0.07;
      },
    };
  },
};

/* ---------- Сцена и рендер ---------- */
export function start() {
  const slots = [...document.querySelectorAll('[data-obj]')].filter(el => OBJECTS[el.dataset.obj]);
  if (!slots.length) return;

  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return; // нет WebGL — лендинг просто остаётся без 3D
  }
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.autoClear = false;
  const canvas = renderer.domElement;
  canvas.className = 'scene3d';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  const env = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

  const items = slots.map(el => {
    const scene = new Scene();
    scene.environment = env;
    scene.environmentIntensity = 0.6;
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 4, 5);
    const rim = new DirectionalLight(0x8b5eff, 5);
    rim.position.set(-4, -2, -3);
    scene.add(key, rim);
    const obj = OBJECTS[el.dataset.obj]();
    obj.update(0, 1, 10);
    const bounds = new Box3().setFromObject(obj.group).getBoundingSphere(new Sphere());
    const centered = new Group(); // центр объекта — в начало координат, чтобы вращение шло вокруг него
    centered.position.copy(bounds.center).negate();
    centered.add(obj.group);
    const holder = new Group(); // сюда пишем реакцию на скролл и мышь, объект анимирует себя сам
    holder.add(centered);
    scene.add(holder);
    const camera = new PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0, (bounds.radius / Math.sin(MathUtils.degToRad(15))) * 1.08);
    return { el, scene, camera, obj, holder, visible: false, shownAt: null, spin: +el.dataset.spin || 0.4 };
  });

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const it = items.find(i => i.el === e.target);
      it.visible = e.isIntersecting;
      if (e.isIntersecting && it.shownAt === null) it.shownAt = performance.now();
    }
    kick();
  }, { rootMargin: '120px 0px' });
  items.forEach(it => io.observe(it.el));

  let w = 0, h = 0;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, innerWidth < 760 ? 1.5 : 2);
    w = innerWidth; h = innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
  }
  resize();

  let mx = 0, my = 0, tx = 0, ty = 0;
  addEventListener('pointermove', e => {
    if (!fineMQ.matches) return;
    tx = e.clientX / innerWidth - 0.5;
    ty = e.clientY / innerHeight - 0.5;
  }, { passive: true });

  const t0 = performance.now();
  let raf = 0;
  function frame(now) {
    raf = 0;
    const reduce = reduceMQ.matches;
    const t = reduce ? 0 : (now - t0) / 1000;
    mx += (tx - mx) * 0.06;
    my += (ty - my) * 0.06;
    if (w !== innerWidth || h !== innerHeight) resize();

    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    let any = false;
    for (const it of items) {
      if (!it.visible) continue;
      const r = it.el.getBoundingClientRect();
      if (r.width < 2 || r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) continue;
      any = true;
      const since = reduce ? 10 : (now - it.shownAt) / 1000;
      const s = MathUtils.clamp(since / 1.3, 0, 1);
      it.obj.update(t, s, since);
      // Появление: из чуть меньшего размера; поворот по скроллу и за мышью
      const center = (r.top + r.height / 2 - h / 2) / h;
      it.holder.scale.setScalar(0.75 + easeOutBack(s) * 0.25);
      it.holder.rotation.y = reduce ? 0 : center * it.spin * 1.6 + mx * 0.5;
      it.holder.rotation.x = reduce ? 0 : -center * it.spin * 0.6 + my * 0.35;
      it.camera.aspect = r.width / r.height;
      it.camera.updateProjectionMatrix();
      renderer.setViewport(r.left, h - r.bottom, r.width, r.height);
      renderer.setScissor(r.left, h - r.bottom, r.width, r.height);
      renderer.render(it.scene, it.camera);
    }
    // Крутим цикл, пока объект на экране; при reduce-motion — только по событиям
    if (any && !reduce && !document.hidden) kick();
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick);
  document.addEventListener('visibilitychange', kick);
  reduceMQ.addEventListener('change', kick);
  document.documentElement.classList.add('has-3d');
  kick();
}
