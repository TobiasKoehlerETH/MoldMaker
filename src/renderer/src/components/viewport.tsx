import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CadMesh, CadPreview } from "../../../shared/cad";
import type { Vec3 } from "../../../shared/vec3";
import {
  OBJECT_ORDER,
  OPACITY,
  type BodySelection,
  type SceneObjectId,
  type ViewState
} from "@/viewport/modes";

interface ViewportProps {
  preview: CadPreview | null;
  /** Envelope and port lines drawn while the solids catch up with the settings. */
  plan: Vec3[][] | null;
  view: ViewState;
  onSelect(selection: BodySelection | null): void;
}

/**
 * Separation at full explode, as a fraction of the mold's largest dimension.
 *
 * Measuring the largest dimension rather than the height keeps the gap in
 * proportion to what is on screen: a wide, shallow tool is the common case, and
 * scaling its gap by its own height barely parted the halves at all.
 */
const EXPLODE_TRAVEL = 0.45;
/** Pointer travel below which a press counts as a click rather than an orbit. */
const CLICK_SLOP = 4;
/** Vertical side section: a YZ plane advancing through the assembly along X. */
const SECTION_NORMAL = new THREE.Vector3(-1, 0, 0);

const STYLES: Record<SceneObjectId, { colour: number; edge: number; metalness: number; roughness: number }> = {
  // Matte black cast part. The edge overlay matches the body so no wireframe
  // shows on it, and roughness 0.9 keeps the surface flat rather than glossy.
  part: { colour: 0x101010, edge: 0x101010, metalness: 0, roughness: 0.9 },
  lower: { colour: 0x4fa6d8, edge: 0x164e78, metalness: 0, roughness: 0.3 },
  upper: { colour: 0x7bc8ee, edge: 0x164e78, metalness: 0, roughness: 0.3 }
};

const geometry = (mesh: CadMesh): THREE.BufferGeometry => {
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.vertices), 3));
  result.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(mesh.normals), 3));
  result.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triangles), 1));
  return result;
};

/** Line segments for a set of polylines, as one geometry. */
const polylines = (lines: Vec3[][]): THREE.BufferGeometry => {
  const positions: number[] = [];
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) positions.push(...line[index - 1], ...line[index]);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return result;
};

interface SectionSegment {
  start: THREE.Vector2;
  end: THREE.Vector2;
  startKey: string;
  endKey: string;
}

interface SectionLoop {
  points: THREE.Vector2[];
  area: number;
  parent: number;
  depth: number;
}

const pointKey = (point: THREE.Vector2, tolerance: number): string =>
  `${Math.round(point.x / tolerance)}:${Math.round(point.y / tolerance)}`;

const pointInPolygon = (point: THREE.Vector2, polygon: THREE.Vector2[]): boolean => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y);
    if (crosses && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x) {
      inside = !inside;
    }
  }
  return inside;
};

/** Intersects a triangulated mesh with the vertical section plane in Y/Z. */
const sectionSegments = (mesh: CadMesh, cut: number): { segments: SectionSegment[]; tolerance: number } => {
  const vertices = new Float32Array(mesh.vertices);
  const triangles = new Uint32Array(mesh.triangles);
  let span = 0;
  for (let index = 0; index < vertices.length; index += 3) {
    span = Math.max(span, Math.abs(vertices[index] - cut));
  }
  const tolerance = Math.max(span * 1e-7, 1e-6);
  const segments: SectionSegment[] = [];
  const seen = new Set<string>();

  const vertex = (index: number): THREE.Vector3 =>
    new THREE.Vector3(vertices[index * 3], vertices[index * 3 + 1], vertices[index * 3 + 2]);

  for (let index = 0; index < triangles.length; index += 3) {
    const points: THREE.Vector2[] = [];
    const addPoint = (point: THREE.Vector2): void => {
      if (!points.some((existing) => existing.distanceToSquared(point) <= tolerance * tolerance)) points.push(point);
    };
    const triangle = [vertex(triangles[index]), vertex(triangles[index + 1]), vertex(triangles[index + 2])];

    for (let edge = 0; edge < 3; edge += 1) {
      const first = triangle[edge];
      const second = triangle[(edge + 1) % 3];
      const firstDistance = first.x - cut;
      const secondDistance = second.x - cut;
      if (Math.abs(firstDistance) <= tolerance) addPoint(new THREE.Vector2(first.y, first.z));
      if (Math.abs(secondDistance) <= tolerance) addPoint(new THREE.Vector2(second.y, second.z));
      if ((firstDistance < -tolerance && secondDistance > tolerance) || (firstDistance > tolerance && secondDistance < -tolerance)) {
        const amount = firstDistance / (firstDistance - secondDistance);
        addPoint(new THREE.Vector2(
          first.y + (second.y - first.y) * amount,
          first.z + (second.z - first.z) * amount
        ));
      }
    }

    if (points.length !== 2) continue;
    const startKey = pointKey(points[0], tolerance);
    const endKey = pointKey(points[1], tolerance);
    if (startKey === endKey) continue;
    const key = [startKey, endKey].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    segments.push({ start: points[0], end: points[1], startKey, endKey });
  }

  return { segments, tolerance };
};

