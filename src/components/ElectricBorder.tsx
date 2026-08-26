import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

interface ElectricBorderProps {
  children: ReactNode;
  color?: string;
  speed?: number;
  chaos?: number;
  borderRadius?: number;
  className?: string;
  style?: CSSProperties;
}

function hexToRgba(color: string, alpha: number) {
  const value = color.replace('#', '');
  if (!/^[\da-f]{3,8}$/i.test(value)) return `rgba(40, 255, 133, ${alpha})`;
  const hex = value.length === 3 ? value.split('').map((part) => part + part).join('') : value;
  const number = Number.parseInt(hex.slice(0, 6), 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

function random(value: number) {
  return (Math.sin(value * 12.9898) * 43758.5453) % 1;
}

function noise2D(x: number, y: number) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const a = random(i + j * 57);
  const b = random(i + 1 + j * 57);
  const c = random(i + (j + 1) * 57);
  const d = random(i + 1 + (j + 1) * 57);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

function octavedNoise(x: number, time: number, seed: number, amplitude: number) {
  let result = 0;
  let currentAmplitude = amplitude;
  let frequency = 10;
  for (let octave = 0; octave < 10; octave += 1) {
    result += currentAmplitude * noise2D(frequency * x + seed * 100, time * frequency * 0.3);
    frequency *= 1.6;
    currentAmplitude *= 0.7;
  }
  return result;
}

function roundedRectPoint(progress: number, left: number, top: number, width: number, height: number, radius: number) {
  const straightWidth = width - 2 * radius;
  const straightHeight = height - 2 * radius;
  const cornerArc = Math.PI * radius / 2;
  const perimeter = 2 * straightWidth + 2 * straightHeight + 4 * cornerArc;
  let distance = progress * perimeter;
  const corner = (centerX: number, centerY: number, startAngle: number, amount: number) => ({
    x: centerX + radius * Math.cos(startAngle + amount * Math.PI / 2),
    y: centerY + radius * Math.sin(startAngle + amount * Math.PI / 2),
  });
  if (distance <= straightWidth) return { x: left + radius + distance, y: top };
  distance -= straightWidth;
  if (distance <= cornerArc) return corner(left + width - radius, top + radius, -Math.PI / 2, distance / cornerArc);
  distance -= cornerArc;
  if (distance <= straightHeight) return { x: left + width, y: top + radius + distance };
  distance -= straightHeight;
  if (distance <= cornerArc) return corner(left + width - radius, top + height - radius, 0, distance / cornerArc);
  distance -= cornerArc;
  if (distance <= straightWidth) return { x: left + width - radius - distance, y: top + height };
  distance -= straightWidth;
  if (distance <= cornerArc) return corner(left + radius, top + height - radius, Math.PI / 2, distance / cornerArc);
  distance -= cornerArc;
  if (distance <= straightHeight) return { x: left, y: top + height - radius - distance };
  return corner(left + radius, top + radius, Math.PI, distance / cornerArc);
}

export function ElectricBorder({
  children,
  color = '#28FF85',
  speed = 1,
  chaos = 0.12,
  borderRadius = 24,
  className = '',
  style,
}: ElectricBorderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!container || !canvas || !context) return;

    const borderOffset = 60;
    let frame = 0;
    let time = 0;
    let lastTime = performance.now();
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width + borderOffset * 2;
      height = rect.height + borderOffset * 2;
      canvas.width = Math.ceil(width * dpr);
      canvas.height = Math.ceil(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    const draw = (now: number) => {
      time += (now - lastTime) / 1000 * speed;
      lastTime = now;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.beginPath();
      const borderWidth = width - borderOffset * 2;
      const borderHeight = height - borderOffset * 2;
      const radius = Math.min(borderRadius, Math.min(borderWidth, borderHeight) / 2);
      const perimeter = 2 * (borderWidth + borderHeight) + 2 * Math.PI * radius;
      const points = Math.floor(perimeter / 2);
      for (let index = 0; index <= points; index += 1) {
        const progress = index / points;
        const point = roundedRectPoint(progress, borderOffset, borderOffset, borderWidth, borderHeight, radius);
        const x = point.x + octavedNoise(progress * 8, time, 0, chaos) * 60;
        const y = point.y + octavedNoise(progress * 8, time, 1, chaos) * 60;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.strokeStyle = color;
      context.lineWidth = 1;
      context.shadowColor = color;
      context.shadowBlur = 0;
      context.stroke();
      frame = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [borderRadius, chaos, color, speed]);

  return (
    <div ref={containerRef} className={`relative isolate overflow-visible ${className}`} style={{ borderRadius, ...style }}>
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2"><canvas ref={canvasRef} className="block" aria-hidden="true" /></div>
      <div className="pointer-events-none absolute inset-0 z-0 rounded-[inherit]" style={{ border: `2px solid ${hexToRgba(color, 0.6)}`, filter: 'blur(1px)' }} />
      <div className="pointer-events-none absolute inset-0 z-0 rounded-[inherit]" style={{ border: `2px solid ${color}`, filter: 'blur(4px)' }} />
      <div className="pointer-events-none absolute -inset-[10%] -z-10 rounded-[inherit] opacity-30" style={{ filter: 'blur(32px)', background: `linear-gradient(-30deg, ${color}, transparent, ${color})` }} />
      <div className="relative z-10 rounded-[inherit]">{children}</div>
    </div>
  );
}