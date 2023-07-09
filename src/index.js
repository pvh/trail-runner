import { Generator } from "@jspm/generator"
import { Repo } from "@automerge/automerge-repo"
import { LocalForageStorageAdapter } from "@automerge/automerge-repo-storage-localforage"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import { AutomergeRegistry } from "./automerge-provider.js"
import { s } from "./generator-b4f53f2d.js"

// Step one: Set up an automerge-repo.
const repo = new Repo({
  storage: new LocalForageStorageAdapter(),
  network: [new BrowserWebSocketClientAdapter("wss://sync.inkandswitch.com")],
})

// put it on the window to reach it from the fetch command elsewhere (this is a hack)
window.repo = repo

function bootstrap() {
  const registryDocId = localStorage.getItem("registryUrl")
  if (!registryDocId) {
    const registryDocHandle = repo.create()
    registryDocHandle.change((doc) => {
      doc.packages = {}
    })
    localStorage.setItem("registryUrl", registryDocHandle.documentId)
    return registryDocHandle
  } else {
    const registryDocHandle = repo.find(registryDocId)
    return registryDocHandle
  }
}

const registryDocHandle = bootstrap()
await registryDocHandle.value()
const registry = (window.registry = new AutomergeRegistry(repo, registryDocHandle))

const generator = (window.generator = new Generator())
await generator.install("codemirror", "@automerge/automerge")
const iM = generator.importMap
const r = generator.traceMap.resolver

// First, imports
Promise.all(
  Object.values(iM.imports).map(async (packageEntryPoint) => {
    const packageBase = await r.getPackageBase(packageEntryPoint)
    await registry.cachePackage(packageBase, await r.getPackageConfig(packageBase))
  })
)
// Next, scopes
Promise.all(
  Object.values(iM.scopes).map(async (scope) => {
    Object.values(scope).map(async (packageEntryPoint) => {
      const packageBase = await r.getPackageBase(packageEntryPoint)
      await registry.cachePackage(packageBase, await r.getPackageConfig(packageBase))
    })
  })
)

/* 
const generator = new Generator({ env: ["production", "browser", "module"] })
await generator.install(`./repo/${BOOTSTRAP_DOC_ID}`)
importShim.addImportMap(generator.getMap())
await import(BOOTSTRAP_DOC_ID)
 */
