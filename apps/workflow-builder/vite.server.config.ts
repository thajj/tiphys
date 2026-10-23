import { defineConfig } from "vite";

export default defineConfig({
  build: { ssr: "server/main.ts", outDir: "dist-server", target: "node24", sourcemap: false },
  ssr: { noExternal: true },
});
