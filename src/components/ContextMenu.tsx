import {
  Fragment,
  type ReactNode,
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { reducedMotion } from "../lib/motion";
import { type Box, pickerMotion } from "../lib/pickerLayout";
import { CaretRight, Check } from "@phosphor-icons/react";
import { Icon } from "./Icon";
import { FLOAT_PANEL, FLOAT_ROW } from "../lib/floatStyle";
import { GOO_SHAPE, GOO_LAYER_STYLE, gooVariants } from "./Goo";
import { useUI, type ContextMenuOptions, type ContextMenuState, type MenuItem, type MenuSubject } from "../stores/ui";
import "../styles/menu.css";

export type MenuSource = MenuItem[] | (() => MenuItem[]);

type Interaction = { preventDefault: () => void; stopPropagation: () => void };
type Point = { x: number; y: number; above: boolean; alignRight: boolean };
type Rect = { left: number; right: number; top: number; bottom: number };
type Placed = { left: number; top: number };
type SubState = { index: number; anchor: Rect };

const ROWS = '[role^="menuitem"]:not(:disabled)';
const PAD = 8;
const GAP = 6;
const SUB_CLOSE_MS = 150;
const MAIN_SIZE = { width: 230, height: 320 };
const SUB_SIZE = { width: 200, height: 340 };
const KEY_ANCHOR_INSET = 16;
const PANEL = `fixed z-[100] max-h-[70vh] min-w-[220px] max-w-[320px] overflow-y-auto no-scrollbar ${FLOAT_PANEL}`;
const SUB_PANEL = `fixed z-[101] max-h-[340px] min-w-[200px] max-w-[320px] overflow-y-auto no-scrollbar ${FLOAT_PANEL}`;
const ATTACHED_PANEL = "fixed z-[100] max-h-[70vh] w-[230px] overflow-y-auto no-scrollbar px-2 pb-2 pt-12";
const ROW = `${FLOAT_ROW} hit-area relative w-full data-[danger=true]:text-danger-text`;

let sheetSeq = 0;

export function resolveMenu(source: MenuSource): MenuItem[] {
  return typeof source === "function" ? source() : source;
}

export function openMenuAtPointer(
  event: Interaction & { clientX: number; clientY: number },
  source: MenuSource,
  options?: ContextMenuOptions,
) {
  event.preventDefault();
  event.stopPropagation();
  useUI.getState().openContextMenu(event.clientX, event.clientY, resolveMenu(source), options);
}

export function openMenuFromKey(
  event: Interaction & { key: string; shiftKey: boolean },
  source: MenuSource,
  options?: ContextMenuOptions,
): boolean {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return false;
  event.preventDefault();
  event.stopPropagation();
  useUI.getState().openContextMenu(0, 0, resolveMenu(source), options);
  return true;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

function rectOf(element: HTMLElement): Rect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
}

function boxOf(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}

function pointFor(menu: ContextMenuState): Point {
  if (menu.x !== 0 || menu.y !== 0) {
    return { x: menu.x, y: menu.y, above: Boolean(menu.above), alignRight: Boolean(menu.alignRight) };
  }
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) return { x: 0, y: 0, above: false, alignRight: false };
  const rect = rectOf(focused);
  return { x: rect.left + KEY_ANCHOR_INSET, y: rect.bottom, above: false, alignRight: false };
}

function placeMain(point: Point, width: number, height: number) {
  const left = clamp(point.alignRight ? point.x - width : point.x, PAD, window.innerWidth - width - PAD);
  const top = point.above
    ? Math.max(PAD, point.y - height - GAP)
    : clamp(point.y, PAD, window.innerHeight - height - PAD);
  return { left, top, origin: `${point.above ? "bottom" : "top"} ${point.alignRight ? "right" : "left"}` };
}

function placeSub(anchor: Rect, width: number, height: number) {
  const right = anchor.right + GAP;
  const flipped = right + width > window.innerWidth - PAD;
  return {
    left: flipped ? anchor.left - width - GAP : right,
    top: clamp(anchor.top - GAP, PAD, window.innerHeight - height - PAD),
    flipped,
  };
}

function rowsIn(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(ROWS)) : [];
}

function typeahead(list: HTMLElement[], at: number, key: string) {
  const letter = key.toLocaleLowerCase();
  for (let step = 1; step <= list.length; step++) {
    const candidate = list[(at + step) % list.length];
    if (candidate.dataset.label?.toLocaleLowerCase().startsWith(letter)) {
      candidate.focus({ preventScroll: true });
      return;
    }
  }
}

