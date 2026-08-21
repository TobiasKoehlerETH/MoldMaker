import { useEffect, useRef } from "react";
import { Blend, Box, EyeOff, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  OBJECT_LABELS,
  VISIBILITY_LABELS,
  VISIBILITY_ORDER,
  type BodySelection,
  type Visibility
} from "@/viewport/modes";

interface VisibilityMenuProps {
  selection: BodySelection;
  current: Visibility;
  onPick(value: Visibility): void;
  onClose(): void;
}

const ICONS: Record<Visibility, LucideIcon> = {
  solid: Box,
  ghost: Blend,
  hidden: EyeOff
};

export function VisibilityMenu({ selection, current, onPick, onClose }: VisibilityMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    // Deferred so the press that opened the menu cannot immediately close it.
    const timer = window.setTimeout(() => window.addEventListener("pointerdown", onPointerDown));
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="body-menu"
      role="group"
      aria-label={`${OBJECT_LABELS[selection.id]} visibility`}
      style={{ left: selection.x, top: selection.y }}
    >
      {VISIBILITY_ORDER.map((value) => {
        const Icon = ICONS[value];
        return (
          <Button
            key={value}
            variant={value === current ? "outline" : "ghost"}
            size="icon"
            aria-label={VISIBILITY_LABELS[value]}
            title={VISIBILITY_LABELS[value]}
            aria-pressed={value === current}
            onClick={() => onPick(value)}
          >
            <Icon />
          </Button>
        );
      })}
    </div>
  );
}
