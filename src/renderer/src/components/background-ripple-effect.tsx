import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface Cell {
  row: number;
  col: number;
}

interface BackgroundRippleEffectProps {
  rows?: number;
  cols?: number;
  cellSize?: number;
  className?: string;
}

/**
 * A lightweight, local version of Aceternity's interactive cell background.
 * The grid is intentionally decorative; the welcome actions remain the only
 * focusable controls in the screen.
 */
export function BackgroundRippleEffect({
  rows = 12,
  cols = 36,
  cellSize = 56,
  className
}: BackgroundRippleEffectProps) {
  const [clickedCell, setClickedCell] = useState<Cell | null>(null);
  const cells = useMemo(() => Array.from({ length: rows * cols }, (_, index) => index), [cols, rows]);

  useEffect(() => {
    if (!clickedCell) return;
    const timer = window.setTimeout(() => setClickedCell(null), 520 + (rows + cols) * 18);
    return () => window.clearTimeout(timer);
  }, [clickedCell, cols, rows]);

  return (
    <div
      aria-hidden="true"
      className={cn("background-ripple-effect", className)}
      style={{
        gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${rows}, ${cellSize}px)`
      }}
    >
      {cells.map((index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const distance = clickedCell
          ? Math.abs(row - clickedCell.row) + Math.abs(col - clickedCell.col)
          : 0;

        return (
          <div
            className={cn("background-ripple-cell", clickedCell && "is-rippling")}
            key={index}
            onClick={() => setClickedCell({ row, col })}
            style={{
              width: cellSize,
              height: cellSize,
              "--ripple-delay": `${distance * 18}ms`
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}
