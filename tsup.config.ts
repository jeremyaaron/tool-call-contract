import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/cli/index.ts"],
  format: ["esm"],
  splitting: false,
  sourcemap: false,
  target: "node20",
});