function roleOf(item: MenuItem): string {
  if (item.checked === undefined) return "menuitem";
  return item.toggle ? "menuitemcheckbox" : "menuitemradio";
}

type PanelProps = {
  rows: MenuItem[];
  subject?: MenuSubject;
  label: string;
  submenu?: boolean;
  attached?: boolean;
  above?: boolean;
  flipped?: boolean;
  openIndex?: number;
  byKeys: MutableRefObject<boolean>;
  style: CSSProperties;
  onRowEnter: (index: number, row: HTMLElement) => void;
  onRowActivate: (index: number, row: HTMLElement) => void;
  onPanelEnter?: () => void;
  onPanelLeave?: () => void;
};

const MenuPanel = forwardRef<HTMLDivElement, PanelProps>(function MenuPanel(
  { rows, subject, label, submenu = false, attached = false, above = false, flipped = false, openIndex, byKeys, style, onRowEnter, onRowActivate, onPanelEnter, onPanelLeave },
  ref,
) {
  const lightRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [reduced] = useState(reducedMotion);
  const presence = pickerMotion(reduced);
  const goo = gooVariants(reduced);

  const setPanel = (node: HTMLDivElement | null) => {
    panelRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const shine = (row: HTMLElement | null) => {
    const light = lightRef.current;
    if (!light) return;
    light.classList.toggle("is-on", row !== null);
    if (!row) return;
    light.style.transform = `translateY(${row.offsetTop}px)`;
    light.style.height = `${row.offsetHeight}px`;
    light.dataset.danger = row.dataset.danger ?? "false";
  };

  const restingRow = (): HTMLElement | null => {
    const panel = panelRef.current;
    if (!panel) return null;
    const expanded = panel.querySelector<HTMLElement>('[aria-expanded="true"]');
    if (expanded) return expanded;
    const focused = document.activeElement;
    return byKeys.current && focused instanceof HTMLElement && panel.contains(focused) && focused.matches(ROWS)
      ? focused
      : null;
  };

  return (
    <motion.div
      ref={setPanel}
      role="menu"
      aria-orientation="vertical"
      aria-label={label}
      data-menu-portal={submenu ? "" : undefined}
      onPointerEnter={onPanelEnter}
      onPointerLeave={() => {
        shine(restingRow());
        onPanelLeave?.();
      }}
      style={{ transformOrigin: flipped ? "top right" : "top left", ...style }}
      {...(attached
        ? { variants: goo.reveal, initial: reduced ? false : "initial", animate: "animate", exit: "exit" }
        : { initial: presence.initial, animate: presence.animate, exit: presence.exit, transition: presence.transition })}
      className={`${attached ? ATTACHED_PANEL : submenu ? SUB_PANEL : PANEL}${above ? " is-above" : ""}${flipped ? " is-flipped" : ""}`}
    >
      {attached && (
        <motion.div variants={goo.stretch} data-goo-panel="" aria-hidden="true" className="pointer-events-none absolute inset-0 origin-top">
          <div data-goo-layer="" className="absolute inset-0" style={GOO_LAYER_STYLE}>
            <div className="absolute right-0 top-0 h-10 w-10 rounded-[12px] [corner-shape:squircle] bg-elevated" />
            <div className={`${GOO_SHAPE} bottom-0 top-10`} />
          </div>
        </motion.div>
      )}
      <span ref={lightRef} aria-hidden="true" className="menu-light" />
      {subject && (
        <>
          <div className="relative mb-2 flex items-center gap-2 overflow-hidden rounded-[10px] px-3 py-2">
            {subject.thumb && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 scale-125 bg-cover opacity-40 blur-2xl"
                style={{ backgroundImage: `url(${JSON.stringify(subject.thumb)})` }}
              />
            )}
            {subject.thumb ? (
              <img loading="lazy" decoding="async"
                alt=""
                src={subject.thumb}
                className={`relative h-10 w-10 shrink-0 object-cover ${subject.round ? "rounded-full" : "rounded-lg"}`}
              />
            ) : (
              <span className={`relative h-10 w-10 shrink-0 bg-wash ${subject.round ? "rounded-full" : "rounded-lg"}`} />
            )}
            <span className="relative min-w-0">
              <span className="block truncate text-body font-bold text-ink-1">{subject.title}</span>
              {subject.subtitle && <span className="mt-px block truncate text-meta text-ink-2">{subject.subtitle}</span>}
            </span>
          </div>
        </>
      )}
      {rows.map((item, index) => (
        <Fragment key={`${index}:${item.label}`}>
          {item.header ? (
            <div role="presentation" className="px-3 pb-1 pt-2 text-meta font-medium text-ink-2">
              {item.label}
            </div>
          ) : (
            <button
              type="button"
              role={roleOf(item)}
              aria-checked={item.checked}
              aria-haspopup={item.children ? "menu" : undefined}
              aria-expanded={item.children ? openIndex === index : undefined}
              data-menu-row=""
              data-menu-index={index}
              data-label={item.label}
              data-danger={item.danger ? "true" : undefined}
              data-has-children={item.children ? "true" : undefined}
              disabled={item.disabled}
              aria-disabled={item.disabled ? "true" : undefined}
              onPointerEnter={(event) => {
                shine(event.currentTarget);
                onRowEnter(index, event.currentTarget);
              }}
              onFocus={(event) => {
                if (byKeys.current) shine(event.currentTarget);
              }}
              onClick={(event) => onRowActivate(index, event.currentTarget)}
              className={item.separatorBefore ? `${ROW} mt-2` : ROW}
            >
              {item.icon &&
                (item.note ? (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-wash">
                    <Icon icon={item.icon} />
                  </span>
                ) : (
                  <Icon icon={item.icon} />
                ))}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.label}</span>
                {item.note && <span className="block truncate text-meta text-ink-2">{item.note}</span>}
              </span>
              {item.trailing && <span className="min-w-0 max-w-[60%] truncate text-meta text-ink-2">{item.trailing}</span>}
              {item.checked === true && <Icon icon={Check} />}
              {item.children && <Icon icon={CaretRight} />}
            </button>
          )}
        </Fragment>
      ))}
    </motion.div>
  );
});

