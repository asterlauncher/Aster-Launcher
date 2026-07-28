import { describe, expect, it } from "vitest";
import { parseUpdateNotes } from "./useLauncherUpdater";

describe("parseUpdateNotes", () => {
  it("uses a Markdown heading as the update name", () => {
    expect(
      parseUpdateNotes(
        "0.2.0",
        "# Starlight Update\n\nFaster downloads and stability fixes.",
      ),
    ).toEqual({
      name: "Starlight Update",
      description: "Faster downloads and stability fixes.",
    });
  });

  it("keeps plain release notes as the description", () => {
    expect(parseUpdateNotes("0.2.1", "Small launcher fixes.")).toEqual({
      name: "Aster Launcher 0.2.1",
      description: "Small launcher fixes.",
    });
  });

  it("provides useful fallback copy when notes are empty", () => {
    expect(parseUpdateNotes("0.2.2").name).toBe("Aster Launcher 0.2.2");
    expect(parseUpdateNotes("0.2.2").description).toContain("new launcher build");
  });
});
