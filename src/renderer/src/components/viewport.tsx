import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CadMesh, CadPreview } from "../../../shared/cad";
import {
  OBJECT_ORDER,
  OPACITY,
  type BodySelection,
  type SceneObjectId,
  type ViewState
} from "@/viewport/modes";

interface ViewportProps {
  preview: CadPreview | null;
  view: ViewState;
  onSelect(selection: BodySelection | null): void;
}

/** Fraction of the mold height the halves separate by at full explode. */
const EXPLODE_TRAVEL = 0.6;
/** Pointer travel below which a press counts as a click rather than an orbit. */
const CLICK_SLOP = 4;

const STYLES: Record<SceneObjectId, { colour: number; edge: number; metalness: number; roughness: number }> = {
  // Black cast part; its edge overlay is light so it still reads against the body.
  part: { colour: 0x000000, edge: 0x9aa3ad, metalness: 0.12, roughness: 0.38 },
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

const dispose = (group: THREE.Group): void => {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
};

export function Viewport({ preview, view, onSelect }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const fitRef = useRef<() => void>(() => undefined);
  const lastPreviewRef = useRef<CadPreview | null>(null);
  const pressRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 10_000);
    camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;

    const grid = new THREE.GridHelper(200, 40, 0x7a8490, 0xaab1ba);
    grid.rotateX(Math.PI / 2);
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    scene.add(grid, new THREE.HemisphereLight(0xffffff, 0x52606d, 2.1));
    gridRef.current = grid;
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(70, -90, 120);
    const fill = new THREE.DirectionalLight(0xbfd8ff, 1.4);
    fill.position.set(-80, 40, 50);
    scene.add(key, fill);

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      controls.update();
      renderer.render(scene, camera);
    };
    draw();

    const resize = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = canvas;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.updateProjectionMatrix();
    });
    resize.observe(canvas);
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;
    if (modelRef.current) {
      scene.remove(modelRef.current);
      dispose(modelRef.current);
      modelRef.current = null;
    }
    if (!preview) return;

    const group = new THREE.Group();
    const sources: Record<SceneObjectId, CadMesh> = {
      part: preview.part,
      lower: preview.lower,
      upper: preview.upper
    };

    for (const id of OBJECT_ORDER) {
      const opacity = OPACITY[view.objects[id]];
      if (opacity === 0) continue;

      const style = STYLES[id];
      const solid = new THREE.Mesh(
        geometry(sources[id]),
        new THREE.MeshStandardMaterial({
          color: style.colour,
          metalness: style.metalness,
          roughness: style.roughness,
          transparent: opacity < 1,
          opacity,
          depthWrite: opacity === 1,
          side: THREE.DoubleSide
        })
      );
      solid.name = id;
      solid.userData.id = id;
      group.add(solid);

      if (view.showEdges) {
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sources[id].edges), 3));
        const lines = new THREE.LineSegments(
          edgeGeometry,
          new THREE.LineBasicMaterial({
            color: style.edge,
            transparent: true,
            opacity: opacity < 1 ? 0.75 : 0.95,
            depthTest: opacity === 1
          })
        );
        lines.renderOrder = 10;
        solid.add(lines);
      }
    }

    if (view.explode > 0) {
      const travel = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).z * EXPLODE_TRAVEL;
      const shift = (travel * view.explode) / 2;
      group.getObjectByName("lower")?.position.setZ(-shift);
      group.getObjectByName("upper")?.position.setZ(shift);
    }

    scene.add(group);
    modelRef.current = group;
    fitRef.current = () => {
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = size.length() / 2;
      if (gridRef.current) gridRef.current.position.z = box.min.z - size.z * 0.08;
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(radius * 1.25, -radius * 1.45, radius * 1.05));
      camera.near = Math.max(radius / 500, 0.01);
      camera.far = Math.max(radius * 50, 1000);
      camera.updateProjectionMatrix();
      controls.update();
    };
    // Only reframe for a new mold, so changing view options keeps the camera.
    if (preview !== lastPreviewRef.current) fitRef.current();
    lastPreviewRef.current = preview;
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
    const hit = raycaster.intersectObjects(group.children, false)[0];
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
