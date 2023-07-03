// This file is inserted into ./web by the build script

// import WASM from "./automerge_wasm_bg.wasm";
const WASM = await WebAssembly.compileStreaming(fetch("./web/automerge_wasm_bg.wasm"))
console.log("loaded the wasm")
import { initSync } from "./automerge_wasm.js"
await initSync(WASM)
console.log("managed to intialize the wasm")
export * from "./automerge_wasm.js"
