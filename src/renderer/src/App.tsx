import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Download, FolderOpen, LoaderCircle, PanelLeftClose, PanelLeftOpen, Save, ScanLine, SlidersHorizontal, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Inspector } from "@/components/inspector";
import { VisibilityMenu } from "@/components/visibility-menu";
import { Viewport } from "@/components/viewport";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { BUILDING, useAppStore } from "@/store/app-store";
import { DEFAULT_VIEW, type BodySelection, type SceneObjectId, type ViewState } from "@/viewport/modes";
import { exportMoldFiles, generateMold } from "@/cad";
import type { CadPreview } from "../../shared/cad";
import type { NativeResult } from "../../shared/electron-api";
import { buildMold, DEFAULT_PARAMS, moldWireframe, type MoldParams } from "../../shared/mold";
import { baseName, decodeProject, encodeProject } from "../../shared/project";
import { readStepModel } from "../../shared/step";

interface ToolButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

interface GeneratedState {
  /** Encoded STEP of the part the preview was built from. */
  source: Uint8Array;
  params: MoldParams;
  preview: CadPreview;
}

type SidebarPanel = "mold" | "view";

function ToolButton({ label, active = false, children, ...props }: ToolButtonProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-label={label}
        aria-pressed={active}
        title={label}
        isActive={active}
        className="mx-auto size-8 justify-center p-0"
        {...props}
      >
        {children}
        <span className="sr-only">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function App() {
  const fileName = useAppStore((state) => state.fileName);
  const source = useAppStore((state) => state.source);
  const part = useAppStore((state) => state.part);
  const params = useAppStore((state) => state.params);
  const status = useAppStore((state) => state.status);
  const openPart = useAppStore((state) => state.openPart);
  const setParams = useAppStore((state) => state.setParams);
  const setStatus = useAppStore((state) => state.setStatus);
  const finishBuild = useAppStore((state) => state.finishBuild);

  const [version, setVersion] = useState("");
  const [railOpen, setRailOpen] = useState(true);
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel | null>("mold");
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [selection, setSelection] = useState<BodySelection | null>(null);
  const [generated, setGenerated] = useState<GeneratedState | null>(null);
  const mold = useMemo(() => (part ? buildMold(part, params) : null), [part, params]);
  // Encoded once per file: rebuilds pass the same array so the worker keeps
  // its imported part and no bytes travel.
  const encodedSource = useMemo(() => (source ? new TextEncoder().encode(source) : null), [source]);
  const ready = generated?.source === encodedSource && generated.params === params ? generated.preview : null;
  // The last solids stay on screen while the next ones build: a settings change
  // should refine the model in place, not blank the viewport and re-frame it.
  const preview = generated?.preview ?? null;
  // Wireframe of the envelope and ports, drawn only while the solids are behind
  // the settings, so an edit shows up immediately. A fresh load has no solids
  // yet; it gets a spinner instead of an empty envelope outline.
  const plan = useMemo(() => (mold && preview && !ready ? moldWireframe(mold) : null), [mold, preview, ready]);
  const busy = status.endsWith("…");
  const loading = busy && !preview;

  useEffect(() => {
    void window.moldMaker.getAppInfo().then((info) => setVersion(info.version));
  }, []);

  useEffect(() => {
    if (!part || !mold || !encodedSource) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setStatus(BUILDING);
      void generateMold(encodedSource, params, mold.splitAxis)
        .then((preview) => {
          if (!current) return;
          setGenerated({ source: encodedSource, params, preview });
          finishBuild("Mold ready · 2 print halves");
        })
        .catch((error: unknown) => {
          if (current) {
            console.error("Mold generation failed", error);
            setStatus(error instanceof Error ? error.message : "Mold generation failed");
          }
        });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [encodedSource, finishBuild, mold, params, part, setStatus]);

  const setVisibility = useCallback((id: SceneObjectId, value: ViewState["objects"][SceneObjectId]): void => {
    setView((current) => ({ ...current, objects: { ...current.objects, [id]: value } }));
  }, []);

  // The sidebar's eye is the plain show/hide; transparency comes from clicking
  // the body itself, so hiding a ghosted body and showing it again returns it
  // solid rather than to a state the eye never offered.
  const toggleObject = useCallback((id: SceneObjectId): void => {
    setView((current) => ({
      ...current,
      objects: { ...current.objects, [id]: current.objects[id] === "hidden" ? "solid" : "hidden" }
    }));
  }, []);

  const closeSelection = useCallback(() => setSelection(null), []);

  /** Runs a native call and reports its outcome in the status line. */
  async function run<T>(pending: Promise<NativeResult<T>>, onValue: (value: T) => string): Promise<void> {
    try {
      const result = await pending;
      if (result.ok) setStatus(onValue(result.value));
      else setStatus(result.canceled ? "Ready" : result.error);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The operation failed");
    }
  }

  async function importStep(): Promise<void> {
    setStatus("Opening…");
    await run(window.moldMaker.openStepFile(), (file) => {
      const text = new TextDecoder().decode(file.data);
      const model = readStepModel(text);
      // A different part gets a fresh camera, so the old solids have to go.
      setGenerated(null);
      openPart(file.name, text, model, DEFAULT_PARAMS);
      return `STEP loaded · ${model.edges.length} edges`;
    });
  }

  async function openProject(): Promise<void> {
    setStatus("Opening…");
    await run(window.moldMaker.openProjectFile(), (file) => {
      const project = decodeProject(file.data);
      setGenerated(null);
      openPart(project.sourceName, project.step, readStepModel(project.step), project.params);
      return "Project loaded";
    });
  }

  async function saveProject(): Promise<void> {
    if (!fileName) return;
    setStatus("Saving…");
    const data = encodeProject({ version: 1, sourceName: fileName, step: source, params });
    await run(
      window.moldMaker.saveProjectFile({ suggestedName: `${baseName(fileName)}.moldmaker`, data }),
      () => "Project saved"
    );
  }

  /** Encodes the current halves on demand and hands the files to the user. */
  async function exportMold(): Promise<void> {
    if (!ready) return;
    setStatus("Exporting…");
    try {
      const files = await exportMoldFiles();
      const stem = `${baseName(fileName ?? "mold")}-mold`;
      await run(
        window.moldMaker.exportFiles({
          files: files.map(({ kind, data }) => {
            const [side, extension] = kind.split("-");
            return { name: `${stem}-${side}.${extension}`, data: new Uint8Array(data) };
          })
        }),
        () => "Exported STEP and STL halves"
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The export failed");
    }
  }

  function toggleSidebar(panel: SidebarPanel): void {
    setSidebarPanel((current) => (current === panel ? null : panel));
  }

  return (
    <SidebarProvider className="h-full min-h-0" style={{ "--sidebar-width": "18rem" } as React.CSSProperties}>
      <Sidebar
        collapsible="none"
        aria-hidden={!railOpen}
        aria-label="Mold tools"
        className={cn(
          "border-r border-sidebar-border transition-[width,visibility] duration-300 ease-in-out motion-reduce:transition-none",
          railOpen ? "visible w-12" : "invisible w-0 overflow-hidden border-r-0"
        )}
      >
        <SidebarContent>
          <SidebarGroup className="w-12 px-1 py-2">
            <SidebarGroupContent>
              <SidebarMenu>
                <ToolButton label={railOpen ? "Hide tools" : "Show tools"} onClick={() => setRailOpen((open) => !open)}>
                  {railOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
                </ToolButton>
                <ToolButton label="Import STEP" onClick={importStep}>
                  <Upload />
                </ToolButton>
                <ToolButton
                  label="Mold settings"
                  active={sidebarPanel === "mold"}
                  disabled={!part}
                  onClick={() => toggleSidebar("mold")}
                >
                  <SlidersHorizontal />
                </ToolButton>
                <ToolButton
                  label="View settings"
                  active={sidebarPanel === "view"}
                  disabled={!part}
                  onClick={() => toggleSidebar("view")}
                >
                  <ScanLine />
                </ToolButton>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      {part && (
        <Sidebar
          collapsible="none"
          aria-hidden={!sidebarPanel}
          role="complementary"
          aria-label={sidebarPanel === "view" ? "View settings" : "Mold settings"}
          className={cn(
            "border-r border-sidebar-border transition-[width,visibility] duration-300 ease-in-out motion-reduce:transition-none",
            sidebarPanel ? "visible w-72" : "invisible w-0 overflow-hidden border-r-0"
          )}
        >
          {/* Fixed-width inner column so the settings reflow never shows while
              the panel's width animates. */}
          <div className={cn("flex h-full w-72 flex-col", !sidebarPanel && "pointer-events-none")}>
            <Inspector
              section={sidebarPanel ?? "mold"}
              params={params}
              mold={mold}
              view={view}
              onChange={setParams}
              onViewChange={(patch) => setView((current) => ({ ...current, ...patch }))}
              onToggleObject={toggleObject}
              onCollapse={() => setSidebarPanel(null)}
            />
          </div>
        </Sidebar>
      )}

      <SidebarInset className="min-h-0 min-w-0">
        <header className="command-bar">
          <div className="file-name">{fileName ?? "Untitled"}</div>
          <div className="command-actions">
            {busy && (
              <span className="inline-flex items-center text-muted-foreground" role="status" aria-live="polite" title={status}>
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                <span className="sr-only">{status}</span>
              </span>
            )}
            <Button variant="ghost" size="icon" aria-label="Open project" title="Open project" onClick={openProject}>
              <FolderOpen />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Save project" title="Save project" disabled={!part} onClick={saveProject}>
              <Save />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Export mold" title="Export mold" disabled={!ready} onClick={exportMold}>
              <Download />
            </Button>
          </div>
        </header>

        <section className="viewport" aria-label="3D workspace">
          <div className="viewport-grid" />
          <Viewport preview={preview} plan={plan} view={view} onSelect={setSelection} />

          {!railOpen && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-2 z-10 text-muted-foreground hover:text-foreground"
              aria-label="Show tools"
              title="Show tools"
              onClick={() => setRailOpen(true)}
            >
              <PanelLeftOpen />
            </Button>
          )}

          {selection && (
            <VisibilityMenu
              selection={selection}
              current={view.objects[selection.id]}
              onPick={(value) => {
                setVisibility(selection.id, value);
                closeSelection();
              }}
              onClose={closeSelection}
            />
          )}

          {!part && (
            <section className="empty-state">
              <div className="empty-icon">
                <Box aria-hidden="true" />
              </div>
              <h1 className="empty-title">MoldMaker</h1>
              <p className="empty-tagline">Turn a STEP model into a printable two-part mold.</p>
              <div className="empty-actions">
                <Button onClick={importStep}>
                  <Upload /> Import STEP
                </Button>
                <Button variant="outline" onClick={openProject}>
                  <FolderOpen /> Open project
                </Button>
              </div>
            </section>
          )}

          {loading && (
            /* Status is already announced by the header indicator; this is only the large visual. */
            <div className="empty-state" aria-hidden="true">
              <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </section>

        <div className="app-meta">v{version || "…"}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
