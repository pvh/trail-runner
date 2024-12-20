import * as AR from "https://esm.sh/@automerge/automerge-repo@2.0.0-alpha.14/slim?bundle-deps"
import { IndexedDBStorageAdapter } from "https://esm.sh/@automerge/automerge-repo-storage-indexeddb@2.0.0-alpha.14?bundle-deps"
import { BrowserWebSocketClientAdapter } from "https://esm.sh/@automerge/automerge-repo-network-websocket@2.0.0-alpha.14?bundle-deps"
import { MessageChannelNetworkAdapter } from "https://esm.sh/@automerge/automerge-repo-network-messagechannel@2.0.0-alpha.14?bundle-deps"

await AR.initializeWasm(
  fetch("https://esm.sh/@automerge/automerge@2.2.8/dist/automerge.wasm")
)

const PRECOOKED_BOOTSTRAP_DOC_URL = "automerge:2sbkVLjmSqdXqyP7XeFeY3ujMzub"

// Then set up an automerge repo (loading with our annoying WASM hack)
async function setupRepo() {
  // no network, no storage... not yet.
  const repo = new AR.Repo({
    storage: new IndexedDBStorageAdapter(),
    network: [new BrowserWebSocketClientAdapter("wss://sync.automerge.org")],
    peerId: "frontend-" + Math.round(Math.random() * 10000),
    sharePolicy: async (peerId) => peerId.includes("service-worker"),
  })

  return repo
}

/*
// Now introduce the two to each other. This frontend takes advantage of loaded state in the SW.
function establishMessageChannel(repo) {
  if (!navigator.serviceWorker.controller) {
    console.log("No service worker is controlling this tab right now.")
    return
  }

  // Send one side of a MessageChannel to the service worker and register the other with the repo.
  const messageChannel = new MessageChannel()
  repo.networkSubsystem.addNetworkAdapter(new MessageChannelNetworkAdapter(messageChannel.port1))
  navigator.serviceWorker.controller.postMessage({ type: "INIT_PORT" }, [messageChannel.port2])
}*/

// (Actually do the things above here.)
// await setupServiceWorker()
const repo = await setupRepo()
// establishMessageChannel(repo)

// Put the repo and Automerge on the window.
// Ideally we wouldn't do this but until we can import the same module from "inside the box"
// this prevents us from creating doppelganger imports and dealing with all the wasm nonsense.
window.repo = repo
// window.Automerge = window.automerge = Automerge

// We establish a faux window.process object to improve support for
// some packages that test for a node environment but don't actually require one.
// Most of this is cruft and at some point it would be good to do away with this.
window.process = {
  env: { DEBUG_COLORS: "false" },
  browser: true,
  versions: {},
  stderr: {},
  cwd: () => ".",
}

// Re-establish the MessageChannel if the controlling service worker changes
/*
navigator.serviceWorker.oncontrollerchange = function () {
  console.log("Controller changed!")
  establishMessageChannel(repo)
}
*/

async function bootstrapApplication() {
  // Choose the initial module to load.
  const appUrl =
    new URLSearchParams(window.location.search).get("app") || PRECOOKED_BOOTSTRAP_DOC_URL
  console.log(`Booting from module at: ${appUrl}`)

  console.log("Applying import map...")
  window.esmsInitOptions = { shimMode: true, mapOverrides: true }
  await import("https://esm.sh/es-module-shims@1.10.1")

  // maybe this should be importmap.json for consistency but the key is the key
  const importMapPath = `./automerge-repo/${appUrl}/importMap`
  const importMapResponse = await fetch(importMapPath)
  if (importMapResponse.status == 200) {
    const importMapJson = await importMapResponse.json()
    importShim.addImportMap(importMapJson)
  } else {
    console.warn(
      `No import map found in this document (carrying on).
      If you have dependencies, you'll see that they can't be loaded in a moment.`
    )
  }

  // Next, import the module (hosted out of the service worker)
  console.log("Importing...")

  // this path relies on knowing how the serviceWorker works & how the import maps are created
  // there's probably a better way to model this
  const packageJsonPath = `./automerge-repo/${appUrl}/package.json`
  const packageJsonResponse = await fetch(packageJsonPath)

  let entryFile = "index.js"
  if (importMapResponse.status == 200) {
    const packageJsonJson = await packageJsonResponse.json()
    if (packageJsonJson?.module) {
      entryFile = packageJsonJson.module
    }
    if (!packageJsonJson.module) {
      console.warn(`package.json without "module": defaulting to index.js`, packageJsonJson)
    }
  } else {
    console.warn(`No package.json found in this document (carrying on).`)
  }

  const modulePath = `./automerge-repo/${appUrl}/fileContents/${entryFile}`
  const moduleUrl = new URL(modulePath, window.location).toString()
  const rootModule = await importShim(moduleUrl)
  console.log("Module imported:", rootModule)

  // and now (at last) we can mount the module, passing in the URL params.
  if (!rootModule.mount) {
    console.error("Root module doesn't export a mount function", rootModule)
  }

  const urlParams = new URLSearchParams(window.location.search)
  const params = Object.fromEntries(urlParams.entries())
  rootModule.mount(document.getElementById("root"), params)
}

await navigator.serviceWorker.ready
bootstrapApplication()
