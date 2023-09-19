import { Repo } from "@automerge/automerge-repo"
import * as Automerge from "@automerge/automerge"
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel"
import { installFetch } from "./fetcher.js"

import MySharedWorker from "./shared-worker.js?sharedworker"

const PRECOOKED_REGISTRY_DOC_URL = "automerge:LFmNSGzPyPkkcnrvimyAGWDWHkM"
const PRECOOKED_BOOTSTRAP_DOC_URL = "automerge:283ncrGdGXGECsrzLT6pznGM8BZd"

// Step one: Set up an automerge-repo.
async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.register(
        "/service-worker.js" // TODO: path fix
      )
    } catch (error) {
      console.error(`sw: Registration failed with ${error}`)
    }
  }
}

function registerSharedWorker() {
  let worker = MySharedWorker()
  return worker
}

async function introduceWorkers(sharedWorker) {
  const reg = await navigator.serviceWorker.ready
  if (!reg.active) {
    throw new Error("ServiceWorker not loaded.")
  }
  /* introduce the SharedWorker and the ServiceWorker. */
  console.log("ServiceWorker is ready.")
  const channel = new MessageChannel()
  reg.active.postMessage({ sharedWorkerPort: channel.port1 }, [channel.port1])
  sharedWorker.port.postMessage({ serviceWorkerPort: channel.port2 }, [channel.port2])
  console.log("Introduced shared & service worker to one another.")
}

function setupSharedWorkerAndRepo() {
  const repoNetworkChannel = new MessageChannel()
  sharedWorker.port.postMessage({ repoNetworkPort: repoNetworkChannel.port2 }, [
    repoNetworkChannel.port2,
  ])
  const repo = new Repo({
    network: [new MessageChannelNetworkAdapter(repoNetworkChannel.port1)],
    sharePolicy: async (peerId) => peerId.includes("shared-worker"),
  })
  return repo
}

registerServiceWorker()
const sharedWorker = registerSharedWorker()

introduceWorkers(sharedWorker)
const repo = setupSharedWorkerAndRepo()

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
// const { generateInitialImportMap } = await import("./bootstrap-importmap.js")
// await generateInitialImportMap(repo, registryDocHandle, bootstrapDocHandle)
console.log(await bootstrapDocHandle.doc())
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
