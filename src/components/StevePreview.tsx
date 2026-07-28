import { useEffect, useRef } from "react";
import { SkinViewer } from "skinview3d";
import { skinSource } from "../services/auth";

interface StevePreviewProps {
  className?: string;
  grayscale?: boolean;
  skinPath?: string | null;
}

export function StevePreview({
  className = "",
  grayscale = false,
  skinPath = null,
}: StevePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const viewer = new SkinViewer({
      canvas,
      width: Math.max(stage.clientWidth, 1),
      height: Math.max(stage.clientHeight, 1),
      enableControls: false,
      renderPaused: true,
      fov: 24,
      zoom: 0.68,
    });
    let disposed = false;

    const applyStaticComposition = () => {
      viewer.autoRotate = false;
      viewer.animation = null;
      viewer.controls.enabled = false;

      viewer.playerWrapper.position.set(0, 0, 0);
      viewer.playerWrapper.rotation.set(0, 0, 0);
      viewer.playerWrapper.scale.set(1, 1, 1);

      viewer.playerObject.position.set(0, 0, 0);
      viewer.playerObject.rotation.set(0, 0, 0);
      viewer.playerObject.scale.set(1, 1, 1);
      viewer.playerObject.resetJoints();

      // Fixed upright presentation: torso turned toward the right, with the
      // head counter-rotated toward the camera so the face remains readable.
      viewer.playerObject.rotation.y = 1;
      viewer.playerObject.skin.head.rotation.y = -0.32;

      const distance = viewer.camera.position.length();
      const cameraHeight = 18;
      const cameraDepth = Math.sqrt(
        Math.max(distance * distance - cameraHeight * cameraHeight, 1),
      );
      viewer.camera.position.set(0, cameraHeight, cameraDepth);
      viewer.camera.rotation.set(0, 0, 0);
      viewer.camera.lookAt(0, 0.8, 0);
      viewer.camera.updateProjectionMatrix();

      viewer.globalLight.intensity = 2.15;
      viewer.cameraLight.intensity = 0.7;
    };

    applyStaticComposition();
    const requestedSkin = skinSource(skinPath);
    void viewer
      .loadSkin(requestedSkin, { model: "default" })
      .catch(() => viewer.loadSkin("/assets/steve.png", { model: "default" }))
      .then(() => {
        if (disposed) return;
        applyStaticComposition();
        viewer.render();
      });

    const resize = new ResizeObserver(() => {
      viewer.setSize(
        Math.max(stage.clientWidth, 1),
        Math.max(stage.clientHeight, 1),
      );
      applyStaticComposition();
      viewer.render();
    });

    resize.observe(stage);

    return () => {
      disposed = true;
      resize.disconnect();
      viewer.dispose();
    };
  }, [skinPath]);

  return (
    <div
      ref={stageRef}
      className={`steve-preview ${grayscale ? "is-grayscale" : "is-colored"} ${className}`.trim()}
      role="img"
      aria-label="Classic Steve skin preview"
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
