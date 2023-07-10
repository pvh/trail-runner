/** 
 * AutomergeRegistry

 A package manager and caching system for NPM packages that stores the results in an Automerge document.

To load the registry:
    const registry = new AutomergeRegistry(repo, registryDocHandle))

To USE cached packages:

const generator = new Generator({
  defaultProvider: "automerge",
  customProviders: {
    automerge: registry.jspmProvider,
  },
})

To update the cache:

const cachingGenerator = (window.generator = new Generator())
await cachingGenerator.install("codemirror", "@automerge/automerge")

registry.update(cachingGenerator.getMap(), cachingGenerator.traceMap.resolver)

*/

// TODO: support different registries: we should separate native from npm
// should these be separate docs?
// TODO: support layers

const AUTOMERGE_REGISTRY_PREFIX = "https://automerge-registry.ca/"
export class AutomergeRegistry {
  automergeRepo
  myRegistryDocHandle
  constructor(automergeRepo, myRegistryDocHandle) {
    this.automergeRepo = automergeRepo
    this.myRegistryDocHandle = myRegistryDocHandle
  }

  async update(importMap, resolver) {
    console.log("updating package registry")
    // First, direct imports
    await Promise.all(
      Object.values(importMap.imports).map(async (packageEntryPoint) => {
        const packageBase = await resolver.getPackageBase(packageEntryPoint)
        await this.cachePackage(packageBase, await resolver.getPackageConfig(packageBase))
      })
    )
    // Next, scopes

    const results = Object.values(importMap.scopes).map(async (scope) => {
      await Promise.all(
        Object.values(scope).map(async (packageEntryPoint) => {
          const packageBase = await resolver.getPackageBase(packageEntryPoint)
          return this.cachePackage(packageBase, await resolver.getPackageConfig(packageBase))
        })
      )
    })

    await Promise.all(results)

    console.log("updated package registry", this.myRegistryDocHandle.doc.packages)
    return
  }

  // could add a force flag to re-cache packages
  // TODO: eventually we'll want to enumerate dependencies here for sharing with users who don't share your registry
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
      doc.packages[name][version] = "automerge:" + pkg.documentId
    })
    console.log("registered package", name, version, pkg.documentId)
  }

  async fetchPackage(packageBase, config) {
    const { name, version, files } = config
    // Note: the canonicalization of `files` comes from
    //       JSPM during their package build & cache process.

    // first, fetch all the file contents: let's not save a partial module
    const fileContents = {}
    await Promise.all(
      files.map(async (path) => {
        const res = await fetch(packageBase + path)
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

  jspmProvider() {
    return {
      // called as resolveLatestTarget.bind(generator)
      resolveLatestTarget: async (target, layer, parentUrl) => {
        const { registry, name, range, stable } = target
        if (!this.myRegistryDocHandle.doc.packages[name])
          throw new Error(`package ${name} not found in registry`)
        const versions = Object.keys(this.myRegistryDocHandle.doc.packages[name])
        const version = range.bestMatch(versions, stable).toString()
        if (!version) return null
        return { registry, name, version }
      },
      async pkgToUrl(pkg, layer) {
        const { registry, name, version } = pkg
        const url = `${AUTOMERGE_REGISTRY_PREFIX}${name}@${version}/`
        return url
      },
      parseUrlPkg(url) {
        if (!url.startsWith(AUTOMERGE_REGISTRY_PREFIX)) return null
        const regex =
          /^https:\/\/automerge-registry.ca\/(?<name>.*)@(?<version>.*)\/(?<subpath>.*)$/
        const { name, version, subpath } = url.match(regex).groups

        return { layer: "default", pkg: { registry: "automerge-registry", name, version }, subpath }
      },
      ownsUrl(url) {
        return url.startsWith(AUTOMERGE_REGISTRY_PREFIX)
      },
      /*resolveBuiltin(specifier, env) {
        throw new Error("not implemented")
        return null
      },
      async getPackageConfig(pkgUrl) {
        throw new Error("not implemented")
        return null
      },*/
      supportedLayers: ["*"], // ???
    }
  }

  // a little convenience function, since canParse isn't in standard
  #parseUrl(url) {
    try {
      return new URL(url)
    } catch (e) {
      return null
    }
  }

  // I should set up a guard to make sure we don't use the jspmProvider until
  // we're prepared to actually resolve packages via this fetch.
  installFetch() {
    const previousFetch = window.fetch
    const myFetch = async (url, options) => {
      try {
        if (!url.startsWith(AUTOMERGE_REGISTRY_PREFIX)) {
          return previousFetch(url, options)
        }

        const parsedUrl = this.#parseUrl(url)
        const REPO_PATH_REGEX = /^\/(?<name>.+)@(?<version>[^/]*)\/(?<fileName>.*)$/
        let { name, version, layer, fileName } = parsedUrl.pathname.match(REPO_PATH_REGEX).groups

        const registry = await this.myRegistryDocHandle.value()
        const packageDocumentId = registry.packages[name][version].split(":")[1]

        const packageHandle = repo.find(packageDocumentId)
        const pkg = await packageHandle.value()
        const { fileContents, ...packageJson } = pkg

        // I should remove this special case
        if (fileName === "package.json") {
          return new Response(JSON.stringify(packageJson), {
            headers: {
              "Content-Type": "application/json",
            },
          })
        }

        if (fileName === "index.js") {
          // Uhhhh, guy, is ths right? this seems wrong.
          fileName = packageJson["module"].replace(/^\.\//, "") // or main?
          console.log("special handling of index.js", fileName)
        }

        const file = fileContents[fileName]
        if (!file) {
          return new Response("not found", { status: 404 })
        }

        return new Response(file.contents, {
          headers: {
            "Content-Type": file.contentType,
          },
        })
      } catch (e) {
        console.error("my fetch failed", url, e)
        throw e
      }
    }
    window.fetch = myFetch
  }
}

/*
      // intercept requests to /repo/$documentId
      if (parsedUrl && parsedUrl.origin === origin) {
        const match = parsedUrl.pathname.match(REPO_PATH_REGEX)

        if (match) {
          const documentId = match[1]
          const fileName = match[3]
          const doc = await repo.find(documentId).value()

          switch (fileName) {
            case "package.json": {
              const packageJson = JSON.stringify({ dependencies: doc.dependencies ?? {} })
              return new Response(packageJson, {
                headers: {
                  "Content-Type": "application/json",
                },
              })
            }
            case "index.js": {
              // always prefer dist over source (we should stop using source at all)
              const code = doc.dist ?? doc.source
              return doc.dist !== undefined || doc.source !== undefined
                ? new Response(doc.dist || doc.source, {
                    headers: {
                      "Content-Type": "application/javascript",
                    },
                  })
                : new Response("Not Found", {
                    headers: {
                      "Content-Type": "text/plain",
                    },
                    status: 404,
                  })
            }
            default:
              return new Response("Not Found", {
                headers: {
                  "Content-Type": "text/plain",
                },
                status: 404,
              })
          }
        }
      }
      
}*/
