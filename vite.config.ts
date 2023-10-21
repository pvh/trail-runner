import { resolve } from "path"
import { defineConfig } from "vite"

export default defineConfig({
  base: "./",

  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "service-worker": resolve(__dirname, "service-worker.js"),
      },
      output: {
        entryFileNames: (assetInfo) =>
          assetInfo.name === "service-worker" ? "[name].js" : "assets/[name].js",
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: { target: "esnext" },
  },
  plugins: [],
  define: { "process.env": {} },
})
