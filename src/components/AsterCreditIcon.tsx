import type { CSSProperties } from "react";

interface AsterCreditIconProps {
  size?: number;
  className?: string;
}

export function AsterCreditIcon({
  size = 32,
  className = "",
}: AsterCreditIconProps) {
  return (
    <span
      className={`aster-credit-icon ${className}`.trim()}
      style={{ "--ac-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span>AC</span>
    </span>
  );
}
