// local provider
// registry: npm, do the npm thing, if it's our thing, do our thing
export class AutomergeRegistry {
  automergeRepo
  myRegistryDocHandle
  constructor(automergeRepo, myRegistryDocHandle) {
    this.automergeRepo = automergeRepo
    this.myRegistryDocHandle = myRegistryDocHandle
  }

  // could add a force flag to re-cache packages
  async cachePackage(packageBase, config) {
    const { name, version, files } = config
    if (!name) throw new Error("no name in package config")
    if (!version) throw new Error("no version in package config")
    if (!files) throw new Error("no files in package config")

    const value = await this.myRegistryDocHandle.value()
    if (value.packages[name] && value.packages[name][version]) {
      console.log("already have this package", name, version)
      return
    }

    console.log("fetching package", name, version)
    const pkg = await this.fetchPackage(packageBase, config)
    console.log("fetched package", name, version)

    this.myRegistryDocHandle.change((doc) => {
      if (!doc.packages[name]) {
        doc.packages[name] = {}
      }
      doc.packages[name][version] = "automerge:" + handle.documentId
    })
    console.log("registered package", name, version, handle.documentId)
  }

  async fetchPackage(packageBase, config) {
    const { name, version, files } = config

    // first, fetch all the file contents: let's not save a partial module
    const fileContents = {}
    await Promise.all(
      files.map(async (path) => {
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

    console.log("cached package", name, version, handle.documentId, handle.doc)
    return handle
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
