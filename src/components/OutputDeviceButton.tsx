import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, SpeakerHifi } from "@phosphor-icons/react";
import { Icon } from "./Icon";
import { activeDefaultLabel, isChoiceChecked, useOutputDevices } from "./OutputDevicePicker";
import { deviceChoices, listOutputDevices } from "../lib/outputDevices";
import { platform } from "../lib/bridge";
import { gate, quick, reducedMotion } from "../lib/motion";
import { useSettings } from "../stores/settings";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
const ITEM = "flex h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-body text-ink-1 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export function OutputDeviceButton() {
  const sink = useSettings((state) => state.audioSinkId);
  const setAudioSinkId = useSettings((state) => state.setAudioSinkId);
  const { devices, setDevices } = useOutputDevices();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const reduced = reducedMotion();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
  }, [open]);

  if (platform === "android" || platform === "ios") return null;

  const choices = deviceChoices(devices);
  const note = activeDefaultLabel(choices);
  const pinned = sink === "" ? undefined : devices.find((device) => device.deviceId === sink);
  const label = pinned?.label ?? "System default";

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    void listOutputDevices().then(setDevices);
  }

  function pick(deviceId: string) {
    setAudioSinkId(deviceId);
    setOpen(false);
    trigger.current?.focus();
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const last = items.length - 1;
    const next =
      event.key === "ArrowDown" ? (at + 1) % items.length
      : event.key === "ArrowUp" ? (at <= 0 ? last : at - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        title={`Output device: ${label}`}
        aria-label={`Output device: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className={`hit-area grid h-9 w-9 shrink-0 place-items-center rounded-full ${pinned ? "text-ink-1" : "text-ink-2 hover:text-ink-1"} ${FOCUS}`}
      >
        <Icon icon={SpeakerHifi} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Output devices"
            onKeyDown={moveFocus}
            initial={reduced ? false : { opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={gate(reduced, quick)}
            style={{ transformOrigin: "bottom right" }}
            className="absolute bottom-full right-0 z-50 mb-2 w-64 rounded-[12px] border border-separator bg-surface p-1.5 shadow-popover"
          >
            {choices.map((choice) => {
              const checked = isChoiceChecked(choice, sink);
              return (
                <button
                  key={choice.deviceId || "default"}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  onClick={() => pick(choice.deviceId)}
                  className={ITEM}
                >
                  <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                  {choice.isDefault && note && <span className="truncate text-meta text-ink-2">{note}</span>}
                  <span aria-hidden="true" className={checked ? "text-accent" : "invisible"}>
                    <Icon icon={Check} />
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
