import { Generator } from "@jspm/generator"
import { Repo } from "@automerge/automerge-repo"
import * as Automerge from "@automerge/automerge"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import { AutomergeRegistry } from "./automerge-provider.js"

const PRECOOKED_BOOTSTRAP_DOC_ID = "441f8ea5-c86f-49a7-87f9-9cc60225e15e"
const PRECOOKED_REGISTRY_DOC_ID = "6b9ae2f8-0629-49d1-a103-f7d4ae2a31e0"

// Step one: Set up an automerge-repo.
const repo = new Repo({
  storage: new IndexedDBStorageAdapter(),
  network: [new BrowserWebSocketClientAdapter("wss://sync.inkandswitch.com")],
})

// put it on the window to reach it from the fetch command elsewhere (this is a hack)
window.repo = repo
window.automerge = Automerge

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

// temporary hack to make the bootstrap doc available to the existing code
window.BOOTSTRAP_DOC_ID = bootstrapDocHandle.documentId

await registryDocHandle.value()
// We stash the registry on the window so we can access it from the debugger for convenience and hackery
const registry = (window.registry = new AutomergeRegistry(repo, registryDocHandle))
registry.installFetch()

window.esmsInitOptions = {
  shimMode: true,
  mapOverrides: true,
  fetch: window.fetch,
}

// hack to work around error during eslint import
if (!window.process) {
  window.process = {}
}
console.log("window.process, before: ", window.process)
window.process.env = { DEBUG_COLORS: "false" }
window.process.browser = true
window.process.versions = {}
window.process.stderr = {}
window.process.cwd = () => "."
console.log("window.process, after: ", window.process)

await import("https://ga.jspm.io/npm:es-module-shims@1.8.0/dist/es-module-shims.js")

// We'll manually record it here (versions don't matter, at least for now):

/** Remove the close comment to re-run the bootstrapping process and repopulate the registry
 * eventually, this should move into the module editor. Feel free to do so!
 * /

// To bootstrap the system from scratch, we need to make sure our initial
// registry has the dependencies for the bootstrap program.

// This code imports the bootstrap document and its dependencies to the registry
const packageName = "@trail-runner/bootstrap"
registry.linkPackage(packageName, "0.0.1", `${PRECOOKED_BOOTSTRAP_DOC_ID}`)
await registry.update(packageName)

// This code creates a reusable importMap based on the current registry you have
// and stores it in the bootstrap document.
const generator = (window.generator = new Generator({
  resolutions: { "@automerge/automerge-wasm": "./web/" },
  defaultProvider: "automerge",
  customProviders: {
    automerge: registry.jspmProvider(),
  },
}))
await generator.install(packageName) // this should load the package above
bootstrapDocHandle.change((doc) => {
  doc.importMap = generator.getMap()
})
/**/

const importMap = (await bootstrapDocHandle.value()).importMap
if (!importMap) {
  throw new Error("No import map found in bootstrap document! Run the code above.")
}

console.log("Bootstrapping...")
// registry.updateImportMap("@trail-runner/bootstrap")
// (does the below) we could maybe do this in the importShim??? or in fetch?
importShim.addImportMap(importMap)
const Bootstrap = await import("@trail-runner/bootstrap")
