import { useEffect, useState } from "react";
import { Box, CircleHelp, FolderOpen, PanelRightClose, Save, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { useAppStore } from "@/store/app-store";

interface ToolButtonProps {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

function ToolButton({ label, children, ...props }: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} title={label} variant="ghost" size="icon" {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function App() {
  const importedFileName = useAppStore((state) => state.importedFileName);
  const status = useAppStore((state) => state.status);
  const setImportedFile = useAppStore((state) => state.setImportedFile);
  const setStatus = useAppStore((state) => state.setStatus);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void window.moldMaker.getAppInfo().then((info) => setVersion(info.version));
  }, []);

  async function openStep(): Promise<void> {
    setStatus("Opening…");
    const result = await window.moldMaker.openStepFile();
    if (result.ok) {
      setImportedFile(result.value.name);
    } else if (result.canceled) {
      setStatus("Ready");
    } else {
      setStatus(result.error);
    }
  }

  return (
    <TooltipProvider delayDuration={350}>
      <div className="app-shell">
        <header className="command-bar">
          <div className="brand"><Box aria-hidden="true" /> MoldMaker</div>
          <div className="file-name">{importedFileName ?? "Untitled"}</div>
          <div className="command-actions">
            <Button variant="ghost" size="icon" aria-label="Open STEP" title="Open STEP" onClick={openStep}>
              <FolderOpen />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Save project" title="Save project" disabled={!importedFileName}>
              <Save />
            </Button>
          </div>
        </header>

        <aside className="tool-rail" aria-label="Mold tools">
          <ToolButton label="Import STEP" onClick={openStep}><Upload /></ToolButton>
          <ToolButton label="Mold settings" disabled={!importedFileName}><Box /></ToolButton>
          <div className="rail-spacer" />
          <ToolButton label="Help"><CircleHelp /></ToolButton>
        </aside>

        <main className="viewport" aria-label="3D model viewport">
          <div className="viewport-grid" />
          <section className="empty-state">
            <div className="empty-icon"><Box aria-hidden="true" /></div>
            <Button onClick={openStep}><Upload /> STEP</Button>
            <p>Drop support and 3D preview arrive in the CAD phase.</p>
          </section>
          <div className="viewport-status"><span className="status-dot" />{status}</div>
        </main>

        <aside className="inspector" aria-label="Precision settings">
          <div className="inspector-title">
            <span>Mold</span>
            <Button variant="ghost" size="icon" aria-label="Collapse inspector" title="Collapse inspector">
              <PanelRightClose />
            </Button>
          </div>
          <div className="field-grid" aria-disabled="true">
            <label>Clearance <span>0.20 mm</span></label>
            <label>Hole Ø <span>4.40 mm</span></label>
            <label>Spacing X <span>—</span></label>
            <label>Spacing Y <span>—</span></label>
          </div>
        </aside>

        <footer className="app-meta">v{version || "…"}</footer>
      </div>
    </TooltipProvider>
  );
}
