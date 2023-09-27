// This file is inserted into ./web by the build script

// TODO: get rid of this... we don't want / need it

// import WASM from "./automerge_wasm_bg.wasm?wasm"
// console.log(WASM)
import { initSync } from "./automerge_wasm.js"

export * from "./automerge_wasm.js"
