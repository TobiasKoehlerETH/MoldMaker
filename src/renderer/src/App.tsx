import { useCallback, useEffect, useMemo, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, FolderOpen, LoaderCircle, Save, Settings2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackgroundRippleEffect } from "@/components/background-ripple-effect";
import { Inspector } from "@/components/inspector";
import { VisibilityMenu } from "@/components/visibility-menu";
import { Viewport } from "@/components/viewport";
import {
  Sidebar,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BUILDING, useAppStore } from "@/store/app-store";
import { moldMaker } from "@/native-api";
import { DEFAULT_VIEW, type BodySelection, type SceneObjectId, type ViewState } from "@/viewport/modes";
import { exportMoldFiles, generateMold } from "@/cad";
import type { CadPreview } from "../../shared/cad";
import type { NativeResult } from "../../shared/native-api";
import { buildMold, DEFAULT_PARAMS, moldWireframe, type MoldParams } from "../../shared/mold";
import { baseName, decodeProject, encodeProject } from "../../shared/project";
import { scalePartModel, readStepModel } from "../../shared/step";

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

function ToolButton({ label, active = false, children, ...props }: ToolButtonProps) {
  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuButton
            aria-label={label}
            aria-pressed={active}
            isActive={active}
            className="app-rail-tool mx-auto size-8 justify-center p-0"
            {...props}
          >
            {children}
            <span className="sr-only">{label}</span>
          </SidebarMenuButton>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
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
  const closePart = useAppStore((state) => state.closePart);
  const setParams = useAppStore((state) => state.setParams);
  const setStatus = useAppStore((state) => state.setStatus);
  const finishBuild = useAppStore((state) => state.finishBuild);

  const [version, setVersion] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [selection, setSelection] = useState<BodySelection | null>(null);
  const [generated, setGenerated] = useState<GeneratedState | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const scaledPart = useMemo(() => (part ? scalePartModel(part, params.shrinkageScale) : null), [part, params.shrinkageScale]);
  const mold = useMemo(() => (scaledPart ? buildMold(scaledPart, params) : null), [scaledPart, params]);
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
  const building = status === BUILDING;

  const autoSaveProject = useCallback(async (): Promise<boolean> => {
    if (!fileName || !part) return true;
    try {
      const result = await moldMaker.saveProjectFile({
        suggestedName: `${baseName(fileName)}.moldmaker`,
        data: encodeProject({ version: 1, sourceName: fileName, step: source, params, view })
      });
      if (result.ok) {
        setStatus("Project saved");
        return true;
      }
      setStatus(result.canceled ? "Ready" : result.error);
      return false;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The project could not be saved");
      return false;
    }
  }, [fileName, params, part, setStatus, source, view]);

  useEffect(() => {
    void moldMaker.getAppInfo().then((info) => setVersion(info.version));
  }, []);

  useEffect(() => {
    let active = true;
    void check()
      .then((available) => {
        if (active && available) setUpdate(available);
      })
      .catch((error: unknown) => {
        console.warn("Update check failed", error);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!part) return;
    const timer = window.setTimeout(() => setSidebarOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [part]);

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

  const closeSelection = useCallback(() => setSelection(null), []);

  function closeProject(): void {
    setGenerated(null);
    setView(DEFAULT_VIEW);
    setSelection(null);
    setSidebarOpen(false);
    closePart();
  }

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
    if (!(await autoSaveProject())) return;
    setStatus("");
    await run(moldMaker.openStepFile(), (file) => {
      const text = new TextDecoder().decode(file.data);
      const model = readStepModel(text);
      // A different part gets a fresh camera, so the old solids have to go.
      setGenerated(null);
      setView(DEFAULT_VIEW);
      setSelection(null);
      openPart(file.name, text, model, DEFAULT_PARAMS);
      return `STEP loaded · ${model.edges.length} edges`;
    });
  }

  async function openProject(): Promise<void> {
    if (!(await autoSaveProject())) return;
    setStatus("");
    await run(moldMaker.openProjectFile(), (file) => {
      const project = decodeProject(file.data);
      setGenerated(null);
      setView(project.view);
      setSelection(null);
      openPart(project.sourceName, project.step, readStepModel(project.step), project.params);
      return "Project loaded";
    });
  }

  async function saveAsProject(): Promise<void> {
    if (!fileName || !part) return;
    const data = encodeProject({ version: 1, sourceName: fileName, step: source, params, view });
    await run(
      moldMaker.saveProjectFile({ suggestedName: `${baseName(fileName)}.moldmaker`, data, saveAs: true }),
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
        moldMaker.exportFiles({
          files: files.map(({ kind, data }) => {
            const [side, extension] = kind.split("-");
            return { name: `${stem}-${side}.${extension}`, data: new Uint8Array(data) };
          })
        }),
        () => "Exported STEP halves"
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The export failed");
    }
  }

  async function installUpdate(): Promise<void> {
    if (!update || updateBusy) return;
    setUpdateBusy(true);
    setStatus(`Installing v${update.version}…`);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (error) {
      setUpdateBusy(false);
      setStatus(error instanceof Error ? error.message : "The update could not be installed");
    }
  }

  if (!part) {
    return (
      <main className="welcome-screen">
        <BackgroundRippleEffect className="welcome-ripple" />
        <section className="welcome-content" aria-labelledby="welcome-title">
          <h1 id="welcome-title">MoldMaker</h1>
          <div className="welcome-actions">
            <Button aria-label="Load STEP model" onClick={importStep}>
              <Upload /> Import STEP
            </Button>
            <Button variant="outline" onClick={openProject}>
              <FolderOpen /> Open project
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <SidebarProvider
      className="app-shell h-full min-h-0"
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      style={{ "--sidebar-width": "34rem", "--sidebar-width-icon": "3rem" } as React.CSSProperties}
    >
      {/* The narrow rail is the persistent primary navigation; the wider
          sidebar beside it changes context between mold and view controls. */}
      <aside
        aria-label="MoldMaker navigation"
        className="app-rail"
      >
        <TooltipProvider delayDuration={0}>
          <SidebarGroup className="app-rail-group">
            <SidebarGroupContent>
              <SidebarMenu>
                <ToolButton
                  label="Settings"
                  active={sidebarOpen}
                  disabled={!part}
                  onClick={() => setSidebarOpen((open) => !open)}
                >
                  <Settings2 />
                </ToolButton>
                {update && (
                  <ToolButton label={`Install update v${update.version}`} disabled={updateBusy} onClick={installUpdate}>
                    {updateBusy ? <LoaderCircle className="animate-spin" /> : <Download />}
                  </ToolButton>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </TooltipProvider>
        <div className="app-rail-spacer" />
        <div className="app-rail-version">v{version || "…"}</div>
      </aside>

      <Sidebar
        collapsible="offcanvas"
        className="app-secondary-sidebar"
        aria-hidden={!sidebarOpen}
        role="complementary"
        aria-label="Settings"
      >
        <Inspector
          section="all"
          params={params}
          mold={mold}
          view={view}
          onChange={setParams}
          onViewChange={(patch) => setView((current) => ({ ...current, ...patch }))}
          onToggleObject={(id) => setView((current) => ({
            ...current,
            objects: { ...current.objects, [id]: current.objects[id] === "hidden" ? "solid" : "hidden" }
          }))}
        />
      </Sidebar>

      <SidebarInset className="min-h-0 min-w-0">
        <header className="command-bar">
          <div className="file-name">{fileName ?? "Untitled"}</div>
          <div className="command-actions">
            {busy && !building && (
              <span className="command-status" role="status" aria-live="polite" title={status}>
                {status}
              </span>
            )}
            <Button variant="ghost" size="icon" aria-label="Import STEP" title="Import STEP" onClick={importStep}>
              <Upload />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Open project" title="Open project" onClick={openProject}>
              <FolderOpen />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Save as project" title="Save as project" disabled={!part} onClick={saveAsProject}>
              <Save />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Export mold" title="Export mold" disabled={!ready} onClick={exportMold}>
              <Download />
            </Button>
          </div>
        </header>

        <section className="viewport" aria-label="3D workspace">
          <div className="viewport-grid" />
          <Viewport preview={preview} plan={plan} view={view} selectedId={selection?.id ?? null} onSelect={setSelection} />
          <Button
            variant="ghost"
            size="icon"
            className="viewer-close-button"
            aria-label="Close project"
            title="Close project"
            onClick={closeProject}
          >
            <X />
          </Button>

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

          {building && (
            <div className="build-loading" role="status" aria-label="Building mold" aria-live="polite">
              <LoaderCircle className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          )}

        </section>

      </SidebarInset>
    </SidebarProvider>
  );
}
