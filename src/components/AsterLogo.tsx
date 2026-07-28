type AsterLogoProps = {
  className?: string;
};

export function AsterLogo({ className }: AsterLogoProps) {
  return (
    <img
      className={className}
      src="/aster-launcher-icon.svg"
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
