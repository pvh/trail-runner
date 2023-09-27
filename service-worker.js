import * as amWasm from "@automerge/automerge-wasm"
import { Repo } from "@automerge/automerge-repo"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"

const PRECOOKED_REGISTRY_DOC_URL = "automerge:LFmNSGzPyPkkcnrvimyAGWDWHkM"

const CACHE_NAME = "v1"
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/index.js",
  "/automerge-provider.js",
  "/bootstrap-importmap.js",
  "/web/automerge_wasm_bg.wasm",
  "/web/automerge_wasm.js",
  "/web/index.js",
]

self.addEventListener("install", (event) => {
  skipWaiting()
  /*event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("Opened cache")
      return // cache.addAll(ASSETS_TO_CACHE) // TODO: figure out what to cache
    })
  )*/
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    clients.claim().then(() => {
      const cacheWhitelist = [CACHE_NAME]
      return caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheWhitelist.indexOf(cacheName) === -1) {
              return caches.delete(cacheName) // Remove old caches
            }
          })
        )
      })
    })
  )
})

self.addEventListener("fetch", async (event) => {
  const url = new URL(event.request.url)

  if (url.pathname.startsWith("/automerge-repo")) {
    event.respondWith(
      (async () => {
        const url = new URL(event.request.url)
        let [_, docUrl, ...path] = url.pathname.split("/").slice(1)

        const handle = repo.find(docUrl)
        const doc = await handle.doc()

        if (path[0] === "package.json") {
          return new Response(JSON.stringify(doc))
        }

        // TODO: this is not the best plan we think --
        // use actual subtrees as implied by the design below
        path = ["fileContents", path.join("/")]
        const subTree = path.reduce((acc, curr) => acc[curr], doc)

        if (!subTree) {
          return new Response(
            `Not found\n${path}\n${JSON.stringify(Object.keys(doc.fileContents))}`,
            {
              status: 404,
              headers: { "Content-Type": "text/plain" },
            }
          )
        }

        if (subTree.contentType) {
          return new Response(subTree.contents, {
            headers: { "Content-Type": subTree.contentType },
          })
        }

        return new Response(`WHAT DO I DO????\n${path}\n${JSON.stringify(doc)}`, {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        })
      })()
    )
  }
})

console.log("Creating repo in SW!")
const repo = new Repo({
  storage: new IndexedDBStorageAdapter(),
  network: [new BrowserWebSocketClientAdapter("wss://sync.automerge.org")],
  peerId: "shared-worker-" + Math.round(Math.random() * 10000),
  sharePolicy: async (peerId) => peerId.includes("storage-server"),
})

console.log(amWasm)
amWasm.promise.then(() => {
  self.registryDocHandle = repo.find(PRECOOKED_REGISTRY_DOC_URL)
})

console.log("SW repo", repo)
