import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
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
import { OBJECT_LABELS, OBJECT_ORDER, type SceneObjectId, type ViewState } from "@/viewport/modes";
import { MAX_PADDING, type Mold, type MoldParams } from "../../../shared/mold";

interface InspectorProps {
  section: "all";
  params: MoldParams;
  mold: Mold | null;
  view: ViewState;
  onChange(patch: Partial<MoldParams>): void;
  onViewChange(patch: Partial<ViewState>): void;
  onToggleObject(id: SceneObjectId): void;
}

interface FieldProps {
  id: string;
  label: string;
  /** Accessible name, when the visible label only reads in context. */
  name?: string;
  value: number;
  step: number;
  min: number;
  max: number;
  unit: string;
  onChange(value: number): void;
}

/** What is currently typed, and the value it was typed against. */
interface Draft {
  text: string;
  base: number;
}

const FIELDS = [
  { key: "shrinkageScale", label: "Shrinkage", step: 0.1, min: 0, max: 100, unit: "%" },
  { key: "wallThickness", label: "Wall", step: 0.5, min: 3, max: 30, unit: "mm" },
  { key: "injectionDiameter", label: "Syringe port", step: 0.1, min: 1, max: 10, unit: "mm" },
  { key: "ventDiameter", label: "Air vents", step: 0.1, min: 0.2, max: 2, unit: "mm" },
  { key: "screwDiameter", label: "Mounting holes", step: 0.1, min: 1.5, max: 12, unit: "mm" }
] as const;

const AXES = ["X", "Y", "Z"] as const;

const format = (value: number): string => Number(value.toFixed(3)).toString();

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A millimetre setting, typed in directly. */
function NumberField({ id, label, name = label, value, step, min, max, unit, onChange }: FieldProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  // The draft holds only while it describes the value it was typed against. A
  // change from anywhere else — a reloaded project, a wall that moved the block
  // minimum — wins, and the field snaps back to the real setting.
  const text = draft?.base === value ? draft.text : format(value);

  /**
   * Commits anything in range as it is typed, and holds anything else as text.
   *
   * Clamping every keystroke made values below the minimum impossible to type:
   * on a field that starts at 3, the "1" of "12" became a "3" on the way in.
   */
  function edit(raw: string, parsed: number): void {
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
      setDraft({ text: raw, base: parsed });
      onChange(parsed);
      return;
    }
    setDraft({ text: raw, base: value });
  }

  /** Leaving the field settles whatever is left over: clamped, or discarded. */
  function settle(): void {
    if (!draft) return;
    setDraft(null);
    const parsed = draft.text.trim() === "" ? Number.NaN : Number(draft.text);
    if (Number.isFinite(parsed) && clamp(parsed, min, max) !== value) onChange(clamp(parsed, min, max));
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={`setting-${id}`} className="text-sm text-sidebar-foreground/75">
        {label}
      </Label>
      <div className="flex items-center gap-1.5">
        <Input
          id={`setting-${id}`}
          aria-label={name}
          type="number"
          inputMode="decimal"
          className="h-8 w-20 appearance-none px-2 text-right text-sm tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          value={text}
          step={step}
          min={min}
          max={max}
          onChange={(event) => edit(event.currentTarget.value, event.currentTarget.valueAsNumber)}
          onBlur={settle}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <span className="w-5 text-xs text-sidebar-foreground/55">{unit}</span>
      </div>
    </div>
  );
}

