import { defineConfig } from "vite"

export default {
  build: {
    target: 'esnext'
  },
  plugins: [],
  define: { "process.env": {} },
  optimizeDeps: {
    // This is necessary because otherwise `vite dev` includes two separate
    // versions of the JS wrapper. This causes problems because the JS
    // wrapper has a module level variable to track JS side heap
    // allocations, initializing this twice causes horrible breakage
    exclude: ["@automerge/automerge-wasm"],
  },
}
