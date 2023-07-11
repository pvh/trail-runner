import { Generator } from "@jspm/generator"
import { Repo } from "@automerge/automerge-repo"
import { LocalForageStorageAdapter } from "@automerge/automerge-repo-storage-localforage"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import { AutomergeRegistry } from "./automerge-provider.js"

console.timeStamp("Entered index.js")

const PRECOOKED_BOOTSTRAP_DOC_ID = "441f8ea5-c86f-49a7-87f9-9cc60225e15e"
const PRECOOKED_REGISTRY_DOC_ID = "6b9ae2f8-0629-49d1-a103-f7d4ae2a31e0"

// Step one: Set up an automerge-repo.
const repo = new Repo({
  storage: new LocalForageStorageAdapter(),
  network: [new BrowserWebSocketClientAdapter("wss://sync.inkandswitch.com")],
})

// put it on the window to reach it from the fetch command elsewhere (this is a hack)
window.repo = repo

function bootstrap(key, initialDocumentFn) {
  const docId = localStorage.getItem(key)
  if (!docId) {
    const handle = initialDocumentFn(repo)
    localStorage.setItem(key, handle.documentId)
    return handle
  } else {
    const handle = repo.find(docId)
    return handle
  }
}

// you can BYO but we'll provide a default
const registryDocHandle = bootstrap("registryKey", (doc) => repo.find(PRECOOKED_REGISTRY_DOC_ID))
const bootstrapDocHandle = bootstrap("bootstrapKey", (doc) => repo.find(PRECOOKED_BOOTSTRAP_DOC_ID))

const rDoc = await registryDocHandle.value()
const bDoc = await bootstrapDocHandle.value()

console.timeStamp("Loaded initial documents")
console.log("Registry Doc ID:", registryDocHandle.documentId, rDoc)
console.log("Bootstrap Doc ID:", bootstrapDocHandle.documentId, bDoc)

// temporary hack to make the bootstrap doc available to the existing code
window.BOOTSTRAP_DOC_ID = bootstrapDocHandle.documentId

const registry = (window.registry = new AutomergeRegistry(repo, registryDocHandle))
registry.installFetch()

window.esmsInitOptions = {
  shimMode: true,
  mapOverrides: true,
  fetch: window.fetch,
}
window.process = { env: {}, versions: {} }
await import("./es-module-shims@1.7.3.js")

// To bootstrap the system from scratch, we need to make sure our initial
// registry has the dependencies for the bootstrap program.
// We'll manually record it here (versions don't matter, at least for now):

// registry.linkPackage("@trail-runner/bootstrap", "0.0.1", `${PRECOOKED_BOOTSTRAP_DOC_ID}`)
// await registry.update("@trail-runner/content-type-raw")

/*
console.log("now installing against local package listing")
const generator = (window.generator = new Generator({
  resolutions: { "@automerge/automerge-wasm": "./web/" },
  defaultProvider: "automerge",
  customProviders: {
    automerge: registry.jspmProvider(),
  },
}))

console.log("installing bootstrap")
await generator.install("@trail-runner/bootstrap") // this should load the package above

console.timeStamp("Installed bootstrap")

// this one should resolve to automerge URLs found in your registry document
console.log("generated version", generator.getMap())
importShim.addImportMap(generator.getMap())
console.log("merged version", importShim.ImportMap)

*/

if (bDoc.importMap) {
  importShim.addImportMap(bDoc.importMap)
}

console.log("loading bootstrap")
console.timeStamp("Importing bootstrap")
const Bootstrap = await import("@trail-runner/bootstrap")
console.timeStamp("Imported bootstrap")
console.log("Success!")
