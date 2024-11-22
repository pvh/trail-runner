import * as AR from "https://esm.sh/@automerge/automerge-repo@2.0.0-alpha.14/slim?bundle-deps"
import { IndexedDBStorageAdapter } from "https://esm.sh/@automerge/automerge-repo-storage-indexeddb@2.0.0-alpha.14?bundle-deps"
import { BrowserWebSocketClientAdapter } from "https://esm.sh/@automerge/automerge-repo-network-websocket@2.0.0-alpha.14?bundle-deps"
import { MessageChannelNetworkAdapter } from "https://esm.sh/@automerge/automerge-repo-network-messagechannel@2.0.0-alpha.14?bundle-deps"

const CACHE_NAME = "v6"

async function fetchDNSTXTRecords(domain) {
  const response = await fetch(`https://dns.google/resolve?name=${domain}&type=TXT`)
  const data = await response.json()
  if (data.Answer) {
    return data.Answer.map((answer) => answer.data)
  } else {
    console.log("No TXT records found:", data.Comment)
    return []
  }
}

async function resolveDomain(domain) {
  const txtRecords = await fetchDNSTXTRecords(`_automerge.${domain}`)
  for (const record of txtRecords) {
    if (record.startsWith("automerge:")) {
      return record // Extract URL inside quotes
    }
  }
  return null // No valid automergeURL found
}

function getBasePath() {
  const serviceWorkerPath = self.location.pathname
  return serviceWorkerPath.split("/").slice(0, -1).join("/") // Remove the filename
}

async function initializeRepo() {
  await AR.initializeWasm(fetch("https://esm.sh/@automerge/automerge@2.2.8/dist/automerge.wasm"))

  console.log("Creating repo")
  const repo = new AR.Repo({
    storage: new IndexedDBStorageAdapter(),
    network: [new BrowserWebSocketClientAdapter("wss://sync.automerge.org")],
    peerId: "service-worker-" + Math.round(Math.random() * 1000000),
    sharePolicy: async (peerId) => peerId.includes("storage-server"),
  })

  self.AR = AR
  self.repo = repo

  return repo
}

console.log("Before registration")
const repo = initializeRepo()

repo.then((r) => {
  self.repo = r
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

self.addEventListener("install", (event) => {
  console.log("Installing SW")
  self.skipWaiting()
})

self.addEventListener("message", async (event) => {
  console.log("Client messaged", event.data)
  if (event.data && event.data.type === "INIT_PORT") {
    const clientPort = event.ports[0]
    ;(await repo).networkSubsystem.addNetworkAdapter(
      new MessageChannelNetworkAdapter(clientPort, { useWeakRef: true })
    )
  }
})

function addSyncServer(url) {
  repo.then((repo) =>
    repo.networkSubsystem.addNetworkAdapter(new BrowserWebSocketClientAdapter(url))
  )
}
self.addSyncServer = addSyncServer

self.addEventListener("activate", async (event) => {
  console.log("Activating service worker.")
  await clearOldCaches()
  clients.claim()
})

self.addEventListener("fetch", async (event) => {
  const url = new URL(event.request.url)

  if (url.origin === location.origin) {
    event.respondWith(
      (async () => {
        const serviceWorkerPath = self.location.pathname // Path where the SW is registered
        const registrationScope = serviceWorkerPath.split("/").slice(0, -1).join("/") + "/" // Base scope

        const requestPath = new URL(event.request.url).pathname

        // Get the path relative to the service worker's registration scope
        const relativePath = requestPath.startsWith(registrationScope)
          ? requestPath.slice(registrationScope.length)
          : requestPath

        console.log("Service Worker Scope:", registrationScope)
        console.log("Request Path:", requestPath)
        console.log("Relative Path:", relativePath)

        let [docUrl, ...path] = relativePath.split("/")
        console.log(docUrl, path)
        docUrl = docUrl.match(/^automerge:/) ? docUrl : await resolveDomain(docUrl)

        if (!AR.isValidAutomergeUrl(docUrl)) {
          return new Response(`Invalid Automerge URL and no TXT record found for\n${docUrl}`, {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          })
        }

        const handle = (await repo).find(docUrl)
        await handle.whenReady()
        const doc = await handle.doc()

        if (!doc) {
          return new Response(`Document unavailable.\n${docUrl}: ${handle.state}`, {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          })
        }

        let subTree = await path.reduce(async (acc, curr) => {
          let current = await acc

          // Try to resolve within `docs` if it exists
          let target = current?.docs?.find((doc) => doc.name === curr)

          // Fall back to a direct property if `docs` resolution failed
          if (!target) {
            target = current?.[curr]
          }

          // If the target is an Automerge URL, resolve it
          if (AR.isValidAutomergeUrl(target?.url || target)) {
            target = await (await repo).find(target?.url || target).doc()
          }

          return target
        }, doc)

        if (!subTree) {
          return new Response(`Not found\nObject path: ${path}\n${JSON.stringify(doc, null, 2)}`, {
            status: 404,
            headers: { "Content-Type": "text/plain" },
          })
        }

        /* More Jacquard compatibility silliness */
        /* We want to return the contents of this as a response:
        {
          "content": {
            "type": "link",
            "url": "https://storage.googleapis.com/jacquard/8bbb766aa7309f465ff15398a03885c03527e83ec5b3716a33985e23d4584783"
          },
          "name": "index.html",
          "type": "html"
        }
        */
        if (subTree?.content?.type === "link") {
          // we need to handle fetching this from behind the scenes to maintain the path
          const response = await fetch(subTree.content.url)
          // return a response that makes this feel like it came from the same origin but works for html, pngs, etc
          return new Response(response.body, {
            headers: { "Content-Type": response.headers.get("Content-Type") },
          })
        } else if (subTree?.content) {
          /*
          {
            "content": {
              "type": "text",
              "value": "Hello world..."
            },
            "name": "react-CHdo91hT.svg",
            "type": "svg"
          }
          */
          // the mimetype isn't actually here so we need to guess it based on the type field
          const mimeType = {
            svg: "image/svg+xml",
            html: "text/html",
            json: "application/json",
            js: "application/javascript",
            css: "text/css",
            md: "text/markdown",
            txt: "text/plain",
            "": "text/plain",
            png: "image/png",
            jpg: "image/jpeg",
          }[subTree.type]

          return new Response(subTree.content.value, {
            headers: { "Content-Type": mimeType },
          })
        }

        if (subTree.contentType) {
          return new Response(subTree.contents, {
            headers: { "Content-Type": subTree.contentType },
          })
        }

        // This doesn't work for a RawString...
        // (Sorry if you're here because of that.)
        if (typeof subTree === "string") {
          return new Response(subTree, {
            headers: { "Content-Type": "text/plain" },
          })
        }

        return new Response(JSON.stringify(subTree), {
          headers: { "Content-Type": "application/json" },
        })
      })()
    )
  }
})
