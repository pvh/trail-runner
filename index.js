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
const rootHandle = repo.find("3cd7c303-1c97-4552-a099-f43d151b6534")
const rootDoc = await rootHandle.value()
console.log("document loaded", JSON.parse(JSON.stringify(rootDoc.contentTypes)))

const automergePrefix = "https://faux-automerge.com/"

const currentUrl = new URL(window.location.href)
const documentId = currentUrl.searchParams.get("documentId")
const viewType = currentUrl.searchParams.get("view")

console.log({ viewType, documentId })

const generator = new Generator({
  // currently we need production mode so all dependencies get bundled into a single esm module
  // todo: fix that modules with sub imports can also be loaded
  env: ["production", "browser", "module"],
})

for (const contentTypeId of rootDoc.contentTypes) {
  console.log("link", contentTypeId)

  const contentTypeDoc = await repo.find(contentTypeId).value()

  for (const [name, version] of Object.entries(contentTypeDoc.dependencies)) {
    console.log("install", name, version)
    await generator.install(`${name}@${version}`)
  }
}

const importMap = generator.getMap()

importShim.addImportMap(importMap)

// bootstrap logic
// todo: extract

const CONTENT_TYPES = {}

for (const contentTypeId of rootDoc.contentTypes) {
  // add random parameter, otherwise we get cached results
  // this probably should be fixed by setting proper caching headers in the fetch shim
  const module = await import(`${automergePrefix}${contentTypeId}?rand=${Math.random()}`)

  if (module.contentType) {
    CONTENT_TYPES[module.contentType.type] = module.contentType
  }
}

const { RepoContext } = await import("@automerge/automerge-repo-react-hooks")
const React = await import("react")
const { createRoot } = await import("react-dom")

document.body.innerHTML = '<div id="app"></div>'

// Render your React component instead
const root = createRoot(document.getElementById("app"))

console.log("root", root)

const contentType = CONTENT_TYPES[viewType]

console.log(CONTENT_TYPES)

if (documentId && contentType && contentType.view) {
  console.log("render", contentType.view)

  root.render(
    React.createElement(
      RepoContext.Provider,
      { value: repo },
      React.createElement(contentType.view, { documentId })
    )
  )
}

/*


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


 */
