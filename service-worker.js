import * as AutomergeWasm from "@automerge/automerge-wasm"
import * as Automerge from "@automerge/automerge"
import { Repo, isValidAutomergeUrl } from "@automerge/automerge-repo"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel"

const PRECOOKED_REGISTRY_DOC_URL = "automerge:LFmNSGzPyPkkcnrvimyAGWDWHkM"

const CACHE_NAME = "v1"
const ASSETS_TO_CACHE = [] /*
  "/",
  "/index.html",
  "/src/index.js",
  "/src/automerge-provider.js",
  "/src/bootstrap-importmap.js",
  "/src/vendor/es-module-shims@1.8.0.js",
  "/src/vendor/es-module-shims@1.8.0.js.map",
  "/src/vendor/automerge-wasm/web/automerge_wasm_bg.wasm",
  "/src/vendor/automerge-wasm/web/automerge_wasm.js",
  "/src/vendor/automerge-wasm/web/index.js",
  "/src/vendor/automerge-wasm/package.json",
]*/

function initializeRepo() {
  const repo = new Repo({
    storage: new IndexedDBStorageAdapter(),
    network: [new BrowserWebSocketClientAdapter("wss://sync.automerge.org")],
    peerId: "service-worker-" + Math.round(Math.random() * 10000),
    sharePolicy: async (peerId) => peerId.includes("storage-server"),
  })
  return repo
}

console.log("Before registration")
self.addEventListener("install", (event) => {
  console.log("Installing SW")
  event.waitUntil(
    Promise.all([
      new Promise(async (resolve) => {
        await AutomergeWasm.promise
        Automerge.use(AutomergeWasm)
        // ah, stash it on the global. why not.
        self.repo = initializeRepo()
        console.log("Repo's up")
        resolve()
      }),
      caches.open(CACHE_NAME).then((cache) => {
        cache.addAll(ASSETS_TO_CACHE)
      }),
    ]).then(() => self.skipWaiting())
  )
})

self.addEventListener("message", (event) => {
  console.log("Client messaged", event.data)
  if (event.data && event.data.type === "INIT_PORT") {
    const clientPort = event.ports[0]
    repo.networkSubsystem.addNetworkAdapter(
      new MessageChannelNetworkAdapter(clientPort, { useWeakRef: true })
    )
  }
})

async function clearOldCaches() {
  const cacheWhitelist = [CACHE_NAME]
  const cacheNames = await caches.keys()
  const deletePromises = cacheNames.map((cacheName) => {
    if (!cacheWhitelist.includes(cacheName)) {
      return caches.delete(cacheName)
    }
  })
  await Promise.all(deletePromises)
}

self.addEventListener("activate", async (event) => {
  event.waitUntil(clearOldCaches())
})

self.addEventListener("fetch", async (event) => {
  const url = new URL(event.request.url)

  const match = url.pathname.match(new RegExp("^.*/automerge-repo/(automerge:.*)"))
  if (match) {
    event.respondWith(
      (async () => {
        let [docUrl, ...path] = match[1].split("/")

        if (!isValidAutomergeUrl(docUrl)) {
          return new Response(`Invalid Automerge URL\n${docUrl}`, {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          })
        }

        const handle = repo.find(docUrl)
        const doc = await handle.doc()

        if (!doc) {
          return new Response(`Document unavailable.\n${docUrl}`, {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          })
        }

        if (path[0] === "package.json") {
          return new Response(JSON.stringify(doc))
        }

        // TODO: this should have error handling
        const subTree = path.reduce((acc, curr) => acc?.[curr], doc)

        if (!subTree) {
          return new Response(`Not found\nObject path: ${path}\n${JSON.stringify(doc, null, 2)}`, {
            status: 404,
            headers: { "Content-Type": "text/plain" },
          })
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
