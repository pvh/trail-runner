/// <reference lib="webworker" />

self.addEventListener("connect", (e) => {
  console.log("client connected to shared-worker")
  var mainPort = e.ports[0]
  mainPort.onmessage = function (e) {
    const data = e.data
    if ("serviceWorkerPort" in data) {
      configureServiceWorkerPort(data.serviceWorkerPort)
    } else if ("repoNetworkPort" in data) {
      // be careful to not accidentally create a strong reference to repoNetworkPort
      // that will prevent dead ports from being garbage collected
      configureRepoNetworkPort(data.repoNetworkPort)
    }
  }
})

// Because automerge is a WASM module and loads asynchronously,
// a bug in Chrome causes the 'connect' event to fire before the
// module is loaded. This promise lets us block until the module loads
// even if the event arrives first.
// Ideally Chrome would fix this upstream but this isn't a terrible hack.
const repoPromise = (async () => {
  const { Repo } = await import("@automerge/automerge-repo")
  const { IndexedDBStorageAdapter } = await import("@automerge/automerge-repo-storage-indexeddb")
  const { BrowserWebSocketClientAdapter } = await import(
    "@automerge/automerge-repo-network-websocket"
  )
  return new Repo({
    storage: new IndexedDBStorageAdapter(),
    network: [new BrowserWebSocketClientAdapter("ws://sync.automerge.org")],
    peerId: "shared-worker-" + Math.round(Math.random() * 10000),
    sharePolicy: async (peerId) => peerId.includes("storage-server"),
  })
})()

async function configureRepoNetworkPort(port) {
  const repo = await repoPromise

  const { MessageChannelNetworkAdapter } = await import(
    "@automerge/automerge-repo-network-messagechannel"
  )
  // be careful to not accidentally create a strong reference to port
  // that will prevent dead ports from being garbage collected
  repo.networkSubsystem.addNetworkAdapter(
    new MessageChannelNetworkAdapter(port, { useWeakRef: true })
  )
}

const recieveBinaryDataRequest = (e) => {
  const message = e.data
  const { binaryDataId } = message
  const { replyPort } = e.ports[0]

  const { id } = parseBinaryDataId(binaryDataId)
  console.log(`[${id}]: shared-worker request`)
  if (!repo) {
    throw new Error("REPO NOT SETUP YET")
  }
  const handle = repo.find(id)
  handle.value().then((doc) => {
    console.log(`[${id}]: shared-worker value`, doc)
    const { mimeType, binary } = doc
    // hack for hackday
    if (!mimeType && !binary) {
      const text = doc.dist || doc.source || doc.text
      console.log("doc", doc)
      replyPort.postMessage({
        binaryDataId,
        mimeType: "text/javascript",
        binary: text,
      })
      return
    }
    var outboundBinary = new ArrayBuffer(binary.byteLength)
    new Uint8Array(outboundBinary).set(new Uint8Array(binary))
    replyPort.postMessage({ binaryDataId, mimeType, binary: outboundBinary }, [outboundBinary])
  })
  // and what if it doesn't work?
}

function configureServiceWorkerPort(port) {
  port.onmessage = recieveBinaryDataRequest
}

console.log("ran shared-worker to end")
