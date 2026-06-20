import { describe, expect, it } from "vitest";

import { version } from "../src/index.js";

describe("package scaffold", () => {
  it("exports the package version", () => {
    expect(version).toBe("0.0.0");
  });
});
