import { describe, expect, it } from "vitest";
import { isSocialRateLimitError } from "./social";

describe("Aster Social error handling", () => {
  it("recognizes Supabase request limits without exposing raw API errors", () => {
    expect(isSocialRateLimitError({ status: 429, message: "Bad Request" })).toBe(
      true,
    );
    expect(
      isSocialRateLimitError({ message: "Request rate limit reached" }),
    ).toBe(true);
  });

  it("does not treat ordinary social errors as request limits", () => {
    expect(isSocialRateLimitError({ message: "Player was not found" })).toBe(
      false,
    );
  });
});
