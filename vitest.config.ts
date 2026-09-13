import { defineConfig } from "vitest/config";

// Deliberately minimal — this covers pure-logic modules only (light presets, payload-size
// guards, format helpers). Nothing here touches Tauri, three.js/WebGL, or the DOM, so no
// jsdom/plugin-react setup is needed; keep it that way rather than growing this into a
// component-testing setup that would need real maintenance to stay green.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
