# Notes on Trail-Runner module architecture

 * modules authored in-application need to notice their dependencies & set them in a map for resolution
 * to resolve the dependencies, we'll use a little form interface that allows the developer to 
  * choose a registry (npm/native)
  * specify a version range (this might be weird/interesting for native)
 * this interface will have a "resolve" button that will create a local importMap for this module
 * [IDEALLY] we would compose these importMaps at app boot time to determine the optimum mapping with deduplication... 
   * and... again as new modules arrive during runtime?
   * guy, what's the optimum workflow here?
 * [FOR NOW] if a module has an importMap, before module loading, we will manually call addImportMap(doc.importMap)
   * (would this be a good hook somewhere?)
  
  interface TextDoc {
    contentType: "application/javascript" | "application/json"
    text: string
  }


## Package Caching Strategy
* We can't (and won't try) to cache all of NPM.
* [FOR NOW] we'll just use npm's version resolver; if you're offline, you can't add npm packages
* [?] at what point should we download & cache 
* cached packages will look like the PackageDoc below 
* [IDEALLY] npm packages would be pinned to a version by a commit hash in the document


export interface PackageConfig {
  registry?: string;
  name?: string;
  version?: string;
  main?: string;
  files?: string[];
  module?: string;
  browser?: string | Record<string, string | false>;
  imports?: Record<string, ExportsTarget>;
  exports?: ExportsTarget | Record<string, ExportsTarget>;
  type?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PackageDoc extends PackageConfig {
  FileContents: Map<path, TextDoc>
  ImportMap?: Map<packageName, Url>
}

  automerge->npm module caching approach
  ---
  
function cachePackage(config: PackageConfig) {
  // first, fetch all the file contents: let's not save a partial module
  const fileContents = {}
  await config.files.forEach( path => {
    const response = fetch(/* resolvedUrl to file*/)
    fileContents[path] = { contentType: res.headers["ContentType"], contents: response.text } // WASM / binary data?
  })
  // if anything fails here, we do indeed want to abort. we're trusting JSPM's files list.

  const handle = repo.create<PackageDoc>()
  // assign the doc 
  handle.change( doc => {
    Object.entries(config).forEach(([k,v]) => doc.k = v)
    doc.fileContents = fileContents
  })
  // now cache each file
  
}