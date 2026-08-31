import { useEffect, useRef } from 'react';
import { Camera, Mesh, Plane, Program, Renderer, Texture, Transform } from 'ogl';

export interface CircularGalleryItem {
  image: string;
  text: string;
  href?: string;
}

interface CircularGalleryProps {
  items?: CircularGalleryItem[];
  bend?: number;
  textColor?: string;
  borderRadius?: number;
  font?: string;
  scrollSpeed?: number;
  scrollEase?: number;
  onItemClick?: (item: CircularGalleryItem) => void;
}

const fallbackItems: CircularGalleryItem[] = [{ image: 'https://picsum.photos/seed/1/800/1000', text: 'Collection' }];

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

export function CircularGallery({
  items = fallbackItems,
  bend = 3,
  textColor = '#ffffff',
  borderRadius = 0.05,
  font = '600 18px Inter',
  scrollSpeed = 2,
  scrollEase = 0.05,
  onItemClick,
}: CircularGalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !items.length) return;
    let renderer: Renderer;
    try {
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl') && !probe.getContext('experimental-webgl')) return;
      renderer = new Renderer({ alpha: true, antialias: true, dpr: Math.min(window.devicePixelRatio || 1, 2) });
    } catch {
      return;
    }
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    container.appendChild(gl.canvas);
    const camera = new Camera(gl, { fov: 45 });
    camera.position.z = 20;
    const scene = new Transform();
    const geometry = new Plane(gl, { widthSegments: 40, heightSegments: 40 });
    const allItems = [...items, ...items];
    const medias = allItems.map((item, index) => {
      const texture = new Texture(gl, { generateMipmaps: true });
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        texture.image = image;
        program.uniforms.uImageSize.value = [image.naturalWidth, image.naturalHeight];
      };
      image.src = item.image;
      const program = new Program(gl, {
        depthTest: false,
        depthWrite: false,
        transparent: true,
        uniforms: { tMap: { value: texture }, uImageSize: { value: [1, 1] }, uPlaneSize: { value: [1, 1] }, uRadius: { value: borderRadius } },
        vertex: `attribute vec3 position; attribute vec2 uv; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragment: `precision highp float; uniform sampler2D tMap; uniform vec2 uImageSize; uniform vec2 uPlaneSize; uniform float uRadius; varying vec2 vUv; float roundedBox(vec2 p, vec2 b, float r) { vec2 d = abs(p) - b; return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - r; } void main() { vec2 ratio = vec2(min((uPlaneSize.x / uPlaneSize.y) / (uImageSize.x / uImageSize.y), 1.0), min((uPlaneSize.y / uPlaneSize.x) / (uImageSize.y / uImageSize.x), 1.0)); vec2 uv = vec2(vUv.x * ratio.x + (1.0 - ratio.x) * 0.5, vUv.y * ratio.y + (1.0 - ratio.y) * 0.5); vec4 color = texture2D(tMap, uv); float alpha = 1.0 - smoothstep(-0.002, 0.002, roundedBox(vUv - 0.5, vec2(0.5 - uRadius), uRadius)); gl_FragColor = vec4(color.rgb, color.a * alpha); }`,
      });
      const plane = new Mesh(gl, { geometry, program });
      plane.setParent(scene);
      return { item, plane, index, extra: 0, width: 0, total: 0 };
    });
    let viewport = { width: 0, height: 0 };
    let scroll = { current: 0, target: 0, last: 0 };
    let dragging = false;
    let dragStart = 0;
    let dragOrigin = 0;
    let frame = 0;
    const touchDevice = window.matchMedia('(pointer: coarse)').matches;
    const easing = touchDevice ? Math.max(scrollEase, 0.18) : scrollEase;
    const resize = () => {
      const screen = { width: container.clientWidth, height: container.clientHeight };
      if (!screen.width || !screen.height) return;
      renderer.setSize(screen.width, screen.height);
      camera.perspective({ aspect: screen.width / screen.height });
      const height = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      viewport = { width: height * camera.aspect, height };
      medias.forEach((media) => {
        const scale = screen.height / 1500;
        media.plane.scale.y = (viewport.height * (900 * scale)) / screen.height;
        media.plane.scale.x = (viewport.width * (700 * scale)) / screen.width;
        media.width = media.plane.scale.x + 2;
        media.total = media.width * allItems.length;
        media.plane.program.uniforms.uPlaneSize.value = [media.plane.scale.x, media.plane.scale.y];
        media.plane.position.x = media.width * media.index;
      });
    };
    const wheel = (event: WheelEvent) => { scroll.target += (event.deltaY > 0 ? scrollSpeed : -scrollSpeed) * 0.2; };
    const pointerDown = (event: PointerEvent) => { dragging = true; dragStart = event.clientX; dragOrigin = scroll.current; container.setPointerCapture(event.pointerId); };
    const pointerMove = (event: PointerEvent) => { if (dragging) scroll.target = dragOrigin + (dragStart - event.clientX) * scrollSpeed * 0.025; };
    const pointerUp = () => { dragging = false; };
    const click = (event: MouseEvent) => {
      if (!onItemClick || !medias[0]?.width) return;
      const rect = gl.canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * viewport.width;
      const nearest = medias.reduce((best, media) => Math.abs(media.plane.position.x - x) < Math.abs(best.plane.position.x - x) ? media : best);
      if (Math.abs(nearest.plane.position.x - x) < nearest.plane.scale.x / 2) onItemClick(nearest.item);
    };
    const update = () => {
      scroll.current = lerp(scroll.current, scroll.target, easing);
      const direction = scroll.current > scroll.last ? 1 : -1;
      medias.forEach((media) => {
        const x = media.width * media.index - scroll.current - media.extra;
        media.plane.position.x = x;
        const half = viewport.width / 2;
        const effectiveX = Math.min(Math.abs(x), half);
        if (bend === 0) { media.plane.position.y = 0; media.plane.rotation.z = 0; }
        else { const radius = (half * half + bend * bend) / (2 * Math.abs(bend)); const arc = radius - Math.sqrt(Math.max(0, radius * radius - effectiveX * effectiveX)); media.plane.position.y = bend > 0 ? -arc : arc; media.plane.rotation.z = (bend > 0 ? -1 : 1) * Math.sign(x) * Math.asin(effectiveX / radius); }
        if (direction > 0 && x + media.plane.scale.x / 2 < -half) media.extra -= media.total;
        if (direction < 0 && x - media.plane.scale.x / 2 > half) media.extra += media.total;
      });
      items.forEach((item, index) => {
        const half = viewport.width / 2;
        const candidates = medias.filter((media) => media.index % items.length === index);
        const media = candidates.reduce((best, candidate) => Math.abs(candidate.plane.position.x) < Math.abs(best.plane.position.x) ? candidate : best);
        const label = labelRefs.current[index];
        if (!label) return;

        const labelOffsetY = media.plane.scale.y * 0.62;
        const labelLeftPercent = 50 + (media.plane.position.x / viewport.width) * 100;
        const labelTopPercent = 50 + ((media.plane.position.y + labelOffsetY) / viewport.height) * 100;

        label.style.left = `${labelLeftPercent}%`;
        label.style.top = `${labelTopPercent}%`;
        label.style.transform = 'translate(-50%, 0)';
        label.style.opacity = Math.abs(media.plane.position.x) < half + media.plane.scale.x ? '1' : '0';
      });
      renderer.render({ scene, camera });
      scroll.last = scroll.current;
      frame = requestAnimationFrame(update);
    };
    resize();
    window.addEventListener('resize', resize);
    container.addEventListener('wheel', wheel, { passive: true });
    container.addEventListener('pointerdown', pointerDown);
    container.addEventListener('pointermove', pointerMove);
    container.addEventListener('pointerup', pointerUp);
    container.addEventListener('pointercancel', pointerUp);
    container.addEventListener('click', click);
    frame = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      container.removeEventListener('wheel', wheel);
      container.removeEventListener('pointerdown', pointerDown);
      container.removeEventListener('pointermove', pointerMove);
      container.removeEventListener('pointerup', pointerUp);
      container.removeEventListener('pointercancel', pointerUp);
      container.removeEventListener('click', click);
      gl.canvas.remove();
    };
  }, [bend, borderRadius, font, items, onItemClick, scrollEase, scrollSpeed]);

  return (
    <div ref={containerRef} className="relative h-full w-full cursor-grab overflow-hidden active:cursor-grabbing" style={{ color: textColor, font, touchAction: 'pan-y' }} aria-label="Shop by category gallery">
      {items.map((item, index) => (
        <span
          key={`${item.text}-${index}`}
          ref={(element) => { labelRefs.current[index] = element; }}
          className="pointer-events-none absolute left-0 top-0 z-10 whitespace-nowrap text-sm font-semibold drop-shadow-md transition-opacity sm:text-base"
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}