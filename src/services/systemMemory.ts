import { invoke } from "@tauri-apps/api/core";

export interface SystemMemoryInfo {
  totalMemoryBytes: number;
  totalMemoryGb: number;
}

export type RamSafety =
  | { level: "safe"; recommendedMaxGb: number; remainingGb: number }
  | {
      level: "warning" | "critical";
      recommendedMaxGb: number;
      remainingGb: number;
      message: string;
    };

let memoryInfoRequest: Promise<SystemMemoryInfo | null> | null = null;

function browserMemoryFallback(): SystemMemoryInfo | null {
  const approximateGb = (
    navigator as Navigator & { deviceMemory?: number }
  ).deviceMemory;
  if (!Number.isFinite(approximateGb) || !approximateGb) {
    return null;
  }

  return {
    totalMemoryBytes: approximateGb * 1024 ** 3,
    totalMemoryGb: approximateGb,
  };
}

export function getSystemMemoryInfo(): Promise<SystemMemoryInfo | null> {
  if (!memoryInfoRequest) {
    memoryInfoRequest = invoke<SystemMemoryInfo>("get_system_memory_info").catch(
      () => browserMemoryFallback(),
    );
  }
  return memoryInfoRequest;
}

export function evaluateRamSafety(
  allocatedGb: number,
  totalMemoryGb: number,
): RamSafety {
  const installedGb = Math.max(1, Math.round(totalMemoryGb));
  const requestedGb = Math.max(0, Math.round(allocatedGb));
  const reserveGb = Math.max(4, Math.ceil(installedGb * 0.25));
  const recommendedMaxGb = Math.max(2, installedGb - reserveGb);
  const remainingGb = installedGb - requestedGb;

  if (requestedGb >= installedGb) {
    return {
      level: "critical",
      recommendedMaxGb,
      remainingGb,
      message: `${requestedGb} GB is too much for a PC with ${installedGb} GB installed. Minecraft may fail to start or make Windows unresponsive.`,
    };
  }

  if (requestedGb > recommendedMaxGb) {
    return {
      level: "warning",
      recommendedMaxGb,
      remainingGb,
      message: `${requestedGb} GB leaves only ${remainingGb} GB for Windows and Aster. Use ${recommendedMaxGb} GB or less for reliable performance.`,
    };
  }

  return { level: "safe", recommendedMaxGb, remainingGb };
}
