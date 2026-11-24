import { useId } from "react";
import { DotsThree, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icon } from "./Icon";
import { PhoneIcon } from "./phone/PhoneIcon";
import { type MenuSource, resolveMenu } from "./ContextMenu";
import { useUI } from "../stores/ui";

type ActionMenuProps = {
  items: MenuSource;
  label: string;
  triggerClass?: string;
  icon?: PhosphorIcon;
  triggerText?: string;
  disabled?: boolean;
  placement?: "up" | "down";
  phoneIcon?: boolean;
};

const TRIGGER =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-hover hover:text-ink-1 motion-safe:transition-[color,background-color,transform] motion-safe:duration-press motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export function ActionMenu({
  items,
  label,
  triggerClass = TRIGGER,
  icon = DotsThree,
  triggerText,
  disabled = false,
  placement = "down",
  phoneIcon = false,
}: ActionMenuProps) {
  const owner = useId();
  const open = useUI((state) => state.contextMenu?.owner === owner);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
      aria-disabled={disabled ? "true" : undefined}
      onPointerDown={(event) => {
        if (open) event.stopPropagation();
      }}
      onClick={(event) => {
        const ui = useUI.getState();
        if (ui.contextMenu?.owner === owner) {
          ui.closeContextMenu();
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const up = placement === "up";
        ui.openContextMenu(up ? rect.left : rect.right, up ? rect.top : rect.bottom + 6, resolveMenu(items), {
          owner,
          above: up,
          alignRight: !up,
        });
      }}
      className={`${triggerClass} disabled:opacity-[var(--disabled-opacity)]`}
    >
      {phoneIcon ? <PhoneIcon icon={icon} /> : <Icon icon={icon} />}
      {triggerText}
    </button>
  );
}
