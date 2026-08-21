import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Download, FolderOpen, Save, ScanLine, SlidersHorizontal, Upload } from "lucide-react";
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
import { BUILDING, useAppStore } from "@/store/app-store";
import {
  DEFAULT_VIEW,
  NEXT_VISIBILITY,
  type BodySelection,
  type SceneObjectId,
  type ViewState
} from "@/viewport/modes";
import { generateMold } from "@/cad";
import type { GeneratedMold } from "../../shared/cad";
import type { NativeResult } from "../../shared/electron-api";
import { buildMold, DEFAULT_PARAMS, type MoldParams } from "../../shared/mold";
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
  source: string;
  params: MoldParams;
  result: GeneratedMold;
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
  const openPart = useAppStore((state) => state.openPart);
  const setParams = useAppStore((state) => state.setParams);
  const setStatus = useAppStore((state) => state.setStatus);
  const finishBuild = useAppStore((state) => state.finishBuild);

  const [version, setVersion] = useState("");
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel | null>("mold");
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [selection, setSelection] = useState<BodySelection | null>(null);
  const [generated, setGenerated] = useState<GeneratedState | null>(null);
  const mold = useMemo(() => (part ? buildMold(part, params) : null), [part, params]);
  const ready = generated?.source === source && generated.params === params ? generated.result : null;

  useEffect(() => {
    void window.moldMaker.getAppInfo().then((info) => setVersion(info.version));
  }, []);

  useEffect(() => {
    if (!part || !mold || !source) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setStatus(BUILDING);
      void generateMold(new TextEncoder().encode(source), params, mold.splitAxis)
        .then((result) => {
          if (!current) return;
          setGenerated({ source, params, result });
          finishBuild("Mold ready · 2 print halves");
        })
        .catch((error: unknown) => {
          if (current) setStatus(error instanceof Error ? error.message : "Mold generation failed");
        });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [finishBuild, mold, params, part, setStatus, source]);

  const setVisibility = useCallback((id: SceneObjectId, value: ViewState["objects"][SceneObjectId]): void => {
    setView((current) => ({ ...current, objects: { ...current.objects, [id]: value } }));
  }, []);

  const closeSelection = useCallback(() => setSelection(null), []);

  /** Steps one body through solid, ghost, and hidden, for the sidebar rows. */
  function cycleObject(id: SceneObjectId): void {
    setView((current) => ({
      ...current,
      objects: { ...current.objects, [id]: NEXT_VISIBILITY[current.objects[id]] }
    }));
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
    setStatus("Opening…");
    await run(window.moldMaker.openStepFile(), (file) => {
      const text = new TextDecoder().decode(file.data);
      const model = readStepModel(text);
      openPart(file.name, text, model, DEFAULT_PARAMS);
      return `STEP loaded · ${model.edges.length} edges`;
    });
  }

  async function openProject(): Promise<void> {
    setStatus("Opening…");
    await run(window.moldMaker.openProjectFile(), (file) => {
      const project = decodeProject(file.data);
      openPart(project.sourceName, project.step, readStepModel(project.step), project.params);
      return "Project loaded";
    });
  }

  async function saveProject(): Promise<void> {
    if (!fileName) return;
    const data = encodeProject({ version: 1, sourceName: fileName, step: source, params });
    await run(
      window.moldMaker.saveProjectFile({ suggestedName: `${baseName(fileName)}.moldmaker`, data }),
      () => "Project saved"
    );
  }

  async function exportMold(): Promise<void> {
    if (!ready) return;
    const stem = `${baseName(fileName ?? "mold")}-mold`;
    await run(
      window.moldMaker.exportFiles({
        files: ready.files.map(({ kind, data }) => {
          const [side, extension] = kind.split("-");
          return { name: `${stem}-${side}.${extension}`, data: new Uint8Array(data) };
        })
      }),
      () => "Exported STEP and STL halves"
    );
  }

  function toggleSidebar(panel: SidebarPanel): void {
    setSidebarPanel((current) => (current === panel ? null : panel));
  }

  return (
    <SidebarProvider className="h-full min-h-0" style={{ "--sidebar-width": "18rem" } as React.CSSProperties}>
      <Sidebar collapsible="none" className="w-12 border-r border-sidebar-border" aria-label="Mold tools">
        <SidebarContent>
          <SidebarGroup className="px-1 py-2">
            <SidebarGroupContent>
              <SidebarMenu>
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

      {sidebarPanel && part && (
        <Sidebar
          collapsible="none"
          className="w-72 border-r border-sidebar-border"
          role="complementary"
          aria-label={sidebarPanel === "mold" ? "Mold settings" : "View settings"}
        >
          <Inspector
            section={sidebarPanel}
            params={params}
            mold={mold}
            view={view}
            onChange={setParams}
            onViewChange={(patch) => setView((current) => ({ ...current, ...patch }))}
            onCycleObject={cycleObject}
            onCollapse={() => setSidebarPanel(null)}
          />
        </Sidebar>
      )}

      <SidebarInset className="min-h-0 min-w-0">
        <header className="command-bar">
          <div className="file-name">{fileName ?? "Untitled"}</div>
          <div className="command-actions">
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
          <Viewport preview={ready?.preview ?? null} view={view} onSelect={setSelection} />

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
              <Button onClick={importStep}>
                <Upload /> STEP
              </Button>
            </section>
          )}
        </section>

        <div className="app-meta">v{version || "…"}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
