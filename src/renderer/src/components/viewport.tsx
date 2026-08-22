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
  const modelRef = useRef<THREE.Group | null>(null);
  const planRef = useRef<THREE.LineSegments | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const frameRef = useRef<(object: THREE.Object3D) => void>(() => undefined);
  const fitRef = useRef<() => void>(() => undefined);
  const invalidateRef = useRef<() => void>(() => undefined);
  const explodeTravelRef = useRef(0);
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
    if (!group || !preview) return;

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
    }

    applyExplode(group, explodeTravelRef.current, view.explode);
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
