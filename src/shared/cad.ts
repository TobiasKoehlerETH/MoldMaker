import type { MoldParams, SplitAxis } from "./mold";

export interface GenerateMoldRequest {
  id: number;
  kind: "generate";
  /**
   * STEP text for a newly opened part. Omitted when rebuilding the part the
   * worker already holds, so an edit does not re-upload the whole file.
   */
  step?: ArrayBuffer;
  params: MoldParams;
  splitAxis: SplitAxis;
}

export interface ExportMoldRequest {
  id: number;
  kind: "export";
}

export type CadRequest = GenerateMoldRequest | ExportMoldRequest;

export interface GeneratedFile {
  kind: "lower-step" | "upper-step" | "lower-stl" | "upper-stl";
  data: ArrayBuffer;
}

export interface CadMesh {
  vertices: ArrayBuffer;
  normals: ArrayBuffer;
  triangles: ArrayBuffer;
  edges: ArrayBuffer;
}

export interface CadPreview {
  part: CadMesh;
  lower: CadMesh;
  upper: CadMesh;
}

export type CadResponse =
  | { id: number; ok: true; preview: CadPreview }
  | { id: number; ok: true; files: GeneratedFile[] }
  | { id: number; ok: false; error: string };
