/**
 * You shouldn't need to run this code, but we preserve it here for bootstrapping purposes.
 * This code will examine the contents of the bootstrap document and then use JSPM and the Automerge provider
 * to import all its dependencies.
 */

import { AutomergeRegistry } from "./automerge-provider.js"
import { Generator } from "@jspm/generator"

export async function generateInitialImportMap(repo, registryDocHandle, targetDocHandle) {
  const registry = new AutomergeRegistry(repo, registryDocHandle)

  const { name } = await targetDocHandle.doc()

  console.log("Building importMap for ", name)

  // To bootstrap the system from scratch, we need to make sure our initial
  // registry has the dependencies for the bootstrap program.

  // This code imports the bootstrap document and its dependencies to the registry
  registry.linkPackage(name, "0.0.1", targetDocHandle.url)
  await registry.update(name, targetDocHandle.url)

  // This code creates a reusable importMap based on the current registry you have
  // and stores it in the bootstrap document.

  const generator = new Generator({
    resolutions: {
      "@automerge/automerge-wasm": "./src/web", // Uhhhh
    },
    defaultProvider: "automerge",
    customProviders: {
      automerge: registry.jspmProvider(),
    },
  })

  console.log(name)
  await generator.install(name) // this should load the package above

  console.log("new import map", generator.getMap())

  targetDocHandle.change((doc) => {
    doc.importMap = generator.getMap()
  })
}
