import { useEffect, useState } from "react";
import { PictureInPicture } from "@phosphor-icons/react";
import { Icon } from "../components/Icon";
import { listenPipOpenChanged, pipIsOpen, pipToggle, platform } from "../lib/bridge";

export function PipButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    let detach: (() => void) | undefined;
    listenPipOpenChanged((value) => setOpen(value))
      .then((unlisten) => {
        if (active) detach = unlisten;
        else unlisten();
      })
      .catch(() => {});
    pipIsOpen()
      .then((value) => {
        if (active) setOpen(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      detach?.();
    };
  }, []);

  if (platform === "android" || platform === "ios") return null;

  const label = open ? "Close mini player" : "Open mini player";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={open}
      onClick={() => {
        void pipToggle()
          .then(setOpen)
          .catch(() => {});
      }}
      className={`hit-area grid h-8 w-8 shrink-0 place-items-center rounded-full motion-safe:transition-colors motion-safe:duration-quick ${open ? "text-ink-1" : "text-ink-2 hover:text-ink-1"}`}
    >
      <Icon icon={open ? PictureInPicture : PictureInPicture} />
    </button>
  );
}
