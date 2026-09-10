import { AlertTriangle, MemoryStick } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  evaluateRamSafety,
  getSystemMemoryInfo,
  type SystemMemoryInfo,
} from "../services/systemMemory";

export function RamSafetyWarning({
  allocatedGb,
}: {
  allocatedGb: number;
}) {
  const [memory, setMemory] = useState<SystemMemoryInfo | null>(null);

  useEffect(() => {
    let active = true;
    void getSystemMemoryInfo().then((result) => {
      if (active) setMemory(result);
    });
    return () => {
      active = false;
    };
  }, []);

  const safety = useMemo(
    () =>
      memory ? evaluateRamSafety(allocatedGb, memory.totalMemoryGb) : null,
    [allocatedGb, memory],
  );

  if (!memory || !safety || safety.level === "safe") return null;

  return (
    <div
      className={`ram-safety-warning is-${safety.level}`}
      role="alert"
      aria-live="polite"
    >
      {safety.level === "critical" ? (
        <AlertTriangle size={16} />
      ) : (
        <MemoryStick size={16} />
      )}
      <span>
        <strong>
          {safety.level === "critical"
            ? "Unsafe RAM allocation"
            : "High RAM allocation"}
        </strong>
        {safety.message}
      </span>
    </div>
  );
}
