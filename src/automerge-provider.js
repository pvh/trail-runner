// local provider
// registry: npm, do the npm thing, if it's our thing, do our thing
export class AutomergeRegistry {
  automergeRepo
  myRegistryDocHandle
  constructor(automergeRepo, myRegistryDocHandle) {
    this.automergeRepo = automergeRepo
    this.myRegistryDocHandle = myRegistryDocHandle
  }
  async cachePackage(packageBase, config) {
    // first, fetch all the file contents: let's not save a partial module
    const fileContents = {}
    if (!config.files) throw new Error("no files in package config")
    const files = config.files
    await Promise.all(
      config.files.map(async (path) => {
        const res = await fetch(packageBase + path)
        console.log(res)
        const file = { contentType: res.headers.get("Content-Type"), contents: await res.text() }
        fileContents[path] = file // WASM / binary data?
      })
    )
    // if anything fails here, we do indeed want to abort. we're trusting JSPM's files list.
    const handle = this.automergeRepo.create()
    // assign the doc
    handle.change((doc) => {
      Object.entries(config).forEach(([k, v]) => (doc[k] = v))
      doc.fileContents = fileContents
    })
    const { name, version } = config
    if (!name || !version) {
      throw new Error("Invalid package definition. Missing name or version")
    }
    this.myRegistryDocHandle.change((doc) => {
      if (!doc.packages[name]) {
        doc.packages[name] = {}
      }
      doc.packages[name][version] = "automerge:" + handle.documentId
    })

    console.log("cached package", name, version, handle.documentId)
    console.log("package doc", handle.doc)
    return [handle, this.myRegistryDocHandle]
  }
}
const automergeProvider = {
  async resolveLatestTarget(target, layer, parentUrl) {
    return null
  },
  async pkgToUrl(pkg, layer) {
    return "/"
  },
  parseUrlPkg(url) {
    throw new Error("not implemented")
  },
  ownsUrl(url) {
    return false
  },
  resolveBuiltin(specifier, env) {
    return null
  },
  async getPackageConfig(pkgUrl) {
    return null
  },
  supportedLayers: ["*"], // ???
}
/* const generator = new Generator({
  defaultProvider: "automerge",
  customProviders: {
    automerge: automergeProvider,
  },
})
*/
