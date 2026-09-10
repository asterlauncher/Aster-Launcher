import { describe, expect, it } from "vitest";
import { evaluateRamSafety } from "./systemMemory";

describe("evaluateRamSafety", () => {
  it("reserves four GB on an eight GB PC", () => {
    expect(evaluateRamSafety(4, 8).level).toBe("safe");
    expect(evaluateRamSafety(6, 8)).toMatchObject({
      level: "warning",
      recommendedMaxGb: 4,
      remainingGb: 2,
    });
  });

  it("reserves one quarter of larger systems", () => {
    expect(evaluateRamSafety(12, 16).level).toBe("safe");
    expect(evaluateRamSafety(14, 16).level).toBe("warning");
    expect(evaluateRamSafety(24, 32).level).toBe("safe");
  });

  it("marks allocations at or above installed memory as critical", () => {
    expect(evaluateRamSafety(16, 16).level).toBe("critical");
    expect(evaluateRamSafety(24, 16).level).toBe("critical");
  });
});
