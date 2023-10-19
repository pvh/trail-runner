import * as Automerge from "@automerge/automerge"
import * as AutomergeWasm from "@automerge/automerge-wasm"
import { Repo } from "@automerge/automerge-repo"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel"

const PRECOOKED_BOOTSTRAP_DOC_URL = "automerge:49koKGh1ewRgt5UJU7X7j6D4RM3Z"

// First, spawn the serviceworker.
async function setupServiceWorker() {
  navigator.serviceWorker.register("service-worker.js", { type: "module" }).then(
    (registration) => {
      console.log("ServiceWorker registration successful with scope:", registration.scope)
    },
    (error) => {
      console.log("ServiceWorker registration failed:", error)
    }
  )
}

async function setupRepo() {
  await AutomergeWasm.promise
  Automerge.use(AutomergeWasm)

  // no network, no storage... not yet.
  const repo = new Repo({
    storage: new IndexedDBStorageAdapter(),
    network: [],
    peerId: "frontend-" + Math.round(Math.random() * 10000),
    sharePolicy: async (peerId) => peerId.includes("service-worker"),
  })

  return repo
}

function establishMessageChannel(repo) {
  if (navigator.serviceWorker.controller) {
    const messageChannel = new MessageChannel()

    repo.networkSubsystem.addNetworkAdapter(
      // no weakref on this side, we're the short-lived partner
      new MessageChannelNetworkAdapter(messageChannel.port1)
    )

    // Send a message to the service worker with one port of the channel
    navigator.serviceWorker.controller.postMessage({ type: "INIT_PORT" }, [messageChannel.port2])
  }
}

await setupServiceWorker()
const repo = await setupRepo()
establishMessageChannel(repo)

// Re-establish the MessageChannel if the controlling service worker changes
navigator.serviceWorker.oncontrollerchange = function () {
  console.log("Controller changed!")
  establishMessageChannel(repo)
}

// Put the repo and Automerge on the window.
// Ideally we wouldn't do this but until we can import the same module from "inside the box"
// this prevents us from creating doppelganger imports and dealing with all the wasm nonsense.
window.repo = repo
window.Automerge = window.automerge = Automerge

function bootstrap(key, initialDocumentFn) {
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
const appHandle = (window.appHandle = bootstrap("app", (doc) =>
  repo.find(PRECOOKED_BOOTSTRAP_DOC_URL)
))

console.log(appHandle.url)
const doc = await appHandle.doc()
if (!doc) {
  throw new Error(`Failed to load ${appHandle.url}`)
}
let { importMap, name, module } = doc

console.log("Module downloaded:", name)

if (!importMap || !name || !module) {
  throw new Error("Essential data missing from bootstrap document:", name, module, importMap)
}

console.log("Applying import map...")
await import("es-module-shims")
importShim.addImportMap(importMap)

console.log("Importing...")

// this path relies on knowing how the serviceWorker works & how the import maps are created
// there's probably a better way to model this
const modulePath = `./automerge-repo/${appHandle.url}/fileContents/${module}`
const moduleUrl = new URL(modulePath, window.location).toString()

// and now we can load the module.
const rootModule = await importShim(moduleUrl)

console.log(rootModule)

console.log("Mounting...")
if (rootModule.mount) {
  const urlParams = new URLSearchParams(window.location.search)
  const params = Object.fromEntries(urlParams.entries())
  rootModule.mount(document.getElementById("root"), { ...params, bootstrapDocUrl: appHandle.url })
} else {
  console.error("Root module doesn't export a mount function", rootModule)
}
