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
        entryFileNames: `[name].js`,
        chunkFileNames: `[name].js`,
        assetFileNames: `[name].[ext]`,
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: { target: "esnext" },
  },
  plugins: [],
  define: { "process.env": {} },
})
