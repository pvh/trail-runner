import * as Automerge from "@automerge/automerge"
import * as AutomergeWasm from "@automerge/automerge-wasm"
import { Repo } from "@automerge/automerge-repo"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel"

const PRECOOKED_BOOTSTRAP_DOC_URL = "automerge:439bMbMZcrw67Ue8bXiNEP13tFrh"

async function setupRepo() {
  await AutomergeWasm.promise
  Automerge.use(AutomergeWasm)

  return new Repo({
    network: [new BroadcastChannelNetworkAdapter()],
    peerId: "frontend-" + Math.round(Math.random() * 10000),
    sharePolicy: async (peerId) => peerId.includes("service-worker"),
  })
}

const repo = await setupRepo()

// put it on the window to reach it from the fetch command elsewhere (just for convenience)
window.repo = repo
window.automerge = Automerge

function bootstrap(key, initialDocumentFn) {
  console.log("IN BOOTSTRAP")
  const param = new URLSearchParams(window.location.search).get(key)
  if (param) {
    return repo.find(param)
  }

  const docUrl = localStorage.getItem(key)
  if (!docUrl) {
    const handle = initialDocumentFn(repo)
    localStorage.setItem(key, handle.url)
    return handle
  } else {
    return repo.find(docUrl)
  }
}

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
const bootstrapDocHandle = (window.bootstrapDocHandle = bootstrap("bootstrapDocUrl", (doc) =>
  repo.find(PRECOOKED_BOOTSTRAP_DOC_URL)
))

console.log(bootstrapDocHandle.url)
let { importMap, name, module } = await bootstrapDocHandle.doc()
console.log("Module downloaded:", name)

// Uncomment this if you want to regenerate the bootstrap document import map
/*
if (!importMap) {
  console.log("Updating import map...")
  const PRECOOKED_REGISTRY_DOC_URL = "automerge:LFmNSGzPyPkkcnrvimyAGWDWHkM"
  const registryDocHandle = repo.find(PRECOOKED_REGISTRY_DOC_URL)
  await registryDocHandle.doc()

  const { generateInitialImportMap } = await import("./bootstrap-importmap.js")
  await generateInitialImportMap(repo, registryDocHandle, bootstrapDocHandle)
  importMap = bootstrapDocHandle.docSync().importMap
}
/* */

if (!importMap || !name || !module) {
  throw new Error("Essential data missing from bootstrap document:", name, module, importMap)
}

console.log("Applying import map...")
await import("./vendor/es-module-shims@1.8.0.js")
importShim.addImportMap(importMap)

console.log("Importing...")
const rootModule = await importShim(
  `/automerge-repo/${bootstrapDocHandle.url}/fileContents/${module}`
)

console.log("Mounting...")
if (rootModule.mount) {
  const urlParams = new URLSearchParams(window.location.search)
  const params = Object.fromEntries(urlParams.entries())
  rootModule.mount(document.getElementById("root"), params)
} else {
  console.error("Root module doesn't export a mount function", rootModule)
}
