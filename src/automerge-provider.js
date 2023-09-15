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

const AUTOMERGE_REGISTRY_PREFIX = "https://automerge-registry.ca/"

export class AutomergeRegistry {
  automergeRepo
  myRegistryDocHandle
  constructor(automergeRepo, myRegistryDocHandle) {
    this.automergeRepo = automergeRepo
    this.myRegistryDocHandle = myRegistryDocHandle
  }

  async update(pkgName) {
    // TODO: These package names are here because they're not found in NPM but we want to be able to resolve them
    // This is a nasty hack but we can ignore it for a little while.
    const cachingGenerator = new Generator({
      resolutions: {
        // "@automerge/automerge-wasm": "./web/",
        [pkgName]: `https://automerge-registry.ca/${pkgName}@0.0.1/`,
        "@trail-runner/list-item": `https://automerge-registry.ca/@trail-runner/list-item@0.0.1/`,
        "@trail-runner/content-type-editor": `https://automerge-registry.ca/@trail-runner/content-type-editor@0.0.1/`,
        "@trail-runner/content-type-raw": `https://automerge-registry.ca/@trail-runner/content-type-raw@0.0.1/`,
        "@trail-runner/git-client": `https://automerge-registry.ca/@trail-runner/git-client@0.0.1/`,
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
    if (importMap.scopes) {
      const results = Object.values(importMap.scopes).map(async (scope) => {
        await Promise.all(
          Object.values(scope).map(async (packageEntryPoint) => {
            const packageBase = await resolver.getPackageBase(packageEntryPoint)
            return this.cachePackage(packageBase, await resolver.getPackageConfig(packageBase))
          })
        )
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
}
