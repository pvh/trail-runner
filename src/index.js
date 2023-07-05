import { Generator } from "@jspm/generator"
import { Repo } from "@automerge/automerge-repo"
import { LocalForageStorageAdapter } from "@automerge/automerge-repo-storage-localforage"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"

// Step one: Set up an automerge-repo.
const repo = new Repo({
  storage: new LocalForageStorageAdapter(),
  network: [new BrowserWebSocketClientAdapter("wss://sync.inkandswitch.com")],
})
window.repo = repo // put it on the window to reach it from the fetch command elsewhere (hack)
console.log("repo loaded", repo)

const generator = new Generator({
  // currently we need production mode so all dependencies get bundled into a single esm module
  // todo: fix that modules with sub imports can also be loaded
  env: ["production", "browser", "module"],
})

const BOOTSTRAP_DOC_ID = (window.BOOTSTRAP_DOC_ID = "e92beafb-147b-44e7-bfd2-abb898279e16")

await generator.install(`./repo/${BOOTSTRAP_DOC_ID}`)
const importMap = generator.getMap()

console.log("import map", importMap)
importShim.addImportMap(importMap)

console.log("import module", BOOTSTRAP_DOC_ID)

await import(BOOTSTRAP_DOC_ID)
