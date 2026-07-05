// Reusable tooltip that escapes overflow-clipping containers (the scrolling
// control panel) by rendering into document.body via a React portal, positioned
// with position:fixed from the trigger's getBoundingClientRect().
//
// Behavior: shows on mouseenter AND keyboard focus; hides on mouseleave, blur,
// Escape, any scroll, and window resize. Prefers below-the-trigger placement,
// flips above when it would overflow the viewport bottom, and slides left when
// it would overflow the right edge. pointer-events:none so it never traps the
// cursor. Dependency-free.

import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

const GAP = 6; // px between trigger and tooltip
const MARGIN = 8; // px minimum distance from viewport edges

interface TooltipProps {
  /** Tooltip body; newlines render as line breaks (white-space: pre-line). */
  text: string;
  /** Class(es) for the trigger span (visual styling lives on the trigger). */
  className?: string;
  'aria-label'?: string;
  children: ReactNode;
}

export function Tooltip({ text, className, 'aria-label': ariaLabel, children }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const tipId = useId();

  // Position after the tooltip has rendered (hidden) so its size is measurable.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null); // every open must start with the hidden measuring pass
      return;
    }
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;

    const tr = trigger.getBoundingClientRect();
    const tt = tip.getBoundingClientRect();
    let left = tr.left;
    let top = tr.bottom + GAP;
    if (left + tt.width > window.innerWidth - MARGIN) {
      left = window.innerWidth - MARGIN - tt.width;
    }
    left = Math.max(MARGIN, left);
    if (top + tt.height > window.innerHeight - MARGIN) {
      top = tr.top - GAP - tt.height; // flip above the trigger
    }
    top = Math.max(MARGIN, top);
    setPos({ left, top });

    const hide = () => setOpen(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    // capture:true catches scrolls of any ancestor (e.g. the panel), not just window.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const show = () => setOpen(true);
  const hide = () => {
    setOpen(false);
    setPos(null);
  };

  return (
    <span
      ref={triggerRef}
      className={className}
      tabIndex={0}
      aria-label={ariaLabel}
      aria-describedby={open ? tipId : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            className="portal-tip"
            role="tooltip"
            style={
              pos
                ? { left: pos.left, top: pos.top }
                : { left: 0, top: 0, visibility: 'hidden' } // measuring pass
            }
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
