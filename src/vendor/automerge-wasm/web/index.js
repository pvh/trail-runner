import url from "./automerge_wasm_bg.wasm?url";
import { initSync } from "./automerge_wasm.js";

export const promise = fetch(url).then( (response) => {
  console.log("loaded wasm", response)
  response.arrayBuffer().then(b => initSync(b))
});

export * from "./automerge_wasm.js";
