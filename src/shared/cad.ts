import type { MoldParams, SplitAxis } from "./mold";

export interface GenerateMoldRequest {
  id: number;
  step: ArrayBuffer;
  params: MoldParams;
  splitAxis: SplitAxis;
}

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

export interface GeneratedMold {
  files: GeneratedFile[];
  preview: CadPreview;
}

export type GenerateMoldResponse =
  | { id: number; ok: true; result: GeneratedMold }
  | { id: number; ok: false; error: string };
