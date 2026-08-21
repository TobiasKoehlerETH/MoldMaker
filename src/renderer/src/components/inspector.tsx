import { Blend, Box, PanelBottomOpen, PanelLeftClose, PanelTopOpen, ScanLine, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarSeparator
} from "@/components/ui/sidebar";
import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  matchesMode,
  MODE_ORDER,
  OBJECT_LABELS,
  OBJECT_ORDER,
  SHADING_MODES,
  type SceneObjectId,
  type ShadingMode,
  type ViewState
} from "@/viewport/modes";
import type { Mold, MoldParams } from "../../../shared/mold";

interface InspectorProps {
  section: "mold" | "view";
  params: MoldParams;
  mold: Mold | null;
  view: ViewState;
  onChange(patch: Partial<MoldParams>): void;
  onViewChange(patch: Partial<ViewState>): void;
  onCycleObject(id: SceneObjectId): void;
  onCollapse(): void;
}

const FIELDS = [
  { key: "wallThickness", label: "Wall", step: 0.5, min: 3, max: 30, unit: "mm" },
  { key: "injectionDiameter", label: "Syringe port", step: 0.1, min: 1, max: 10, unit: "mm" },
  { key: "ventDiameter", label: "Air vents", step: 0.1, min: 0.2, max: 2, unit: "mm" },
  { key: "shrinkagePercent", label: "Scale compensation", step: 0.1, min: 0, max: 5, unit: "%" }
] as const;

const MODE_ICONS: Record<ShadingMode, LucideIcon> = {
  solid: Box,
  transparent: Blend,
  "ghost-upper": PanelTopOpen,
  "ghost-lower": PanelBottomOpen
};

const format = (value: number): string => Number(value.toFixed(3)).toString();

function MoldPanel({ params, mold, onChange }: Pick<InspectorProps, "params" | "mold" | "onChange">) {
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>RTV tool</SidebarGroupLabel>
        <SidebarGroupContent className="space-y-4 px-2 pb-2">
          {FIELDS.map(({ key, label, step, min, max, unit }) => (
            <div className="space-y-2" key={key}>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`setting-${key}`} className="text-xs text-sidebar-foreground/75">
                  {label}
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id={`setting-${key}`}
                    aria-label={label}
                    type="number"
                    inputMode="decimal"
                    className="h-7 w-16 appearance-none px-2 text-right text-xs tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    value={format(params[key])}
                    step={step}
                    min={min}
                    max={max}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(value)) onChange({ [key]: Math.min(max, Math.max(min, value)) });
                    }}
                  />
                  <span className="w-5 text-[10px] text-sidebar-foreground/55">{unit}</span>
                </div>
              </div>
              <Slider
                aria-label={`${label} slider`}
                value={[params[key]]}
                step={step}
                min={min}
                max={max}
                onValueChange={([value]) => onChange({ [key]: value })}
              />
            </div>
          ))}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      <SidebarGroup>
        <SidebarGroupLabel>Generated</SidebarGroupLabel>
        <SidebarGroupContent className="space-y-2 px-2 text-xs">
          <div className="flex justify-between gap-3 text-sidebar-foreground/65">
            <span>Tool</span>
            <span className="text-right tabular-nums text-sidebar-foreground">{mold ? `${mold.size.map(format).join(" × ")} mm` : "—"}</span>
          </div>
          <div className="flex justify-between text-sidebar-foreground/65">
            <span>Split</span>
            <span className="text-sidebar-foreground">{mold ? ["X", "Y", "Z"][mold.splitAxis] : "—"} · auto</span>
          </div>
          <div className="flex justify-between text-sidebar-foreground/65">
            <span>Flow</span>
            <span className="text-sidebar-foreground">1 gate · {mold?.vents.length ?? 0} vents</span>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

function ViewPanel({ view, onViewChange, onCycleObject }: Pick<InspectorProps, "view" | "onViewChange" | "onCycleObject">) {
  const mode = MODE_ORDER.find((candidate) => matchesMode(view, candidate));
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Shading</SidebarGroupLabel>
        <SidebarGroupContent className="flex items-center gap-2 px-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode}
            onValueChange={(value) => {
              if (value) onViewChange({ objects: { ...SHADING_MODES[value as ShadingMode].objects } });
            }}
          >
            {MODE_ORDER.map((preset) => {
              const Icon = MODE_ICONS[preset];
              return (
                <ToggleGroupItem key={preset} value={preset} aria-label={SHADING_MODES[preset].label} title={SHADING_MODES[preset].label}>
                  <Icon />
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          <Toggle variant="outline" size="sm" pressed={view.showEdges} onPressedChange={(pressed) => onViewChange({ showEdges: pressed })} aria-label="Show all edges" title="Show all edges">
            <ScanLine />
          </Toggle>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      <SidebarGroup>
        <SidebarGroupLabel>Objects</SidebarGroupLabel>
        <SidebarGroupContent className="space-y-1 px-1">
          {OBJECT_ORDER.map((id) => (
            <div className="flex h-8 items-center justify-between rounded-md px-2 text-xs" key={id}>
              <span className="text-sidebar-foreground/70">{OBJECT_LABELS[id]}</span>
              <Button variant="ghost" size="sm" className="h-7 capitalize" aria-label={`${OBJECT_LABELS[id]} visibility`} onClick={() => onCycleObject(id)}>
                {view.objects[id]}
              </Button>
            </div>
          ))}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      <SidebarGroup>
        <SidebarGroupLabel>Assembly</SidebarGroupLabel>
        <SidebarGroupContent className="space-y-3 px-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-sidebar-foreground/70">Explode</Label>
            <span className="text-xs tabular-nums">{Math.round(view.explode * 100)}%</span>
          </div>
          <Slider aria-label="Explode" value={[view.explode]} min={0} max={1} step={0.02} onValueChange={([value]) => onViewChange({ explode: value })} />
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

export function Inspector(props: InspectorProps) {
  const moldPanel = props.section === "mold";
  return (
    <>
      <SidebarHeader className="h-14 flex-row items-center justify-between border-b border-sidebar-border px-3">
        <div className="grid gap-0.5">
          <strong className="text-sm">{moldPanel ? "Mold" : "View"}</strong>
          <span className="text-[10px] text-sidebar-foreground/55">{moldPanel ? "RTV silicone" : "Display"}</span>
        </div>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Collapse sidebar" title="Collapse sidebar" onClick={props.onCollapse}>
          <PanelLeftClose />
        </Button>
      </SidebarHeader>
      <SidebarContent>{moldPanel ? <MoldPanel {...props} /> : <ViewPanel {...props} />}</SidebarContent>
    </>
  );
}
