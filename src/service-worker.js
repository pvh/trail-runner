import * as AR from "https://esm.sh/@automerge/automerge-repo@2.0.0-alpha.14/slim?bundle-deps"
import { IndexedDBStorageAdapter } from "https://esm.sh/@automerge/automerge-repo-storage-indexeddb@2.0.0-alpha.14?bundle-deps"
import { BrowserWebSocketClientAdapter } from "https://esm.sh/@automerge/automerge-repo-network-websocket@2.0.0-alpha.14?bundle-deps"
import { MessageChannelNetworkAdapter } from "https://esm.sh/@automerge/automerge-repo-network-messagechannel@2.0.0-alpha.14?bundle-deps"

const CACHE_NAME = "v6"

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
const repoPromise = initializeRepo()
repoPromise.then((r) => {
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

const determinePath = (url) => {
  const serviceWorkerPath = self.location.pathname // Path where the SW is registered
  const registrationScope = serviceWorkerPath.split("/").slice(0, -1).join("/") + "/" // Base scope

  const requestPath = new URL(url).pathname

  // Get the path relative to the service worker's registration scope
  const relativePath = requestPath.startsWith(registrationScope)
    ? requestPath.slice(registrationScope.length)
    : requestPath

  // Special case for expected web serer behavior
  const candidatePath = relativePath.split("/")
  if (candidatePath[candidatePath.length - 1] === "") {
    candidatePath[candidatePath.length - 1] = "index.html"
  }

  return candidatePath
}

const descendPathStep = (context, pathStep) => {
  let target = context?.docs?.find((doc) => doc.name === pathStep)?.url

  if (!target) {
    target = context?.[pathStep]
  }

  return target
}

const AT_DOMAIN_NAME_REGEX =
  /^\@(((?!-))(xn--|_)?[a-z0-9-]{0,61}[a-z0-9]{1,1}\.)*(xn--)?([a-z0-9][a-z0-9\-]{0,60}|[a-z0-9-]{1,30}\.[a-z]{2,})$/
function apparentDNSTXTRecord(domain) {
  return typeof domain == "string" && domain.match(AT_DOMAIN_NAME_REGEX)
}

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

async function resolveDNSTXTRecord(domain) {
  const txtRecords = await fetchDNSTXTRecords(`_automerge.${domain.slice(1)}`)
  for (const record of txtRecords) {
    if (record.startsWith("automerge:")) {
      return record // Extract URL inside quotes
    }
  }
  return domain // No valid automergeURL found
}

const resolveTarget = async (target) => {
  if (apparentDNSTXTRecord(target)) {
    target = await resolveDNSTXTRecord(target)
  }

  if (AR.isValidAutomergeUrl(target)) {
    await repoPromise // todo: ugh
    target = await repo.find(target).doc()
  }

  return target
}

const targetToResponse = async (target) => {
  if (target?.content?.type === "link") {
    // we need to handle fetching this from behind the scenes to maintain the path
    const response = await fetch(target.content.url)
    // return a response that makes this feel like it came from the same origin but works for html, pngs, etc
    return new Response(response.body, {
      headers: { "Content-Type": response.headers.get("Content-Type") },
    })
  } else if (target?.content) {
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
    }[target.type]

    return new Response(target.content.value, {
      headers: { "Content-Type": mimeType },
    })
  }

  if (target.contentType) {
    return new Response(target.contents, {
      headers: { "Content-Type": target.contentType },
    })
  }

  if (typeof target === "string") {
    return new Response(target, {
      headers: { "Content-Type": "text/plain" },
    })
  }

  return new Response(JSON.stringify(target), {
    headers: { "Content-Type": "application/json" },
  })
}

self.addEventListener("fetch", async (event) => {
  const url = new URL(event.request.url)

  if (url.origin === location.origin) {
    event.respondWith(
      (async () => {
        let [target, ...path] = determinePath(url)
        path = path || []

        target = resolveTarget(target)

        for (const pathStep of path) {
          target = await descendPathStep(await target, pathStep)
          target = await resolveTarget(await target)
          if (!target) {
            break
          }
        }

        // unwrap the promise at the end
        target = await target

        if (!target) {
          return new Response(`The path couldn't be resolved to a valid document.`, {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          })
        }

        return targetToResponse(target)
      })()
    )
  }
})
