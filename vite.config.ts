import { defineConfig } from "vite"
import wasm from "vite-plugin-wasm"
import topLevelAwait from "vite-plugin-top-level-await"

export default {
  plugins: [wasm(), topLevelAwait()],

  // This is only necessary if you are using `SharedWorker` or `WebWorker`, as
  // documented in https://vitejs.dev/guide/features.html#import-with-constructors
  worker: {
    format: "es",
    plugins: [wasm(), topLevelAwait()],
  },

  optimizeDeps: {
    // This is necessary because otherwise `vite dev` includes two separate
    // versions of the JS wrapper. This causes problems because the JS
    // wrapper has a module level variable to track JS side heap
    // allocations, initializing this twice causes horrible breakage
    exclude: ["@automerge/automerge-wasm"],
  },

  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: "./index.html",
        "service-worker": "./src/service-worker.js",
      },
      output: {
        entryFileNames: (assetInfo) =>
          assetInfo.name === "service-worker" ? "[name].js" : "[name]-[hash].js",
      },
    },
  },
}
