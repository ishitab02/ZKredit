import { useEffect, useRef } from "react";
import * as THREE from "three";

type Props = { className?: string };

/** Interactive multi-green point-cloud sphere: slow drift, water-like ripple,
 *  hover jiggle, firefly core. Vanilla Three.js; respects reduced motion. */
export default function ParticleSphere({ className }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const isSmall = window.innerWidth < 768;
    const COUNT = isSmall ? 2200 : 4600;
    const RADIUS = 1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100,
    );
    camera.position.z = 2.95;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));

    const shades = [
      new THREE.Color("#1FA85E"),
      new THREE.Color("#35C46E"),
      new THREE.Color("#4FD98A"),
      new THREE.Color("#6BE89E"),
      new THREE.Color("#8CF0B0"),
      new THREE.Color("#A8F5C6"),
      new THREE.Color("#7CF0B8"),
      new THREE.Color("#C4FBDA"),
    ];
    const sampleGreen = (u: number) => {
      const x = THREE.MathUtils.clamp(u, 0, 1) * (shades.length - 1);
      const i = Math.floor(x);
      if (i >= shades.length - 1) return shades[shades.length - 1].clone();
      return shades[i].clone().lerp(shades[i + 1], x - i);
    };

    for (let i = 0; i < COUNT; i++) {
      const y = 1 - (i / (COUNT - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      const jitter = 0.94 + Math.random() * 0.12;
      positions[i * 3] = x * RADIUS * jitter;
      positions[i * 3 + 1] = y * RADIUS * jitter;
      positions[i * 3 + 2] = z * RADIUS * jitter;
      const t = (y + 1) / 2;
      const col = sampleGreen(0.35 * t + 0.65 * Math.random());
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    geometry.setAttribute("position", posAttr);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const basePos = positions.slice();

    const sprite = makeGlowTexture();
    const material = new THREE.PointsMaterial({
      size: isSmall ? 0.032 : 0.026,
      vertexColors: true,
      map: sprite,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const coreMat = new THREE.PointsMaterial({
      size: 0.5,
      color: new THREE.Color("#8FF6EA"),
      map: sprite,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const coreGeo = new THREE.BufferGeometry();
    coreGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3),
    );
    scene.add(new THREE.Points(coreGeo, coreMat));

    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    let dragVX = 0;
    let dragVY = 0;
    let dragging = false;
    let lastPointer = { x: 0, y: 0 };
    let wobble = 0;
    let wobbleVel = 0;

    const onPointerMove = (e: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      target.x = ny * 0.22;
      target.y = nx * 0.32;
      const dx = nx - lastPointer.x;
      const dy = ny - lastPointer.y;
      wobbleVel += Math.hypot(dx, dy) * 9;
      if (dragging) {
        dragVY += dx * 0.35;
        dragVX += dy * 0.35;
      }
      lastPointer = { x: nx, y: ny };
    };
    const onPointerDown = () => (dragging = true);
    const onPointerUp = () => (dragging = false);

    if (!prefersReduced) {
      mount.addEventListener("pointermove", onPointerMove);
      mount.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointerup", onPointerUp);
    }

    const onResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    let raf = 0;
    const clock = new THREE.Clock();
    const baseSpin = prefersReduced ? 0 : 0.014;
    const INTRO_MS = 2200;
    const startTime = performance.now();

    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const introT = Math.min((performance.now() - startTime) / INTRO_MS, 1);
      const introEase = 1 - Math.pow(1 - introT, 3);
      material.opacity = introEase;
      const introScale = 0.82 + 0.18 * introEase;

      const flicker = prefersReduced
        ? 0.6
        : 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.1);
      coreMat.opacity = introEase * (0.45 + 0.5 * flicker);
      coreMat.size = 0.52 + (prefersReduced ? 0.14 : 0.28 * flicker);

      current.x += (target.x - current.x) * 0.03;
      current.y += (target.y - current.y) * 0.03;
      dragVX *= 0.95;
      dragVY *= 0.95;

      points.rotation.y += baseSpin * dt + dragVY * dt;
      points.rotation.x += dragVX * dt;
      points.rotation.x += (current.x - points.rotation.x * 0.02) * 0.015;
      points.rotation.y += current.y * 0.02;

      wobbleVel += (-42 * wobble - 7.5 * wobbleVel) * dt;
      wobble += wobbleVel * dt;
      wobble = Math.max(-0.4, Math.min(0.4, wobble));
      points.rotation.z = wobble * 0.16;

      if (!prefersReduced) {
        const t = clock.elapsedTime;
        const amp = 0.045 + Math.abs(wobble) * 0.1;
        for (let i = 0; i < COUNT; i++) {
          const ix = i * 3;
          const bx = basePos[ix];
          const by = basePos[ix + 1];
          const bz = basePos[ix + 2];
          const n =
            Math.sin(bx * 3.0 + t * 0.9) +
            Math.sin(by * 3.4 + t * 1.15) +
            Math.sin(bz * 3.2 + t * 0.8);
          const d =
            1 + amp * (n / 3) + amp * 0.5 * Math.sin((bx + by + bz) * 2.2 + t * 1.7);
          positions[ix] = bx * d;
          positions[ix + 1] = by * d;
          positions[ix + 2] = bz * d;
        }
        posAttr.needsUpdate = true;
      }

      const breathe = prefersReduced
        ? 1
        : 1 + Math.sin(clock.elapsedTime * 0.5) * 0.012;
      const jiggle = 1 + wobble * 0.09;
      points.scale.setScalar(introScale * breathe * jiggle);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      geometry.dispose();
      material.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      sprite.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div ref={mountRef} className={className} aria-hidden="true" role="presentation" />
  );
}

function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(246,255,251,0.98)");
  g.addColorStop(0.28, "rgba(200,255,232,0.72)");
  g.addColorStop(0.62, "rgba(95,240,190,0.26)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
