import { Provider } from "@jspm/generator"

// local provider

// providers are multi-registry because providers are not registries
// providerOwnsUrl??

// resolveLatestTarget("name", "range", "unstable", "layer", "parentUrl")
pkgToUrl()

// registry: npm, do the npm thing, if it's our thing, do our thing

new Generator({})

const registryDoc = {
  react: [],
}

const generator = new Generator({
  defaultProvider: "custom",
  customProviders: {
    custom: {
      pkgToUrl({ registry, name, version }) {
        return `${unpkgUrl}${name}@${version}/`
      },
      parseUrlPkg(url) {
        if (url.startsWith(unpkgUrl)) {
          const [, name, version] = url.slice(unpkgUrl.length).match(exactPkgRegEx) || []
          return { registry: "npm", name, version }
        }
      },
      resolveLatestTarget({ registry, name, range }, unstable, layer, parentUrl) {
        return { registry, name, version: "3.6.0" }
      },
    },
  },
})