const sectionLoops = (segments: SectionSegment[], tolerance: number): SectionLoop[] => {
  const adjacency = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    adjacency.set(segment.startKey, [...(adjacency.get(segment.startKey) ?? []), index]);
    adjacency.set(segment.endKey, [...(adjacency.get(segment.endKey) ?? []), index]);
  });

  const unused = new Set(segments.map((_, index) => index));
  const rawLoops: THREE.Vector2[][] = [];
  while (unused.size > 0) {
    const firstIndex = unused.values().next().value as number;
    unused.delete(firstIndex);
    const first = segments[firstIndex];
    const startKey = first.startKey;
    let currentKey = first.endKey;
    const loop = [first.start.clone(), first.end.clone()];
    let guard = 0;

    while (currentKey !== startKey && guard < segments.length + 1) {
      guard += 1;
      const nextIndex = adjacency.get(currentKey)?.find((candidate) => unused.has(candidate));
      if (nextIndex === undefined) break;
      unused.delete(nextIndex);
      const next = segments[nextIndex];
      if (next.startKey === currentKey) {
        loop.push(next.end.clone());
        currentKey = next.endKey;
      } else {
        loop.push(next.start.clone());
        currentKey = next.startKey;
      }
    }

    if (currentKey === startKey) {
      loop.pop();
      if (loop.length >= 3 && Math.abs(THREE.ShapeUtils.area(loop)) > tolerance * tolerance) rawLoops.push(loop);
    }
  }

  const loops: SectionLoop[] = rawLoops.map((points) => ({
    points,
    area: THREE.ShapeUtils.area(points),
    parent: -1,
    depth: 0
  }));
  const order = loops.map((_, index) => index).sort((a, b) => Math.abs(loops[b].area) - Math.abs(loops[a].area));
  for (const index of order) {
    const parent = order.find(
      (candidate) => candidate !== index && Math.abs(loops[candidate].area) > Math.abs(loops[index].area) && pointInPolygon(loops[index].points[0], loops[candidate].points)
    );
    if (parent !== undefined) {
      loops[index].parent = parent;
      loops[index].depth = loops[parent].depth + 1;
    }
  }
  return loops;
};

