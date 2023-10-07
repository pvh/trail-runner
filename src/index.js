import * as Automerge from "@automerge/automerge"
import * as AutomergeWasm from "@automerge/automerge-wasm"
import { Repo } from "@automerge/automerge-repo"
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel"

const PRECOOKED_BOOTSTRAP_DOC_URL = "automerge:439bMbMZcrw67Ue8bXiNEP13tFrh"

// First, spawn the serviceworker.
async function setupServiceWorker() {
  navigator.serviceWorker.register("service-worker.js", { type: "module" }).then(
    (registration) => {
      console.log("ServiceWorker registration successful with scope:", registration.scope)

      // Ensure the service worker is in the 'activated' state
      if (registration.installing) {
        registration.installing.addEventListener("statechange", function (event) {
          if (event.target.state === "activated") {
            // Do any additional setup once the service worker is ready
          }
        })
      }
    },
    (error) => {
      console.log("ServiceWorker registration failed:", error)
    }
  )
  navigator.serviceWorker.oncontrollerchange = function () {
    // A new service worker is now controlling the page
    if (navigator.serviceWorker.controller) {
      // TODO: Get rid of the old MessageChannel
    }
  }
}

async function setupRepo() {
  await AutomergeWasm.promise
  Automerge.use(AutomergeWasm)

  // no network, no storage... not yet.
  const repo = new Repo({
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

// Try establishing a MessageChannel when the page loads
establishMessageChannel(repo)

// Re-establish the MessageChannel if the controlling service worker changes
navigator.serviceWorker.oncontrollerchange = function () {
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
const bootstrapDocHandle = (window.bootstrapDocHandle = bootstrap("bootstrapDocUrl", (doc) =>
  repo.find(PRECOOKED_BOOTSTRAP_DOC_URL)
))

console.log(bootstrapDocHandle.url)
let { importMap, name, module } = await bootstrapDocHandle.doc()
console.log("Module downloaded:", name)

// Uncomment this if you want to regenerate the bootstrap document import map
// You should be able to use the importMap generator tool instead of this, but if that's
// broken, there's this.
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
// this path relies on knowing how the serviceWorker works & how the import maps are created
// there's probably a better way to model this
const modulePath = `./automerge-repo/${bootstrapDocHandle.url}/fileContents/${module}`
// and this is required for correct relative paths on non-localhost
const moduleUrl = new URL(modulePath, window.location).toString()
const rootModule = await importShim(moduleUrl)

console.log("Mounting...")
if (rootModule.mount) {
  const urlParams = new URLSearchParams(window.location.search)
  const params = Object.fromEntries(urlParams.entries())
  rootModule.mount(document.getElementById("root"), params)
} else {
  console.error("Root module doesn't export a mount function", rootModule)
}
