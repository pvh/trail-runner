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
import { next as Automerge } from "@automerge/automerge"

export class AutomergeRegistry {
  automergeRepo
  myRegistryDocHandle
  constructor(automergeRepo, myRegistryDocHandle) {
    this.automergeRepo = automergeRepo
    this.myRegistryDocHandle = myRegistryDocHandle
    window.myRegistryDocHandle = myRegistryDocHandle
  }

  async update(pkgName, pkgUrl) {
    // TODO: These package names are here because they're not found in NPM but we want to be able to resolve them
    // This is a nasty hack but we can ignore it for a little while.
    const cachingGenerator = new Generator({
      resolutions: {
        [pkgName]: `/automerge-repo/${pkgUrl}`,
        "@automerge/automerge-wasm": "./src/web", // Uhhhh
      },
    })
    console.log("before packages", cachingGenerator.getMap())
    console.log("Linking")
    await cachingGenerator.link(pkgName)
    console.log("prepared packages", cachingGenerator.getMap())
    await this.cacheImportMap(cachingGenerator.getMap(), cachingGenerator.traceMap.resolver)
  }

  async cacheImportMap(importMap, resolver) {
    console.log("updating package registry")

    const cachePackage = async (packageEntryPoint) => {
      const packageBase = await resolver.getPackageBase(packageEntryPoint)
      const packageConfig = await resolver.getPackageConfig(packageBase)
      if (packageBase && packageConfig) {
        await this.cachePackage(packageBase, packageConfig)
      } else {
        console.warn("could not cache package", packageBase, packageConfig)
      }
    }

    // First, direct imports
    await Promise.all(Object.values(importMap.imports).map(cachePackage))

    // Next, scopes
    if (importMap.scopes) {
      const results = Object.values(importMap.scopes).map(async (scope) => {
        await Promise.all(Object.values(scope).map(cachePackage))
      })
      await Promise.all(results)
    }

    console.log("updated package registry", this.myRegistryDocHandle.docSync().packages)
    return
  }

  // could add a force flag to re-cache packages
  // TODO: eventually we'll want to enumerate dependencies here for sharing with users who don't share your registry
  async cachePackage(packageBase, config) {
    const { name, version, files } = config
    if (!name) throw new Error("no name in package config")
    if (!version) throw new Error("no version in package config")
    if (!files) throw new Error("no files in package config")

    const value = await this.myRegistryDocHandle.doc()
    if (value.packages[name] && value.packages[name][version]) {
      console.log("already have this package", name, version)
      return
    }

    console.log("fetching package", name, version)
    const pkg = await this.fetchPackage(packageBase, config)
    console.log("fetched package", name, version)

    this.linkPackage(name, version, pkg.url)
  }

  linkPackage(name, version, packageUrl) {
    this.myRegistryDocHandle.change((doc) => {
      if (!doc.packages[name]) {
        doc.packages[name] = {}
      }
      if (doc.packages[name][version] !== packageUrl) {
        doc.packages[name][version] = packageUrl
      }
    })
    console.log("registered package", name, version, packageUrl)
  }

  async findLinkedNames(documentUrl) {
    const linkedNames = []

    const registryDoc = await this.myRegistryDocHandle.doc()
    for (const [name, versions] of Object.entries(registryDoc.packages)) {
      for (const [version, versionUrl] of Object.entries(versions)) {
        if (documentUrl == versionUrl) {
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
        const file = {
          contentType: res.headers.get("Content-Type"),
          contents: new Automerge.RawString(await res.text()),
        }
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

    console.log("cached package", name, version, handle.url, handle.doc)
    return handle
  }

  jspmProvider() {
    return {
      // called as resolveLatestTarget.bind(generator)
      resolveLatestTarget: async (target, layer, parentUrl) => {
        const { registry, name, range, stable } = target
        const doc = this.myRegistryDocHandle.docSync()
        if (!doc.packages[name]) throw new Error(`package ${name} not found in registry`)
        const versions = Object.keys(doc.packages[name])
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
      async pkgToUrl(pkgPromise, layer) {
        let pkg = await pkgPromise

        const registryDoc = window.myRegistryDocHandle.docSync()

        if (pkg.pkg) {
          pkg = pkg.pkg
        }
        const { registry, name, version } = pkg

        if (!name || !version) {
          console.log(pkg)
          console.log(registryDoc)
          throw new Error("pkgToUrl: missing name or version")
        }

        const docUrl = registryDoc.packages?.[name]?.[version]
        if (!docUrl) throw new Error(`package ${name} not found in registry`)

        const url = new URL(`/automerge-repo/${docUrl}/`, window.location)
        return url.toString()
      },

      parseUrlPkg(stringUrl) {
        const url = new URL(stringUrl)

        if (!url.pathname.startsWith("/automerge-repo")) return null

        const regex = /^\/automerge-repo\/(?<docUrl>[^\/]*)\/(?<subpath>.*)$/
        const { docUrl, subpath } = url.pathname.match(regex).groups

        console.log("parseUrlPkg", stringUrl)

        return new Promise((resolve, reject) => {
          repo
            .find(docUrl)
            .doc()
            .then((doc) => {
              const { name, version } = doc
              console.log("parseUrlPkg", { docUrl, name, version, subpath })

              const result = {
                layer: "default",
                pkg: { registry: "automerge-registry", name, version },
                subpath,
              }

              /*
              const result = { registry: "automerge-registry", name, version }
              console.log("parseUrlPkg RESULT", result)
              */

              resolve(result)
            })
        })
      },

      ownsUrl(stringUrl) {
        const url = new URL(stringUrl)
        return url.pathname.startsWith("/automerge-repo")
      },
      /*resolveBuiltin(specifier, env) {
        throw new Error("not implemented")
        return null
      },*/
      async getPackageConfig(pkgUrl) {
        const url = new URL(pkgUrl)
        if (!url.pathname.startsWith("/automerge-repo")) return null

        const regex = /^\/automerge-repo\/(?<docUrl>[^\/]*)\/(?<subpath>.*)$/
        const { docUrl, subpath } = url.pathname.match(regex).groups
        return new Promise((resolve, reject) => {
          repo
            .find(docUrl)
            .doc()
            .then((doc) => {
              const { fileContents, ...packageJson } = doc
              resolve(packageJson)
            })
        })
      },
      supportedLayers: ["*"], // ???
    }
  }
}