/** Triangulates the material side of a section, preserving cavity holes. */
const sectionCapGeometry = (mesh: CadMesh, cut: number): THREE.BufferGeometry => {
  const { segments, tolerance } = sectionSegments(mesh, cut);
  const loops = sectionLoops(segments, tolerance);
  const positions: number[] = [];
  const normals: number[] = [];
  const extent = Math.max(tolerance, ...loops.flatMap((loop) => loop.points.map((point) => Math.abs(point.x) + Math.abs(point.y))));
  const capX = cut - Math.max(extent * 1e-6, 1e-5);

  loops.forEach((outer, outerIndex) => {
    if (outer.depth % 2 !== 0) return;
    const holes = loops.filter((loop) => loop.parent === outerIndex);
    const points = [outer.points, ...holes.map((hole) => hole.points)].flat();
    const faces = THREE.ShapeUtils.triangulateShape(outer.points, holes.map((hole) => hole.points));
    for (const [first, second, third] of faces) {
      for (const pointIndex of [first, second, third]) {
        const point = points[pointIndex];
        positions.push(capX, point.x, point.y);
        normals.push(1, 0, 0);
      }
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
};

const dispose = (group: THREE.Object3D): void => {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
};

/** Separates the halves about the parting plane, leaving the part in the gap. */
const applyExplode = (group: THREE.Group, travel: number, explode: number): void => {
  const shift = (travel * explode) / 2;
  group.getObjectByName("lower")?.position.setZ(-shift);
  group.getObjectByName("upper")?.position.setZ(shift);
};

export function Viewport({ preview, plan, view, onSelect }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const planRef = useRef<THREE.LineSegments | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const frameRef = useRef<(object: THREE.Object3D) => void>(() => undefined);
  const fitRef = useRef<() => void>(() => undefined);
  const invalidateRef = useRef<() => void>(() => undefined);
  const explodeTravelRef = useRef(0);
  const sectionPlaneRef = useRef(new THREE.Plane(SECTION_NORMAL, 0));
  const pendingFitRef = useRef(false);
  const pressRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 10_000);
    camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    // A 2x display renders four times as many fragments. The modest cap is
    // visually crisp for CAD edges without overwhelming integrated GPUs.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x52606d, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(70, -90, 120);
    const fill = new THREE.DirectionalLight(0xbfd8ff, 1.4);
    fill.position.set(-80, 40, 50);
    scene.add(key, fill);

    let frame: number | null = null;
    const invalidate = () => {
      if (frame === null) frame = requestAnimationFrame(draw);
    };
    const draw = () => {
      frame = null;
      const dampingActive = controls.update();
      renderer.render(scene, camera);
      // Keep rendering only while OrbitControls is easing toward rest.
      if (dampingActive) invalidate();
    };
    invalidateRef.current = invalidate;
    controls.addEventListener("change", invalidate);

    /** Frames an object for the camera. */
    frameRef.current = (object) => {
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = size.length() / 2;
      // Pull back far enough for the bounding sphere to fit the narrower of the
      // two field of views, so nothing is cropped — separated halves included.
      const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
      const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
      const distance = (radius / Math.sin(Math.min(vertical, horizontal))) * 1.05;
      controls.target.copy(center);
      camera.position
        .copy(center)
        .add(new THREE.Vector3(1.25, -1.45, 1.05).normalize().multiplyScalar(distance));
      camera.near = Math.max(radius / 500, 0.01);
      camera.far = Math.max(radius * 50, 1000);
      camera.updateProjectionMatrix();
      controls.update();
      invalidate();
    };

    let width = 0;
    let height = 0;
    const resizeCanvas = () => {
      const nextWidth = Math.max(Math.round(canvas.clientWidth), 1);
      const nextHeight = Math.max(Math.round(canvas.clientHeight), 1);
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // The sidebar changes the flex width of this canvas. Re-frame against
      // the new aspect ratio so the model is centered in the remaining view,
      // including during the sidebar's width transition.
      fitRef.current();
      invalidate();
    };
    const resize = new ResizeObserver(resizeCanvas);
    resize.observe(canvas);
    resizeCanvas();
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    invalidate();

    return () => {
      invalidateRef.current = () => undefined;
      if (frame !== null) cancelAnimationFrame(frame);
      resize.disconnect();
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      if (modelRef.current) dispose(modelRef.current);
      if (planRef.current) dispose(planRef.current);
      renderer.dispose();
      frameRef.current = () => undefined;
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      modelRef.current = null;
      planRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;
    // A settings change rebuilds the solids for a part already on screen. Only
    // the first model of a part earns a camera move; re-framing on every
    // rebuild would throw away the view the user had set up.
    const isFirstModel = modelRef.current === null;
    if (modelRef.current) {
      scene.remove(modelRef.current);
      dispose(modelRef.current);
      modelRef.current = null;
    }
    explodeTravelRef.current = 0;
    fitRef.current = () => undefined;
    if (!preview) {
      invalidateRef.current();
      return;
    }

    const group = new THREE.Group();
    const sources: Record<SceneObjectId, CadMesh> = {
      part: preview.part,
      lower: preview.lower,
      upper: preview.upper
    };

    for (const id of OBJECT_ORDER) {
      const style = STYLES[id];
      const solid = new THREE.Mesh(
        geometry(sources[id]),
        new THREE.MeshStandardMaterial({
          color: style.colour,
          metalness: style.metalness,
          roughness: style.roughness,
          side: THREE.DoubleSide
        })
      );
      solid.name = id;
      solid.userData.id = id;
      group.add(solid);

      const edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sources[id].edges), 3));
      const lines = new THREE.LineSegments(
        edgeGeometry,
        new THREE.LineBasicMaterial({ color: style.edge, transparent: true })
      );
      lines.name = `${id}-edges`;
      lines.renderOrder = 10;
      solid.add(lines);

      const cap = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial({
          color: style.colour,
          metalness: style.metalness,
          roughness: style.roughness,
          side: THREE.DoubleSide
        })
      );
      cap.name = `${id}-section-cap`;
      cap.renderOrder = 11;
      cap.visible = false;
      solid.add(cap);
    }

    scene.add(group);
    modelRef.current = group;
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    explodeTravelRef.current = Math.max(size.x, size.y, size.z) * EXPLODE_TRAVEL;
    fitRef.current = () => frameRef.current(group);
    // Fitting waits for the presentation pass below, which runs before this
    // commit paints, so the camera frames the model as it is actually shown —
    // exploded halves included.
    pendingFitRef.current = isFirstModel;
    invalidateRef.current();
  }, [preview]);

  // The plan is pure geometry from the parameters, so it redraws the moment a
  // setting changes and shows where the rebuilt solids are heading.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (planRef.current) {
      scene.remove(planRef.current);
      dispose(planRef.current);
      planRef.current = null;
    }
    if (plan) {
      const lines = new THREE.LineSegments(
        polylines(plan),
        new THREE.LineBasicMaterial({ color: 0x1d6fa5, transparent: true, opacity: 0.6, depthTest: false })
      );
      lines.renderOrder = 20;
      scene.add(lines);
      planRef.current = lines;
      // Nothing has been built yet on a fresh import, so the plan is all there
      // is to look at: frame it, and hand double-click the same target.
      if (!modelRef.current) {
        fitRef.current = () => frameRef.current(lines);
        fitRef.current();
      }
    }
    invalidateRef.current();
  }, [plan]);

  // Visibility and explode are presentation-only changes. Updating the existing
  // objects avoids reallocating and re-uploading every mesh buffer.
  useEffect(() => {
    const group = modelRef.current;
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (!group || !preview) {
      renderer.clippingPlanes = [];
      return;
    }

    applyExplode(group, explodeTravelRef.current, view.explode);
    group.updateMatrixWorld(true);
    const sources: Record<SceneObjectId, CadMesh> = {
      part: preview.part,
      lower: preview.lower,
      upper: preview.upper
    };
    let sectionCut: number | null = null;

    if (view.section) {
      const bounds = new THREE.Box3().setFromObject(group);
      sectionCut = THREE.MathUtils.lerp(
        bounds.min.x,
        bounds.max.x,
        THREE.MathUtils.clamp(view.sectionPosition, 0, 1)
      );
      // Three's plane constant is the signed distance from the origin. With
      // this normal, the positive-X side is clipped, leaving a vertical side
      // section as the slider advances through the assembly.
      sectionPlaneRef.current.set(SECTION_NORMAL, sectionCut);
      renderer.clippingPlanes = [sectionPlaneRef.current];
    } else {
      renderer.clippingPlanes = [];
    }

    for (const id of OBJECT_ORDER) {
      const solid = group.getObjectByName(id) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | undefined;
      if (!solid) continue;
      const opacity = OPACITY[view.objects[id]];
      const transparent = opacity < 1;
      solid.visible = opacity > 0;
      solid.material.opacity = opacity;
      solid.material.depthWrite = !transparent;
      if (solid.material.transparent !== transparent) {
        solid.material.transparent = transparent;
        solid.material.needsUpdate = true;
      }

      const lines = solid.getObjectByName(`${id}-edges`) as
        | THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
        | undefined;
      if (lines) {
        lines.visible = opacity > 0;
        lines.material.opacity = transparent ? 0.75 : 0.95;
        lines.material.transparent = transparent;
        lines.material.depthTest = !transparent;
      }

      const cap = solid.getObjectByName(`${id}-section-cap`) as
        | THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
        | undefined;
      if (cap) {
        cap.visible = sectionCut !== null && opacity > 0;
        cap.material.opacity = opacity;
        cap.material.depthWrite = !transparent;
        if (cap.material.transparent !== transparent) {
          cap.material.transparent = transparent;
          cap.material.needsUpdate = true;
        }
        if (sectionCut !== null) {
          cap.geometry.dispose();
          cap.geometry = sectionCapGeometry(sources[id], sectionCut);
        }
      }
    }

    if (pendingFitRef.current) {
      pendingFitRef.current = false;
      fitRef.current();
    }
    invalidateRef.current();
  }, [preview, view]);

  /** Picks the front-most mold body under the pointer, ignoring orbit drags. */
  function selectAtPointer(event: React.PointerEvent<HTMLCanvasElement>): void {
    const press = pressRef.current;
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    const group = modelRef.current;
    pressRef.current = null;
    if (!press || !canvas || !camera || !group) return;
    if (Math.hypot(event.clientX - press[0], event.clientY - press[1]) > CLICK_SLOP) return;

    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const visibleBodies = group.children.filter((child) => child.visible);
    const hit = raycaster.intersectObjects(visibleBodies, false)[0];
    const id = hit?.object.userData.id as SceneObjectId | undefined;
    onSelect(id ? { id, x: event.clientX - rect.left, y: event.clientY - rect.top } : null);
  }

  return (
    <canvas
      ref={canvasRef}
      className="viewport-canvas"
      aria-label="3D model viewport"
      onDoubleClick={() => fitRef.current()}
      onPointerDown={(event) => {
        pressRef.current = [event.clientX, event.clientY];
      }}
      onPointerUp={selectAtPointer}
    />
  );
}
