const AUTOMERGE_REGISTRY_PREFIX = "https://automerge-registry.ca/"

function parseUrl(url) {
  try {
    return new URL(url)
  } catch (e) {
    return null
  }
}

// I should set up a guard to make sure we don't use the jspmProvider until
// we're prepared to actually resolve packages via this fetch.
export function installFetch(myRegistryDocHandle) {
  myRegistryDocHandle = myRegistryDocHandle || this.myRegistryDocHandle

  const previousFetch = window.fetch
  const myFetch = async (url, options) => {
    try {
      if (!url.startsWith(AUTOMERGE_REGISTRY_PREFIX)) {
        return previousFetch(url, options)
      }

      const parsedUrl = parseUrl(url)
      const REPO_PATH_REGEX = /^\/(?<name>.+)@(?<version>[^/]*)\/(?<fileName>.*)$/
      let { name, version, layer, fileName } = parsedUrl.pathname.match(REPO_PATH_REGEX).groups

      const registry = await myRegistryDocHandle.doc()
      const packageDocumentUrl = registry.packages[name][version]

      console.log({ name, version, packageDocumentUrl })

      const packageHandle = repo.find(packageDocumentUrl)
      const pkg = await packageHandle.doc()

      console.log({ pkg, fileName })
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
