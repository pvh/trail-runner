import { Repo } from "@automerge/automerge-repo"
import * as Automerge from "@automerge/automerge"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import { installFetch } from "./fetcher.js"

const PRECOOKED_REGISTRY_DOC_URL = "automerge:LFmNSGzPyPkkcnrvimyAGWDWHkM"
const PRECOOKED_BOOTSTRAP_DOC_URL = "automerge:283ncrGdGXGECsrzLT6pznGM8BZd"

// Step one: Set up an automerge-repo.
const repo = new Repo({
  storage: new IndexedDBStorageAdapter(),
  network: [new BrowserWebSocketClientAdapter("wss://sync.automerge.org")],
})

// put it on the window to reach it from the fetch command elsewhere (just for convenience)
window.repo = repo
window.automerge = Automerge

function bootstrap(key, initialDocumentFn) {
  const docUrl = localStorage.getItem(key)
  if (!docUrl) {
    const handle = initialDocumentFn(repo)
    localStorage.setItem(key, handle.url)
    return handle
  } else {
    return repo.find(docUrl)
  }
}

// you can BYO but we'll provide a default
const registryDocHandle = bootstrap("registryDocUrl", (doc) =>
  repo.find(PRECOOKED_REGISTRY_DOC_URL)
)
installFetch(registryDocHandle)

window.esmsInitOptions = {
  shimMode: true,
  mapOverrides: true,
  fetch: window.fetch,
}

// We establish a faux window.process object to improve support for
// some packages that test for a node environment but don't actually require one.
window.process = {
  env: { DEBUG_COLORS: "false" },
  browser: true,
  versions: {},
  stderr: {},
  cwd: () => ".",
}

console.log("Bootstrapping...")
const bootstrapDocHandle = bootstrap("bootstrapDocUrl", (doc) =>
  repo.find(PRECOOKED_BOOTSTRAP_DOC_URL)
)

// Uncomment this if you want to regenerate the bootstrap document import map
const { generateInitialImportMap } = await import("./bootstrap-importmap.js")
await generateInitialImportMap(repo, registryDocHandle, bootstrapDocHandle)

const { importMap, name } = await bootstrapDocHandle.doc()
if (!importMap || !name) {
  throw new Error("Essential data missing from bootstrap document")
}

await import("https://ga.jspm.io/npm:es-module-shims@1.8.0/dist/es-module-shims.js")

importShim.addImportMap(importMap)
const rootModule = await import(name)

if (rootModule.mount) {
  const urlParams = new URLSearchParams(window.location.search)
  const params = Object.fromEntries(urlParams.entries())
  rootModule.mount(document.getElementById("root"), params)
} else {
  console.error("Root module doesn't export a mount function", rootModule)
}
