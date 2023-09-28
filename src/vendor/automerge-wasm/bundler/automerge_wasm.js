import * as wasm from "./automerge_wasm_bg.wasm";
import { __wbg_set_wasm } from "./automerge_wasm_bg.js";
__wbg_set_wasm(wasm);
export * from "./automerge_wasm_bg.js";
