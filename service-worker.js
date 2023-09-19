const CACHE_NAME = "v1"
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/index.js",
  "/fetcher.js",
  "/automerge-provider.js",
  "/bootstrap-importmap.js",
  "/web/automerge_wasm_bg.wasm",
  "/web/automerge_wasm.js",
  "/web/index.js",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("Opened cache")
      return // cache.addAll(ASSETS_TO_CACHE) // TODO: figure out what to cache
    })
  )
})

self.addEventListener("fetch", (event) => {
  console.log("FETCHING", event)
  if (event.request.url.match(/automerge-doc/)) {
    serveFromAutomerge(event)
  }
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response // Return from cache
      }
      return fetch(event.request) // Fetch from network
    })
  )
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

const CACHED_BINARY_OBJECTS = {}

self.addEventListener("fetch", async function (event) {
  const url = new URL(event.request.url)

  const binaryDataUrl = url.searchParams.get("binaryDataUrl")
  if (binaryDataUrl) {
    console.log("found a binary data URL")
    event.respondWith(
      (async () => {
        let entry = CACHED_BINARY_OBJECTS[binaryDataUrl]
        if (!entry) {
          console.log(`[${binaryDataUrl}]: requesting from shared-worker`)
          entry = await loadBinaryData(binaryDataUrl)
          console.log(`[${binaryDataUrl}]: received from shared-worker`, entry)
          CACHED_BINARY_OBJECTS[binaryDataUrl] = entry
        }
        // TODO: handle case where it's not in either
        const { header, binary } = entry || {}

        console.log(`[${binaryDataUrl}]: answering`, entry)

        if (!header) {
          return new Response("Not found", {
            status: 404,
            headers: { "Content-Type": "text/plain" },
          })
        }

        return new Response(binary, {
          headers: { "Content-Type": header.mimeType },
        })
      })()
    )
  }
})

async function loadBinaryData(binaryDataUrl) {
  if (!binaryDataRequestPort) {
    throw new Error("gotta wait for that port")
  }

  console.log("loadBinaryData", binaryDataUrl)
  const promise = new Promise((resolve, reject) => {
    const replyChannel = new MessageChannel()
    binaryDataRequestPort.postMessage({ binaryDataUrl }, [replyChannel.port2])
    console.log("loadBinaryData posted", binaryDataUrl)

    replyChannel.port1.onmessage = (e) => {
      console.log("shared worker responded: ", e)
      const { mimeType, binary } = e.data
      resolve({ mimeType, binary })
    }

    // what about reject? (after timeout i guess)
  })
  return promise
}
