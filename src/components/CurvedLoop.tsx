import { useEffect, useId, useRef, useState } from 'react';

interface CurvedLoopProps {
  marqueeText?: string;
  speed?: number;
  className?: string;
  curveAmount?: number;
  direction?: 'left' | 'right';
  interactive?: boolean;
}

export function CurvedLoop({
  marqueeText = '',
  speed = 3,
  className = '',
  curveAmount = 400,
  direction = 'left',
  interactive = true,
}: CurvedLoopProps) {
  const measureRef = useRef<SVGTextElement>(null);
  const textPathRef = useRef<SVGTextPathElement>(null);
  const [spacing, setSpacing] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState(0);
  const dragRef = useRef({ lastX: 0, velocity: 0 });
  const id = useId().replace(/:/g, '');
  const pathId = `curved-loop-${id}`;
  const text = `${marqueeText.replace(/\s+$/, '')}\u00a0`;

  useEffect(() => {
    const updateSpacing = () => setSpacing(measureRef.current?.getComputedTextLength() || 0);
    updateSpacing();
    const observer = new ResizeObserver(updateSpacing);
    if (measureRef.current) observer.observe(measureRef.current);
    return () => observer.disconnect();
  }, [text]);

  useEffect(() => {
    if (!spacing) return;
    let frame = 0;
    const step = () => {
      if (!dragging && textPathRef.current) {
        const delta = (direction === 'right' ? speed : -speed);
        const next = ((offset + delta + spacing) % (spacing * 2)) - spacing;
        setOffset(next);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [direction, dragging, offset, spacing, speed]);

  const updateFromPointer = (clientX: number) => {
    const delta = clientX - dragRef.current.lastX;
    dragRef.current.lastX = clientX;
    dragRef.current.velocity = delta;
    setOffset((current) => {
      if (!spacing) return current + delta;
      return ((current + delta + spacing) % (spacing * 2)) - spacing;
    });
  };

  return (
    <div
      className={`w-full select-none overflow-visible ${className}`}
      style={{ cursor: interactive ? (dragging ? 'grabbing' : 'grab') : 'auto', touchAction: interactive ? 'pan-y' : 'auto' }}
      onPointerDown={(event) => {
        if (!interactive) return;
        setDragging(true);
        dragRef.current = { lastX: event.clientX, velocity: 0 };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => { if (interactive && dragging) updateFromPointer(event.clientX); }}
      onPointerUp={() => { if (interactive) setDragging(false); }}
      onPointerCancel={() => { if (interactive) setDragging(false); }}
      onPointerLeave={() => { if (interactive) setDragging(false); }}
    >
      <svg className="block aspect-[100/12] w-full overflow-visible text-[5rem] font-bold uppercase leading-none" viewBox="0 0 1440 120" aria-label={marqueeText}>
        <text ref={measureRef} xmlSpace="preserve" style={{ visibility: 'hidden', opacity: 0, pointerEvents: 'none' }}>{text}</text>
        <defs><path id={pathId} d={`M-100,40 Q500,${40 + curveAmount} 1540,40`} fill="none" /></defs>
        {spacing > 0 && (
          <text xmlSpace="preserve" className="fill-current">
            <textPath ref={textPathRef} href={`#${pathId}`} startOffset={`${offset}px`} xmlSpace="preserve">
              {Array(Math.ceil(1800 / spacing) + 2).fill(text).join('')}
            </textPath>
          </text>
        )}
      </svg>
    </div>
  );
}