function SubLayer({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

function MenuSheet({ menu }: { menu: ContextMenuState }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const subRef = useRef<HTMLDivElement | null>(null);
  const openSubRef = useRef<SubState | null>(null);
  const byKeys = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [placed, setPlaced] = useState<(Placed & { origin: string }) | null>(null);
  const [sub, setSubState] = useState<SubState | null>(null);
  const [subPlaced, setSubPlaced] = useState<(Placed & { flipped: boolean }) | null>(null);
  const rows = useMemo(() => menu.items.filter((item) => !item.subject), [menu.items]);
  const subject = menu.items.find((item) => item.subject)?.subject;
  const subRows = sub ? (rows[sub.index]?.children ?? []) : [];

  function setSub(next: SubState | null) {
    openSubRef.current = next;
    setSubState(next);
  }

  function close() {
    useUI.getState().closeContextMenu();
  }

  function clearSubTimer() {
    window.clearTimeout(closeTimer.current);
  }

  function scheduleSubClose() {
    clearSubTimer();
    if (openSubRef.current) closeTimer.current = window.setTimeout(() => setSub(null), SUB_CLOSE_MS);
  }

  function openSub(index: number, row: HTMLElement) {
    clearSubTimer();
    setSub({ index, anchor: rectOf(row) });
  }

  function foldSub() {
    const current = openSubRef.current;
    if (!current) return;
    panelRef.current?.querySelector<HTMLElement>(`[data-menu-index="${current.index}"]`)?.focus({ preventScroll: true });
    setSub(null);
  }

  function enterRow(index: number, row: HTMLElement) {
    clearSubTimer();
    if (rows[index].children) {
      if (openSubRef.current?.index !== index) openSub(index, row);
    } else if (openSubRef.current) {
      setSub(null);
    }
  }

  function activateRow(index: number, row: HTMLElement) {
    const item = rows[index];
    if (item.children) {
      if (openSubRef.current?.index === index) setSub(null);
      else openSub(index, row);
      return;
    }
    item.onSelect?.(boxOf(row));
    close();
  }

  function activateSubRow(index: number, row: HTMLElement) {
    subRows[index].onSelect?.(boxOf(row));
    close();
  }

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const focused = document.activeElement;
    opener.current = focused instanceof HTMLElement ? focused : null;
    setPlaced(placeMain(pointFor(menu), panel.offsetWidth || MAIN_SIZE.width, panel.offsetHeight || MAIN_SIZE.height));
    panel.querySelector<HTMLElement>(ROWS)?.focus({ preventScroll: true });
  }, [menu]);

  useLayoutEffect(() => {
    const panel = subRef.current;
    if (!sub || !panel) return;
    setSubPlaced(placeSub(sub.anchor, panel.offsetWidth || SUB_SIZE.width, panel.offsetHeight || SUB_SIZE.height));
    panel.querySelector<HTMLElement>(ROWS)?.focus({ preventScroll: true });
  }, [sub]);

  useEffect(() => {
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (Boolean(panelRef.current?.contains(target)) || (target instanceof Element && target.closest("[data-menu-portal]") !== null));

    const live = () => useUI.getState().contextMenu === menu;
    const onPointerDown = (event: PointerEvent) => {
      if (live() && !inside(event.target)) useUI.getState().closeContextMenu();
    };
    const onPointerCapture = () => {
      byKeys.current = false;
    };
    const onWheel = (event: WheelEvent) => {
      if (live() && !inside(event.target)) useUI.getState().closeContextMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!live()) return;
      byKeys.current = true;
      const current = openSubRef.current;
      const focused = document.activeElement;
      const inSub = Boolean(current) && Boolean(subRef.current?.contains(focused));
      const list = rowsIn(inSub ? subRef.current : panelRef.current);
      const at = focused instanceof HTMLElement ? list.indexOf(focused) : -1;

      switch (event.key) {
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          if (current) foldSub();
          else useUI.getState().closeContextMenu();
          return;
        case "Tab":
          event.preventDefault();
          useUI.getState().closeContextMenu();
          return;
        case "ArrowDown":
        case "ArrowUp":
        case "Home":
        case "End": {
          event.preventDefault();
          if (list.length === 0) return;
          const target =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? list.length - 1
                : event.key === "ArrowDown"
                  ? (at + 1) % list.length
                  : at <= 0
                    ? list.length - 1
                    : at - 1;
          list[target].focus({ preventScroll: true });
          return;
        }
        case "ArrowRight": {
          if (inSub || !(focused instanceof HTMLElement) || focused.dataset.hasChildren !== "true") return;
          event.preventDefault();
          const index = Number(focused.dataset.menuIndex);
          if (openSubRef.current?.index !== index) openSub(index, focused);
          return;
        }
        case "ArrowLeft":
          if (!inSub) return;
          event.preventDefault();
          foldSub();
          return;
        default:
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) typeahead(list, at, event.key);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerdown", onPointerCapture, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerdown", onPointerCapture, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(
    () =>
      useUI.subscribe((state) => {
        if (state.contextMenu === menu) return;
        const panels = [panelRef.current, subRef.current];
        const hadFocus = panels.some((node) => node?.contains(document.activeElement));
        for (const node of panels) {
          node?.setAttribute("aria-hidden", "true");
          node?.setAttribute("inert", "");
        }
        const target = opener.current;
        if (hadFocus && target?.isConnected) target.focus({ preventScroll: true });
      }),
    [menu],
  );

  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current);
      const target = opener.current;
      const focused = document.activeElement;
      if (target?.isConnected && (!focused || focused === document.body)) target.focus({ preventScroll: true });
    },
    [],
  );

  return (
    <>
      <MenuPanel
        ref={panelRef}
        rows={rows}
        subject={subject}
        label={subject?.title ?? "Menu"}
        above={menu.above}
        attached={menu.attached}
        openIndex={sub?.index}
        byKeys={byKeys}
        style={placed ? { left: placed.left, top: placed.top, transformOrigin: placed.origin } : { left: 0, top: 0, visibility: "hidden" }}
        onRowEnter={enterRow}
        onRowActivate={activateRow}
        onPanelEnter={clearSubTimer}
        onPanelLeave={scheduleSubClose}
      />
      <AnimatePresence>
        {sub && (
          <SubLayer key={sub.index}>
            <MenuPanel
              ref={subRef}
              rows={subRows}
              label={rows[sub.index].label}
              submenu
              flipped={subPlaced?.flipped}
              byKeys={byKeys}
              style={subPlaced ? { left: subPlaced.left, top: subPlaced.top } : { left: 0, top: 0, visibility: "hidden" }}
              onRowEnter={() => {}}
              onRowActivate={activateSubRow}
              onPanelEnter={clearSubTimer}
              onPanelLeave={scheduleSubClose}
            />
          </SubLayer>
        )}
      </AnimatePresence>

    </>
  );
}

export function ContextMenu() {
  const menu = useUI((state) => state.contextMenu);
  const sheet = useMemo(() => (menu ? ++sheetSeq : 0), [menu]);
  return <AnimatePresence>{menu && <MenuSheet key={sheet} menu={menu} />}</AnimatePresence>;
}