function MoldPanel({ params, mold, onChange }: Pick<InspectorProps, "params" | "mold" | "onChange">) {
  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent className="space-y-2 px-2 pb-2">
          {FIELDS.map(({ key, label, step, min, max, unit }) => (
            <NumberField
              key={key}
              id={key}
              label={label}
              value={params[key]}
              step={step}
              min={min}
              max={max}
              unit={unit}
              onChange={(value) => onChange({ [key]: value })}
            />
          ))}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      {/* Outer block size. The wall sets the smallest block that still encloses
          the part, so these only ever grow it — typing an axis down to its
          minimum hands it back to the wall. */}
      <SidebarGroup>
        <SidebarGroupLabel>Block size</SidebarGroupLabel>
        <SidebarGroupContent className="space-y-2 px-2 pb-2">
          {mold ? (
            AXES.map((axis, index) => (
              <NumberField
                key={axis}
                id={`size-${axis}`}
                label={axis}
                name={`Block ${axis}`}
                value={mold.size[index]}
                step={0.5}
                min={mold.minSize[index]}
                max={mold.minSize[index] + MAX_PADDING}
                unit="mm"
                onChange={(value) => {
                  const padding = [...params.padding] as MoldParams["padding"];
                  padding[index] = Math.max(0, value - mold.minSize[index]);
                  onChange({ padding });
                }}
              />
            ))
          ) : (
            <p className="text-sm text-sidebar-foreground/55">Import a part to size the block.</p>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      {/* The channel is drilled straight down onto the part, so the port lands
          on the topmost surface under wherever these put it. */}
      <SidebarGroup>
        <SidebarGroupLabel>Port position</SidebarGroupLabel>
        <SidebarGroupContent className="space-y-2 px-2 pb-2">
          {mold ? (
            <>
              {AXES.slice(0, 2).map((axis, index) => (
                <NumberField
                  key={axis}
                  id={`port-${axis}`}
                  label={axis}
                  name={`Port ${axis}`}
                  value={params.gateOffset[index]}
                  step={0.5}
                  min={-mold.gateRange[index]}
                  max={mold.gateRange[index]}
                  unit="mm"
                  onChange={(value) => {
                    const gateOffset = [...params.gateOffset] as MoldParams["gateOffset"];
                    gateOffset[index] = value;
                    onChange({ gateOffset });
                  }}
                />
              ))}
            </>
          ) : (
            <p className="text-sm text-sidebar-foreground/55">Import a part to move the port.</p>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      {/* Sliding the seam is a search for the height that draws cleanly, so it
          is worth scrubbing rather than typing. */}
      <SidebarGroup>
        <SidebarGroupLabel>Parting line</SidebarGroupLabel>
        <SidebarGroupContent className="space-y-3 px-2 pb-2">
          {mold ? (
            <>
              <div className="flex items-center justify-between gap-3 text-sm">
                <Label className="text-sidebar-foreground/75">
                  {["X", "Y", "Z"][mold.splitAxis]} height
                </Label>
                <span className="tabular-nums text-sidebar-foreground">
                  {format(mold.splitZ)} mm{params.splitOffset === 0 ? " · auto" : ""}
                </span>
              </div>
              <Slider
                aria-label="Parting line"
                value={[clamp(params.splitOffset, mold.splitRange[0], mold.splitRange[1])]}
                min={mold.splitRange[0]}
                max={mold.splitRange[1]}
                step={0.1}
                onValueChange={([value]) => onChange({ splitOffset: value })}
              />
            </>
          ) : (
            <p className="text-sm text-sidebar-foreground/55">Import a part to move the seam.</p>
          )}
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

function ViewPanel({ view, onViewChange, onToggleObject }: Pick<InspectorProps, "view" | "onViewChange" | "onToggleObject">) {
  return (
    <>
      <div className="workspace-sidebar-column-heading">
        <span>Viewport</span>
      </div>

      <SidebarGroup>
        <SidebarGroupLabel>Objects</SidebarGroupLabel>
        <SidebarGroupContent className="space-y-1 px-1">
          {OBJECT_ORDER.map((id) => {
            const visibility = view.objects[id];
            const shown = visibility !== "hidden";
            const name = OBJECT_LABELS[id].toLowerCase();
            return (
              <div className="flex h-9 items-center justify-between rounded-md px-2 text-sm" key={id}>
                <span className={shown ? "text-sidebar-foreground" : "text-sidebar-foreground/40"}>
                  {OBJECT_LABELS[id]}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`${OBJECT_LABELS[id]} visibility`}
                  aria-pressed={shown}
                  title={shown ? `Hide ${name}` : `Show ${name}`}
                  onClick={() => onToggleObject(id)}
                >
                  {/* A half-lit eye is the transparent state, set from the
                      viewport; the eye itself only ever shows or hides. */}
                  {shown ? <Eye className={visibility === "ghost" ? "opacity-45" : undefined} /> : <EyeOff className="opacity-50" />}
                </Button>
              </div>
            );
          })}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      <SidebarGroup>
        <SidebarGroupContent className="space-y-3 px-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-sidebar-foreground/70">Explode</Label>
            <span className="text-sm tabular-nums">{Math.round(view.explode * 100)}%</span>
          </div>
          <Slider aria-label="Explode" value={[view.explode]} min={0} max={1} step={0.02} onValueChange={([value]) => onViewChange({ explode: value })} />
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      <SidebarGroup>
        <SidebarGroupContent className="space-y-3 px-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="section-view" className="text-sm text-sidebar-foreground/70">Section view</Label>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                id="section-view"
                type="checkbox"
                role="switch"
                className="peer sr-only"
                aria-label="Section view"
                aria-checked={view.section}
                checked={view.section}
                onChange={(event) => onViewChange({ section: event.currentTarget.checked })}
              />
              <span
                aria-hidden="true"
                className="relative h-6 w-11 rounded-full bg-sidebar-foreground/20 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-sidebar after:shadow-sm after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
              />
            </label>
          </div>
          {view.section && (
            <>
              <div className="flex items-center justify-between">
                <Label className="text-sm text-sidebar-foreground/70">Cut position</Label>
                <span className="text-sm tabular-nums">{Math.round(view.sectionPosition * 100)}%</span>
              </div>
              <Slider
                aria-label="Section cut position"
                value={[view.sectionPosition]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={([value]) => onViewChange({ sectionPosition: value })}
              />
            </>
          )}
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

export function Inspector(props: InspectorProps) {
  return (
    <>
      <SidebarHeader className="workspace-sidebar-header">
        <div className="grid gap-0.5">
          <strong className="workspace-sidebar-title">Settings</strong>
        </div>
      </SidebarHeader>
      <SidebarContent className="workspace-sidebar-content">
        <div className="workspace-sidebar-column workspace-sidebar-mold-column">
          <div className="workspace-sidebar-column-heading">
            <span>Mold</span>
          </div>
          <MoldPanel {...props} />
        </div>
        <div className="workspace-sidebar-column workspace-sidebar-view-column">
          <ViewPanel {...props} />
        </div>
      </SidebarContent>
    </>
  );
}
