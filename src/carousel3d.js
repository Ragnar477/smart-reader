// A WebGL book carousel: real 3D books on an arc, studio lighting, a soft contact shadow,
// drag with momentum, click to bring a book to the centre, and a slow drift when idle.
// Framework-free so it can be mounted from React or a plain page. THREE is passed in.

const DEFAULTS = {
  bookWidth: 1.4,
  bookHeight: 2.1,
  spineThickness: 0.3,
  gap: 1.15, // horizontal distance between neighbours
  flankAngle: 0.62, // radians the side books turn towards the centre
  arcDepth: 0.38, // how far side books fall back
  centerLift: 0.18, // the centre book steps forward
  ambient: 1.1,
  key: 2.4,
  rim: 1.6,
  shadowOpacity: 0.38,
  shadowSoftness: 6,
  sheen: 0.6, // clear-coat gloss on covers
  decay: 0.92, // momentum kept per frame
  dragSensitivity: 1,
  drift: 0.0025, // books per frame while idle
  idleDelay: 3500,
  fov: 32,
  distance: 9,
  pitch: 0.12,
};

export function createBookCarousel(THREE, container, books, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const n = books.length;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCF honours shadow.radius for a soft edge
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "pan-y";
  renderer.domElement.style.cursor = "grab";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(o.fov, 1, 0.1, 100);
  camera.position.set(0, o.bookHeight * 0.5 + Math.sin(o.pitch) * o.distance, Math.cos(o.pitch) * o.distance);
  camera.lookAt(0, o.bookHeight * 0.5, 0);

  // Three-point studio lighting.
  scene.add(new THREE.AmbientLight(0xffffff, o.ambient));
  const key = new THREE.DirectionalLight(0xfff3e0, o.key);
  key.position.set(1.5, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = o.shadowSoftness;
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, o.key * 0.35);
  fill.position.set(-5, 3, 4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xbfe4ff, o.rim);
  rim.position.set(-2, 4, -6);
  scene.add(rim);

  // Floor that only shows the contact shadow.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.ShadowMaterial({ opacity: o.shadowOpacity }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const pagesTexture = (() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#f4ecda";
    g.fillRect(0, 0, 64, 256);
    for (let x = 0; x < 64; x += 2) {
      g.fillStyle = x % 4 ? "#e3d6bd" : "#ede2cb";
      g.fillRect(x, 0, 1, 256);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const pagesTop = pagesTexture.clone();
  pagesTop.rotation = Math.PI / 2;
  pagesTop.center.set(0.5, 0.5);

  const loader = new THREE.TextureLoader();
  const geometry = new THREE.BoxGeometry(o.bookWidth, o.bookHeight, o.spineThickness);
  geometry.translate(0, o.bookHeight / 2, 0);
  const disposables = [geometry, pagesTexture, pagesTop, floor.geometry, floor.material];

  const meshes = books.map((book, i) => {
    // The spine continues the cover: it samples the cover's left edge, stretched.
    const spine = new THREE.Texture();
    spine.colorSpace = THREE.SRGBColorSpace;
    spine.repeat.set(0.08, 1);
    const cover = loader.load(book.cover, (tex) => {
      spine.image = tex.image;
      spine.needsUpdate = true;
    });
    cover.colorSpace = THREE.SRGBColorSpace;
    cover.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const coverMat = new THREE.MeshPhysicalMaterial({ map: cover, roughness: 0.42, clearcoat: o.sheen, clearcoatRoughness: 0.25 });
    const spineMat = new THREE.MeshPhysicalMaterial({ map: spine, roughness: 0.5, clearcoat: o.sheen * 0.6, color: 0xbbbbbb });
    const backMat = new THREE.MeshStandardMaterial({ color: book.back || 0x2a2a33, roughness: 0.7 });
    const pagesMat = new THREE.MeshStandardMaterial({ map: pagesTexture, roughness: 0.9 });
    const pagesTopMat = new THREE.MeshStandardMaterial({ map: pagesTop, roughness: 0.9 });
    // Box faces: +x pages, -x spine, +y top, -y bottom, +z cover, -z back.
    const mesh = new THREE.Mesh(geometry, [pagesMat, spineMat, pagesTopMat, pagesTopMat, coverMat, backMat]);
    mesh.castShadow = true;
    mesh.userData.index = i;
    scene.add(mesh);
    disposables.push(cover, spine, coverMat, spineMat, backMat, pagesMat, pagesTopMat);
    return mesh;
  });

  // Carousel state: `pos` is the (fractional) index at the centre.
  let pos = Math.min(options.start ?? 0, n - 1);
  let velocity = 0;
  let target = null;
  let lastInteraction = performance.now();
  let lastCenter = -1;
  let raf = 0;

  const wrap = (x) => (n ? ((x % n) + n) % n : 0);
  const offset = (i) => {
    // Shortest signed distance from the centre, so the ring loops.
    let d = i - pos;
    if (n > 2) d = wrap(d + n / 2) - n / 2;
    return d;
  };

  function layout() {
    for (const mesh of meshes) {
      const d = offset(mesh.userData.index);
      const a = Math.abs(d);
      const side = Math.max(-1, Math.min(1, d));
      mesh.position.x = d * o.gap + side * o.bookWidth * 0.35;
      mesh.position.z = -(Math.min(a, 4) ** 1.35) * o.arcDepth + Math.max(0, 1 - a) * o.centerLift;
      mesh.rotation.y = -side * o.flankAngle;
      mesh.visible = a < 6.5;
    }
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / h;
    // Fill the height with the books, but always keep at least three in view on narrow screens.
    const deg = 180 / Math.PI;
    const fovForHeight = 2 * Math.atan((o.bookHeight * 1.7) / 2 / o.distance) * deg;
    const halfWidth = (3 * o.gap) / 2 + o.bookWidth;
    const fovForWidth = 2 * Math.atan(halfWidth / camera.aspect / o.distance) * deg;
    camera.fov = Math.min(60, Math.max(fovForHeight, fovForWidth));
    camera.updateProjectionMatrix();
  }

  function tick() {
    const now = performance.now();
    if (!dragging) {
      if (target != null) {
        // Spring towards the clicked book.
        let d = target - pos;
        if (n > 2) d = wrap(d + n / 2) - n / 2;
        velocity = velocity * 0.7 + d * 0.12;
        if (Math.abs(d) < 0.002 && Math.abs(velocity) < 0.002) {
          pos = target;
          velocity = 0;
          target = null;
        }
      } else if (Math.abs(velocity) > 0.004) {
        velocity *= o.decay;
      } else if (!reduceMotion && now - lastInteraction > o.idleDelay) {
        velocity = o.drift;
      } else {
        // Settle on the nearest book.
        const d = Math.round(pos) - pos;
        velocity = d * 0.15;
      }
      pos = wrap(pos + velocity);
    }
    layout();
    const center = wrap(Math.round(pos));
    if (center !== lastCenter) {
      lastCenter = center;
      options.onCenter?.(center);
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  // Drag with momentum; a click without movement picks a book.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragging = false;
  let startX = 0;
  let lastX = 0;
  let moved = 0;
  // Screen pixels per book at the centre, so a drag follows the finger.
  const pxPerBook = () => {
    const visibleHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * o.distance;
    return (o.gap / (visibleHeight * camera.aspect)) * container.clientWidth;
  };

  function onDown(e) {
    dragging = true;
    moved = 0;
    startX = lastX = e.clientX;
    target = null;
    velocity = 0;
    lastInteraction = performance.now();
    renderer.domElement.setPointerCapture(e.pointerId);
    renderer.domElement.style.cursor = "grabbing";
  }
  function onMove(e) {
    if (!dragging) {
      renderer.domElement.style.cursor = hit(e) ? "pointer" : "grab";
      return;
    }
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved = Math.max(moved, Math.abs(e.clientX - startX));
    const step = (-dx / pxPerBook()) * o.dragSensitivity;
    pos = wrap(pos + step);
    velocity = step;
    lastInteraction = performance.now();
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    renderer.domElement.style.cursor = "grab";
    lastInteraction = performance.now();
    if (moved < 6) {
      const index = hit(e);
      if (index == null) return;
      if (index === wrap(Math.round(pos)) && Math.abs(offset(index)) < 0.3) options.onOpen?.(index);
      else target = index;
    }
  }
  function hit(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(meshes.filter((m) => m.visible))[0]?.object.userData.index ?? null;
  }
  const el = renderer.domElement;
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  tick();

  return {
    // Move by whole books (keyboard and buttons).
    step(delta) {
      lastInteraction = performance.now();
      target = wrap(Math.round(pos) + delta);
    },
    goTo(index) {
      lastInteraction = performance.now();
      target = wrap(index);
    },
    // Where the centre book's cover is on screen, for the opening animation.
    centerRect() {
      const mesh = meshes[wrap(Math.round(pos))];
      if (!mesh) return null;
      const r = el.getBoundingClientRect();
      const pts = [
        [-o.bookWidth / 2, 0],
        [o.bookWidth / 2, o.bookHeight],
      ].map(([x, y]) => new THREE.Vector3(x, y, o.spineThickness / 2).applyMatrix4(mesh.matrixWorld).project(camera));
      const xs = pts.map((p) => r.left + ((p.x + 1) / 2) * r.width);
      const ys = pts.map((p) => r.top + ((1 - p.y) / 2) * r.height);
      return new DOMRect(Math.min(...xs), Math.min(...ys), Math.abs(xs[1] - xs[0]), Math.abs(ys[1] - ys[0]));
    },
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      el.remove();
    },
  };
}
