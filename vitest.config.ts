import { defineConfig } from "vitest/config";
import { seasons } from "./tools/seasons.mjs";

export default defineConfig({
  plugins: [seasons()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tools/**/*.test.mjs"],
  },
});
