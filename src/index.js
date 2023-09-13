import { Repo } from "@automerge/automerge-repo"
import * as Automerge from "@automerge/automerge"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import { installFetch } from "./fetcher.js"

const PRECOOKED_REGISTRY_DOC_ID = "6b9ae2f8-0629-49d1-a103-f7d4ae2a31e0"

const queryString = window.location.search
const urlParams = new URLSearchParams(queryString)

const BOOTSTRAP_DOC_ID = urlParams.get("bootstrapDocId") ?? "441f8ea5-c86f-49a7-87f9-9cc60225e15e"

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
    return repo.find(docId)
  }
}

// you can BYO but we'll provide a default
const registryDocHandle = bootstrap("registryKey", (doc) => repo.find(PRECOOKED_REGISTRY_DOC_ID))
installFetch(registryDocHandle)

const bootstrapDocHandle = repo.find(BOOTSTRAP_DOC_ID)

// temporary hack to make the bootstrap doc available to the existing code
window.BOOTSTRAP_DOC_ID = bootstrapDocHandle.documentId

// todo: allow to bootstrap documents that are not in the registry
/*
const names = await registry.findLinkedNames(BOOTSTRAP_DOC_ID)
if (names.length === 0) {
  throw new Error("Can't bootstrap document because it has no entry in the package registry")
}

const bootstrapPackageName = names[0].name
*/

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
 registry.linkPackage(bootstrapPackageName, "0.0.1", `${BOOTSTRAP_DOC_ID}`)
 await registry.update(bootstrapPackageName)

 // This code creates a reusable importMap based on the current registry you have
 // and stores it in the bootstrap document.
 const generator = (window.generator = new Generator({
  resolutions: { "@automerge/automerge-wasm": "./web/" },
  defaultProvider: "automerge",
  customProviders: {
    automerge: registry.jspmProvider(),
  },
}))

 console.log("load", bootstrapPackageName)

 await generator.install(bootstrapPackageName) // this should load the package above
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
// const rootModule = await import("@trail-runner/bootstrap")

if (rootModule.mount) {
  const params = Object.fromEntries(urlParams.entries())
  rootModule.mount(document.getElementById("root"), params)
}
