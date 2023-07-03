import { Generator } from "@jspm/generator"

import { Repo } from "@automerge/automerge-repo"
import { LocalForageStorageAdapter } from "@automerge/automerge-repo-storage-localforage"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"

// Step one: Set up an automerge-repo.
const repo = new Repo({
  storage: new LocalForageStorageAdapter(),
  network: [new BrowserWebSocketClientAdapter("wss://sync.inkandswitch.com")],
})
window.repo = repo // put it on the window to reach it from the fetch command elsewhere (hack)
console.log("repo loaded", repo)

// Step two: load a document from the repo.
//const handle = repo.find("043862bd-12e1-4b22-87d2-fc9fc7fe4ed1")
const handle = repo.find("3cd7c303-1c97-4552-a099-f43d151b6534")
const value = await handle.value()
console.log("document loaded")

// (I had trouble using a more protocol-ey prefix, so this is a hack for now.)
const automergePrefix = "https://faux-automerge.com/"

// Check the document hash for "shouldRebuild" and if it's there, rebuild the import map.
const currentUrl = new URL(window.location.href)
const shouldRebuild = currentUrl.searchParams.get("shouldRebuild") !== null

if (!value.importMap || shouldRebuild) {
  console.log("Creating new importMap from", value.importMap)
  const generator = new Generator({
    importMap: value.importMap,
    env: ["production", "browser", "module"], // production saved us from a hack
  })
  await generator.link("./app.js")
  const map = generator.getMap()
  console.log("map", map)

  if (map.imports) {
    for (const [key, value] of Object.entries(map.imports)) {
      if (value.startsWith(automergePrefix)) {
        console.log("Skipping automerge import", key, value)
      }
      if (value.startsWith("https://ga.jspm.io/npm:")) {
        const code = await (await fetch(value)).text()
        const textHandle = repo.create()
        textHandle.change((d) => {
          d.text = code
        })

        map.imports[key] = automergePrefix + textHandle.documentId
        console.log("Replaced import", key, value, "with", map.imports[key])
      }
    }
  }

  if (!map.imports) {
    map.imports = {}
  }

  const scopes = map.scopes
  for (const scope in scopes) {
    console.log("remapping", scope)
    if (scope === automergePrefix) {
      continue
    }
    for (const [key, value] of Object.entries(map.scopes[scope])) {
      if (value.startsWith(automergePrefix)) {
        console.log("Skipping automerge import", key, value)
      }
      if (value.startsWith("https://ga.jspm.io/npm:")) {
        const code = await (await fetch(value)).text()
        const textHandle = repo.create()
        textHandle.change((d) => {
          d.text = code
        })

        map.imports[key] = automergePrefix + textHandle.documentId
        console.log("Replaced import", key, value, "with", map.imports[key])
      }
    }
    delete map.scopes[scope]
  }
  console.log("after rewrite", map)

  handle.change((d) => {
    console.log("Result", map)
    d.importMap = map
  })
} else {
  console.log("found ", value.importMap)
}

try {
  const R = await import("react")
  console.log("should not have, but managed to import", R)
} catch (e) {
  console.log("All is well: we shouldn't be able to load React yet.")
}

console.log("Now we add the import map found in the automerge doc.")
importShim.addImportMap(handle.doc.importMap)
