import {
  Repo,
  initializeWasm,
  isValidAutomergeUrl,
  IndexedDBStorageAdapter,
  WebSocketClientAdapter,
  MessageChannelNetworkAdapter
} from "https://esm.sh/@automerge/vanillajs@2.0.0-beta.6/slim?bundle-deps"

// Put the library on the global scope so it can be used in the console
import * as AutomergeRepo from "https://esm.sh/@automerge/vanillajs@2.0.0-beta.6/slim?bundle-deps"
self.AutomergeRepo = AutomergeRepo

const CACHE_NAME = "v6"

async function initializeRepo() {
  await initializeWasm(fetch("https://esm.sh/@automerge/automerge@2.2.9/dist/automerge.wasm"))

  console.log("Creating repo")
  const repo = new Repo({
    storage: new IndexedDBStorageAdapter(),
    network: [new WebSocketClientAdapter("wss://sync3.automerge.org")],
    peerId: "service-worker-" + Math.round(Math.random() * 1000000),
    sharePolicy: async (peerId) => peerId.includes("storage-server"),
  })

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

  // Special case for expected web server behavior
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

  if (isValidAutomergeUrl(target)) {
    await repoPromise // todo: ugh
    target = (await repo.find(target)).doc()
  }

  return target
}

const targetToResponse = async (target) => {
  if (target.mimeType) {
    return new Response(target.content, {
      headers: { "Content-Type": target.mimeType },
    })
  }

  // legacy format here; can be retired in a future version
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
