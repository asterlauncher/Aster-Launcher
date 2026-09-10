import { describe, expect, it } from "vitest";
import { requiresBtd6RiskWarning } from "./btd6";

describe("BTD6 launch safety", () => {
  it("requires the warning whenever at least one mod is enabled", () => {
    expect(requiresBtd6RiskWarning([{ enabled: true }])).toBe(true);
    expect(requiresBtd6RiskWarning([{ enabled: false }, { enabled: true }])).toBe(true);
  });

  it("does not block a truly vanilla launch", () => {
    expect(requiresBtd6RiskWarning([])).toBe(false);
    expect(requiresBtd6RiskWarning([{ enabled: false }])).toBe(false);
  });
});
