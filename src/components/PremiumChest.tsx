import { useEffect, useRef } from "react";
import * as THREE from "three";

type Point3 = [number, number, number];
type FaceName = "north" | "east" | "south" | "west" | "up" | "down";

interface ChestFace {
  uv: [number, number, number, number];
}

interface ChestElement {
  from: Point3;
  to: Point3;
  rotation?: {
    angle: number;
    axis: "x" | "y" | "z";
    origin: Point3;
  };
  faces: Partial<Record<FaceName, ChestFace>>;
}

interface ChestModel {
  texture_size?: [number, number];
  elements: ChestElement[];
  display?: {
    gui?: {
      rotation?: Point3;
      translation?: Point3;
      scale?: Point3;
    };
  };
}

const FACE_CORNERS: Record<
  FaceName,
  (from: Point3, to: Point3) => [Point3, Point3, Point3, Point3]
> = {
  north: ([x1, y1, z1], [x2, y2]) => [
    [x1, y2, z1],
    [x2, y2, z1],
    [x2, y1, z1],
    [x1, y1, z1],
  ],
  east: ([, y1, z1], [x2, y2, z2]) => [
    [x2, y2, z1],
    [x2, y2, z2],
    [x2, y1, z2],
    [x2, y1, z1],
  ],
  south: ([x1, y1, ,], [x2, y2, z2]) => [
    [x2, y2, z2],
    [x1, y2, z2],
    [x1, y1, z2],
    [x2, y1, z2],
  ],
  west: ([x1, y1, z1], [, y2, z2]) => [
    [x1, y2, z2],
    [x1, y2, z1],
    [x1, y1, z1],
    [x1, y1, z2],
  ],
  up: ([x1, , z1], [x2, y2, z2]) => [
    [x1, y2, z2],
    [x2, y2, z2],
    [x2, y2, z1],
    [x1, y2, z1],
  ],
  down: ([x1, y1, z1], [x2, , z2]) => [
    [x1, y1, z1],
    [x2, y1, z1],
    [x2, y1, z2],
    [x1, y1, z2],
  ],
};

function rotateElementPoint(point: Point3, element: ChestElement): Point3 {
  if (!element.rotation || element.rotation.angle === 0) return point;

  const { angle, axis, origin } = element.rotation;
  const vector = new THREE.Vector3(
    point[0] - origin[0],
    point[1] - origin[1],
    point[2] - origin[2],
  );
  const radians = THREE.MathUtils.degToRad(angle);

  if (axis === "x") vector.applyAxisAngle(new THREE.Vector3(1, 0, 0), radians);
  if (axis === "y") vector.applyAxisAngle(new THREE.Vector3(0, 1, 0), radians);
  if (axis === "z") vector.applyAxisAngle(new THREE.Vector3(0, 0, 1), radians);

  return [
    vector.x + origin[0],
    vector.y + origin[1],
    vector.z + origin[2],
  ];
}

function makeFaceGeometry(
  element: ChestElement,
  name: FaceName,
  face: ChestFace,
) {
  const corners = FACE_CORNERS[name](element.from, element.to).map((point) =>
    rotateElementPoint(point, element),
  );
  const positions = new Float32Array(
    corners.flatMap(([x, y, z]) => [x - 8, y - 8, z - 8]),
  );
  const [u1, v1, u2, v2] = face.uv;
  // Minecraft model UV values use the conventional 0..16 model space even
  // when the source texture itself is higher resolution.
  const textureWidth = 16;
  const textureHeight = 16;
  const uvs = new Float32Array([
    u1 / textureWidth,
    1 - v1 / textureHeight,
    u2 / textureWidth,
    1 - v1 / textureHeight,
    u2 / textureWidth,
    1 - v2 / textureHeight,
    u1 / textureWidth,
    1 - v2 / textureHeight,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

function loadImage(path: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${path}`));
    image.src = path;
  });
}

async function createChestScene(canvas: HTMLCanvasElement) {
  const [model, image] = await Promise.all([
    fetch("/assets/cosmetics/premium_chest.json").then((response) => {
      if (!response.ok) throw new Error("Premium chest model unavailable");
      return response.json() as Promise<ChestModel>;
    }),
    loadImage("/assets/cosmetics/premium_chest.png"),
  ]);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(220, 180, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    alphaTest: 0.01,
    transparent: true,
    side: THREE.FrontSide,
  });
  const scene = new THREE.Scene();
  const chest = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  model.elements.forEach((element) => {
    (Object.entries(element.faces) as Array<[FaceName, ChestFace]>).forEach(
      ([name, face]) => {
        const geometry = makeFaceGeometry(element, name, face);
        geometries.push(geometry);
        chest.add(new THREE.Mesh(geometry, material));
      },
    );
  });

  const gui = model.display?.gui;
  const rotation = gui?.rotation ?? [33, 139, 0];
  const translation = gui?.translation ?? [0, 2.75, 0];
  const scale = gui?.scale ?? [1, 1, 1];
  chest.position.set(...translation);
  chest.scale.set(...scale);
  chest.rotation.set(
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
    "XYZ",
  );
  scene.add(chest);

  const aspect = 220 / 180;
  const viewHeight = 21;
  const camera = new THREE.OrthographicCamera(
    (-viewHeight * aspect) / 2,
    (viewHeight * aspect) / 2,
    viewHeight / 2,
    -viewHeight / 2,
    0.1,
    100,
  );
  camera.position.set(0, 0, 40);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);

  return () => {
    geometries.forEach((geometry) => geometry.dispose());
    material.dispose();
    texture.dispose();
    renderer.dispose();
  };
}

export function PremiumChest({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let disposed = false;
    let disposeScene: (() => void) | undefined;
    const canvas = canvasRef.current;
    if (!canvas) return;

    void createChestScene(canvas)
      .then((dispose) => {
        if (disposed) dispose();
        else disposeScene = dispose;
      })
      .catch(() => {
        if (!disposed) canvas.classList.add("premium-chest-render-failed");
      });

    return () => {
      disposed = true;
      disposeScene?.();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`premium-chest-render ${className}`.trim()}
      aria-label="Premium cosmetics release chest"
      role="img"
      width={220}
      height={180}
    />
  );
}
