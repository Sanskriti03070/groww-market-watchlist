"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
};

/**
 * A small, lightweight info affordance - not the Modal component (no
 * backdrop, no scroll lock, no focus trap): just a compact popover anchored
 * to its trigger, dismissed by an outside click, Escape, or the page
 * scrolling/resizing under it. Positioned with `fixed` coordinates (rather
 * than an absolutely-positioned ancestor) so it can never be clipped by the
 * watchlist table's horizontal-scroll container.
 */
export function InfoPopover({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function toggle(event: React.MouseEvent) {
    event.stopPropagation();
    if (!open) {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        setCoords({ top: rect.bottom + 6, left: rect.left + rect.width / 2 });
      }
    }
    setOpen((value) => !value);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    function close() {
      setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={toggle}
        className="inline-flex shrink-0 items-center justify-center rounded-full text-muted-soft transition-colors hover:text-foreground"
      >
        <InfoIcon />
      </button>
      {open && coords && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={label}
          style={{ position: "fixed", top: coords.top, left: coords.left, transform: "translateX(-50%)" }}
          className="z-50 w-60 rounded-lg border border-border bg-surface p-3 text-left text-xs leading-relaxed text-foreground-soft shadow-[var(--shadow-modal)]"
        >
          {children}
        </div>
      )}
    </>
  );
}

function InfoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.3v3.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="5.1" r="0.9" fill="currentColor" />
    </svg>
  );
}
