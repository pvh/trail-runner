import { getPackageConfig } from "@jspm/generator"
export const AUTOMERGE_PREFIX = "automerge://"
const exactPkgRegEx = /^([^@]+)(?:@([^\/]+))?(?:\/(.*))?$/

export class AutomergeCustomProvider {
  constructor(registryDocHandle, proxyJSPM = true) {
    this.registryDocHandle = registryDocHandle
    this.proxyJSPM = proxyJSPM
  }

  async pkgToUrl({ registry, name, version }) {
    console.log("ACP pkgToUrl", registry, name, version)
    if (registry != "automerge") return
    if (!(this.registryDocHandle.doc[name] && registryDocHandle.doc[name][version])) {
      cache(name, version)
    }
    console.log("pkgToUrl", name, version, registryDocHandle.doc[name])
    return `${AUTOMERGE_PREFIX}${name}@${version}/`
  }
  parseUrlPkg(url) {
    console.log("ACP parseUrlPkg", url)
    if (url.startsWith(AUTOMERGE_PREFIX)) {
      const match = url.slice(AUTOMERGE_PREFIX.length).match(exactPkgRegEx)
      return { registry: "automerge", name, version }
    }
  }
  resolveLatestTarget({ registry, name, range }, unstable, layer, parentUrl) {
    console.log("resolveLatestTarget", registry, name, range, unstable, layer, parentUrl)
    console.log(this)
    const jspmProvider = this.providers["jspm"]
    jspmProvider.resolveLatestTarget({ registry, name, range }, unstable, layer, parentUrl)

    // TODO: This is a hack to make it work with the current version of jspm
    const versions = Object.keys(registryDocHandle.doc[name] || {})
    let version = range.bestMatch(versions, unstable)

    if (!version) {
      return null
    }

    return { registry, name, version }
  }

  fetch(url) {
    if (url.startsWith(AUTOMERGE_PREFIX)) {
      const [, name, version, path] = url.slice(AUTOMERGE_PREFIX.length).match(exactPkgRegEx)
      const pkg = registryDocHandle.doc[name][version]
      if (!pkg) {
        throw new Error(`Could not find package ${name}@${version}`)
      }
      const response = path ? pkg.fileContents[path] : pkg.fileContents["index.js"]
      if (!response) {
        return new Response(null, { status: 404, statusText: "Not Found" })
      }
      return new Response(response.contents, {
        status: response.status,
        headers: { "content-type": response.contentType },
      })
    } else {
      // We don't return 404 because we don't want to block the rest of the resolvers from handling the request
      return null
    }
  }

  async cache(name, version) {
    const packageJson = await getPackageConfig({ registry: "jspm", name, version })
    const fileContents = Object.fromEntries(
      await Promise.all(
        packageJson.files.map(async (file) => {
          const res = await fetch(`https://ga.jspm.io/npm:${name}@${version}/${file}`)
          return [
            file,
            { contents: res.text(), contentType: res.headers.get("content-type"), status: 200 },
          ]
        })
      )
    )

    registryDocHandle.change((d) => {
      if (!d[name]) d[name] = {}
      d[name][version] = {
        ...packageJson,
        fileContents,
      }
    })
  }
}
