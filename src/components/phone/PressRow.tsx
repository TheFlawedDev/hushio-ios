import { useEffect, useRef, useState, type ReactNode, type PointerEvent, type MouseEvent } from "react";
import { haptic } from "../../lib/haptics";
import { LongPress } from "../../lib/longPress";
import { reducedMotion } from "../../lib/motion";
import { PRESS_SLOP_PX, pressMoved, type Point } from "../../lib/touchGesture";

type PressRowProps = {
  label?: string;
  className?: string;
  contentClassName?: string;
  onPress?: () => void;
  onPressStart?: () => void;
  onLongPress?: (point: Point) => void;
  longPressMs?: number;
  children: ReactNode;
  "aria-current"?: boolean | "true" | "false" | "page" | "step" | "location" | "date" | "time";
};

export function PressRow({
  label,
  className = "",
  contentClassName = "",
  onPress,
  onPressStart,
  onLongPress,
  longPressMs,
  children,
  "aria-current": ariaCurrent,
}: PressRowProps) {
  const reduced = reducedMotion();
  const [pressed, setPressed] = useState(false);
  const origin = useRef<Point | null>(null);
  const fired = useRef(false);
  const handlers = useRef({ onPress, onLongPress });
  handlers.current = { onPress, onLongPress };

  const press = useRef<LongPress | null>(null);
  if (press.current === null) {
    press.current = new LongPress(() => {
      fired.current = true;
      setPressed(false);
      const at = origin.current;
      if (!at) return;
      haptic("select");
      handlers.current.onLongPress?.(at);
    }, longPressMs);
  }

  useEffect(() => () => press.current?.cancel(), []);

  const release = () => {
    origin.current = null;
    press.current?.cancel();
    setPressed(false);
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    fired.current = false;
    origin.current = { x: event.clientX, y: event.clientY };
    setPressed(true);
    press.current?.start(origin.current);
    onPressStart?.();
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const from = origin.current;
    if (!from) return;
    const to = { x: event.clientX, y: event.clientY };
    press.current?.move(to);
    if (pressMoved(from, to, PRESS_SLOP_PX)) release();
  };

  const onPointerUp = () => {
    const shouldPress = origin.current !== null && !fired.current;
    release();
    if (shouldPress) handlers.current.onPress?.();
  };

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) handlers.current.onPress?.();
  };

  return (
    <button
      type="button"
      aria-label={label}
      aria-current={ariaCurrent}
      className={`relative flex min-h-12 w-full touch-pan-y items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={release}
      onPointerLeave={release}
      onClick={onClick}
    >
      <span
        aria-hidden="true"
        data-press-highlight
        className={`pointer-events-none absolute inset-0 rounded-[12px] bg-wash ${
          pressed ? "opacity-100" : `opacity-0 ${reduced ? "" : "motion-safe:transition-opacity motion-safe:duration-fade"}`
        }`}
      />
      <span className={`relative flex w-full min-w-0 items-center ${contentClassName}`}>{children}</span>
    </button>
  );
}
