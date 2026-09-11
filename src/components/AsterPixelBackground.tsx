import { useEffect, useRef } from "react";

export function AsterPixelBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let pixelFrame = 0;
    let lastPixelPaint = 0;
    let pointerX = 0.5;
    let pointerY = 0.5;
    let pointerEnergy = 0;
    let wheelVelocity = 0;
    let wheelTarget = 0;
    let canvasWidth = 1;
    let canvasHeight = 1;

    const resizePixels = () => {
      const density = Math.min(window.devicePixelRatio || 1, 1.5);
      const bounds = canvas.getBoundingClientRect();
      canvasWidth = Math.max(1, bounds.width);
      canvasHeight = Math.max(1, bounds.height);
      canvas.width = Math.round(canvasWidth * density);
      canvas.height = Math.round(canvasHeight * density);
      context.setTransform(density, 0, 0, density, 0, 0);
    };

    const drawPixels = (timestamp = 0) => {
      if (!mediaQuery.matches && timestamp - lastPixelPaint < 32) {
        pixelFrame = window.requestAnimationFrame(drawPixels);
        return;
      }

      lastPixelPaint = timestamp;
      const width = canvasWidth;
      const height = canvasHeight;
      const time = timestamp * 0.00025;
      const densityProgress = 0;
      const topSpacing = width < 600 ? 14 : 13;
      const spacing = topSpacing - densityProgress * (topSpacing - 8);

      wheelVelocity += (wheelTarget - wheelVelocity) * 0.16;
      wheelTarget *= 0.82;
      pointerEnergy *= 0.975;
      const speed = Math.min(1, Math.abs(wheelVelocity) / 75);

      context.clearRect(0, 0, width, height);
      context.fillStyle = "#fff";

      for (let y = spacing / 2; y < height; y += spacing) {
        const normalizedY = y / height;
        for (let x = spacing / 2; x < width; x += spacing) {
          const normalizedX = x / width;
          const waveA = Math.sin(normalizedX * 9.5 + time * 2.3) * 0.12;
          const waveB = Math.cos(normalizedX * 5.5 - time * 1.7) * 0.09;
          const ridgeA = Math.exp(-Math.pow((normalizedY - 0.35 - waveA) / 0.12, 2));
          const ridgeB = Math.exp(-Math.pow((normalizedY - 0.72 - waveB) / 0.15, 2));
          const leftEdge = Math.exp(-(
            Math.pow((normalizedX + 0.04) / 0.43, 2) +
            Math.pow((normalizedY - 0.53 - waveA * 0.55) / 0.25, 2)
          ) * 2.1);
          const rightEdge = Math.exp(-(
            Math.pow((normalizedX - 1.04) / 0.44, 2) +
            Math.pow((normalizedY - 0.58 - waveB * 0.55) / 0.27, 2)
          ) * 2.05);
          const interference = 0.5 + 0.5 * Math.sin(
            normalizedX * 17 + normalizedY * 12 + time * 2,
          );
          const grain = 0.5 + 0.5 * Math.sin(x * 0.043 + y * 0.029 + time * 5.4) *
            Math.cos(x * 0.021 - y * 0.035 - time * 3.7);
          const distance = Math.hypot(normalizedX - pointerX, normalizedY - pointerY);
          const pointerField = Math.exp(-distance * 8.5) * pointerEnergy;
          const pointerRipple = 0.5 + 0.5 * Math.sin(distance * 54 - time * 8);
          const edgeField = Math.min(1, leftEdge + rightEdge);
          const fullField = Math.min(1, ridgeA * 0.72 + ridgeB * 0.62 + interference * 0.22);
          const field = edgeField * (1 - densityProgress) + fullField * densityProgress;
          const baseAlpha = 0.004 + densityProgress * (0.052 + grain * 0.035);
          const alpha = Math.min(
            0.6,
            baseAlpha + field * (0.018 + grain * (0.15 + densityProgress * 0.08)) +
              pointerField * pointerRipple * 0.32 + speed * field * 0.12,
          );

          if (alpha < 0.012) continue;

          const size = 0.6 + grain * (1.45 + densityProgress * 0.65) + speed * field * 0.9;
          const trail = speed * field * (3 + grain * 8);
          const shiftedY = y + wheelVelocity * (0.08 + field * 0.075);

          context.globalAlpha = alpha;
          context.fillRect(x - size / 2, shiftedY - size / 2, size, size + trail);
        }
      }

      context.globalAlpha = 1;
      if (!mediaQuery.matches) pixelFrame = window.requestAnimationFrame(drawPixels);
    };

    const restartPixels = () => {
      window.cancelAnimationFrame(pixelFrame);
      resizePixels();
      drawPixels(mediaQuery.matches ? 0 : performance.now());
    };
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointerX = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      pointerY = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      pointerEnergy = 1;
    };
    const handlePointerLeave = () => {
      pointerEnergy = 0;
    };
    const handleWheel = (event: WheelEvent) => {
      wheelTarget = Math.max(-90, Math.min(90, wheelTarget + event.deltaY * 0.12));
    };

    restartPixels();
    window.addEventListener("resize", restartPixels, { passive: true });
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("wheel", handleWheel, { passive: true });
    mediaQuery.addEventListener?.("change", restartPixels);

    return () => {
      window.cancelAnimationFrame(pixelFrame);
      window.removeEventListener("resize", restartPixels);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("wheel", handleWheel);
      mediaQuery.removeEventListener?.("change", restartPixels);
    };
  }, []);

  return <canvas ref={canvasRef} className="aster-ambient-pixels" aria-hidden="true" />;
}
