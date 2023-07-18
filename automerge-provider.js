/** 
 * AutomergeRegistry

 A package manager and caching system for NPM packages that stores the results in an Automerge document.

To load the registry:
    const registry = new AutomergeRegistry(repo, registryDocHandle))

To USE cached packages:

const generator = new Generator({
  defaultProvider: "automerge",
  customProviders: {
    automerge: registry.jspmProvider(),
  },
})

To update the cache:

registry.update()

*/

// TODO: support different registries: we should separate native from npm
// should these be separate docs?
// TODO: support layers
import { Generator } from "@jspm/generator"
import { SemverRange } from "sver"

const AUTOMERGE_REGISTRY_PREFIX = "https://automerge-registry.ca/"
export class AutomergeRegistry {
  automergeRepo
  myRegistryDocHandle
  constructor(automergeRepo, myRegistryDocHandle) {
    this.automergeRepo = automergeRepo
    this.myRegistryDocHandle = myRegistryDocHandle
  }

  async update(pkgName) {
    const cachingGenerator = new Generator({
      resolutions: {
        // "@automerge/automerge-wasm": "./web/",
        [pkgName]: `https://automerge-registry.ca/${pkgName}@0.0.1/`,
        "@trail-runner/list-item": `https://automerge-registry.ca/@trail-runner/list-item@0.0.1/`,
        "@trail-runner/content-type-editor": `https://automerge-registry.ca/@trail-runner/content-type-editor@0.0.1/`,
        "@trail-runner/content-type-raw": `https://automerge-registry.ca/@trail-runner/content-type-raw@0.0.1/`,
      },
    })
    await cachingGenerator.link(pkgName)
    console.log("prepared packages", cachingGenerator.getMap())
    await this.cacheImportMap(cachingGenerator.getMap(), cachingGenerator.traceMap.resolver)
  }

  async cacheImportMap(importMap, resolver) {
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

    this.linkPackage(name, version, pkg.documentId)
  }

  linkPackage(name, version, documentId) {
    const packageUrl = "automerge:" + documentId
    this.myRegistryDocHandle.change((doc) => {
      if (!doc.packages[name]) {
        doc.packages[name] = {}
      }
      if (doc.packages[name][version] !== packageUrl) {
        doc.packages[name][version] = packageUrl
      }
    })
    console.log("registered package", name, version, documentId)
  }

  async findLinkedNames(documentId) {
    const linkedNames = []

    const registryDoc = await this.myRegistryDocHandle.value()
    for (const [name, versions] of Object.entries(registryDoc.packages)) {
      // documentIds in registry are prefixed with "automerge:"
      for (const [version, prefixedDocumentId] of Object.entries(versions)) {
        if (prefixedDocumentId.endsWith(documentId)) {
          linkedNames.push({ version, name })
        }
      }
    }

    return linkedNames
  }

  async fetchPackage(packageBase, config) {
    const { name, version, files } = config
    // Note: the canonicalization of `files` comes from
    //       JSPM during their package build & cache process.

    // first, fetch all the file contents: let's not save a partial module
    const fileContents = {}
    await Promise.all(
      files.map(async (path) => {
        // We should use a throttled fetch as seen in es-module-shims; guy open to some kind of PR (discuss later)
        // upstream this bit to JSPM
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
        let sver = range.bestMatch(versions, stable)
        if (!sver) {
          sver = new SemverRange("*").bestMatch(versions, stable)
          if (!sver) {
            console.log(
              `${name}: Could not satisfy range ${range.toString()} among ${versions}, giving up!`
            )
            return null
          }
          console.log(
            `${name}: Could not satisfy range ${range.toString()} among ${versions}, falling back to ${sver.toString()}`
          )
        }
        const version = sver.toString()
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
          /^https:\/\/automerge-registry.ca\/(?<name>.*)@(?<version>[^\/]*)\/(?<subpath>.*)$/
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

        let response

        // I should remove this special case
        if (fileName === "package.json") {
          response = new Response(JSON.stringify(packageJson), {
            headers: {
              "Content-Type": "application/json",
            },
          })
          Object.defineProperty(response, "url", { value: url })
          return response
        }

        if (fileName === "index.js") {
          // Uhhhh, guy, is ths right? this seems wrong.
          fileName = packageJson["module"] || packageJson["main"] || "index.js"
          fileName = fileName.replace(/^\.\//, "") // or main?
          // zeit/ms has a package.json with "main": "./index"
          if (fileName === "index") {
            fileName = "index.js"
          }
        }

        if (!fileContents[fileName]) {
          response = new Response("not found", { status: 404 })
          Object.defineProperty(response, "url", { value: url })
          return response
        } else {
          const file = fileContents[fileName]
          response = new Response(file.contents, {
            headers: {
              "Content-Type": file.contentType,
            },
          })
          Object.defineProperty(response, "url", { value: url })
          return response
        }

        throw new Error("unreachable!")
      } catch (e) {
        console.error("my fetch failed", url, e)
        throw e
      }
    }
    window.fetch = myFetch
  }
}
