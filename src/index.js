import { Generator } from "@jspm/generator"
import { Repo } from "@automerge/automerge-repo"
import { LocalForageStorageAdapter } from "@automerge/automerge-repo-storage-localforage"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import * as Automerge from "@automerge/automerge"

// Step one: Set up an automerge-repo.
const repo = new Repo({
  storage: new LocalForageStorageAdapter(),
  network: [new BrowserWebSocketClientAdapter("wss://sync.inkandswitch.com")],
})
window.repo = repo // put it on the window to reach it from the fetch command elsewhere (hack)
window.Automerge = Automerge // put this on the window too, because the published version doesn't work due to the WASM import situation
console.log("repo loaded", repo)

const generator = new Generator({
  // currently we need production mode so all dependencies get bundled into a single esm module
  // todo: fix that modules with sub imports can also be loaded
  env: ["production", "browser", "module"],
})

const BOOTSTRAP_DOC_ID = (window.BOOTSTRAP_DOC_ID =
  localStorage.BOOTSTRAP_DOC_ID || "bec0e828-838f-4484-82ad-b2d52bc03f71")

await generator.install(`./repo/${BOOTSTRAP_DOC_ID}`)
const importMap = generator.getMap()

console.log("import map", importMap)
importShim.addImportMap(importMap)

console.log("import module", BOOTSTRAP_DOC_ID)

await import(BOOTSTRAP_DOC_ID)
