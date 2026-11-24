import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { motion, useTransform } from "motion/react";
import { fade, phoneSmooth, phoneTransition, reducedMotion } from "../../lib/motion";
import { INSET_BOTTOM } from "../../lib/phoneNav";
import { viewportHeight } from "../../lib/viewport";
import { sheetBodyAtTop, useSheetDrag } from "./useSheetDrag";

type SheetProps = {
  label: string;
  onClose: () => void;
  header?: ReactNode;
  height?: string;
  zClass?: string;
  children: ReactNode;
};

export function Sheet({ label, onClose, header, height, zClass = "z-[115]", children }: SheetProps) {
  const reduced = reducedMotion();
  const panel = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const travel = useRef(0);
  const drag = useSheetDrag(
    onClose,
    (event) => {
      const target = event.target as Element;
      if (target.closest("[data-sheet-grab]")) return "grab";
      const root = body.current;
      return root !== null && root.contains(target) && sheetBodyAtTop(target, root) ? "content" : null;
    },
    undefined,
    () => travel.current || viewportHeight(),
  );
  const scrimOpacity = useTransform(drag.y, (y) => 1 - Math.min(1, Math.max(0, y / (travel.current || viewportHeight()))));

  useLayoutEffect(() => {
    travel.current = panel.current?.offsetHeight ?? 0;
    if (!reduced) drag.y.set(travel.current || viewportHeight());
  }, []);

  useEffect(() => {
    const priorFocus = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      if (!panel.current) return;
      const closeBtn = panel.current.querySelector<HTMLElement>('button[aria-label="Close"]');
      if (closeBtn) {
        closeBtn.focus();
      } else {
        const focusable = panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          panel.current.focus();
        }
      }
    }, 16);

    return () => {
      clearTimeout(timer);
      priorFocus?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const container = panel.current;
        if (!container) return;
        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) {
          event.preventDefault();
          container.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const current = document.activeElement;
        if (event.shiftKey && (current === first || !container.contains(current))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && current === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <motion.div className={`fixed inset-0 ${zClass} flex flex-col justify-end`}>
      <motion.div
        aria-hidden="true"
        className={reduced ? "absolute inset-0" : "absolute inset-0 will-change-[opacity]"}
        style={{ background: "rgb(var(--scrim) / var(--scrim-alpha))", opacity: reduced ? undefined : scrimOpacity }}
        initial={reduced ? { opacity: 0 } : undefined}
        animate={reduced ? { opacity: 1 } : undefined}
        exit={reduced ? { opacity: 0 } : undefined}
        transition={reduced ? fade : undefined}
        onClick={onClose}
      />
      <motion.section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        initial={reduced ? { opacity: 0 } : undefined}
        animate={{ y: 0, opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { y: travel.current || viewportHeight() }}
        transition={phoneTransition(reduced, phoneSmooth)}
        {...drag.handlers}
        className="relative flex w-full flex-col overflow-hidden rounded-t-[20px] bg-elevated text-ink-1 outline-none will-change-transform"
        style={{ height, maxHeight: "90vh", paddingBottom: INSET_BOTTOM, y: drag.y }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:right-4 focus:z-10 focus:rounded-full focus:bg-surface focus:px-3 focus:py-1 focus:text-meta focus:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          Close
        </button>
        <div data-sheet-grab className="flex shrink-0 cursor-grab touch-none flex-col items-center pb-1 pt-2">
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-ink-3" />
        </div>
        {header && (
          <div data-sheet-grab className="shrink-0 px-4 pb-2 touch-none">
            {header}
          </div>
        )}
        <div ref={body} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">{children}</div>
      </motion.section>
    </motion.div>
  );
}
