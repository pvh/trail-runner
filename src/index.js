import { Generator } from "@jspm/generator"
import { Repo } from "@automerge/automerge-repo"
import { LocalForageStorageAdapter } from "@automerge/automerge-repo-storage-localforage"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import { AutomergeRegistry } from "./automerge-provider.js"

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

const cachingGenerator = (window.cachingGenerator = new Generator())
await cachingGenerator.install(["codemirror", "@automerge/automerge"])
console.log("installed packages", cachingGenerator.getMap())

const registryDocHandle = bootstrap()
await registryDocHandle.value() // block until we've loaded our registry doc
const registry = (window.registry = new AutomergeRegistry(repo, registryDocHandle))
await registry.update(cachingGenerator.getMap(), cachingGenerator.traceMap.resolver)
console.log("cached those packages", cachingGenerator.getMap())

registry.installFetch()
const generator = (window.generator = new Generator({
  importMap: importShim.importMap,
  defaultProvider: "automerge",
  customProviders: {
    automerge: registry.jspmProvider(),
  },
}))

// this one should resolve to automerge URLs found in your registry document
console.log("installing against local package listing")
await generator.install(["codemirror", "@automerge/automerge"])
console.log(generator.getMap())
importShim.addImportMap(generator.getMap())

const CodeMirror = await import("codemirror")
const Automerge = await import("@automerge/automerge")
console.log("CodeMirror", CodeMirror)
console.log("Automerge", Automerge)
console.log("Finished!")

/* 
const generator = new Generator({ env: ["production", "browser", "module"] })
await generator.install(`./repo/${BOOTSTRAP_DOC_ID}`)
importShim.addImportMap(generator.getMap())
await import(BOOTSTRAP_DOC_ID)
 */
