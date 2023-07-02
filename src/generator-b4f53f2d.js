import sver, { SemverRange as SemverRange$2, Semver as Semver$1 } from 'sver';
import convertRange from 'sver/convert-range.js';
import { fetch as fetch$1, clearCache as clearCache$1 } from '#fetch';
import { ImportMap, getScopeMatches, getMapMatch as getMapMatch$1 } from '@jspm/import-map';
import process$1 from 'process';
import { parse } from 'es-module-lexer/js';

// See: https://nodejs.org/docs/latest/api/modules.html#the-module-scope
const cjsGlobals = [
    "__dirname",
    "__filename",
    "exports",
    "module",
    "require"
];
let babel$1;
function setBabel$1(_babel) {
    babel$1 = _babel;
}
async function createCjsAnalysis(imports, source, url) {
    if (!babel$1) ({ default: babel$1  } = await import('@babel/core'));
    const requires = new Set();
    const lazy = new Set();
    const unboundGlobals = new Set();
    babel$1.transform(source, {
        ast: false,
        sourceMaps: false,
        inputSourceMap: false,
        babelrc: false,
        babelrcRoots: false,
        configFile: false,
        highlightCode: false,
        compact: false,
        sourceType: "script",
        parserOpts: {
            allowReturnOutsideFunction: true,
            // plugins: stage3Syntax,
            errorRecovery: true
        },
        plugins: [
            ({ types: t  })=>{
                return {
                    visitor: {
                        Program (path, state) {
                            state.functionDepth = 0;
                        },
                        CallExpression (path, state) {
                            if (t.isIdentifier(path.node.callee, {
                                name: "require"
                            }) || t.isIdentifier(path.node.callee.object, {
                                name: "require"
                            }) && t.isIdentifier(path.node.callee.property, {
                                name: "resolve"
                            }) || t.isMemberExpression(path.node.callee) && t.isIdentifier(path.node.callee.object, {
                                name: "module"
                            }) && t.isIdentifier(path.node.callee.property, {
                                name: "require"
                            })) {
                                const req = buildDynamicString$1(path.get("arguments.0").node, url);
                                requires.add(req);
                                if (state.functionDepth > 0) lazy.add(req);
                            }
                        },
                        ReferencedIdentifier (path) {
                            let identifierName = path.node.name;
                            if (!path.scope.hasBinding(identifierName)) {
                                unboundGlobals.add(identifierName);
                            }
                        },
                        Scope: {
                            enter (path, state) {
                                if (t.isFunction(path.scope.block)) state.functionDepth++;
                            },
                            exit (path, state) {
                                if (t.isFunction(path.scope.block)) state.functionDepth--;
                            }
                        }
                    }
                };
            }
        ]
    });
    // Check if the module actually uses any CJS-specific globals, as otherwise
    // other host runtimes like browser/deno can run this module anyway:
    let usesCjs = false;
    for (let g of cjsGlobals){
        if (unboundGlobals.has(g)) {
            usesCjs = true;
            break;
        }
    }
    return {
        deps: [
            ...requires
        ],
        dynamicDeps: imports.filter((impt)=>impt.n).map((impt)=>impt.n),
        cjsLazyDeps: [
            ...lazy
        ],
        size: source.length,
        format: "commonjs",
        usesCjs
    };
}
function buildDynamicString$1(node, fileName, isEsm = false, lastIsWildcard = false) {
    if (node.type === "StringLiteral") {
        return node.value;
    }
    if (node.type === "TemplateLiteral") {
        let str = "";
        for(let i = 0; i < node.quasis.length; i++){
            const quasiStr = node.quasis[i].value.cooked;
            if (quasiStr.length) {
                str += quasiStr;
                lastIsWildcard = false;
            }
            const nextNode = node.expressions[i];
            if (nextNode) {
                const nextStr = buildDynamicString$1(nextNode, fileName, isEsm, lastIsWildcard);
                if (nextStr.length) {
                    lastIsWildcard = nextStr.endsWith("*");
                    str += nextStr;
                }
            }
        }
        return str;
    }
    if (node.type === "BinaryExpression" && node.operator === "+") {
        const leftResolved = buildDynamicString$1(node.left, fileName, isEsm, lastIsWildcard);
        if (leftResolved.length) lastIsWildcard = leftResolved.endsWith("*");
        const rightResolved = buildDynamicString$1(node.right, fileName, isEsm, lastIsWildcard);
        return leftResolved + rightResolved;
    }
    if (node.type === "Identifier") {
        if (node.name === "__dirname") return ".";
        if (node.name === "__filename") return "./" + fileName;
    }
    // TODO: proper expression support
    // new URL('...', import.meta.url).href | new URL('...', import.meta.url).toString() | new URL('...', import.meta.url).pathname
    // import.meta.X
    /*if (isEsm && node.type === 'MemberExpression' && node.object.type === 'MetaProperty' &&
      node.object.meta.type === 'Identifier' && node.object.meta.name === 'import' &&
      node.object.property.type === 'Identifier' && node.object.property.name === 'meta') {
    if (node.property.type === 'Identifier' && node.property.name === 'url') {
      return './' + fileName;
    }
  }*/ return lastIsWildcard ? "" : "*";
}

let babel, babelPresetTs, babelPluginImportAssertions;
function setBabel(_babel, _babelPresetTs, _babelPluginImportAssertions) {
    babel = _babel, babelPresetTs = _babelPresetTs, babelPluginImportAssertions = _babelPluginImportAssertions;
}
const globalConsole = globalThis.console;
const dummyConsole = {
    log () {},
    warn () {},
    memory () {},
    assert () {},
    clear () {},
    count () {},
    countReset () {},
    debug () {},
    dir () {},
    dirxml () {},
    error () {},
    exception () {},
    group () {},
    groupCollapsed () {},
    groupEnd () {},
    info () {},
    table () {},
    time () {},
    timeEnd () {},
    timeLog () {},
    timeStamp () {},
    trace () {}
};
async function createTsAnalysis(source, url) {
    if (!babel) [{ default: babel  }, { default: { default: babelPresetTs  }  }, { default: babelPluginImportAssertions  }] = await Promise.all([
        import('@babel/core'),
        import('@babel/preset-typescript'),
        import('@babel/plugin-syntax-import-assertions')
    ]);
    const imports = new Set();
    const dynamicImports = new Set();
    let importMeta = false;
    // @ts-ignore
    globalThis.console = dummyConsole;
    try {
        babel.transform(source, {
            filename: "/" + url,
            ast: false,
            sourceMaps: false,
            inputSourceMap: false,
            babelrc: false,
            babelrcRoots: false,
            configFile: false,
            highlightCode: false,
            compact: false,
            sourceType: "module",
            parserOpts: {
                plugins: [
                    "jsx"
                ],
                errorRecovery: true
            },
            presets: [
                [
                    babelPresetTs,
                    {
                        onlyRemoveTypeImports: true
                    }
                ]
            ],
            plugins: [
                babelPluginImportAssertions,
                ({ types: t  })=>{
                    return {
                        visitor: {
                            ExportAllDeclaration (path) {
                                imports.add(path.node.source.value);
                            },
                            ExportNamedDeclaration (path) {
                                if (path.node.source) imports.add(path.node.source.value);
                            },
                            ImportDeclaration (path) {
                                imports.add(path.node.source.value);
                            },
                            Import (path) {
                                dynamicImports.add(buildDynamicString(path.parentPath.get("arguments.0").node, url, true));
                            },
                            MetaProperty (path) {
                                if (t.isIdentifier(path.node.meta, {
                                    name: "import"
                                }) && t.isIdentifier(path.node.property, {
                                    name: "meta"
                                })) {
                                    importMeta = true;
                                }
                            }
                        }
                    };
                }
            ]
        });
    } finally{
        globalThis.console = globalConsole;
    }
    return {
        deps: [
            ...imports
        ],
        dynamicDeps: [
            ...dynamicImports
        ],
        cjsLazyDeps: null,
        size: source.length,
        format: "typescript"
    };
}
function buildDynamicString(node, fileName, isEsm = false, lastIsWildcard = false) {
    if (node.type === "StringLiteral") {
        return node.value;
    }
    if (node.type === "TemplateLiteral") {
        let str = "";
        for(let i = 0; i < node.quasis.length; i++){
            const quasiStr = node.quasis[i].value.cooked;
            if (quasiStr.length) {
                str += quasiStr;
                lastIsWildcard = false;
            }
            const nextNode = node.expressions[i];
            if (nextNode) {
                const nextStr = buildDynamicString(nextNode, fileName, isEsm, lastIsWildcard);
                if (nextStr.length) {
                    lastIsWildcard = nextStr.endsWith("*");
                    str += nextStr;
                }
            }
        }
        return str;
    }
    if (node.type === "BinaryExpression" && node.operator === "+") {
        const leftResolved = buildDynamicString(node.left, fileName, isEsm, lastIsWildcard);
        if (leftResolved.length) lastIsWildcard = leftResolved.endsWith("*");
        const rightResolved = buildDynamicString(node.right, fileName, isEsm, lastIsWildcard);
        return leftResolved + rightResolved;
    }
    if (isEsm && node.type === "Identifier") {
        if (node.name === "__dirname") return ".";
        if (node.name === "__filename") return "./" + fileName;
    }
    // TODO: proper expression support
    // new URL('...', import.meta.url).href | new URL('...', import.meta.url).toString() | new URL('...', import.meta.url).pathname
    // import.meta.X
    /*if (isEsm && node.type === 'MemberExpression' && node.object.type === 'MetaProperty' &&
      node.object.meta.type === 'Identifier' && node.object.meta.name === 'import' &&
      node.object.property.type === 'Identifier' && node.object.property.name === 'meta') {
    if (node.property.type === 'Identifier' && node.property.name === 'url') {
      return './' + fileName;
    }
  }*/ return lastIsWildcard ? "" : "*";
}

class JspmError extends Error {
    constructor(msg, code){
        super(msg);
        this.jspmError = true;
        this.code = code;
    }
}
function throwInternalError(...args) {
    throw new Error("Internal Error" + (args.length ? " " + args.join(", ") : ""));
}

function isFetchProtocol(protocol) {
    return protocol === "file:" || protocol === "https:" || protocol === "http:" || protocol === "data:";
}
let baseUrl;
// @ts-ignore
if (typeof Deno !== "undefined") {
    // @ts-ignore
    const denoCwd = Deno.cwd();
    baseUrl = new URL("file://" + (denoCwd[0] === "/" ? "" : "/") + denoCwd + "/");
} else if (typeof process !== "undefined" && process.versions.node) {
    baseUrl = new URL("file://" + process.cwd() + "/");
} else if (typeof document !== "undefined") {
    baseUrl = new URL(document.baseURI);
}
if (!baseUrl && typeof location !== "undefined") {
    baseUrl = new URL(location.href);
}
baseUrl.search = baseUrl.hash = "";
function resolveUrl(url, mapUrl, rootUrl) {
    if (url.startsWith("/")) return rootUrl ? new URL("." + url.slice(url[1] === "/" ? 1 : 0), rootUrl).href : url;
    return new URL(url, mapUrl).href;
}
function importedFrom(parentUrl) {
    if (!parentUrl) return "";
    return ` imported from ${parentUrl}`;
}
function matchesRoot(url, baseUrl) {
    return url.protocol === baseUrl.protocol && url.host === baseUrl.host && url.port === baseUrl.port && url.username === baseUrl.username && url.password === baseUrl.password;
}
function relativeUrl(url, baseUrl, absolute = false) {
    const href = url.href;
    let baseUrlHref = baseUrl.href;
    if (!baseUrlHref.endsWith("/")) baseUrlHref += "/";
    if (href.startsWith(baseUrlHref)) return (absolute ? "/" : "./") + href.slice(baseUrlHref.length);
    if (!matchesRoot(url, baseUrl)) return url.href;
    if (absolute) return url.href;
    const baseUrlPath = baseUrl.pathname;
    const urlPath = url.pathname;
    const minLen = Math.min(baseUrlPath.length, urlPath.length);
    let sharedBaseIndex = -1;
    for(let i = 0; i < minLen; i++){
        if (baseUrlPath[i] !== urlPath[i]) break;
        if (urlPath[i] === "/") sharedBaseIndex = i;
    }
    return "../".repeat(baseUrlPath.slice(sharedBaseIndex + 1).split("/").length - 1) + urlPath.slice(sharedBaseIndex + 1) + url.search + url.hash;
}
function isURL(specifier) {
    try {
        if (specifier[0] === "#") return false;
        new URL(specifier);
    } catch  {
        return false;
    }
    return true;
}
function isPlain(specifier) {
    return !isRelative(specifier) && !isURL(specifier);
}
function isRelative(specifier) {
    return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

const cdnUrl$5 = "https://deno.land/x/";
const stdlibUrl = "https://deno.land/std";
let denoStdVersion;
function resolveBuiltin$1(specifier, env) {
    // Bare npm:XXX imports are supported by Deno:
    if (env.includes("deno") && specifier.startsWith("npm:")) return specifier;
    if (specifier.startsWith("deno:")) {
        let name = specifier.slice(5);
        if (name.endsWith(".ts")) name = name.slice(0, -3);
        let alias = name, subpath = ".";
        const slashIndex = name.indexOf("/");
        if (slashIndex !== -1) {
            alias = name.slice(0, slashIndex);
            subpath = `./${name.slice(slashIndex + 1)}`;
        }
        return {
            alias,
            subpath,
            target: {
                pkgTarget: {
                    registry: "deno",
                    name: "std",
                    ranges: [
                        new SemverRange$2("*")
                    ],
                    unstable: true
                },
                installSubpath: `./${slashIndex === -1 ? name : name.slice(0, slashIndex)}`
            }
        };
    }
}
async function pkgToUrl$6(pkg) {
    if (pkg.registry === "deno") return `${stdlibUrl}@${pkg.version}/`;
    if (pkg.registry === "denoland") return `${cdnUrl$5}${pkg.name}@${vCache[pkg.name] ? "v" : ""}${pkg.version}/`;
    throw new Error(`Deno provider does not support the ${pkg.registry} registry for package "${pkg.name}" - perhaps you mean to install "denoland:${pkg.name}"?`);
}
async function getPackageConfig$3(pkgUrl) {
    if (pkgUrl.startsWith("https://deno.land/std@")) {
        return {
            exports: {
                "./archive": "./archive/mod.ts",
                "./archive/*.ts": "./archive/*.ts",
                "./archive/*": "./archive/*.ts",
                "./async": "./async/mod.ts",
                "./async/*.ts": "./async/*.ts",
                "./async/*": "./async/*.ts",
                "./bytes": "./bytes/mod.ts",
                "./bytes/*.ts": "./bytes/*.ts",
                "./bytes/*": "./bytes/*.ts",
                "./collection": "./collection/mod.ts",
                "./collection/*.ts": "./collection/*.ts",
                "./collection/*": "./collection/*.ts",
                "./crypto": "./crypto/mod.ts",
                "./crypto/*.ts": "./crypto/*.ts",
                "./crypto/*": "./crypto/*.ts",
                "./datetime": "./datetime/mod.ts",
                "./datetime/*.ts": "./datetime/*.ts",
                "./datetime/*": "./datetime/*.ts",
                "./dotenv": "./dotenv/mod.ts",
                "./dotenv/*.ts": "./dotenv/*.ts",
                "./dotenv/*": "./dotenv/*.ts",
                "./encoding": "./encoding/mod.ts",
                "./encoding/*.ts": "./encoding/*.ts",
                "./encoding/*": "./encoding/*.ts",
                "./examples": "./examples/mod.ts",
                "./examples/*.ts": "./examples/*.ts",
                "./examples/*": "./examples/*.ts",
                "./flags": "./flags/mod.ts",
                "./flags/*.ts": "./flags/*.ts",
                "./flags/*": "./flags/*.ts",
                "./fmt": "./fmt/mod.ts",
                "./fmt/*.ts": "./fmt/*.ts",
                "./fmt/*": "./fmt/*.ts",
                "./fs": "./fs/mod.ts",
                "./fs/*.ts": "./fs/*.ts",
                "./fs/*": "./fs/*.ts",
                "./hash": "./hash/mod.ts",
                "./hash/*.ts": "./hash/*.ts",
                "./hash/*": "./hash/*.ts",
                "./http": "./http/mod.ts",
                "./http/*.ts": "./http/*.ts",
                "./http/*": "./http/*.ts",
                "./io": "./io/mod.ts",
                "./io/*.ts": "./io/*.ts",
                "./io/*": "./io/*.ts",
                "./log": "./log/mod.ts",
                "./log/*.ts": "./log/*.ts",
                "./log/*": "./log/*.ts",
                "./media_types": "./media_types/mod.ts",
                "./media_types/*.ts": "./media_types/*.ts",
                "./media_types/*": "./media_types/*.ts",
                "./node": "./node/mod.ts",
                "./node/*.ts": "./node/*.ts",
                "./node/*": "./node/*.ts",
                "./path": "./path/mod.ts",
                "./path/*.ts": "./path/*.ts",
                "./path/*": "./path/*.ts",
                "./permissions": "./permissions/mod.ts",
                "./permissions/*.ts": "./permissions/*.ts",
                "./permissions/*": "./permissions/*.ts",
                "./signal": "./signal/mod.ts",
                "./signal/*.ts": "./signal/*.ts",
                "./signal/*": "./signal/*.ts",
                "./streams": "./streams/mod.ts",
                "./streams/*.ts": "./streams/*.ts",
                "./streams/*": "./streams/*.ts",
                "./testing": "./testing/mod.ts",
                "./testing/*.ts": "./testing/*.ts",
                "./testing/*": "./testing/*.ts",
                "./textproto": "./textproto/mod.ts",
                "./textproto/*.ts": "./textproto/*.ts",
                "./textproto/*": "./textproto/*.ts",
                "./uuid": "./uuid/mod.ts",
                "./uuid/*.ts": "./uuid/*.ts",
                "./uuid/*": "./uuid/*.ts",
                "./version": "./version.ts",
                "./version.ts": "./version.ts",
                "./wasi": "./wasi/mod.ts",
                "./wasi/*.ts": "./wasi/*.ts",
                "./wasi/*": "./wasi*.ts"
            }
        };
    }
    // If there's a package.json, return that:
    const pkgJsonUrl = new URL("package.json", pkgUrl);
    const pkgRes = await fetch$1(pkgJsonUrl.href, this.fetchOpts);
    switch(pkgRes.status){
        case 200:
        case 304:
            return await pkgRes.json();
    }
    return null;
}
const vCache = {};
function parseUrlPkg$7(url) {
    let subpath = null;
    if (url.startsWith(stdlibUrl) && url[stdlibUrl.length] === "@") {
        const version = url.slice(stdlibUrl.length + 1, url.indexOf("/", stdlibUrl.length + 1));
        subpath = url.slice(stdlibUrl.length + version.length + 2);
        if (subpath.endsWith("/mod.ts")) subpath = subpath.slice(0, -7);
        else if (subpath.endsWith(".ts")) subpath = subpath.slice(0, -3);
        const name = subpath.indexOf("/") === -1 ? subpath : subpath.slice(0, subpath.indexOf("/"));
        return {
            pkg: {
                registry: "deno",
                name: "std",
                version
            },
            layer: "default",
            subpath: `./${name}${subpath ? `./${subpath}/mod.ts` : ""}`
        };
    } else if (url.startsWith(cdnUrl$5)) {
        const path = url.slice(cdnUrl$5.length);
        const versionIndex = path.indexOf("@");
        if (versionIndex === -1) return;
        const sepIndex = path.indexOf("/", versionIndex);
        const name = path.slice(0, versionIndex);
        const version = path.slice(versionIndex + ((vCache[name] = path[versionIndex + 1] === "v") ? 2 : 1), sepIndex === -1 ? path.length : sepIndex);
        return {
            pkg: {
                registry: "denoland",
                name,
                version
            },
            subpath: null,
            layer: "default"
        };
    }
}
async function resolveLatestTarget$2(target, _layer, parentUrl) {
    let { registry , name , range  } = target;
    if (denoStdVersion && registry === "deno") return {
        registry,
        name,
        version: denoStdVersion
    };
    if (range.isExact) return {
        registry,
        name,
        version: range.version.toString()
    };
    // convert all Denoland ranges into wildcards
    // since we don't have an actual semver lookup at the moment
    if (!range.isWildcard) range = new SemverRange$2(range.version.toString());
    const fetchOpts = {
        ...this.fetchOpts,
        headers: Object.assign({}, this.fetchOpts.headers || {}, {
            // For some reason, Deno provides different redirect behaviour for the server
            // Which requires us to use the text/html accept
            accept: typeof document === "undefined" ? "text/html" : "text/javascript"
        })
    };
    // "mod.ts" addition is necessary for the browser otherwise not resolving an exact module gives a CORS error
    const fetchUrl = registry === "denoland" ? cdnUrl$5 + name + "/mod.ts" : stdlibUrl + "/version.ts";
    const res = await fetch$1(fetchUrl, fetchOpts);
    if (!res.ok) throw new Error(`Deno: Unable to lookup ${fetchUrl}`);
    const { version  } = (await parseUrlPkg$7(res.url)).pkg;
    if (registry === "deno") denoStdVersion = version;
    return {
        registry,
        name,
        version
    };
}

var deno = /*#__PURE__*/Object.freeze({
  __proto__: null,
  resolveBuiltin: resolveBuiltin$1,
  pkgToUrl: pkgToUrl$6,
  getPackageConfig: getPackageConfig$3,
  parseUrlPkg: parseUrlPkg$7,
  resolveLatestTarget: resolveLatestTarget$2
});

const { SemverRange: SemverRange$1  } = sver;
const supportedProtocols = [
    "https",
    "http",
    "data",
    "file",
    "ipfs"
];
async function parseUrlOrBuiltinTarget(resolver, targetStr, parentUrl) {
    const registryIndex = targetStr.indexOf(":");
    if (isRelative(targetStr) || registryIndex !== -1 && supportedProtocols.includes(targetStr.slice(0, registryIndex)) || builtinSchemes.has(targetStr.slice(0, registryIndex))) {
        let target;
        let alias;
        let subpath = ".";
        const maybeBuiltin = builtinSchemes.has(targetStr.slice(0, registryIndex)) && resolver.resolveBuiltin(targetStr);
        if (maybeBuiltin) {
            if (typeof maybeBuiltin === "string") {
                throw new Error(`Builtin "${targetStr}" was resolved to package specifier ${maybeBuiltin}, but JSPM does not currently support installing specifiers for builtins.`);
            } else {
                ({ alias , subpath ="." , target  } = maybeBuiltin);
            }
        } else {
            var _ref;
            const subpathIndex = targetStr.indexOf("|");
            if (subpathIndex !== -1) {
                subpath = `./${targetStr.slice(subpathIndex + 1)}`;
                targetStr = targetStr.slice(0, subpathIndex);
            }
            target = {
                pkgTarget: new URL(targetStr + (targetStr.endsWith("/") ? "" : "/"), parentUrl || baseUrl),
                installSubpath: null
            };
            const pkgUrl = await resolver.getPackageBase(target.pkgTarget.href);
            alias = ((_ref = pkgUrl ? await resolver.getPackageConfig(pkgUrl) : null) === null || _ref === void 0 ? void 0 : _ref.name) || target.pkgTarget.pathname.split("/").slice(0, -1).pop();
        }
        if (!alias) throw new JspmError(`Unable to determine an alias for target package ${targetStr}`);
        return {
            alias,
            target,
            subpath
        };
    }
}
async function parseTarget(resolver, targetStr, parentPkgUrl, defaultRegistry) {
    const urlTarget = await parseUrlOrBuiltinTarget(resolver, targetStr, parentPkgUrl);
    if (urlTarget) return urlTarget;
    // TODO: package aliases support as per https://github.com/npm/rfcs/blob/latest/implemented/0001-package-aliases.md
    const registryIndex = targetStr.indexOf(":");
    const versionOrScopeIndex = targetStr.indexOf("@");
    if (targetStr.indexOf(":") !== -1 && versionOrScopeIndex !== -1 && versionOrScopeIndex < registryIndex) throw new Error(`Package aliases not yet supported. PRs welcome.`);
    const pkg = parsePkg(registryIndex === -1 ? targetStr : targetStr.slice(registryIndex + 1));
    if (!pkg) throw new JspmError(`Invalid package name ${targetStr}`);
    let registry = null;
    if (registryIndex !== -1) registry = targetStr.slice(0, registryIndex);
    let alias = pkg.pkgName;
    const versionIndex = pkg.pkgName.indexOf("@", 1);
    if (versionIndex !== -1) alias = pkg.pkgName.slice(0, versionIndex);
    else alias = pkg.pkgName;
    // If no version is specified, we fallback to the constraints in the parent
    // package config if they exist:
    const pcfg = await resolver.getPackageConfig(parentPkgUrl.href);
    if (versionIndex === -1 && pcfg) {
        var _pcfg_dependencies, _pcfg_peerDependencies, _pcfg_optionalDependencies, _pcfg_devDependencies;
        const dep = ((_pcfg_dependencies = pcfg.dependencies) === null || _pcfg_dependencies === void 0 ? void 0 : _pcfg_dependencies[alias]) || ((_pcfg_peerDependencies = pcfg.peerDependencies) === null || _pcfg_peerDependencies === void 0 ? void 0 : _pcfg_peerDependencies[alias]) || ((_pcfg_optionalDependencies = pcfg.optionalDependencies) === null || _pcfg_optionalDependencies === void 0 ? void 0 : _pcfg_optionalDependencies[alias]) || ((_pcfg_devDependencies = pcfg.devDependencies) === null || _pcfg_devDependencies === void 0 ? void 0 : _pcfg_devDependencies[alias]);
        if (dep) {
            return {
                target: newPackageTarget(dep, parentPkgUrl, registry || defaultRegistry, pkg.pkgName),
                alias,
                subpath: pkg.subpath
            };
        }
    }
    // Otherwise we construct a package target from what we were given:
    return {
        target: newPackageTarget(pkg.pkgName, parentPkgUrl, registry || defaultRegistry),
        alias,
        subpath: pkg.subpath
    };
}
function newPackageTarget(target, parentPkgUrl, defaultRegistry, pkgName) {
    if (target === ".") {
        // useful shorthand
        target = "./";
    }
    let registry, name, ranges;
    const registryIndex = target.indexOf(":");
    if (target.startsWith("./") || target.startsWith("../") || target.startsWith("/") || registryIndex === 1) return {
        pkgTarget: new URL(target, parentPkgUrl),
        installSubpath: null
    };
    registry = registryIndex < 1 ? defaultRegistry : target.slice(0, registryIndex);
    if (registry === "file") return {
        pkgTarget: new URL(target.slice(registry.length + 1), parentPkgUrl),
        installSubpath: null
    };
    if (registry === "https" || registry === "http") return {
        pkgTarget: new URL(target),
        installSubpath: null
    };
    const versionIndex = target.lastIndexOf("@");
    let unstable = false;
    if (versionIndex > registryIndex + 1) {
        name = target.slice(registryIndex + 1, versionIndex);
        const version = target.slice(versionIndex + 1);
        ranges = pkgName || SemverRange$1.isValid(version) ? [
            new SemverRange$1(version)
        ] : version.split("||").map((v)=>convertRange(v));
        if (version === "") unstable = true;
    } else if (registryIndex === -1 && pkgName) {
        name = pkgName;
        ranges = SemverRange$1.isValid(target) ? [
            new SemverRange$1(target)
        ] : target.split("||").map((v)=>convertRange(v));
    } else {
        name = target.slice(registryIndex + 1);
        ranges = [
            new SemverRange$1("*")
        ];
    }
    if (registryIndex === -1 && name.indexOf("/") !== -1 && name[0] !== "@") registry = "github";
    const targetNameLen = name.split("/").length;
    if (targetNameLen > 2 || targetNameLen === 1 && name[0] === "@") throw new JspmError(`Invalid package target ${target}`);
    return {
        pkgTarget: {
            registry,
            name,
            ranges,
            unstable
        },
        installSubpath: null
    };
}
function pkgToStr(pkg) {
    return `${pkg.registry ? pkg.registry + ":" : ""}${pkg.name}${pkg.version ? "@" + pkg.version : ""}`;
}
/**
 * Throws unless the given specifier is a valid npm-style package specifier.
 *
 * @param {string} specifier Specifier to validate.
 */ function validatePkgName(specifier) {
    const parsed = parsePkg(specifier);
    if (!parsed || parsed.subpath !== ".") throw new Error(`"${specifier}" is not a valid npm-style package name. Subpaths must be provided separately to the installation package name.`);
}
/**
 * Parses an npm-style module specifier, such as '@jspm/generator/index.js',
 * and splits it into the package name ('@jspm/generator') and module subpath
 * ('./index.js'). Returns undefined if the given specifier is invalid.
 *
 * @param {string} specifier Specifier to parse.
 * @returns {{ pkgName: string, subpath: '.' | `./${string}` } | undefined}
 */ function parsePkg(specifier) {
    let sepIndex = specifier.indexOf("/");
    if (specifier[0] === "@") {
        if (sepIndex === -1) return;
        sepIndex = specifier.indexOf("/", sepIndex + 1);
    }
    // TODO: Node.js validations like percent encodng checks
    if (sepIndex === -1) return {
        pkgName: specifier,
        subpath: "."
    };
    return {
        pkgName: specifier.slice(0, sepIndex),
        subpath: `.${specifier.slice(sepIndex)}`
    };
}

const cdnUrl$4 = "https://ga.jspm.io/";
const systemCdnUrl = "https://ga.system.jspm.io/";
const apiUrl = "https://api.jspm.io/";
const BUILD_POLL_TIME = 5 * 60 * 1000;
const BUILD_POLL_INTERVAL = 5 * 1000;
const supportedLayers = [
    "default",
    "system"
];
async function pkgToUrl$5(pkg, layer) {
    return `${layer === "system" ? systemCdnUrl : cdnUrl$4}${pkgToStr(pkg)}/`;
}
const exactPkgRegEx$4 = /^(([a-z]+):)?((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
function parseUrlPkg$6(url) {
    let subpath = null;
    let layer;
    if (url.startsWith(cdnUrl$4)) layer = "default";
    else if (url.startsWith(systemCdnUrl)) layer = "system";
    else return;
    const [, , registry, name, version] = url.slice((layer === "default" ? cdnUrl$4 : systemCdnUrl).length).match(exactPkgRegEx$4) || [];
    if (registry && name && version) {
        if (registry === "npm" && name === "@jspm/core" && url.includes("/nodelibs/")) {
            subpath = `./nodelibs/${url.slice(url.indexOf("/nodelibs/") + 10).split("/")[1]}`;
            if (subpath && subpath.endsWith(".js")) subpath = subpath.slice(0, -3);
            else subpath = null;
        }
        return {
            pkg: {
                registry,
                name,
                version
            },
            layer,
            subpath
        };
    }
}
let resolveCache = {};
function clearResolveCache() {
    resolveCache = {};
}
async function checkBuildOrError(pkgUrl, fetchOpts) {
    const pjsonRes = await fetch$1(`${pkgUrl}package.json`, fetchOpts);
    if (pjsonRes.ok) return true;
    // no package.json! Check if there's a build error:
    const errLogRes = await fetch$1(`${pkgUrl}/_error.log`, fetchOpts);
    if (errLogRes.ok) {
        const errLog = await errLogRes.text();
        throw new JspmError(`Resolved dependency ${pkgUrl} with error:\n\n${errLog}\nPlease post an issue at jspm/project on GitHub, or by following the link below:\n\nhttps://github.com/jspm/project/issues/new?title=CDN%20build%20error%20for%20${encodeURIComponent(pkgUrl)}&body=_Reporting%20CDN%20Build%20Error._%0A%0A%3C!--%20%20No%20further%20description%20necessary,%20just%20click%20%22Submit%20new%20issue%22%20--%3E`);
    }
    console.error(`Unable to request ${pkgUrl}package.json - ${pjsonRes.status} ${pjsonRes.statusText || "returned"}`);
    return false;
}
async function ensureBuild(pkg, fetchOpts) {
    if (await checkBuildOrError(await pkgToUrl$5(pkg, "default"), fetchOpts)) return;
    const fullName = `${pkg.name}@${pkg.version}`;
    // no package.json AND no build error -> post a build request
    // once the build request has been posted, try polling for up to 2 mins
    const buildRes = await fetch$1(`${apiUrl}build/${fullName}`, fetchOpts);
    if (!buildRes.ok && buildRes.status !== 403) {
        const err = (await buildRes.json()).error;
        throw new JspmError(`Unable to request the JSPM API for a build of ${fullName}, with error: ${err}.`);
    }
    // build requested -> poll on that
    let startTime = Date.now();
    while(true){
        await new Promise((resolve)=>setTimeout(resolve, BUILD_POLL_INTERVAL));
        if (await checkBuildOrError(await pkgToUrl$5(pkg, "default"), fetchOpts)) return;
        if (Date.now() - startTime >= BUILD_POLL_TIME) throw new JspmError(`Timed out waiting for the build of ${fullName} to be ready on the JSPM CDN. Try again later, or post a JSPM project issue if the issue persists.`);
    }
}
async function resolveLatestTarget$1(target, layer, parentUrl) {
    const { registry , name , range , unstable  } = target;
    // exact version optimization
    if (range.isExact && !range.version.tag) {
        const pkg = {
            registry,
            name,
            version: range.version.toString()
        };
        await ensureBuild(pkg, this.fetchOpts);
        return pkg;
    }
    const cache = resolveCache[target.registry + ":" + target.name] = resolveCache[target.registry + ":" + target.name] || {
        latest: null,
        majors: Object.create(null),
        minors: Object.create(null),
        tags: Object.create(null)
    };
    if (range.isWildcard || range.isExact && range.version.tag === "latest") {
        let lookup = await (cache.latest || (cache.latest = lookupRange.call(this, registry, name, "", unstable, parentUrl)));
        // Deno wat?
        if (lookup instanceof Promise) lookup = await lookup;
        if (!lookup) return null;
        this.log("jspm/resolveLatestTarget", `${target.registry}:${target.name}@${range} -> WILDCARD ${lookup.version}${parentUrl ? " [" + parentUrl + "]" : ""}`);
        await ensureBuild(lookup, this.fetchOpts);
        return lookup;
    }
    if (range.isExact && range.version.tag) {
        const tag = range.version.tag;
        let lookup = await (cache.tags[tag] || (cache.tags[tag] = lookupRange.call(this, registry, name, tag, unstable, parentUrl)));
        // Deno wat?
        if (lookup instanceof Promise) lookup = await lookup;
        if (!lookup) return null;
        this.log("jspm/resolveLatestTarget", `${target.registry}:${target.name}@${range} -> TAG ${tag}${parentUrl ? " [" + parentUrl + "]" : ""}`);
        await ensureBuild(lookup, this.fetchOpts);
        return lookup;
    }
    let stableFallback = false;
    if (range.isMajor) {
        const major = range.version.major;
        let lookup = await (cache.majors[major] || (cache.majors[major] = lookupRange.call(this, registry, name, major, unstable, parentUrl)));
        // Deno wat?
        if (lookup instanceof Promise) lookup = await lookup;
        if (!lookup) return null;
        // if the latest major is actually a downgrade, use the latest minor version (fallthrough)
        // note this might miss later major prerelease versions, which should strictly be supported via a pkg@X@ unstable major lookup
        if (range.version.gt(lookup.version)) {
            stableFallback = true;
        } else {
            this.log("jspm/resolveLatestTarget", `${target.registry}:${target.name}@${range} -> MAJOR ${lookup.version}${parentUrl ? " [" + parentUrl + "]" : ""}`);
            await ensureBuild(lookup, this.fetchOpts);
            return lookup;
        }
    }
    if (stableFallback || range.isStable) {
        const minor = `${range.version.major}.${range.version.minor}`;
        let lookup = await (cache.minors[minor] || (cache.minors[minor] = lookupRange.call(this, registry, name, minor, unstable, parentUrl)));
        // in theory a similar downgrade to the above can happen for stable prerelease ranges ~1.2.3-pre being downgraded to 1.2.2
        // this will be solved by the pkg@X.Y@ unstable minor lookup
        // Deno wat?
        if (lookup instanceof Promise) lookup = await lookup;
        if (!lookup) return null;
        this.log("jspm/resolveLatestTarget", `${target.registry}:${target.name}@${range} -> MINOR ${lookup.version}${parentUrl ? " [" + parentUrl + "]" : ""}`);
        await ensureBuild(lookup, this.fetchOpts);
        return lookup;
    }
    return null;
}
function pkgToLookupUrl(pkg, edge = false) {
    return `${cdnUrl$4}${pkg.registry}:${pkg.name}${pkg.version ? "@" + pkg.version : edge ? "@" : ""}`;
}
async function lookupRange(registry, name, range, unstable, parentUrl) {
    const res = await fetch$1(pkgToLookupUrl({
        registry,
        name,
        version: range
    }, unstable), this.fetchOpts);
    switch(res.status){
        case 304:
        case 200:
            return {
                registry,
                name,
                version: (await res.text()).trim()
            };
        case 404:
            const versions = await fetchVersions(name);
            const semverRange = new SemverRange$2(String(range) || "*", unstable);
            const version = semverRange.bestMatch(versions, unstable);
            if (version) {
                return {
                    registry,
                    name,
                    version
                };
            }
            throw new JspmError(`Unable to resolve ${registry}:${name}@${range} to a valid version${importedFrom(parentUrl)}`);
        default:
            throw new JspmError(`Invalid status code ${res.status} looking up "${registry}:${name}" - ${res.statusText}${importedFrom(parentUrl)}`);
    }
}
const versionsCacheMap = new Map();
async function fetchVersions(name) {
    if (versionsCacheMap.has(name)) {
        return versionsCacheMap.get(name);
    }
    const registryLookup = await (await fetch$1(`https://npmlookup.jspm.io/${encodeURI(name)}`, {})).json();
    const versions = Object.keys(registryLookup.versions || {});
    versionsCacheMap.set(name, versions);
    return versions;
}

var jspm = /*#__PURE__*/Object.freeze({
  __proto__: null,
  supportedLayers: supportedLayers,
  pkgToUrl: pkgToUrl$5,
  parseUrlPkg: parseUrlPkg$6,
  clearResolveCache: clearResolveCache,
  resolveLatestTarget: resolveLatestTarget$1
});

const cdnUrl$3 = "https://cdn.skypack.dev/";
async function pkgToUrl$4(pkg) {
    return `${cdnUrl$3}${pkg.name}@${pkg.version}/`;
}
const exactPkgRegEx$3 = /^((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
function parseUrlPkg$5(url) {
    if (!url.startsWith(cdnUrl$3)) return;
    const [, name, version] = url.slice(cdnUrl$3.length).match(exactPkgRegEx$3) || [];
    if (!name || !version) return;
    return {
        registry: "npm",
        name,
        version
    };
}

var skypack = /*#__PURE__*/Object.freeze({
  __proto__: null,
  pkgToUrl: pkgToUrl$4,
  parseUrlPkg: parseUrlPkg$5,
  resolveLatestTarget: resolveLatestTarget$1
});

const cdnUrl$2 = "https://cdn.jsdelivr.net/";
async function pkgToUrl$3(pkg) {
    return `${cdnUrl$2}${pkg.registry}/${pkg.name}@${pkg.version}/`;
}
const exactPkgRegEx$2 = /^([^\/]+)\/((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
function parseUrlPkg$4(url) {
    if (!url.startsWith(cdnUrl$2)) return;
    const [, registry, name, version] = url.slice(cdnUrl$2.length).match(exactPkgRegEx$2) || [];
    return {
        registry,
        name,
        version
    };
}

var jsdelivr = /*#__PURE__*/Object.freeze({
  __proto__: null,
  pkgToUrl: pkgToUrl$3,
  parseUrlPkg: parseUrlPkg$4,
  resolveLatestTarget: resolveLatestTarget$1
});

const cdnUrl$1 = "https://unpkg.com/";
async function pkgToUrl$2(pkg) {
    return `${cdnUrl$1}${pkg.name}@${pkg.version}/`;
}
const exactPkgRegEx$1 = /^((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
function parseUrlPkg$3(url) {
    if (!url.startsWith(cdnUrl$1)) return;
    const [, name, version] = url.slice(cdnUrl$1.length).match(exactPkgRegEx$1) || [];
    if (name && version) {
        return {
            registry: "npm",
            name,
            version
        };
    }
}

var unpkg = /*#__PURE__*/Object.freeze({
  __proto__: null,
  pkgToUrl: pkgToUrl$2,
  parseUrlPkg: parseUrlPkg$3,
  resolveLatestTarget: resolveLatestTarget$1
});

const nodeBuiltinSet = new Set([
    "_http_agent",
    "_http_client",
    "_http_common",
    "_http_incoming",
    "_http_outgoing",
    "_http_server",
    "_stream_duplex",
    "_stream_passthrough",
    "_stream_readable",
    "_stream_transform",
    "_stream_wrap",
    "_stream_writable",
    "_tls_common",
    "_tls_wrap",
    "assert",
    "assert/strict",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "dns/promises",
    "domain",
    "events",
    "fs",
    "fs/promises",
    "http",
    "http2",
    "https",
    "inspector",
    "module",
    "net",
    "os",
    "path",
    "path/posix",
    "path/win32",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "repl",
    "stream",
    "stream/promises",
    "string_decoder",
    "sys",
    "timers",
    "timers/promises",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "util/types",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib"
]);
async function pkgToUrl$1(pkg, layer) {
    if (pkg.registry !== "node") return pkgToUrl$5(pkg, layer);
    return `node:${pkg.name}/`;
}
function resolveBuiltin(specifier, env) {
    const builtin = specifier.startsWith("node:") ? specifier.slice(5) : nodeBuiltinSet.has(specifier) ? specifier : null;
    if (!builtin) return;
    // Deno supports all node builtins via bare "node:XXX" specifiers. As of
    // std@0.178.0, the standard library no longer ships node polyfills, so we
    // should always install builtins as base specifiers. This does mean that we
    // no longer support old versions of deno unless they use --compat.
    if (env.includes("deno") || env.includes("node")) {
        return `node:${builtin}`;
    }
    return {
        target: {
            pkgTarget: {
                registry: "npm",
                name: "@jspm/core",
                ranges: [
                    new SemverRange$2("*")
                ],
                unstable: true
            },
            installSubpath: `./nodelibs/${builtin}`
        },
        alias: builtin
    };
}
// Special "." export means a file package (not a folder package)
async function getPackageConfig$2() {
    return {
        exports: {
            ".": "."
        }
    };
}
async function resolveLatestTarget(target, layer, parentUrl) {
    if (target.registry !== "npm" || target.name !== "@jspm/core") return null;
    return resolveLatestTarget$1.call(this, {
        registry: "npm",
        name: "@jspm/core",
        range: new SemverRange$2("*"),
        unstable: true
    }, layer, parentUrl);
}
function parseUrlPkg$2(url) {
    if (!url.startsWith("node:")) return;
    let name = url.slice(5);
    if (name.endsWith("/")) name = name.slice(0, -1);
    return {
        registry: "node",
        name,
        version: ""
    };
}

var node = /*#__PURE__*/Object.freeze({
  __proto__: null,
  nodeBuiltinSet: nodeBuiltinSet,
  pkgToUrl: pkgToUrl$1,
  resolveBuiltin: resolveBuiltin,
  getPackageConfig: getPackageConfig$2,
  resolveLatestTarget: resolveLatestTarget,
  parseUrlPkg: parseUrlPkg$2
});

// @ts-ignore
const cdnUrl = "https://esm.sh/";
async function pkgToUrl(pkg) {
    // The wildcard '*' at the end tells the esm.sh CDN to externalise all
    // dependencies instead of bundling them into the returned module file.
    //   see https://esm.sh/#docs
    return `${cdnUrl}*${pkg.name}@${pkg.version}/`;
}
const exactPkgRegEx = /^(?:v\d+\/)?\*?((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
function parseUrlPkg$1(url) {
    if (!url.startsWith(cdnUrl)) return;
    const [, name, version] = url.slice(cdnUrl.length).match(exactPkgRegEx) || [];
    if (!name || !version) return;
    return {
        registry: "npm",
        name,
        version
    };
}
// esm.sh serves im/exports on their "exports" subpaths, whereas the generator
// expects them to be served on their filesystem paths, so we have to rewrite
// the package.json before doing anything with it:
async function getPackageConfig$1(pkgUrl) {
    const res = await fetch$1(`${pkgUrl}package.json`, this.fetchOpts);
    switch(res.status){
        case 200:
        case 304:
            break;
        case 400:
        case 401:
        case 403:
        case 404:
        case 406:
        case 500:
            this.pcfgs[pkgUrl] = null;
            return;
        default:
            throw new JspmError(`Invalid status code ${res.status} reading package config for ${pkgUrl}. ${res.statusText}`);
    }
    const pcfg = await res.json();
    if (pcfg.exports) {
        for (const key of Object.keys(pcfg.exports)){
            pcfg.exports[key] = key;
        }
    }
    if (pcfg.imports) {
        for (const key of Object.keys(pcfg.imports)){
            pcfg.imports[key] = key;
        }
    }
    return pcfg;
}

var esmsh = /*#__PURE__*/Object.freeze({
  __proto__: null,
  pkgToUrl: pkgToUrl,
  parseUrlPkg: parseUrlPkg$1,
  getPackageConfig: getPackageConfig$1,
  resolveLatestTarget: resolveLatestTarget$1
});

const defaultProviders = {
    deno,
    jsdelivr,
    node,
    skypack,
    unpkg,
    "esm.sh": esmsh,
    "jspm.io": jspm,
    // TODO: remove at some point, alias for backwards compatibility:
    jspm
};
function getProvider(name, providers) {
    const provider = providers[name];
    if (provider) return provider;
    throw new JspmError(`No provider named "${name}" has been defined.`);
}
function getDefaultProviderStrings() {
    let res = [];
    for (const [name, provider] of Object.entries(defaultProviders)){
        // TODO: remove the jspm alias at some point along with this hack:
        if (name === "jspm") continue;
        var _provider_supportedLayers;
        for (const layer of (_provider_supportedLayers = provider.supportedLayers) !== null && _provider_supportedLayers !== void 0 ? _provider_supportedLayers : [
            "default"
        ])res.push(`${name}${layer === "default" ? "" : `#${layer}`}`);
    }
    return res;
}
const registryProviders = {
    "denoland:": "deno",
    "deno:": "deno"
};
const mappableSchemes = new Set([
    "npm",
    "deno",
    "node"
]);
const builtinSchemes = new Set([
    "node",
    "deno"
]);

function createEsmAnalysis(imports, source, url) {
    if (!imports.length && registerRegEx.test(source)) return createSystemAnalysis(source, imports, url);
    const deps = [];
    const dynamicDeps = [];
    for (const impt of imports){
        if (impt.d === -1) {
            if (!deps.includes(impt.n)) deps.push(impt.n);
            continue;
        }
        // dynamic import -> deoptimize trace all dependencies (and all their exports)
        if (impt.d >= 0) {
            if (impt.n) {
                try {
                    dynamicDeps.push(impt.n);
                } catch (e) {
                    console.warn(`TODO: Dynamic import custom expression tracing in ${url} for:\n\n${source.slice(impt.ss, impt.se)}\n`);
                }
            }
        }
    }
    const size = source.length;
    return {
        deps,
        dynamicDeps,
        cjsLazyDeps: null,
        size,
        format: "esm"
    };
}
const registerRegEx = /^\s*(\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*)*\s*System\s*\.\s*register\s*\(\s*(\[[^\]]*\])\s*,\s*\(?function\s*\(\s*([^\),\s]+\s*(,\s*([^\),\s]+)\s*)?\s*)?\)/;
function createSystemAnalysis(source, imports, url) {
    const [, , , rawDeps, , , contextId] = source.match(registerRegEx) || [];
    if (!rawDeps) return createEsmAnalysis(imports, source, url);
    const deps = JSON.parse(rawDeps.replace(/'/g, '"'));
    const dynamicDeps = [];
    if (contextId) {
        const dynamicImport = `${contextId}.import(`;
        let i = -1;
        while((i = source.indexOf(dynamicImport, i + 1)) !== -1){
            const importStart = i + dynamicImport.length + 1;
            const quote = source[i + dynamicImport.length];
            if (quote === '"' || quote === "'") {
                const importEnd = source.indexOf(quote, i + dynamicImport.length + 1);
                if (importEnd !== -1) {
                    try {
                        dynamicDeps.push(JSON.parse('"' + source.slice(importStart, importEnd) + '"'));
                        continue;
                    } catch (e) {}
                }
            }
            console.warn("TODO: Dynamic import custom expression tracing.");
        }
    }
    const size = source.length;
    return {
        deps,
        dynamicDeps,
        cjsLazyDeps: null,
        size,
        format: "system"
    };
}

let realpath, pathToFileURL;
function setPathFns(_realpath, _pathToFileURL) {
    realpath = _realpath, pathToFileURL = _pathToFileURL;
}
function isBuiltinScheme(specifier) {
    if (specifier.indexOf(":") === -1) return false;
    return builtinSchemes.has(specifier.slice(0, specifier.indexOf(":")));
}
function isMappableScheme(specifier) {
    if (specifier.indexOf(":") === -1) return false;
    return mappableSchemes.has(specifier.slice(0, specifier.indexOf(":")));
}
class Resolver {
    addCustomProvider(name, provider) {
        if (!provider.pkgToUrl) throw new Error('Custom provider "' + name + '" must define a "pkgToUrl" method.');
        if (!provider.parseUrlPkg) throw new Error('Custom provider "' + name + '" must define a "parseUrlPkg" method.');
        if (!provider.resolveLatestTarget) throw new Error('Custom provider "' + name + '" must define a "resolveLatestTarget" method.');
        this.providers = Object.assign({}, this.providers, {
            [name]: provider
        });
    }
    providerNameForUrl(url) {
        for (const name of Object.keys(this.providers)){
            const provider = this.providers[name];
            if (provider.ownsUrl && provider.ownsUrl.call(this, url) || provider.parseUrlPkg.call(this, url)) {
                return name;
            }
        }
    }
    providerForUrl(url) {
        const name = this.providerNameForUrl(url);
        return name ? this.providers[name] : null;
    }
    async parseUrlPkg(url) {
        for (const provider of Object.keys(this.providers)){
            const providerInstance = this.providers[provider];
            const result = providerInstance.parseUrlPkg.call(this, url);
            if (result) return {
                pkg: "pkg" in result ? result.pkg : result,
                source: {
                    provider,
                    layer: "layer" in result ? result.layer : "default"
                },
                subpath: "subpath" in result ? result.subpath : null
            };
        }
        return null;
    }
    async pkgToUrl(pkg, { provider , layer  }) {
        return getProvider(provider, this.providers).pkgToUrl.call(this, pkg, layer);
    }
    resolveBuiltin(specifier) {
        for (const provider of Object.values(this.providers)){
            if (!provider.resolveBuiltin) continue;
            const builtin = provider.resolveBuiltin.call(this, specifier, this.env);
            if (builtin) return builtin;
        }
    }
    async getPackageBase(url) {
        const pkg = await this.parseUrlPkg(url);
        if (pkg) return this.pkgToUrl(pkg.pkg, pkg.source);
        let testUrl;
        try {
            testUrl = new URL("./", url);
        } catch  {
            return url;
        }
        const rootUrl = new URL("/", testUrl).href;
        do {
            let responseUrl;
            if (responseUrl = await this.checkPjson(testUrl.href)) return new URL(".", responseUrl).href;
            // No package base -> use directory itself
            if (testUrl.href === rootUrl) return new URL("./", url).href;
        }while (testUrl = new URL("../", testUrl))
    }
    // TODO: there are actually two different kinds of "package" in the codebase.
    // There's a registry package, which is something that can be pinned exactly
    // by name and version against a registry like "npm" or "denoland". Then we
    // have a resolver package, which is any URL that has a "package.json" as a
    // child. We should only be doing providerForUrl checks for _registry_
    // packages, and in resolution contexts we should skip straight to npm-style
    // backtracking to find package bases.
    async getPackageConfig(pkgUrl) {
        if (!pkgUrl.startsWith("file:") && !pkgUrl.startsWith("http:") && !pkgUrl.startsWith("https:") && !pkgUrl.startsWith("ipfs:") && !pkgUrl.startsWith("node:")) return null;
        if (!pkgUrl.endsWith("/")) throw new Error(`Internal Error: Package URL must end in "/". Got ${pkgUrl}`);
        let cached = this.pcfgs[pkgUrl];
        if (cached) return cached;
        if (!this.pcfgPromises[pkgUrl]) this.pcfgPromises[pkgUrl] = (async ()=>{
            var _res_headers_get;
            const provider = this.providerForUrl(pkgUrl);
            if (provider) {
                var _provider_getPackageConfig;
                const pcfg = await ((_provider_getPackageConfig = provider.getPackageConfig) === null || _provider_getPackageConfig === void 0 ? void 0 : _provider_getPackageConfig.call(this, pkgUrl));
                if (pcfg !== undefined) {
                    this.pcfgs[pkgUrl] = pcfg;
                    return;
                }
            }
            const res = await fetch$1(`${pkgUrl}package.json`, this.fetchOpts);
            switch(res.status){
                case 200:
                case 304:
                    break;
                case 400:
                case 401:
                case 403:
                case 404:
                case 406:
                case 500:
                    this.pcfgs[pkgUrl] = null;
                    return;
                default:
                    throw new JspmError(`Invalid status code ${res.status} reading package config for ${pkgUrl}. ${res.statusText}`);
            }
            if (res.headers && !((_res_headers_get = res.headers.get("Content-Type")) === null || _res_headers_get === void 0 ? void 0 : _res_headers_get.match(/^application\/json(;|$)/))) {
                this.pcfgs[pkgUrl] = null;
            } else try {
                this.pcfgs[pkgUrl] = await res.json();
            } catch (e) {
                this.pcfgs[pkgUrl] = null;
            }
        })();
        await this.pcfgPromises[pkgUrl];
        return this.pcfgs[pkgUrl];
    }
    async getDepList(pkgUrl, dev = false) {
        const pjson = await this.getPackageConfig(pkgUrl);
        if (!pjson) return [];
        return [
            ...new Set([
                Object.keys(pjson.dependencies || {}),
                Object.keys(dev && pjson.devDependencies || {}),
                Object.keys(pjson.peerDependencies || {}),
                Object.keys(pjson.optionalDependencies || {}),
                Object.keys(pjson.imports || {})
            ].flat())
        ];
    }
    async checkPjson(url) {
        if (await this.getPackageConfig(url) === null) return false;
        return url;
    }
    async exists(resolvedUrl) {
        const res = await fetch$1(resolvedUrl, this.fetchOpts);
        switch(res.status){
            case 200:
            case 304:
                return true;
            case 400:
            case 401:
            case 403:
            case 404:
            case 406:
            case 500:
                return false;
            default:
                throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
        }
    }
    async resolveLatestTarget(target, { provider , layer  }, parentUrl) {
        // find the range to resolve latest
        let range;
        for (const possibleRange of target.ranges.sort(target.ranges[0].constructor.compare)){
            if (!range) {
                range = possibleRange;
            } else if (possibleRange.gt(range) && !range.contains(possibleRange)) {
                range = possibleRange;
            }
        }
        const latestTarget = {
            registry: target.registry,
            name: target.name,
            range,
            unstable: target.unstable
        };
        const resolveLatestTarget = getProvider(provider, this.providers).resolveLatestTarget.bind(this);
        const pkg = await resolveLatestTarget(latestTarget, layer, parentUrl);
        if (pkg) return pkg;
        if (provider === "nodemodules") {
            throw new JspmError(`${parentUrl}node_modules/${target.name} does not exist, try installing "${target.name}" with npm first via "npm install ${target.name}".`);
        } else {
            throw new JspmError(`Unable to resolve package ${latestTarget.registry}:${latestTarget.name} in range "${latestTarget.range}" from parent ${parentUrl}.`);
        }
    }
    async wasCommonJS(url) {
        var _pcfg_exports;
        // TODO: make this a provider hook
        const pkgUrl = await this.getPackageBase(url);
        if (!pkgUrl) return false;
        const pcfg = await this.getPackageConfig(pkgUrl);
        if (!pcfg) return false;
        const subpath = "./" + url.slice(pkgUrl.length);
        return (pcfg === null || pcfg === void 0 ? void 0 : (_pcfg_exports = pcfg.exports) === null || _pcfg_exports === void 0 ? void 0 : _pcfg_exports[subpath + "!cjs"]) ? true : false;
    }
    async realPath(url) {
        if (!url.startsWith("file:") || this.preserveSymlinks) return url;
        let encodedColon = false;
        url = url.replace(/%3a/i, ()=>{
            encodedColon = true;
            return ":";
        });
        if (!realpath) {
            [{ realpath  }, { pathToFileURL  }] = await Promise.all([
                import('fs'),
                import('url')
            ]);
        }
        const outUrl = pathToFileURL(await new Promise((resolve, reject)=>realpath(new URL(url), (err, result)=>err ? reject(err) : resolve(result)))).href;
        if (encodedColon) return "file:" + outUrl.slice(5).replace(":", "%3a");
        return outUrl;
    }
    async finalizeResolve(url, parentIsCjs, pkgUrl) {
        if (parentIsCjs && url.endsWith("/")) url = url.slice(0, -1);
        // Only CJS modules do extension searching for relative resolved paths
        if (parentIsCjs) url = await (async ()=>{
            // subfolder checks before file checks because of fetch
            if (await this.exists(url + "/package.json")) {
                const pcfg = await this.getPackageConfig(url) || {};
                if (this.env.includes("browser") && typeof pcfg.browser === "string") return this.finalizeResolve(await legacyMainResolve.call(this, pcfg.browser, new URL(url)), parentIsCjs, pkgUrl);
                if (this.env.includes("module") && typeof pcfg.module === "string") return this.finalizeResolve(await legacyMainResolve.call(this, pcfg.module, new URL(url)), parentIsCjs, pkgUrl);
                if (typeof pcfg.main === "string") return this.finalizeResolve(await legacyMainResolve.call(this, pcfg.main, new URL(url)), parentIsCjs, pkgUrl);
                return this.finalizeResolve(await legacyMainResolve.call(this, null, new URL(url)), parentIsCjs, pkgUrl);
            }
            if (await this.exists(url + "/index.js")) return url + "/index.js";
            if (await this.exists(url + "/index.json")) return url + "/index.json";
            if (await this.exists(url + "/index.node")) return url + "/index.node";
            if (await this.exists(url)) return url;
            if (await this.exists(url + ".js")) return url + ".js";
            if (await this.exists(url + ".json")) return url + ".json";
            if (await this.exists(url + ".node")) return url + ".node";
            return url;
        })();
        // Only browser maps apply to relative resolved paths
        if (this.env.includes("browser")) {
            pkgUrl = pkgUrl || await this.getPackageBase(url);
            if (url.startsWith(pkgUrl)) {
                const pcfg = await this.getPackageConfig(pkgUrl);
                if (pcfg && typeof pcfg.browser === "object" && pcfg.browser !== null) {
                    const subpath = "./" + url.slice(pkgUrl.length);
                    if (pcfg.browser[subpath]) {
                        const target = pcfg.browser[subpath];
                        if (target === false) throw new Error(`TODO: Empty browser map for ${subpath} in ${url}`);
                        if (!target.startsWith("./")) throw new Error(`TODO: External browser map for ${subpath} to ${target} in ${url}`);
                        // for browser mappings to the same module, avoid a loop
                        if (pkgUrl + target.slice(2) === url) return url;
                        return await this.finalizeResolve(pkgUrl + target.slice(2), parentIsCjs, pkgUrl);
                    }
                }
            }
        }
        return url;
    }
    // reverse exports resolution
    // returns _a_ possible export which resolves to the given package URL and subpath
    // also handles "imports"
    async getExportResolution(pkgUrl, subpath, originalSpecifier) {
        const pcfg = await this.getPackageConfig(pkgUrl) || {};
        if (originalSpecifier[0] === "#") {
            if (pcfg.imports === undefined || pcfg.imports === null) return null;
            const match = getMapMatch(originalSpecifier, pcfg.imports);
            if (!match) return null;
            const targets = enumeratePackageTargets(pcfg.imports[match]);
            for (const curTarget of targets){
                try {
                    if (await this.finalizeResolve(curTarget, false, pkgUrl) === pkgUrl + subpath.slice(2)) {
                        return ".";
                    }
                } catch  {}
            }
            return null;
        }
        if (pcfg.exports !== undefined && pcfg.exports !== null) {
            if (typeof pcfg.exports === "string") {
                if (subpath !== ".") return null;
                const url = new URL(pcfg.exports, pkgUrl).href;
                try {
                    if (await this.finalizeResolve(url, false, pkgUrl) === pkgUrl + subpath.slice(2)) return ".";
                } catch  {}
                return null;
            } else if (!allDotKeys(pcfg.exports)) {
                if (subpath !== ".") return null;
                const targets = enumeratePackageTargets(pcfg.exports);
                for (const curTarget of targets){
                    try {
                        if (await this.finalizeResolve(new URL(curTarget, pkgUrl).href, false, pkgUrl) === pkgUrl + subpath.slice(2)) return ".";
                    } catch  {}
                }
                return null;
            } else {
                let bestMatch;
                for (const expt of Object.keys(pcfg.exports)){
                    const targets = enumeratePackageTargets(pcfg.exports[expt]);
                    for (const curTarget of targets){
                        if (curTarget.indexOf("*") === -1) {
                            if (await this.finalizeResolve(new URL(curTarget, pkgUrl).href, false, pkgUrl) === pkgUrl + subpath.slice(2)) {
                                if (bestMatch) {
                                    if (originalSpecifier.endsWith(bestMatch.slice(2))) {
                                        if (!originalSpecifier.endsWith(expt.slice(2))) continue;
                                    } else if (!originalSpecifier.endsWith(expt.slice(2))) {
                                        // Normal precedence = shortest export!
                                        if (expt.length < bestMatch.length) bestMatch = expt;
                                    }
                                }
                                bestMatch = expt;
                            }
                        } else {
                            const parts = curTarget.split("*");
                            if (!subpath.startsWith(parts[0])) continue;
                            const matchEndIndex = subpath.indexOf(parts[1], parts[0].length);
                            if (matchEndIndex === -1) continue;
                            const match = subpath.slice(parts[0].length, matchEndIndex);
                            const substitutedTarget = curTarget.replace(/\*/g, match);
                            if (subpath === substitutedTarget) {
                                const prefix = expt.slice(0, expt.indexOf("*"));
                                const suffix = expt.slice(expt.indexOf("*") + 1);
                                if (bestMatch) {
                                    if (originalSpecifier.endsWith(bestMatch.slice(2))) {
                                        if (!originalSpecifier.endsWith(expt.slice(2).replace("*", match)) || bestMatch.startsWith(prefix) && bestMatch.endsWith(suffix)) continue;
                                    } else if (!originalSpecifier.endsWith(expt.slice(2).replace("*", match))) {
                                        if (bestMatch.startsWith(prefix) && bestMatch.endsWith(suffix)) continue;
                                    }
                                }
                                bestMatch = expt.replace("*", match);
                            }
                        }
                    }
                }
                return bestMatch;
            }
        } else {
            if (subpath !== ".") {
                try {
                    if (await this.finalizeResolve(new URL(subpath, new URL(pkgUrl)).href, false, pkgUrl) === pkgUrl + subpath.slice(2)) return ".";
                } catch  {}
                return null;
            }
            try {
                if (typeof pcfg.main === "string" && await this.finalizeResolve(await legacyMainResolve.call(this, pcfg.main, new URL(pkgUrl), originalSpecifier, pkgUrl), false, pkgUrl) === pkgUrl + subpath.slice(2)) return ".";
            } catch  {}
            try {
                if (await this.finalizeResolve(await legacyMainResolve.call(this, null, new URL(pkgUrl), originalSpecifier, pkgUrl), false, pkgUrl) === pkgUrl + subpath.slice(2)) return ".";
            } catch  {}
            try {
                if (typeof pcfg.browser === "string" && await this.finalizeResolve(await legacyMainResolve.call(this, pcfg.browser, new URL(pkgUrl), originalSpecifier, pkgUrl), false, pkgUrl) === pkgUrl + subpath.slice(2)) return ".";
            } catch  {}
            try {
                if (typeof pcfg.module === "string" && await this.finalizeResolve(await legacyMainResolve.call(this, pcfg.module, new URL(pkgUrl), originalSpecifier, pkgUrl), false, pkgUrl) === pkgUrl + subpath.slice(2)) return ".";
                return null;
            } catch  {}
        }
        return null;
    }
    // Note: updates here must be tracked in function above
    async resolveExport(pkgUrl, subpath, cjsEnv, parentIsCjs, originalSpecifier, installer, parentUrl) {
        const env = cjsEnv ? this.cjsEnv : this.env;
        const pcfg = await this.getPackageConfig(pkgUrl) || {};
        // If the package has no exports then we resolve against "node:@empty":
        if (typeof pcfg.exports === "object" && pcfg.exports !== null && Object.keys(pcfg.exports).length === 0) {
            const stdlibTarget = {
                registry: "npm",
                name: "@jspm/core",
                ranges: [
                    new SemverRange$2("*")
                ],
                unstable: true
            };
            const provider = installer.getProvider(stdlibTarget);
            const pkg = await this.resolveLatestTarget(stdlibTarget, provider, parentUrl.href);
            return this.resolveExport(await this.pkgToUrl(pkg, provider), "./nodelibs/@empty", cjsEnv, parentIsCjs, originalSpecifier, installer, parentUrl);
        }
        function throwExportNotDefined() {
            throw new JspmError(`No '${subpath}' exports subpath defined in ${pkgUrl} resolving ${originalSpecifier}${importedFrom(parentUrl)}.`, "MODULE_NOT_FOUND");
        }
        if (pcfg.exports !== undefined && pcfg.exports !== null) {
            function allDotKeys(exports) {
                for(let p in exports){
                    if (p[0] !== ".") return false;
                }
                return true;
            }
            if (typeof pcfg.exports === "string") {
                if (subpath === ".") return this.finalizeResolve(new URL(pcfg.exports, pkgUrl).href, parentIsCjs, pkgUrl);
                else throwExportNotDefined();
            } else if (!allDotKeys(pcfg.exports)) {
                if (subpath === ".") return this.finalizeResolve(this.resolvePackageTarget(pcfg.exports, pkgUrl, cjsEnv, "", false), parentIsCjs, pkgUrl);
                else throwExportNotDefined();
            } else {
                const match = getMapMatch(subpath, pcfg.exports);
                if (match) {
                    let replacement = "";
                    const wildcardIndex = match.indexOf("*");
                    if (wildcardIndex !== -1) {
                        replacement = subpath.slice(wildcardIndex, subpath.length - (match.length - wildcardIndex - 1));
                    } else if (match.endsWith("/")) {
                        replacement = subpath.slice(match.length);
                    }
                    const resolved = this.resolvePackageTarget(pcfg.exports[match], pkgUrl, cjsEnv, replacement, false);
                    if (resolved === null) throwExportNotDefined();
                    return this.finalizeResolve(resolved, parentIsCjs, pkgUrl);
                }
                throwExportNotDefined();
            }
        } else {
            if (subpath === "." || parentIsCjs && subpath === "./") {
                if (env.includes("browser") && typeof pcfg.browser === "string") return this.finalizeResolve(await legacyMainResolve.call(this, pcfg.browser, new URL(pkgUrl), originalSpecifier, pkgUrl), parentIsCjs, pkgUrl);
                if (env.includes("module") && typeof pcfg.module === "string") return this.finalizeResolve(await legacyMainResolve.call(this, pcfg.module, new URL(pkgUrl), originalSpecifier, pkgUrl), parentIsCjs, pkgUrl);
                if (typeof pcfg.main === "string") return this.finalizeResolve(await legacyMainResolve.call(this, pcfg.main, new URL(pkgUrl), originalSpecifier, pkgUrl), parentIsCjs, pkgUrl);
                return this.finalizeResolve(await legacyMainResolve.call(this, null, new URL(pkgUrl), originalSpecifier, pkgUrl), parentIsCjs, pkgUrl);
            } else {
                return this.finalizeResolve(new URL(subpath, new URL(pkgUrl)).href, parentIsCjs, pkgUrl);
            }
        }
    }
    async analyze(resolvedUrl, parentUrl, system, isRequire, retry = true) {
        const res = await fetch$1(resolvedUrl, this.fetchOpts);
        if (!res) throw new JspmError(`Unable to fetch URL "${resolvedUrl}" for ${parentUrl}`);
        switch(res.status){
            case 200:
            case 304:
                break;
            case 404:
                throw new JspmError(`Module not found: ${resolvedUrl}${importedFrom(parentUrl)}`, "MODULE_NOT_FOUND");
            default:
                throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
        }
        try {
            var source = await res.text();
        } catch (e) {
            if (retry && (e.code === "ERR_SOCKET_TIMEOUT" || e.code === "ETIMEOUT" || e.code === "ECONNRESET")) return this.analyze(resolvedUrl, parentUrl, system, isRequire, false);
            throw e;
        }
        // TODO: headers over extensions for non-file URLs
        try {
            if (resolvedUrl.endsWith(".ts") || resolvedUrl.endsWith(".tsx") || resolvedUrl.endsWith(".jsx")) return await createTsAnalysis(source, resolvedUrl);
            if (resolvedUrl.endsWith(".wasm")) {
                return {
                    deps: [],
                    dynamicDeps: [],
                    cjsLazyDeps: null,
                    size: source.length,
                    format: "wasm"
                };
            }
            if (resolvedUrl.endsWith(".json")) {
                try {
                    JSON.parse(source);
                    return {
                        deps: [],
                        dynamicDeps: [],
                        cjsLazyDeps: null,
                        size: source.length,
                        format: "json"
                    };
                } catch  {}
            }
            const [imports, exports] = parse(source);
            if (imports.every((impt)=>impt.d > 0) && !exports.length && resolvedUrl.startsWith("file:")) {
                var _ref;
                // Support CommonJS package boundary checks for non-ESM on file: protocol only
                if (isRequire) {
                    var _ref1;
                    if (!(resolvedUrl.endsWith(".mjs") || resolvedUrl.endsWith(".js") && ((_ref1 = await this.getPackageConfig(await this.getPackageBase(resolvedUrl))) === null || _ref1 === void 0 ? void 0 : _ref1.type) === "module")) return createCjsAnalysis(imports, source, resolvedUrl);
                } else if (resolvedUrl.endsWith(".cjs") || resolvedUrl.endsWith(".js") && ((_ref = await this.getPackageConfig(await this.getPackageBase(resolvedUrl))) === null || _ref === void 0 ? void 0 : _ref.type) !== "module") {
                    return createCjsAnalysis(imports, source, resolvedUrl);
                }
            }
            return system ? createSystemAnalysis(source, imports, resolvedUrl) : createEsmAnalysis(imports, source, resolvedUrl);
        } catch (e) {
            if (!e.message || !e.message.startsWith("Parse error @:")) throw e;
            // fetch is _unstable_!!!
            // so we retry the fetch first
            if (retry) {
                try {
                    return this.analyze(resolvedUrl, parentUrl, system, isRequire, false);
                } catch  {}
            }
            // TODO: better parser errors
            if (e.message && e.message.startsWith("Parse error @:")) {
                const [topline] = e.message.split("\n", 1);
                const pos = topline.slice(14);
                let [line, col] = pos.split(":");
                const lines = source.split("\n");
                let errStack = "";
                if (line > 1) errStack += "\n  " + lines[line - 2];
                errStack += "\n> " + lines[line - 1];
                errStack += "\n  " + " ".repeat(col - 1) + "^";
                if (lines.length > 1) errStack += "\n  " + lines[line];
                throw new JspmError(`${errStack}\n\nError parsing ${resolvedUrl}:${pos}`);
            }
            throw e;
        }
    }
    // Note: changes to this function must be updated enumeratePackageTargets too
    resolvePackageTarget(target, packageUrl, cjsEnv, subpath, isImport) {
        if (typeof target === "string") {
            if (target === ".") {
                // special dot export for file packages
                return packageUrl.slice(0, -1);
            }
            if (!target.startsWith("./")) {
                if (isImport) return target;
                throw new Error(`Invalid exports target ${target} resolving ./${subpath} in ${packageUrl}`);
            }
            if (!target.startsWith("./")) throw new Error("Invalid ");
            if (subpath === "") return new URL(target, packageUrl).href;
            if (target.indexOf("*") !== -1) {
                return new URL(target.replace(/\*/g, subpath), packageUrl).href;
            } else if (target.endsWith("/")) {
                return new URL(target + subpath, packageUrl).href;
            } else {
                throw new Error(`Expected pattern or path export resolving ./${subpath} in ${packageUrl}`);
            }
        } else if (typeof target === "object" && target !== null && !Array.isArray(target)) {
            for(const condition in target){
                if (condition === "default" || (cjsEnv ? this.cjsEnv : this.env).includes(condition)) {
                    const resolved = this.resolvePackageTarget(target[condition], packageUrl, cjsEnv, subpath, isImport);
                    if (resolved) return resolved;
                }
            }
        } else if (Array.isArray(target)) {
            // TODO: Validation for arrays
            for (const targetFallback of target){
                return this.resolvePackageTarget(targetFallback, packageUrl, cjsEnv, subpath, isImport);
            }
        }
        return null;
    }
    constructor(env, log, fetchOpts, preserveSymlinks = false){
        this.pcfgPromises = Object.create(null);
        this.pcfgs = Object.create(null);
        this.preserveSymlinks = false;
        this.providers = defaultProviders;
        if (env.includes("require")) throw new Error("Cannot manually pass require condition");
        if (!env.includes("import")) env.push("import");
        this.env = env;
        this.cjsEnv = this.env.map((e)=>e === "import" ? "require" : e);
        this.log = log;
        this.fetchOpts = fetchOpts;
        this.preserveSymlinks = preserveSymlinks;
    }
}
function enumeratePackageTargets(target, targets = new Set()) {
    if (typeof target === "string") {
        targets.add(target);
    } else if (typeof target === "object" && target !== null && !Array.isArray(target)) {
        for(const condition in target){
            enumeratePackageTargets(target[condition], targets);
        }
        return targets;
    } else if (Array.isArray(target)) {
        // TODO: Validation for arrays
        for (const targetFallback of target){
            enumeratePackageTargets(targetFallback, targets);
            return targets;
        }
    }
    return targets;
}
async function legacyMainResolve(main, pkgUrl, originalSpecifier, parentUrl) {
    let guess;
    if (main === null || main === void 0 ? void 0 : main.endsWith("index.js")) {
        if (await this.exists(guess = new URL(`./${main}`, pkgUrl).href)) return guess;
    } else if (main) {
        if (await this.exists(guess = new URL(`./${main}/index.js`, pkgUrl).href)) return guess;
        if (await this.exists(guess = new URL(`./${main}/index.json`, pkgUrl).href)) return guess;
        if (await this.exists(guess = new URL(`./${main}/index.node`, pkgUrl).href)) return guess;
        if (await this.exists(guess = new URL(`./${main}`, pkgUrl).href)) return guess;
        if (await this.exists(guess = new URL(`./${main}.js`, pkgUrl).href)) return guess;
        if (await this.exists(guess = new URL(`./${main}.json`, pkgUrl).href)) return guess;
        if (await this.exists(guess = new URL(`./${main}.node`, pkgUrl).href)) return guess;
    } else {
        if (pkgUrl.protocol !== "file:" && await this.exists(guess = new URL("./mod.ts", pkgUrl).href)) return guess;
        if (await this.exists(guess = new URL("./index.js", pkgUrl).href)) return guess;
        if (await this.exists(guess = new URL("./index.json", pkgUrl).href)) return guess;
        if (await this.exists(guess = new URL("./index.node", pkgUrl).href)) return guess;
    }
    // Not found.
    throw new JspmError(`Unable to resolve ${main ? main + " in " : ""}${pkgUrl} resolving ${originalSpecifier !== null && originalSpecifier !== void 0 ? originalSpecifier : ""}${importedFrom(parentUrl)}.`, "MODULE_NOT_FOUND");
}
function getMapMatch(specifier, map) {
    if (specifier in map) return specifier;
    let bestMatch;
    for (const match of Object.keys(map)){
        const wildcardIndex = match.indexOf("*");
        if (!match.endsWith("/") && wildcardIndex === -1) continue;
        if (match.endsWith("/")) {
            if (specifier.startsWith(match)) {
                if (!bestMatch || match.length > bestMatch.length) bestMatch = match;
            }
        } else {
            const prefix = match.slice(0, wildcardIndex);
            const suffix = match.slice(wildcardIndex + 1);
            if (specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length > prefix.length + suffix.length) {
                if (!bestMatch || !bestMatch.startsWith(prefix) || !bestMatch.endsWith(suffix)) bestMatch = match;
            }
        }
    }
    return bestMatch;
}
function allDotKeys(exports) {
    for(let p in exports){
        if (p[0] !== ".") return false;
    }
    return true;
}

// @ts-ignore
let createHash;
function setCreateHash(_createHash) {
    createHash = _createHash;
}
async function getIntegrity(url, fetchOpts) {
    if (!createHash) ({ createHash  } = await import('crypto'));
    const res = await fetch$1(url, fetchOpts);
    const buf = await res.text();
    const hash = createHash("sha384");
    hash.update(buf);
    return "sha384-" + hash.digest("base64");
}

function encodeBase64(data) {
    if (typeof window !== "undefined") {
        return window.btoa(data);
    }
    return Buffer.from(data).toString("base64");
}
function decodeBase64(data) {
    if (typeof window !== "undefined") {
        return window.atob(data);
    }
    return Buffer.from(data, "base64").toString("utf8");
}

const { Semver , SemverRange  } = sver;
function enumerateParentScopes(url) {
    const parentScopes = [];
    let separatorIndex = url.lastIndexOf("/");
    const protocolIndex = url.indexOf("://") + 1;
    while((separatorIndex = url.lastIndexOf("/", separatorIndex - 1)) !== protocolIndex){
        parentScopes.push(url.slice(0, separatorIndex + 1));
    }
    return parentScopes;
}
function getResolution(resolutions, name, pkgScope) {
    if (pkgScope && !pkgScope.endsWith("/")) throwInternalError(pkgScope);
    if (!pkgScope) return resolutions.primary[name];
    const scope = resolutions.secondary[pkgScope];
    var _scope_name;
    return (_scope_name = scope === null || scope === void 0 ? void 0 : scope[name]) !== null && _scope_name !== void 0 ? _scope_name : null;
}
function getFlattenedResolution(resolutions, name, pkgScope, flattenedSubpath) {
    // no current scope -> check the flattened scopes
    const parentScopes = enumerateParentScopes(pkgScope);
    for (const scopeUrl of parentScopes){
        if (!resolutions.flattened[scopeUrl]) continue;
        const flatResolutions = resolutions.flattened[scopeUrl][name];
        if (!flatResolutions) continue;
        for (const flatResolution of flatResolutions){
            if (flatResolution.export === flattenedSubpath || flatResolution.export.endsWith("/") && flattenedSubpath.startsWith(flatResolution.export)) {
                return flatResolution.resolution;
            }
        }
    }
    return null;
}
function setConstraint(constraints, name, target, pkgScope = null) {
    if (pkgScope === null) constraints.primary[name] = target;
    else (constraints.secondary[pkgScope] = constraints.secondary[pkgScope] || Object.create(null))[name] = target;
}
function setResolution(resolutions, name, installUrl, pkgScope = null, installSubpath = null) {
    if (pkgScope && !pkgScope.endsWith("/")) throwInternalError(pkgScope);
    if (pkgScope === null) {
        const existing = resolutions.primary[name];
        if (existing && existing.installUrl === installUrl && existing.installSubpath === installSubpath) return false;
        resolutions.primary[name] = {
            installUrl,
            installSubpath
        };
        return true;
    } else {
        resolutions.secondary[pkgScope] = resolutions.secondary[pkgScope] || {};
        const existing = resolutions.secondary[pkgScope][name];
        if (existing && existing.installUrl === installUrl && existing.installSubpath === installSubpath) return false;
        resolutions.secondary[pkgScope][name] = {
            installUrl,
            installSubpath
        };
        return true;
    }
}
function mergeLocks(resolutions, newResolutions) {
    for (const pkg of Object.keys(newResolutions.primary)){
        resolutions.primary[pkg] = newResolutions.primary[pkg];
    }
    for (const pkgUrl of Object.keys(newResolutions.secondary)){
        if (resolutions[pkgUrl]) Object.assign(resolutions[pkgUrl] = Object.create(null), newResolutions[pkgUrl]);
        else resolutions.secondary[pkgUrl] = newResolutions.secondary[pkgUrl];
    }
    for (const scopeUrl of Object.keys(newResolutions.flattened)){
        if (resolutions[scopeUrl]) Object.assign(resolutions[scopeUrl], newResolutions[scopeUrl]);
        else resolutions.flattened[scopeUrl] = newResolutions.flattened[scopeUrl];
    }
}
function mergeConstraints(constraints, newConstraints) {
    for (const pkg of Object.keys(newConstraints.primary)){
        constraints.primary[pkg] = newConstraints.primary[pkg];
    }
    for (const pkgUrl of Object.keys(newConstraints.secondary)){
        if (constraints[pkgUrl]) Object.assign(constraints[pkgUrl] = Object.create(null), newConstraints[pkgUrl]);
        else constraints.secondary[pkgUrl] = newConstraints.secondary[pkgUrl];
    }
}
function toPackageTargetMap(pcfg, pkgUrl, defaultRegistry = "npm", includeDev = false) {
    const constraints = Object.create(null);
    if (pcfg.dependencies) for (const name of Object.keys(pcfg.dependencies)){
        constraints[name] = newPackageTarget(pcfg.dependencies[name], pkgUrl, defaultRegistry, name).pkgTarget;
    }
    if (pcfg.peerDependencies) for (const name of Object.keys(pcfg.peerDependencies)){
        if (name in constraints) continue;
        constraints[name] = newPackageTarget(pcfg.peerDependencies[name], pkgUrl, defaultRegistry, name).pkgTarget;
    }
    if (pcfg.optionalDependencies) for (const name of Object.keys(pcfg.optionalDependencies)){
        if (name in constraints) continue;
        constraints[name] = newPackageTarget(pcfg.optionalDependencies[name], pkgUrl, defaultRegistry, name).pkgTarget;
    }
    if (includeDev && pcfg.devDependencies) for (const name of Object.keys(pcfg.devDependencies)){
        if (name in constraints) continue;
        constraints[name] = newPackageTarget(pcfg.devDependencies[name], pkgUrl, defaultRegistry, name).pkgTarget;
    }
    return constraints;
}
async function packageTargetFromExact(pkg, resolver, permitDowngrades = false) {
    let registry, name, version;
    if (pkg.registry === "node_modules") {
        // The node_modules versions are always URLs to npm-installed packages:
        const pkgUrl = decodeBase64(pkg.version);
        const pcfg = await resolver.getPackageConfig(pkgUrl);
        if (!pcfg) throw new JspmError(`Package ${pkgUrl} has no package config, cannot create package target.`);
        if (!pcfg.name || !pcfg.version) throw new JspmError(`Package ${pkgUrl} has no name or version, cannot create package target.`);
        name = pcfg.name;
        version = pcfg.version;
        registry = "npm";
    } else {
        // The other registries all use semver ranges:
        ({ registry , name , version  } = pkg);
    }
    const v = new Semver(version);
    if (v.tag) return {
        registry,
        name,
        ranges: [
            new SemverRange(version)
        ],
        unstable: false
    };
    if (permitDowngrades) {
        if (v.major !== 0) return {
            registry,
            name,
            ranges: [
                new SemverRange(v.major)
            ],
            unstable: false
        };
        if (v.minor !== 0) return {
            registry,
            name,
            ranges: [
                new SemverRange(v.major + "." + v.minor)
            ],
            unstable: false
        };
        return {
            registry,
            name,
            ranges: [
                new SemverRange(version)
            ],
            unstable: false
        };
    } else {
        return {
            registry,
            name,
            ranges: [
                new SemverRange("^" + version)
            ],
            unstable: false
        };
    }
}
function getConstraintFor(name, registry, constraints) {
    const installs = [];
    for (const [alias, target] of Object.entries(constraints.primary)){
        if (!(target instanceof URL) && target.registry === registry && target.name === name) installs.push({
            alias,
            pkgScope: null,
            ranges: target.ranges
        });
    }
    for (const [pkgScope, scope] of Object.entries(constraints.secondary)){
        for (const alias of Object.keys(scope)){
            const target = scope[alias];
            if (!(target instanceof URL) && target.registry === registry && target.name === name) installs.push({
                alias,
                pkgScope: pkgScope,
                ranges: target.ranges
            });
        }
    }
    return installs;
}
async function extractLockConstraintsAndMap(map, preloadUrls, mapUrl, rootUrl, defaultRegistry, resolver, // TODO: we should pass the whole providers namespace here so that we can
// enforce the user's URL-specific constraints on which provider to use:
provider) {
    const locks = {
        primary: Object.create(null),
        secondary: Object.create(null),
        flattened: Object.create(null)
    };
    const maps = {
        imports: Object.create(null),
        scopes: Object.create(null)
    };
    // Primary version constraints taken from the map configuration base (if found)
    const primaryBase = await resolver.getPackageBase(mapUrl.href);
    const primaryPcfg = await resolver.getPackageConfig(primaryBase);
    const constraints = {
        primary: primaryPcfg ? toPackageTargetMap(primaryPcfg, new URL(primaryBase), defaultRegistry, true) : Object.create(null),
        secondary: Object.create(null)
    };
    const pkgUrls = new Set();
    for (const key of Object.keys(map.imports || {})){
        if (isPlain(key)) {
            // Get the package name and subpath in package specifier space.
            const parsedKey = parsePkg(key);
            // Get the target package details in URL space:
            let { parsedTarget , pkgUrl , subpath  } = await resolveTargetPkg(map.imports[key], mapUrl, rootUrl, primaryBase, resolver);
            const exportSubpath = parsedTarget && await resolver.getExportResolution(pkgUrl, subpath, key);
            pkgUrls.add(pkgUrl);
            // If the plain specifier resolves to a package on some provider's CDN,
            // and there's a corresponding import/export map entry in that package,
            // then the resolution is standard and we can lock it:
            if (exportSubpath) {
                // Package "imports" resolutions don't constrain versions.
                if (key[0] === "#") continue;
                // Otherwise we treat top-level package versions as a constraint.
                if (!constraints.primary[parsedKey.pkgName]) {
                    constraints.primary[parsedKey.pkgName] = await packageTargetFromExact(parsedTarget.pkg, resolver);
                }
                // In the case of subpaths having diverging versions, we force convergence on one version
                // Only scopes permit unpacking
                let installSubpath = null;
                if (parsedKey.subpath !== exportSubpath) {
                    if (parsedKey.subpath === ".") {
                        installSubpath = exportSubpath;
                    } else if (exportSubpath === ".") {
                        installSubpath = false;
                    } else if (exportSubpath.endsWith(parsedKey.subpath.slice(1))) {
                        installSubpath = exportSubpath.slice(0, parsedKey.subpath.length);
                    }
                }
                if (installSubpath !== false) {
                    setResolution(locks, parsedKey.pkgName, pkgUrl, null, installSubpath);
                    continue;
                }
            }
            // Another possibility is that the bare specifier is a remapping for the
            // primary package's own-name, in which case we should check whether
            // there's a corresponding export in the primary pjson:
            if (primaryPcfg && primaryPcfg.name === parsedKey.pkgName) {
                const exportSubpath = await resolver.getExportResolution(primaryBase, subpath, key);
                // If the export subpath matches the key's subpath, then this is a
                // standard resolution:
                if (parsedKey.subpath === exportSubpath) continue;
            }
        }
        // Fallback - this resolution is non-standard, so we need to record it as
        // a custom import override:
        maps.imports[isPlain(key) ? key : resolveUrl(key, mapUrl, rootUrl)] = resolveUrl(map.imports[key], mapUrl, rootUrl);
    }
    for (const scopeUrl of Object.keys(map.scopes || {})){
        var _resolveUrl;
        const resolvedScopeUrl = (_resolveUrl = resolveUrl(scopeUrl, mapUrl, rootUrl)) !== null && _resolveUrl !== void 0 ? _resolveUrl : scopeUrl;
        const scopePkgUrl = await resolver.getPackageBase(resolvedScopeUrl);
        const flattenedScope = new URL(scopePkgUrl).pathname === "/";
        pkgUrls.add(scopePkgUrl);
        const scope = map.scopes[scopeUrl];
        for (const key of Object.keys(scope)){
            if (isPlain(key)) {
                // Get the package name and subpath in package specifier space.
                const parsedKey = parsePkg(key);
                // Get the target package details in URL space:
                let { parsedTarget , pkgUrl , subpath  } = await resolveTargetPkg(scope[key], mapUrl, rootUrl, scopePkgUrl, resolver);
                pkgUrls.add(pkgUrl);
                const exportSubpath = parsedTarget && await resolver.getExportResolution(pkgUrl, subpath, key);
                // TODO: we don't handle trailing-slash mappings here at all, which
                // leads to them sticking around in the import map as custom
                // resolutions forever.
                if (exportSubpath) {
                    // Imports resolutions that resolve as expected can be skipped
                    if (key[0] === "#") continue;
                    // If there is no constraint, we just make one as the semver major on the current version
                    if (!constraints.primary[parsedKey.pkgName]) constraints.primary[parsedKey.pkgName] = parsedTarget ? await packageTargetFromExact(parsedTarget.pkg, resolver) : new URL(pkgUrl);
                    // In the case of subpaths having diverging versions, we force convergence on one version
                    // Only scopes permit unpacking
                    let installSubpath = null;
                    if (parsedKey.subpath !== exportSubpath) {
                        if (parsedKey.subpath === ".") {
                            installSubpath = exportSubpath;
                        } else if (exportSubpath === ".") {
                            installSubpath = false;
                        } else {
                            if (exportSubpath.endsWith(parsedKey.subpath.slice(1))) installSubpath = exportSubpath.slice(0, parsedKey.subpath.length);
                        }
                    }
                    if (installSubpath !== false) {
                        if (flattenedScope) {
                            const flattened = locks.flattened[scopePkgUrl] = locks.flattened[scopePkgUrl] || {};
                            flattened[parsedKey.pkgName] = flattened[parsedKey.pkgName] || [];
                            flattened[parsedKey.pkgName].push({
                                export: parsedKey.subpath,
                                resolution: {
                                    installUrl: pkgUrl,
                                    installSubpath
                                }
                            });
                        } else {
                            setResolution(locks, parsedKey.pkgName, pkgUrl, scopePkgUrl, installSubpath);
                        }
                        continue;
                    }
                }
            }
            // Fallback -> Custom import with normalization
            (maps.scopes[resolvedScopeUrl] = maps.scopes[resolvedScopeUrl] || Object.create(null))[isPlain(key) ? key : resolveUrl(key, mapUrl, rootUrl)] = resolveUrl(scope[key], mapUrl, rootUrl);
        }
    }
    // for every package we resolved, add their package constraints into the list of constraints
    await Promise.all([
        ...pkgUrls
    ].map(async (pkgUrl)=>{
        if (!isURL(pkgUrl)) return;
        const pcfg = await getPackageConfig(pkgUrl);
        if (pcfg) constraints.secondary[pkgUrl] = toPackageTargetMap(pcfg, new URL(pkgUrl), defaultRegistry, false);
    }));
    // TODO: allow preloads to inform used versions somehow
    // for (const url of preloadUrls) {
    //   const resolved = resolveUrl(url, mapUrl, rootUrl).href;
    //   const providerPkg = resolver.parseUrlPkg(resolved);
    //   if (providerPkg) {
    //     const pkgUrl = await resolver.getPackageBase(mapUrl.href);
    //   }
    // }
    return {
        maps,
        constraints,
        locks: await enforceProviderConstraints(locks, provider, resolver, primaryBase)
    };
}
/**
 * Enforces the user's provider constraints, which map subsets of URL-space to
 * the provider that should be used to resolve them. Constraints are enforced
 * by re-resolving every input map lock and constraint against the provider
 * for their parent package URL.
 * TODO: actually handle provider constraints
 */ async function enforceProviderConstraints(locks, provider, resolver, basePkgUrl) {
    const res = {
        primary: {},
        secondary: {},
        flattened: {}
    };
    for (const [pkgName, lock] of Object.entries(locks.primary)){
        const { installUrl , installSubpath  } = await translateLock(lock, provider, resolver, basePkgUrl);
        setResolution(res, pkgName, installUrl, null, installSubpath);
    }
    for (const [pkgUrl, pkgLocks] of Object.entries(locks.secondary)){
        for (const [pkgName, lock] of Object.entries(pkgLocks)){
            const { installUrl , installSubpath  } = await translateLock(lock, provider, resolver, pkgUrl);
            setResolution(res, pkgName, installUrl, pkgUrl, installSubpath);
        }
    }
    for (const [scopeUrl, pkgLocks] of Object.entries(locks.flattened)){
        res.flattened[scopeUrl] = {};
        for (const [pkgName, locks] of Object.entries(pkgLocks)){
            res.flattened[scopeUrl][pkgName] = [];
            for (const lock of locks){
                const newLock = await translateLock(lock.resolution, provider, resolver, scopeUrl);
                res.flattened[scopeUrl][pkgName].push({
                    export: lock.export,
                    resolution: newLock
                });
            }
        }
    }
    return res;
}
async function translateLock(lock, provider, resolver, parentUrl) {
    const mdl = await resolver.parseUrlPkg(lock.installUrl);
    if (!mdl) return lock; // no provider owns it, nothing to translate
    const parentPkgUrl = await resolver.getPackageBase(parentUrl);
    const newMdl = await translateProvider(mdl, provider, resolver, parentPkgUrl);
    if (!newMdl) {
        // TODO: we should throw here once parent scoping is implemented
        // throw new JspmError(
        //   `Failed to translate ${lock.installUrl} to provider ${provider.provider}.`
        // );
        return lock;
    }
    return {
        installUrl: await resolver.pkgToUrl(newMdl.pkg, provider),
        installSubpath: lock.installSubpath
    };
}
async function translateProvider(mdl, { provider , layer  }, resolver, parentUrl) {
    const pkg = mdl.pkg;
    if ((pkg.registry === "deno" || pkg.registry === "denoland") && provider === "deno") {
        return mdl; // nothing to do if translating deno-to-deno
    } else if (pkg.registry === "deno" || pkg.registry === "denoland" || provider === "deno") {
        // TODO: we should throw here once parent scoping is implemented
        // throw new JspmError(
        //   "Cannot translate packages between the 'deno' provider and other providers."
        // );
        return null;
    }
    const fromNodeModules = pkg.registry === "node_modules";
    const toNodeModules = provider === "nodemodules";
    if (fromNodeModules === toNodeModules) {
        return {
            ...mdl,
            source: {
                provider,
                layer
            }
        };
    }
    const target = await packageTargetFromExact(pkg, resolver);
    let latestPkg;
    try {
        latestPkg = await resolver.resolveLatestTarget(target, {
            provider,
            layer
        }, parentUrl);
    } catch (err) {
        // TODO: we should throw here once parent scoping is implemented
        // throw new JspmError(
        //   `Failed to translate package ${pkg.name}@${pkg.version} to provider ${provider}.`
        // );
        return null;
    }
    return {
        pkg: latestPkg,
        source: {
            provider,
            layer
        },
        subpath: mdl.subpath
    };
}
async function resolveTargetPkg(moduleUrl, mapUrl, rootUrl, parentUrl, resolver, provider) {
    let targetUrl = resolveUrl(moduleUrl, mapUrl, rootUrl);
    let parsedTarget = await resolver.parseUrlPkg(targetUrl);
    let pkgUrl = parsedTarget ? await resolver.pkgToUrl(parsedTarget.pkg, parsedTarget.source) : await resolver.getPackageBase(targetUrl);
    const subpath = "." + targetUrl.slice(pkgUrl.length - 1);
    return {
        parsedTarget,
        pkgUrl,
        subpath
    };
}

var _this_providers, _npm;
class Installer {
    visitInstalls(visitor) {
        if (visitor(this.installs.primary, null)) return;
        for (const scopeUrl of Object.keys(this.installs.secondary)){
            if (visitor(this.installs.secondary[scopeUrl], scopeUrl)) return;
        }
    }
    startInstall() {
        if (this.installing) throw new Error("Internal error: already installing");
        this.installing = true;
        this.newInstalls = false;
        this.added = new Map();
    }
    finishInstall() {
        this.installing = false;
    }
    getProvider(target) {
        let provider = this.defaultProvider;
        for (const name of Object.keys(this.providers)){
            if (name.endsWith(":") && target.registry === name.slice(0, -1) || target.name.startsWith(name) && (target.name.length === name.length || target.name[name.length] === "/")) {
                provider = parseProviderStr(this.providers[name]);
                break;
            }
        }
        return provider;
    }
    /**
   * Locks a package against the given target.
   *
   * @param {string} pkgName Name of the package being installed.
   * @param {InstallTarget} target The installation target being installed.
   * @param {`./${string}` | '.'} traceSubpath
   * @param {InstallMode} mode Specifies how to interact with existing installs.
   * @param {`${string}/` | null} pkgScope URL of the package scope in which this install is occurring, null if it's a top-level install.
   * @param {string} parentUrl URL of the parent for this install.
   * @returns {Promise<InstalledResolution>}
   */ async installTarget(pkgName, { pkgTarget , installSubpath  }, traceSubpath, mode, pkgScope, parentUrl) {
        const isTopLevel = pkgScope === null;
        const useLatest = isTopLevel && mode.includes("latest") || !isTopLevel && mode === "latest-all";
        // Resolutions are always authoritative, and override the existing target:
        if (this.resolutions[pkgName]) {
            const resolutionTarget = newPackageTarget(this.resolutions[pkgName], this.opts.baseUrl, this.defaultRegistry, pkgName);
            resolutionTarget.installSubpath = installSubpath;
            if (JSON.stringify(pkgTarget) !== JSON.stringify(resolutionTarget.pkgTarget)) return this.installTarget(pkgName, resolutionTarget, traceSubpath, mode, pkgScope, parentUrl);
        }
        // URL targets are installed as locks directly, as we have no versioning
        // information to work with:
        if (pkgTarget instanceof URL) {
            const installHref = pkgTarget.href;
            const installUrl = installHref + (installHref.endsWith("/") ? "" : "/");
            this.log("installer/installTarget", `${pkgName} ${pkgScope} -> ${installHref} (URL)`);
            this.newInstalls = setResolution(this.installs, pkgName, installUrl, pkgScope, installSubpath);
            return {
                installUrl,
                installSubpath
            };
        }
        const provider = this.getProvider(pkgTarget);
        // Look for an existing lock for this package if we're in an install mode
        // that supports them:
        if (mode === "default" || mode === "freeze" || !useLatest) {
            const pkg = await this.getBestExistingMatch(pkgTarget);
            if (pkg) {
                this.log("installer/installTarget", `${pkgName} ${pkgScope} -> ${JSON.stringify(pkg)} (existing match)`);
                const installUrl = await this.resolver.pkgToUrl(pkg, provider);
                this.newInstalls = setResolution(this.installs, pkgName, installUrl, pkgScope, installSubpath);
                setConstraint(this.constraints, pkgName, pkgTarget, pkgScope);
                return {
                    installUrl,
                    installSubpath
                };
            }
        }
        const latestPkg = await this.resolver.resolveLatestTarget(pkgTarget, provider, parentUrl);
        const pkgUrl = await this.resolver.pkgToUrl(latestPkg, provider);
        const installed = getConstraintFor(latestPkg.name, latestPkg.registry, this.constraints);
        // If this is a secondary install, then we ideally want to upgrade all
        // existing locks on this package to latest and use that. If there's a
        // constraint and we can't, then we fallback to the best existing lock:
        if (mode !== "freeze" && !useLatest && !isTopLevel && latestPkg && !this.tryUpgradeAllTo(latestPkg, pkgUrl, installed)) {
            const pkg = await this.getBestExistingMatch(pkgTarget);
            // cannot upgrade to latest -> stick with existing resolution (if compatible)
            if (pkg) {
                this.log("installer/installTarget", `${pkgName} ${pkgScope} -> ${JSON.stringify(latestPkg)} (existing match not latest)`);
                const installUrl = await this.resolver.pkgToUrl(pkg, provider);
                this.newInstalls = setResolution(this.installs, pkgName, installUrl, pkgScope, installSubpath);
                setConstraint(this.constraints, pkgName, pkgTarget, pkgScope);
                return {
                    installUrl,
                    installSubpath
                };
            }
        }
        // Otherwise we install latest and make an attempt to upgrade any existing
        // locks that are compatible to the latest version:
        this.log("installer/installTarget", `${pkgName} ${pkgScope} -> ${pkgUrl} ${installSubpath ? installSubpath : "<no-subpath>"} (latest)`);
        this.newInstalls = setResolution(this.installs, pkgName, pkgUrl, pkgScope, installSubpath);
        setConstraint(this.constraints, pkgName, pkgTarget, pkgScope);
        if (mode !== "freeze") this.upgradeSupportedTo(latestPkg, pkgUrl, installed);
        return {
            installUrl: pkgUrl,
            installSubpath
        };
    }
    /**
   * Installs the given package specifier.
   *
   * @param {string} pkgName The package specifier being installed.
   * @param {InstallMode} mode Specifies how to interact with existing installs.
   * @param {`${string}/` | null} pkgScope URL of the package scope in which this install is occurring, null if it's a top-level install.
   * @param {`./${string}` | '.'} traceSubpath
   * @param {string} parentUrl URL of the parent for this install.
   * @returns {Promise<string | InstalledResolution>}
   */ async install(pkgName, mode, pkgScope = null, traceSubpath, parentUrl = this.installBaseUrl) {
        var _pcfg_dependencies, _pcfg_peerDependencies, _pcfg_optionalDependencies, _pcfg_devDependencies;
        this.log("installer/install", `installing ${pkgName} from ${parentUrl} in scope ${pkgScope}`);
        if (!this.installing) throwInternalError("Not installing");
        // Anything installed in the scope of the installer's base URL is treated
        // as top-level, and hits the primary locks. Anything else is treated as
        // a secondary dependency:
        // TODO: wire this concept through the whole codebase.
        const isTopLevel = !pkgScope || pkgScope == this.installBaseUrl;
        if (this.resolutions[pkgName]) return this.installTarget(pkgName, newPackageTarget(this.resolutions[pkgName], this.opts.baseUrl, this.defaultRegistry, pkgName), traceSubpath, mode, isTopLevel ? null : pkgScope, parentUrl);
        // Fetch the current scope's pjson:
        const definitelyPkgScope = pkgScope || await this.resolver.getPackageBase(parentUrl);
        const pcfg = await this.resolver.getPackageConfig(definitelyPkgScope) || {};
        // By default, we take an install target from the current scope's pjson:
        const pjsonTargetStr = ((_pcfg_dependencies = pcfg.dependencies) === null || _pcfg_dependencies === void 0 ? void 0 : _pcfg_dependencies[pkgName]) || ((_pcfg_peerDependencies = pcfg.peerDependencies) === null || _pcfg_peerDependencies === void 0 ? void 0 : _pcfg_peerDependencies[pkgName]) || ((_pcfg_optionalDependencies = pcfg.optionalDependencies) === null || _pcfg_optionalDependencies === void 0 ? void 0 : _pcfg_optionalDependencies[pkgName]) || isTopLevel && ((_pcfg_devDependencies = pcfg.devDependencies) === null || _pcfg_devDependencies === void 0 ? void 0 : _pcfg_devDependencies[pkgName]);
        const pjsonTarget = pjsonTargetStr && newPackageTarget(pjsonTargetStr, new URL(definitelyPkgScope), this.defaultRegistry, pkgName);
        const useLatestPjsonTarget = !!pjsonTarget && (isTopLevel && mode.includes("latest") || !isTopLevel && mode === "latest-all");
        // Find any existing locks in the current package scope, making sure
        // locks are always in-range for their parent scope pjsons:
        const existingResolution = getResolution(this.installs, pkgName, isTopLevel ? null : pkgScope);
        if (!useLatestPjsonTarget && existingResolution && (isTopLevel || mode === "freeze" || await this.inRange(existingResolution.installUrl, pjsonTarget.pkgTarget))) {
            this.log("installer/install", `existing lock for ${pkgName} from ${parentUrl} in scope ${pkgScope} is ${JSON.stringify(existingResolution)}`);
            return existingResolution;
        }
        // Pick up resolutions from flattened scopes like 'https://ga.jspm.io/"
        // for secondary installs, if they're in range for the current pjson, or
        // if we're in a freeze install:
        if (!isTopLevel) {
            const flattenedResolution = getFlattenedResolution(this.installs, pkgName, pkgScope, traceSubpath);
            if (!useLatestPjsonTarget && flattenedResolution && (mode === "freeze" || await this.inRange(flattenedResolution.installUrl, pjsonTarget.pkgTarget))) {
                this.newInstalls = setResolution(this.installs, pkgName, flattenedResolution.installUrl, pkgScope, flattenedResolution.installSubpath);
                return flattenedResolution;
            }
        }
        // Use the pjson target if it exists:
        if (pjsonTarget) {
            return this.installTarget(pkgName, pjsonTarget, traceSubpath, mode, isTopLevel ? null : pkgScope, parentUrl);
        }
        // Try resolve the package as a built-in:
        const specifier = pkgName + (traceSubpath ? traceSubpath.slice(1) : "");
        const builtin = this.resolver.resolveBuiltin(specifier);
        if (builtin) {
            if (typeof builtin === "string") return builtin;
            return this.installTarget(specifier, // TODO: either change the types so resolveBuiltin always returns a
            // fully qualified InstallTarget, or support string targets here.
            builtin.target, traceSubpath, mode, isTopLevel ? null : pkgScope, parentUrl);
        }
        // existing primary version fallback
        if (this.installs.primary[pkgName]) {
            const { installUrl  } = getResolution(this.installs, pkgName, null);
            return {
                installUrl,
                installSubpath: null
            };
        }
        // global install fallback
        const target = newPackageTarget("*", new URL(definitelyPkgScope), this.defaultRegistry, pkgName);
        const { installUrl  } = await this.installTarget(pkgName, target, null, mode, isTopLevel ? null : pkgScope, parentUrl);
        return {
            installUrl,
            installSubpath: null
        };
    }
    // Note: maintain this live instead of recomputing
    get pkgUrls() {
        const pkgUrls = new Set();
        for (const pkgUrl of Object.values(this.installs.primary)){
            pkgUrls.add(pkgUrl.installUrl);
        }
        for (const scope of Object.keys(this.installs.secondary)){
            for (const { installUrl  } of Object.values(this.installs.secondary[scope])){
                pkgUrls.add(installUrl);
            }
        }
        for (const flatScope of Object.keys(this.installs.flattened)){
            for (const { resolution: { installUrl  }  } of Object.values(this.installs.flattened[flatScope]).flat()){
                pkgUrls.add(installUrl);
            }
        }
        return pkgUrls;
    }
    async getBestExistingMatch(matchPkg) {
        let bestMatch = null;
        for (const pkgUrl of this.pkgUrls){
            const pkg = await this.resolver.parseUrlPkg(pkgUrl);
            if (pkg && await this.inRange(pkg.pkg, matchPkg)) {
                if (bestMatch) bestMatch = Semver$1.compare(new Semver$1(bestMatch.version), pkg.pkg.version) === -1 ? pkg.pkg : bestMatch;
                else bestMatch = pkg.pkg;
            }
        }
        return bestMatch;
    }
    async inRange(pkg, target) {
        var _ref;
        // URL|null targets don't have ranges, so nothing is in-range for them:
        if (!target || target instanceof URL) return false;
        const pkgExact = typeof pkg === "string" ? (_ref = await this.resolver.parseUrlPkg(pkg)) === null || _ref === void 0 ? void 0 : _ref.pkg : pkg;
        if (!pkgExact) return false;
        return pkgExact.registry === target.registry && pkgExact.name === target.name && target.ranges.some((range)=>range.has(pkgExact.version, true));
    }
    // upgrade all existing packages to this package if possible
    tryUpgradeAllTo(pkg, pkgUrl, installed) {
        const pkgVersion = new Semver$1(pkg.version);
        let allCompatible = true;
        for (const { ranges  } of installed){
            if (ranges.every((range)=>!range.has(pkgVersion))) allCompatible = false;
        }
        if (!allCompatible) return false;
        // if every installed version can support this new version, update them all
        for (const { alias , pkgScope  } of installed){
            const resolution = getResolution(this.installs, alias, pkgScope);
            if (!resolution) continue;
            const { installSubpath  } = resolution;
            this.newInstalls = setResolution(this.installs, alias, pkgUrl, pkgScope, installSubpath);
        }
        return true;
    }
    // upgrade some exsiting packages to the new install
    upgradeSupportedTo(pkg, pkgUrl, installed) {
        const pkgVersion = new Semver$1(pkg.version);
        for (const { alias , pkgScope , ranges  } of installed){
            const resolution = getResolution(this.installs, alias, pkgScope);
            if (!resolution) continue;
            if (!ranges.some((range)=>range.has(pkgVersion, true))) continue;
            const { installSubpath  } = resolution;
            this.newInstalls = setResolution(this.installs, alias, pkgUrl, pkgScope, installSubpath);
        }
    }
    constructor(baseUrl, opts, log, resolver){
        this.installing = false;
        this.newInstalls = false;
        this.added = new Map();
        this.hasLock = false;
        this.defaultProvider = {
            provider: "jspm.io",
            layer: "default"
        };
        this.defaultRegistry = "npm";
        this.log = log;
        this.resolver = resolver;
        this.resolutions = opts.resolutions || {};
        this.installBaseUrl = baseUrl;
        this.opts = opts;
        this.hasLock = !!opts.lock;
        this.installs = opts.lock || {
            primary: Object.create(null),
            secondary: Object.create(null),
            flattened: Object.create(null)
        };
        this.constraints = {
            primary: Object.create(null),
            secondary: Object.create(null)
        };
        if (opts.defaultRegistry) this.defaultRegistry = opts.defaultRegistry;
        if (opts.defaultProvider) this.defaultProvider = parseProviderStr(opts.defaultProvider);
        this.providers = Object.assign({}, registryProviders);
        var _;
        // TODO: this is a hack, as we currently don't have proper support for
        // providers owning particular registries. The proper way to do this would
        // be to have each provider declare what registries it supports, and
        // construct a providers mapping at init when we detect default provider:
        if (opts.defaultProvider.includes("deno")) (_ = (_this_providers = this.providers)[_npm = "npm:"]) !== null && _ !== void 0 ? _ : _this_providers[_npm] = "jspm.io";
        if (opts.providers) Object.assign(this.providers, opts.providers);
    }
}
function parseProviderStr(provider) {
    const split = provider.split("#");
    return {
        provider: split[0],
        layer: split[1] || "default"
    };
}

function combineSubpaths(installSubpath, traceSubpath) {
    return installSubpath === null || traceSubpath === "." ? installSubpath || traceSubpath : `${installSubpath}${traceSubpath.slice(1)}`;
}
class TraceMap {
    async addInputMap(map, mapUrl = this.mapUrl, rootUrl = this.rootUrl, preloads) {
        return this.processInputMap = this.processInputMap.then(async ()=>{
            const inMap = new ImportMap({
                map,
                mapUrl,
                rootUrl
            }).rebase(this.mapUrl, this.rootUrl);
            const pins = Object.keys(inMap.imports || []);
            for (const pin of pins){
                if (!this.pins.includes(pin)) this.pins.push(pin);
            }
            const { maps , locks , constraints  } = await extractLockConstraintsAndMap(inMap, preloads, mapUrl, rootUrl, this.installer.defaultRegistry, this.resolver, this.installer.defaultProvider);
            this.inputMap.extend(maps);
            mergeLocks(this.installer.installs, locks);
            mergeConstraints(this.installer.constraints, constraints);
        });
    }
    /**
   * Resolves, analyses and recursively visits the given module specifier and all of its dependencies.
   *
   * @param {string} specifier Module specifier to visit.
   * @param {VisitOpts} opts Visitor configuration.
   * @param {} parentUrl URL of the parent context for the specifier.
   * @param {} seen Cache for optimisation.
   */ async visit(specifier, opts, parentUrl = this.baseUrl.href, seen = new Set()) {
        var _this_opts_ignore;
        if (!parentUrl) throw new Error("Internal error: expected parentUrl");
        if ((_this_opts_ignore = this.opts.ignore) === null || _this_opts_ignore === void 0 ? void 0 : _this_opts_ignore.includes(specifier)) return;
        if (seen.has(`${specifier}##${parentUrl}`)) return;
        seen.add(`${specifier}##${parentUrl}`);
        this.log("tracemap/visit", `Attempting to resolve ${specifier} to a module from ${parentUrl}, toplevel=${opts.toplevel}, mode=${opts.installMode}`);
        const resolved = await this.resolve(specifier, parentUrl, opts.installMode, opts.toplevel);
        // We support analysis of CommonJS modules for local workflows, where it's
        // very likely that the user has some CommonJS dependencies, but this is
        // something that the user has to explicitly enable:
        const entry = await this.getTraceEntry(resolved, parentUrl);
        if ((entry === null || entry === void 0 ? void 0 : entry.format) === "commonjs" && entry.usesCjs && !this.opts.commonJS) {
            throw new JspmError(`Unable to trace ${resolved}, as it is a CommonJS module. Either enable CommonJS tracing explicitly by setting "GeneratorOptions.commonJS" to true, or use a provider that performs ESM transpiling like jspm.io via defaultProvider: 'jspm.io'.`);
        }
        if (opts.visitor) {
            const stop = await opts.visitor(specifier, parentUrl, resolved, opts.toplevel, entry);
            if (stop) return;
        }
        if (!entry) return;
        let allDeps = [
            ...entry.deps
        ];
        if (entry.dynamicDeps.length && !opts.static) {
            for (const dep of entry.dynamicDeps){
                if (!allDeps.includes(dep)) allDeps.push(dep);
            }
        }
        if (entry.cjsLazyDeps && !opts.static) {
            for (const dep of entry.cjsLazyDeps){
                if (!allDeps.includes(dep)) allDeps.push(dep);
            }
        }
        if (opts.toplevel && (isMappableScheme(specifier) || isPlain(specifier))) {
            opts = {
                ...opts,
                toplevel: false
            };
        }
        await Promise.all(allDeps.map(async (dep)=>{
            if (dep.indexOf("*") !== -1) {
                this.log("todo", "Handle wildcard trace " + dep + " in " + resolved);
                return;
            }
            await this.visit(dep, opts, resolved, seen);
        }));
    }
    async extractMap(modules) {
        const map = new ImportMap({
            mapUrl: this.mapUrl,
            rootUrl: this.rootUrl
        });
        // note this plucks custom top-level custom imports
        // we may want better control over this
        map.extend(this.inputMap);
        // re-drive all the traces to convergence
        do {
            this.installer.newInstalls = false;
            await Promise.all(modules.map(async (module)=>{
                await this.visit(module, {
                    installMode: "freeze",
                    static: this.opts.static,
                    toplevel: true
                });
            }));
        }while (this.installer.newInstalls)
        // The final loop gives us the mappings
        const staticList = new Set();
        const dynamicList = new Set();
        const dynamics = [];
        let list = staticList;
        const visitor = async (specifier, parentUrl, resolved, toplevel, entry)=>{
            if (!staticList.has(resolved)) list.add(resolved);
            if (entry) for (const dep of entry.dynamicDeps){
                dynamics.push([
                    dep,
                    resolved
                ]);
            }
            if (toplevel) {
                if (isPlain(specifier) || isMappableScheme(specifier)) {
                    var _this_tracedUrls, _this_tracedUrls_parentUrl;
                    const existing = map.imports[specifier];
                    if (!existing || existing !== resolved && ((_this_tracedUrls = this.tracedUrls) === null || _this_tracedUrls === void 0 ? void 0 : (_this_tracedUrls_parentUrl = _this_tracedUrls[parentUrl]) === null || _this_tracedUrls_parentUrl === void 0 ? void 0 : _this_tracedUrls_parentUrl.wasCjs)) {
                        map.set(specifier, resolved);
                    }
                }
            } else {
                if (isPlain(specifier) || isMappableScheme(specifier)) {
                    var _map_scopes_scopeUrl, _map_scopes_parentUrl;
                    const scopeUrl = await this.resolver.getPackageBase(parentUrl);
                    const existing = (_map_scopes_scopeUrl = map.scopes[scopeUrl]) === null || _map_scopes_scopeUrl === void 0 ? void 0 : _map_scopes_scopeUrl[specifier];
                    if (!existing) {
                        map.set(specifier, resolved, scopeUrl);
                    } else if (existing !== resolved && ((_map_scopes_parentUrl = map.scopes[parentUrl]) === null || _map_scopes_parentUrl === void 0 ? void 0 : _map_scopes_parentUrl[specifier]) !== resolved) {
                        map.set(specifier, resolved, parentUrl);
                    }
                }
            }
        };
        const seen = new Set();
        await Promise.all(modules.map(async (module)=>{
            await this.visit(module, {
                static: true,
                visitor,
                installMode: "freeze",
                toplevel: true
            }, this.baseUrl.href, seen);
        }));
        list = dynamicList;
        await Promise.all(dynamics.map(async ([specifier, parent])=>{
            await this.visit(specifier, {
                visitor,
                installMode: "freeze",
                toplevel: false
            }, parent, seen);
        }));
        if (this.installer.newInstalls) ;
        return {
            map,
            staticDeps: [
                ...staticList
            ],
            dynamicDeps: [
                ...dynamicList
            ]
        };
    }
    startInstall() {
        this.installer.startInstall();
    }
    async finishInstall(modules = this.pins) {
        const result = await this.extractMap(modules);
        this.installer.finishInstall();
        return result;
    }
    async add(name, target, opts) {
        await this.installer.installTarget(name, target, null, opts, null, this.mapUrl.href);
    }
    /**
   * @returns `resolved` - either a URL `string` pointing to the module or `null` if the specifier should be ignored.
   */ async resolve(specifier, parentUrl, installOpts, toplevel) {
        var _this_tracedUrls_parentUrl, _this_tracedUrls_parentUrl1;
        const cjsEnv = (_this_tracedUrls_parentUrl = this.tracedUrls[parentUrl]) === null || _this_tracedUrls_parentUrl === void 0 ? void 0 : _this_tracedUrls_parentUrl.wasCjs;
        const parentPkgUrl = await this.resolver.getPackageBase(parentUrl);
        if (!parentPkgUrl) throwInternalError();
        const parentIsCjs = ((_this_tracedUrls_parentUrl1 = this.tracedUrls[parentUrl]) === null || _this_tracedUrls_parentUrl1 === void 0 ? void 0 : _this_tracedUrls_parentUrl1.format) === "commonjs";
        if ((!isPlain(specifier) || specifier === "..") && !isMappableScheme(specifier)) {
            let resolvedUrl = new URL(specifier, parentUrl);
            if (!isFetchProtocol(resolvedUrl.protocol)) throw new JspmError(`Found unexpected protocol ${resolvedUrl.protocol}${importedFrom(parentUrl)}`);
            const resolvedHref = resolvedUrl.href;
            let finalized = await this.resolver.realPath(await this.resolver.finalizeResolve(resolvedHref, parentIsCjs, parentPkgUrl));
            // handle URL mappings
            const urlResolved = this.inputMap.resolve(finalized, parentUrl);
            // TODO: avoid this hack - perhaps solved by conditional maps
            if (urlResolved !== finalized && !urlResolved.startsWith("node:") && !urlResolved.startsWith("deno:")) {
                finalized = urlResolved;
            }
            if (finalized !== resolvedHref) {
                this.inputMap.set(resolvedHref.endsWith("/") ? resolvedHref.slice(0, -1) : resolvedHref, finalized);
                resolvedUrl = new URL(finalized);
            }
            this.log("tracemap/resolve", `${specifier} ${parentUrl} -> ${resolvedUrl} (URL resolution)`);
            return resolvedUrl.href;
        }
        // Subscope override
        const scopeMatches = getScopeMatches(parentUrl, this.inputMap.scopes, this.inputMap.mapUrl);
        const pkgSubscopes = scopeMatches.filter(([, url])=>url.startsWith(parentPkgUrl));
        if (pkgSubscopes.length) {
            for (const [scope] of pkgSubscopes){
                const mapMatch = getMapMatch$1(specifier, this.inputMap.scopes[scope]);
                if (mapMatch) {
                    const resolved = await this.resolver.realPath(resolveUrl(this.inputMap.scopes[scope][mapMatch] + specifier.slice(mapMatch.length), this.inputMap.mapUrl, this.inputMap.rootUrl));
                    this.log("tracemap/resolve", `${specifier} ${parentUrl} -> ${resolved} (subscope resolution)`);
                    return resolved;
                }
            }
        }
        // Scope override
        // TODO: isn't this subsumed by previous check?
        const userScopeMatch = scopeMatches.find(([, url])=>url === parentPkgUrl);
        if (userScopeMatch) {
            const imports = this.inputMap.scopes[userScopeMatch[0]];
            const userImportsMatch = getMapMatch$1(specifier, imports);
            const userImportsResolved = userImportsMatch ? await this.resolver.realPath(resolveUrl(imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.inputMap.mapUrl, this.inputMap.rootUrl)) : null;
            if (userImportsResolved) {
                this.log("tracemap/resolve", `${specifier} ${parentUrl} -> ${userImportsResolved} (scope resolution)`);
                return userImportsResolved;
            }
        }
        // User import overrides
        const userImportsMatch = getMapMatch$1(specifier, this.inputMap.imports);
        const userImportsResolved = userImportsMatch ? await this.resolver.realPath(resolveUrl(this.inputMap.imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.inputMap.mapUrl, this.inputMap.rootUrl)) : null;
        if (userImportsResolved) {
            this.log("tracemap/resolve", `${specifier} ${parentUrl} -> ${userImportsResolved} (imports resolution)`);
            return userImportsResolved;
        }
        const parsed = parsePkg(specifier);
        if (!parsed) throw new JspmError(`Invalid package name ${specifier}`);
        const { pkgName , subpath  } = parsed;
        // Own name import
        const pcfg = await this.resolver.getPackageConfig(parentPkgUrl) || {};
        if (pcfg.exports && pcfg.name === pkgName) {
            const resolved = await this.resolver.realPath(await this.resolver.resolveExport(parentPkgUrl, subpath, cjsEnv, parentIsCjs, specifier, this.installer, new URL(parentUrl)));
            this.log("tracemap/resolve", `${specifier} ${parentUrl} -> ${resolved} (package own-name resolution)`);
            return resolved;
        }
        // Imports
        if (pcfg.imports && pkgName[0] === "#") {
            const match = getMapMatch$1(specifier, pcfg.imports);
            if (!match) throw new JspmError(`No '${specifier}' import defined in ${parentPkgUrl}${importedFrom(parentUrl)}.`);
            const target = this.resolver.resolvePackageTarget(pcfg.imports[match], parentPkgUrl, cjsEnv, specifier.slice(match.length), true);
            if (!isURL(target)) {
                return this.resolve(target, parentUrl, installOpts, toplevel);
            }
            const resolved = await this.resolver.realPath(target);
            this.log("tracemap/resolve", `${specifier} ${parentUrl} -> ${resolved} (package imports resolution)`);
            return resolved;
        }
        // @ts-ignore
        const installed = await this.installer.install(pkgName, installOpts, toplevel ? null : parentPkgUrl, subpath, parentUrl);
        if (typeof installed === "string") {
            return installed;
        } else if (installed) {
            const { installUrl , installSubpath  } = installed;
            const resolved = await this.resolver.realPath(await this.resolver.resolveExport(installUrl, combineSubpaths(installSubpath, subpath), cjsEnv, parentIsCjs, specifier, this.installer, new URL(parentUrl)));
            this.log("tracemap/resolve", `${specifier} ${parentUrl} -> ${resolved} (installation resolution)`);
            return resolved;
        }
        throw new JspmError(`No resolution in map for ${specifier}${importedFrom(parentUrl)}`);
    }
    async getTraceEntry(resolvedUrl, parentUrl) {
        if (resolvedUrl in this.tracedUrls) {
            const entry = this.tracedUrls[resolvedUrl];
            await entry.promise;
            return entry;
        }
        if (isBuiltinScheme(resolvedUrl)) return null;
        if (resolvedUrl.endsWith("/")) throw new JspmError(`Trailing "/" installs not supported installing ${resolvedUrl} for ${parentUrl}`);
        const traceEntry = this.tracedUrls[resolvedUrl] = {
            promise: null,
            wasCjs: false,
            usesCjs: false,
            deps: null,
            dynamicDeps: null,
            cjsLazyDeps: null,
            hasStaticParent: true,
            size: NaN,
            integrity: "",
            format: undefined
        };
        traceEntry.promise = (async ()=>{
            var _this_tracedUrls_parentUrl;
            const parentIsCjs = ((_this_tracedUrls_parentUrl = this.tracedUrls[parentUrl]) === null || _this_tracedUrls_parentUrl === void 0 ? void 0 : _this_tracedUrls_parentUrl.format) === "commonjs";
            const { deps , dynamicDeps , cjsLazyDeps , size , format , usesCjs  } = await this.resolver.analyze(resolvedUrl, parentUrl, this.opts.system, parentIsCjs);
            traceEntry.format = format;
            traceEntry.size = size;
            traceEntry.deps = deps.sort();
            traceEntry.dynamicDeps = dynamicDeps.sort();
            traceEntry.cjsLazyDeps = cjsLazyDeps ? cjsLazyDeps.sort() : cjsLazyDeps;
            // wasCJS distinct from CJS because it applies to CJS transformed into ESM
            // from the resolver perspective
            const wasCJS = format === "commonjs" || await this.resolver.wasCommonJS(resolvedUrl);
            if (wasCJS) traceEntry.wasCjs = true;
            traceEntry.promise = null;
        })();
        await traceEntry.promise;
        return traceEntry;
    }
    constructor(opts, log, resolver){
        this.tracedUrls = {};
        this.pins = [];
        /**
   * Lock to ensure no races against input map processing.
   * @type {Promise<void>}
   */ this.processInputMap = Promise.resolve();
        this.log = log;
        this.resolver = resolver;
        this.mapUrl = opts.mapUrl;
        this.baseUrl = opts.baseUrl;
        this.rootUrl = opts.rootUrl || null;
        this.opts = opts;
        this.inputMap = new ImportMap({
            mapUrl: this.mapUrl,
            rootUrl: this.rootUrl
        });
        this.installer = new Installer(this.mapUrl.pathname.endsWith("/") ? this.mapUrl.href : `${this.mapUrl.href}/`, this.opts, this.log, this.resolver);
    }
}

function createLogger() {
    let resolveQueue;
    let queuePromise = new Promise((resolve)=>resolveQueue = resolve);
    let queue = [];
    const logStream = async function*() {
        while(true){
            while(queue.length)yield queue.shift();
            await queuePromise;
        }
    };
    function log(type, message) {
        if (queue.length) {
            queue.push({
                type,
                message
            });
        } else {
            queue = [
                {
                    type,
                    message
                }
            ];
            const _resolveQueue = resolveQueue;
            queuePromise = new Promise((resolve)=>resolveQueue = resolve);
            _resolveQueue();
        }
    }
    return {
        log,
        logStream
    };
}

const wsRegEx = /^\s+/;
class Replacer {
    replace(start, end, replacement) {
        const startOffset = findOffset(this.offsetTable, start);
        const endOffset = findOffset(this.offsetTable, end);
        this.source = this.source.slice(0, start + startOffset) + replacement + this.source.slice(end + endOffset);
        addOffset(this.offsetTable, end, replacement.length - (end + endOffset - start - startOffset));
    }
    remove(start, end, trimWs = false) {
        this.replace(start, end, "");
        if (trimWs) {
            if (typeof trimWs === "boolean") trimWs = wsRegEx;
            const endIndex = this.idx(end);
            var _this_source_slice_match;
            const [wsMatch] = (_this_source_slice_match = this.source.slice(endIndex).match(trimWs)) !== null && _this_source_slice_match !== void 0 ? _this_source_slice_match : [];
            var _ref;
            this.source = this.source.slice(0, endIndex) + this.source.slice((_ref = endIndex + (wsMatch === null || wsMatch === void 0 ? void 0 : wsMatch.length)) !== null && _ref !== void 0 ? _ref : 0);
            var _ref1;
            addOffset(this.offsetTable, end, (_ref1 = -(wsMatch === null || wsMatch === void 0 ? void 0 : wsMatch.length)) !== null && _ref1 !== void 0 ? _ref1 : 0);
        }
    }
    idx(idx) {
        return idx + findOffset(this.offsetTable, idx);
    }
    constructor(source){
        this.offsetTable = [];
        this.source = source;
    }
}
function addOffset(offsetTable, idx, offset) {
    let i = offsetTable.length, eq = false;
    while(i-- > 0){
        const [offsetIdx] = offsetTable[i];
        if (offsetIdx < idx || offsetIdx === idx && (eq = true)) break;
    }
    if (eq) offsetTable.splice(i, 1, [
        idx,
        offset + offsetTable[i][1]
    ]);
    else offsetTable.splice(i + 1, 0, [
        idx,
        offset
    ]);
}
function findOffset(offsetTable, idx) {
    let curOffset = 0;
    for (const [offsetIdx, offset] of offsetTable){
        if (offsetIdx > idx) break;
        curOffset += offset;
    }
    return curOffset;
}

var _globalThis_process, _globalThis_process1, _globalThis_process2;
const isWindows = ((_globalThis_process = globalThis.process) === null || _globalThis_process === void 0 ? void 0 : _globalThis_process.platform) === "win32";
isWindows ? Object.keys((_globalThis_process1 = globalThis.process) === null || _globalThis_process1 === void 0 ? void 0 : _globalThis_process1.env).find((e)=>Boolean(e.match(/^PATH$/i))) || "Path" : "PATH";
((_globalThis_process2 = globalThis.process) === null || _globalThis_process2 === void 0 ? void 0 : _globalThis_process2.platform) === "win32" ? ";" : ":";

const defaultStyle = {
    tab: "  ",
    newline: isWindows ? "\r\n" : "\n",
    trailingNewline: isWindows ? "\r\n" : "\n",
    indent: "",
    quote: '"'
};
function detectNewline(source) {
    let newLineMatch = source.match(/\r?\n|\r(?!\n)/);
    if (newLineMatch) return newLineMatch[0];
    return isWindows ? "\r\n" : "\n";
}
function detectIndent$1(source, newline) {
    let indent = undefined;
    // best-effort tab detection
    // yes this is overkill, but it avoids possibly annoying edge cases
    let lines = source.split(newline);
    for (const line of lines){
        const curIndent = line.match(/^\s*[^\s]/);
        if (curIndent && (indent === undefined || curIndent.length < indent.length)) indent = curIndent[0].slice(0, -1);
    }
    indent = indent || "";
    lines = lines.map((line)=>line.slice(indent.length));
    let tabSpaces = lines.map((line)=>{
        var _line_match;
        return ((_line_match = line.match(/^[ \t]*/)) === null || _line_match === void 0 ? void 0 : _line_match[0]) || "";
    }) || [];
    let tabDifferenceFreqs = new Map();
    let lastLength = 0;
    tabSpaces.forEach((tabSpace)=>{
        let diff = Math.abs(tabSpace.length - lastLength);
        if (diff !== 0) tabDifferenceFreqs.set(diff, (tabDifferenceFreqs.get(diff) || 0) + 1);
        lastLength = tabSpace.length;
    });
    let bestTabLength = 0;
    for (const tabLength of tabDifferenceFreqs.keys()){
        if (!bestTabLength || tabDifferenceFreqs.get(tabLength) >= tabDifferenceFreqs.get(bestTabLength)) bestTabLength = tabLength;
    }
    // having determined the most common spacing difference length,
    // generate samples of this tab length from the end of each line space
    // the most common sample is then the tab string
    let tabSamples = new Map();
    tabSpaces.forEach((tabSpace)=>{
        let sample = tabSpace.substr(tabSpace.length - bestTabLength);
        tabSamples.set(sample, (tabSamples.get(sample) || 0) + 1);
    });
    let bestTabSample = "";
    for (const [sample, freq] of tabSamples){
        if (!bestTabSample || freq > tabSamples.get(bestTabSample)) bestTabSample = sample;
    }
    if (lines.length < 5 && lines.reduce((cnt, line)=>cnt + line.length, 0) < 100) bestTabSample = "  ";
    return {
        indent: indent || "",
        tab: bestTabSample
    };
}
function detectStyle(source) {
    let style = Object.assign({}, defaultStyle);
    style.newline = detectNewline(source);
    let { indent , tab  } = detectIndent$1(source, style.newline);
    style.indent = indent;
    style.tab = tab;
    let quoteMatch = source.match(/"|'/);
    if (quoteMatch) style.quote = quoteMatch[0];
    style.trailingNewline = source && source.match(new RegExp(style.newline + "$")) ? style.newline : "";
    return style;
}

function parseStyled(source, fileName) {
    // remove any byte order mark
    if (source.startsWith("\uFEFF")) source = source.substr(1);
    let style = detectStyle(source);
    try {
        return {
            json: JSON.parse(source),
            style
        };
    } catch (e) {
        throw new JspmError(`Error parsing JSON file${fileName ? " " + fileName : ""}`);
    }
}

let source, i;
const alwaysSelfClosing = [
    "link",
    "base"
];
function parseHtml(_source, tagNames = [
    "script",
    "link",
    "base",
    "!--"
]) {
    const scripts = [];
    source = _source;
    i = 0;
    let curScript = {
        tagName: undefined,
        start: -1,
        end: -1,
        attributes: [],
        innerStart: -1,
        innerEnd: -1
    };
    while(i < source.length){
        var _readTagName;
        while(source.charCodeAt(i++) !== 60 /*<*/ )if (i === source.length) return scripts;
        const start = i - 1;
        const tagName = (_readTagName = readTagName()) === null || _readTagName === void 0 ? void 0 : _readTagName.toLowerCase();
        if (tagName === "!--") {
            while(source.charCodeAt(i) !== 45 /*-*/  || source.charCodeAt(i + 1) !== 45 /*-*/  || source.charCodeAt(i + 2) !== 62 /*>*/ )if (++i === source.length) return scripts;
            scripts.push({
                tagName: "!--",
                start: start,
                end: i + 3,
                attributes: [],
                innerStart: start + 3,
                innerEnd: i
            });
            i += 3;
        } else if (tagName === undefined) {
            return scripts;
        } else if (tagNames.includes(tagName)) {
            curScript.tagName = tagName;
            curScript.start = i - tagName.length - 2;
            const attributes = curScript.attributes;
            let attr;
            while(attr = scanAttr())attributes.push(attr);
            let selfClosing = alwaysSelfClosing.includes(tagName);
            if (source.charCodeAt(i - 2) === 47 /*/*/  && source.charCodeAt(i - 1) === 62 /*>*/ ) selfClosing = true;
            if (selfClosing) {
                curScript.end = i;
            } else {
                curScript.innerStart = i;
                while(true){
                    while(source.charCodeAt(i++) !== 60 /*<*/ )if (i === source.length) return scripts;
                    const tag = readTagName();
                    if (tag === undefined) return scripts;
                    if (tag === `/${curScript.tagName}`) {
                        curScript.innerEnd = i - 8;
                        while(scanAttr());
                        curScript.end = i;
                        break;
                    }
                }
            }
            scripts.push(curScript);
            curScript = {
                tagName: undefined,
                start: -1,
                end: -1,
                attributes: [],
                innerStart: -1,
                innerEnd: -1
            };
        } else {
            while(scanAttr());
        }
    }
    return scripts;
}
function readTagName() {
    let start = i;
    let ch;
    while(!isWs(ch = source.charCodeAt(i++)) && ch !== 62 /*>*/ )if (i === source.length) return null;
    return source.slice(start, ch === 62 ? --i : i - 1);
}
function scanAttr() {
    let ch;
    while(isWs(ch = source.charCodeAt(i)))if (++i === source.length) return null;
    if (ch === 62 /*>*/  || ch === 47 /*/*/  && (ch = source.charCodeAt(++i)) === 62) {
        i++;
        return null;
    }
    const nameStart = i;
    while(!isWs(ch = source.charCodeAt(i++)) && ch !== 61 /*=*/ ){
        if (i === source.length) return null;
        if (ch === 62 /*>*/ ) {
            if (nameStart + 2 === i && source.charCodeAt(nameStart) === 47 /*/*/ ) return null;
            return {
                nameStart,
                nameEnd: --i,
                valueStart: -1,
                valueEnd: -1
            };
        }
    }
    const nameEnd = i - 1;
    if (ch !== 61 /*=*/ ) {
        while(isWs(ch = source.charCodeAt(i)) && ch !== 61 /*=*/ ){
            if (++i === source.length) return null;
            if (ch === 62 /*>*/ ) return null;
        }
        if (ch !== 61 /*=*/ ) return {
            nameStart,
            nameEnd,
            valueStart: -1,
            valueEnd: -1
        };
    }
    while(isWs(ch = source.charCodeAt(i++))){
        if (i === source.length) return null;
        if (ch === 62 /*>*/ ) return null;
    }
    if (ch === 34 /*"*/ ) {
        const valueStart = i;
        while(source.charCodeAt(i++) !== 34 /*"*/ )if (i === source.length) return null;
        return {
            nameStart,
            nameEnd,
            valueStart,
            valueEnd: i - 1
        };
    } else if (ch === 39 /*'*/ ) {
        const valueStart = i;
        while(source.charCodeAt(i++) !== 39 /*'*/ )if (i === source.length) return null;
        return {
            nameStart,
            nameEnd,
            valueStart,
            valueEnd: i - 1
        };
    } else {
        const valueStart = i - 1;
        i++;
        while(!isWs(ch = source.charCodeAt(i)) && ch !== 62 /*>*/ )if (++i === source.length) return null;
        return {
            nameStart,
            nameEnd,
            valueStart,
            valueEnd: i
        };
    }
}
function isWs(ch) {
    return ch === 32 || ch < 14 && ch > 8;
} // function logScripts (source: string, scripts: ParsedTag[]) {
 //   for (const script of scripts) {
 //     for (const { nameStart, nameEnd, valueStart, valueEnd } of script.attributes) {
 //       console.log('Name: ' + source.slice(nameStart, nameEnd));
 //       if (valueStart !== -1)
 //         console.log('Value: ' + source.slice(valueStart, valueEnd));
 //     }
 //     console.log('"' + source.slice(script.innerStart, script.innerEnd) + '"');
 //     console.log('"' + source.slice(script.start, script.end) + '"');
 //   }
 // }

function getAttr(source, tag, name) {
    for (const attr of tag.attributes){
        if (source.slice(attr.nameStart, attr.nameEnd) === name) return source.slice(attr.valueStart, attr.valueEnd);
    }
    return null;
}
const esmsSrcRegEx = /(^|\/)(es-module-shims|esms)(\.min)?\.js$/;
function toHtmlAttrs(source, attributes) {
    return Object.fromEntries(attributes.map((attr)=>readAttr(source, attr)).map((attr)=>[
            attr.name,
            attr
        ]));
}
function analyzeHtml(source, url = baseUrl) {
    const analysis = {
        base: url,
        newlineTab: "\n",
        map: {
            json: null,
            style: null,
            start: -1,
            end: -1,
            newScript: false,
            attrs: null
        },
        staticImports: new Set(),
        dynamicImports: new Set(),
        preloads: [],
        modules: [],
        esModuleShims: null,
        comments: []
    };
    const tags = parseHtml(source, [
        "!--",
        "base",
        "script",
        "link"
    ]);
    let createdInjectionPoint = false;
    for (const tag of tags){
        switch(tag.tagName){
            case "!--":
                analysis.comments.push({
                    start: tag.start,
                    end: tag.end,
                    attrs: {}
                });
                break;
            case "base":
                const href = getAttr(source, tag, "href");
                if (href) analysis.base = new URL(href, url);
                break;
            case "script":
                const type = getAttr(source, tag, "type");
                if (type === "importmap") {
                    const mapText = source.slice(tag.innerStart, tag.innerEnd);
                    const emptyMap = mapText.trim().length === 0;
                    const { json , style  } = emptyMap ? {
                        json: {},
                        style: defaultStyle
                    } : parseStyled(mapText, url.href + "#importmap");
                    const { start , end  } = tag;
                    const attrs = toHtmlAttrs(source, tag.attributes);
                    let lastChar = tag.start;
                    while(isWs(source.charCodeAt(--lastChar)));
                    analysis.newlineTab = detectIndent(source, lastChar + 1);
                    analysis.map = {
                        json,
                        style,
                        start,
                        end,
                        attrs,
                        newScript: false
                    };
                    createdInjectionPoint = true;
                } else if (type === "module") {
                    const src = getAttr(source, tag, "src");
                    if (src) {
                        if (esmsSrcRegEx.test(src)) {
                            analysis.esModuleShims = {
                                start: tag.start,
                                end: tag.end,
                                attrs: toHtmlAttrs(source, tag.attributes)
                            };
                        } else {
                            analysis.staticImports.add(isPlain(src) ? "./" + src : src);
                            analysis.modules.push({
                                start: tag.start,
                                end: tag.end,
                                attrs: toHtmlAttrs(source, tag.attributes)
                            });
                        }
                    } else {
                        const [imports] = parse(source.slice(tag.innerStart, tag.innerEnd)) || [];
                        for (const { n , d  } of imports){
                            if (!n) continue;
                            (d === -1 ? analysis.staticImports : analysis.dynamicImports).add(n);
                        }
                    }
                } else if (!type || type === "javascript") {
                    const src = getAttr(source, tag, "src");
                    if (src) {
                        if (esmsSrcRegEx.test(src)) {
                            analysis.esModuleShims = {
                                start: tag.start,
                                end: tag.end,
                                attrs: toHtmlAttrs(source, tag.attributes)
                            };
                        }
                    } else {
                        const [imports] = parse(source.slice(tag.innerStart, tag.innerEnd)) || [];
                        for (const { n , d  } of imports){
                            if (!n) continue;
                            (d === -1 ? analysis.staticImports : analysis.dynamicImports).add(n);
                        }
                    }
                }
                // If we haven't found an injection point already, then we default to
                // injecting before the first link/script tag:
                if (!createdInjectionPoint) {
                    createInjectionPoint(source, tag.start, analysis.map, tag, analysis);
                    createdInjectionPoint = true;
                }
                break;
            case "link":
                if (getAttr(source, tag, "rel") === "modulepreload") {
                    const { start , end  } = tag;
                    const attrs = toHtmlAttrs(source, tag.attributes);
                    analysis.preloads.push({
                        start,
                        end,
                        attrs
                    });
                }
                // If we haven't found an injection point already, then we default to
                // injecting before the first link/script tag:
                if (!createdInjectionPoint) {
                    createInjectionPoint(source, tag.start, analysis.map, tag, analysis);
                    createdInjectionPoint = true;
                }
        }
    }
    // If we haven't found an existing import map to base the injection on, we
    // fall back to injecting into the head:
    if (!createdInjectionPoint) {
        var _parseHtml;
        const head = (_parseHtml = parseHtml(source, [
            "head"
        ])) === null || _parseHtml === void 0 ? void 0 : _parseHtml[0];
        if (head) {
            let injectionPoint = head.innerStart;
            while(source[injectionPoint] !== "<")injectionPoint++;
            createInjectionPoint(source, injectionPoint, analysis.map, head, analysis);
            createdInjectionPoint = true;
        }
    }
    // As a final fallback we inject into the end of the document:
    if (!createdInjectionPoint) {
        createInjectionPoint(source, source.length, analysis.map, {
            tagName: "html",
            start: source.length,
            end: source.length,
            attributes: [],
            innerStart: source.length,
            innerEnd: source.length
        }, analysis);
    }
    return analysis;
}
function createInjectionPoint(source, injectionPoint, map, tag, analysis) {
    let lastChar = injectionPoint;
    while(isWs(source.charCodeAt(--lastChar)));
    analysis.newlineTab = detectIndent(source, lastChar + 1);
    if (analysis.newlineTab.indexOf("\n") === -1) {
        lastChar = tag.start;
        while(isWs(source.charCodeAt(--lastChar)));
        analysis.newlineTab = detectIndent(source, lastChar + 1);
    }
    map.newScript = true;
    map.attrs = toHtmlAttrs(source, tag.attributes);
    map.start = map.end = injectionPoint;
}
function readAttr(source, { nameStart , nameEnd , valueStart , valueEnd  }) {
    return {
        start: nameStart,
        end: valueEnd !== -1 ? valueEnd : nameEnd,
        quote: valueStart !== -1 && (source[valueStart - 1] === '"' || source[valueStart - 1] === "'") ? source[valueStart - 1] : "",
        name: source.slice(nameStart, nameEnd),
        value: valueStart === -1 ? null : source.slice(valueStart, valueEnd)
    };
}
function detectIndent(source, atIndex) {
    if (source === "" || atIndex === -1) return "";
    const nlIndex = atIndex;
    if (source[atIndex] === "\r" && source[atIndex + 1] === "\n") atIndex++;
    if (source[atIndex] === "\n") atIndex++;
    while(source[atIndex] === " " || source[atIndex] === "\t")atIndex++;
    return source.slice(nlIndex, atIndex) || "";
}

// @ts-ignore
function createProvider(baseUrl, ownsBaseUrl) {
    return {
        ownsUrl,
        pkgToUrl,
        parseUrlPkg,
        resolveLatestTarget,
        getPackageConfig
    };
    function ownsUrl(url) {
        // The nodemodules provider owns the base URL when it is the default
        // provider so that it can link against a user's local installs, letting
        // us support "file:" dependencies:
        return ownsBaseUrl && url === baseUrl || url.includes("/node_modules/");
    }
    async function pkgToUrl(pkg) {
        // The node_modules registry uses the base64-encoded URL of the package as
        // the package version, so we need to decode it to get the right copy. See
        // comments in the `resolveLatestTarget` function for details:
        if (pkg.registry === "node_modules") {
            return `${decodeBase64(pkg.version)}`;
        }
        // If we don't have a URL in the package name, then we need to try and
        // resolve the package against the node_modules in the base package:
        const target = await nodeResolve.call(this, pkg.name, baseUrl);
        if (!target) throw new JspmError(`Failed to resolve ${pkg.name} against node_modules from ${baseUrl}`);
        return `${decodeBase64(target.version)}`;
    }
    function parseUrlPkg(url) {
        // We can only resolve packages in node_modules folders:
        const nodeModulesIndex = url.lastIndexOf("/node_modules/");
        if (nodeModulesIndex === -1) return null;
        const nameAndSubpaths = url.slice(nodeModulesIndex + 14).split("/");
        const name = nameAndSubpaths[0][0] === "@" ? `${nameAndSubpaths[0]}/${nameAndSubpaths[1]}` : nameAndSubpaths[0];
        const pkgUrl = `${url.slice(0, nodeModulesIndex + 14)}${name}/`;
        const subpath = `./${url.slice(pkgUrl.length)}`;
        if (name && pkgUrl) {
            return {
                pkg: {
                    name,
                    registry: "node_modules",
                    version: encodeBase64(pkgUrl)
                },
                subpath: subpath === "./" ? null : subpath,
                layer: "default"
            };
        }
    }
    async function resolveLatestTarget(target, _layer, parentUrl) {
        return nodeResolve.call(this, target.name, parentUrl);
    }
    async function getPackageConfig(pkgUrl) {
        if (!ownsUrl.call(this, pkgUrl)) return null;
        const pkgJsonUrl = new URL("package.json", pkgUrl);
        const res = await fetch$1(pkgJsonUrl.href, this.fetchOpts);
        switch(res.status){
            case 200:
            case 304:
                break;
            default:
                return null;
        }
        async function remap(deps) {
            if (!deps) return;
            for (const [name, dep] of Object.entries(deps)){
                if (!isLocal(dep)) continue;
                const remappedUrl = new URL(`./node_modules/${name}`, pkgUrl);
                if (!await dirExists.call(this, remappedUrl)) continue;
                deps[name] = remappedUrl.href;
            }
        }
        const pcfg = await res.json();
        await remap.call(this, pcfg.dependencies);
        await remap.call(this, pcfg.peerDependencies);
        await remap.call(this, pcfg.optionalDependencies);
        await remap.call(this, pcfg.devDependencies);
        return pcfg;
    }
}
/**
 * Mimics the node resolution algorithm: look for a node_modules in the
 * current directory with a package matching the target, and if you can't
 * find it then recurse through the parent directories until you do.
 * TODO: we don't currently handle the target's version constraints here
 */ async function nodeResolve(name, parentUrl) {
    let curUrl = new URL(`node_modules/${name}`, parentUrl);
    const rootUrl = new URL(`/node_modules/${name}`, parentUrl).href;
    const isScoped = name[0] === "@";
    while(!await dirExists.call(this, curUrl)){
        if (curUrl.href === rootUrl) return null; // failed to resolve
        curUrl = new URL(`../../${isScoped ? "../" : ""}node_modules/${name}`, curUrl);
    }
    // Providers need to be able to translate between canonical package specs and
    // URLs in a one-to-one fashion. The nodemodules provider breaks this contract
    // as a node_modules folder may contain multiple copies of a given package
    // and version, and if the user has local packages installed then "identical"
    // packages may have different contents! To work around this use the
    // base64-encoded URL of the package as the package version in the local
    // registry, which we can decode to get the right copy:
    return {
        name,
        registry: "node_modules",
        version: encodeBase64(`${curUrl.href}/`)
    };
}
async function dirExists(url, parentUrl) {
    const res = await fetch$1(url, this.fetchOpts);
    switch(res.status){
        case 304:
        case 200:
            return true;
        case 404:
            return false;
        default:
            throw new JspmError(`Invalid status code ${res.status} looking up "${url}" - ${res.statusText}${importedFrom(parentUrl)}`);
    }
}
function isLocal(dep) {
    return dep.startsWith("file:");
}

/**
 * Supports clearing the global fetch cache in Node.js.
 *
 * Example:
 *
 * ```js
 * import { clearCache } from '@jspm/generator';
 * clearCache();
 * ```
 */ function clearCache() {
    clearCache$1();
}
/**
 * Generator.
 */ class Generator {
    /**
   * Add new custom mappings and lock resolutions to the input map
   * of the generator, which are then applied in subsequent installs.
   *
   * @param jsonOrHtml The mappings are parsed as a JSON data object or string, falling back to reading an inline import map from an HTML file.
   * @param mapUrl An optional URL for the map to handle relative resolutions, defaults to generator mapUrl.
   * @param rootUrl An optional root URL for the map to handle root resolutions, defaults to generator rootUrl.
   * @returns The list of modules pinned by this import map or HTML.
   */ async addMappings(jsonOrHtml, mapUrl = this.mapUrl, rootUrl = this.rootUrl, preloads) {
        if (typeof mapUrl === "string") mapUrl = new URL(mapUrl, this.baseUrl);
        if (typeof rootUrl === "string") rootUrl = new URL(rootUrl, this.baseUrl);
        let htmlModules;
        if (typeof jsonOrHtml === "string") {
            try {
                jsonOrHtml = JSON.parse(jsonOrHtml);
            } catch  {
                const analysis = analyzeHtml(jsonOrHtml, mapUrl);
                jsonOrHtml = analysis.map.json || {};
                preloads = (preloads || []).concat(analysis.preloads.map((preload)=>{
                    var _preload_attrs_href;
                    return (_preload_attrs_href = preload.attrs.href) === null || _preload_attrs_href === void 0 ? void 0 : _preload_attrs_href.value;
                }).filter((x)=>x));
                htmlModules = [
                    ...new Set([
                        ...analysis.staticImports,
                        ...analysis.dynamicImports
                    ])
                ];
            }
        }
        await this.traceMap.addInputMap(jsonOrHtml, mapUrl, rootUrl, preloads);
        return htmlModules || [
            ...this.traceMap.pins
        ];
    }
    /**
   * Retrieve the lockfile data from the installer
   */ getLock() {
        return JSON.parse(JSON.stringify(this.traceMap.installer.installs));
    }
    /**
   * Trace and pin a module, installing all dependencies necessary into the map
   * to support its execution including static and dynamic module imports.
   *
   * @deprecated Use "link" instead.
   */ async pin(specifier, parentUrl) {
        return this.link(specifier, parentUrl);
    }
    /**
   * Trace a module, installing all dependencies necessary into the map
   * to support its execution including static and dynamic module imports.
   *
   * @param specifier Module to trace
   * @param parentUrl Optional parent URL
   * @deprecated Use "link" instead.
   */ async traceInstall(specifier, parentUrl) {
        return this.link(specifier, parentUrl);
    }
    /**
   * Link a module, installing all dependencies necessary into the map
   * to support its execution including static and dynamic module imports.
   *
   * @param specifier Module to link
   * @param parentUrl Optional parent URL
   */ async link(specifier, parentUrl) {
        if (typeof specifier === "string") specifier = [
            specifier
        ];
        let error = false;
        if (this.installCnt++ === 0) this.traceMap.startInstall();
        specifier = specifier.map((specifier)=>specifier.replace(/\\/g, "/"));
        await this.traceMap.processInputMap;
        try {
            await Promise.all(specifier.map((specifier)=>this.traceMap.visit(specifier, {
                    installMode: "freeze",
                    toplevel: true
                }, parentUrl || this.baseUrl.href)));
            for (const s of specifier){
                if (!this.traceMap.pins.includes(s)) this.traceMap.pins.push(s);
            }
        } catch (e) {
            error = true;
            throw e;
        } finally{
            if (--this.installCnt === 0) {
                const { map , staticDeps , dynamicDeps  } = await this.traceMap.finishInstall();
                this.map = map;
                if (!error) return {
                    staticDeps,
                    dynamicDeps
                };
            }
        }
    }
    /**
   * Links every imported module in the given HTML file, installing all
   * dependencies necessary to support its execution.
   *
   * @param html HTML to link
   * @param htmlUrl URL of the given HTML
   */ async linkHtml(html, htmlUrl) {
        if (Array.isArray(html)) {
            const impts = await Promise.all(html.map((h)=>this.linkHtml(h, htmlUrl)));
            return [
                ...new Set(impts)
            ].reduce((a, b)=>a.concat(b), []);
        }
        let resolvedUrl;
        if (htmlUrl) {
            if (typeof htmlUrl === "string") {
                resolvedUrl = new URL(resolveUrl(htmlUrl, this.mapUrl, this.rootUrl));
            } else {
                resolvedUrl = htmlUrl;
            }
        }
        const analysis = analyzeHtml(html, resolvedUrl);
        const impts = [
            ...new Set([
                ...analysis.staticImports,
                ...analysis.dynamicImports
            ])
        ];
        await Promise.all(impts.map((impt)=>{
            return this.link(impt, resolvedUrl === null || resolvedUrl === void 0 ? void 0 : resolvedUrl.href);
        }));
        return impts;
    }
    /**
   * Generate and inject an import map for an HTML file
   *
   * @deprecated Instead use:
   *   const pins = await generator.addMappings(html, mapUrl, rootUrl);
   *   return await generator.htmlInject(html, { pins, htmlUrl: mapUrl, rootUrl, preload, integrity, whitespace, esModuleShims, comment });
   *
   * Traces the module scripts of the HTML via link and install
   * for URL-like specifiers and bare specifiers respectively.
   *
   * Injects the final generated import map returning the injected HTML
   *
   * @param html String
   * @param injectOptions Injection options
   *
   * Injection options are: `htmlUrl`, `preload`, `integrity`, `whitespace`
   * and `esModuleShims`. The default is `\{ esModuleShims: true, whitespace: true \}`.
   *
   * ES Module shims will be resolved to the latest version against the provider
   *
   * Example:
   *
   * ```js
   *  const outputHtml = await generator.htmlGenerate(`
   *    <!doctype html>
   *    <script type="module">import 'react'</script>
   *  `);
   *   // <!doctype html>
   *   // <!-- Generated by @jspm/generator - https://github.com/jspm/generator -->
   *   // <script async src="https://ga.jspm.io/npm:es-module-shims@1.4.1/dist/es-module-shims.js"></script>
   *   // <script type="importmap">
   *   // {...}
   *   // </script>
   *   // <script type="module">import 'react'</script>
   * ```
   *
   */ async htmlGenerate(html, { mapUrl , rootUrl , htmlUrl , preload =false , integrity =false , whitespace =true , esModuleShims =true , comment =true  } = {}) {
        if (typeof mapUrl === "string") mapUrl = new URL(mapUrl);
        const pins = await this.addMappings(html, mapUrl, rootUrl);
        return await this.htmlInject(html, {
            pins,
            htmlUrl: htmlUrl || mapUrl,
            rootUrl,
            preload,
            integrity,
            whitespace,
            esModuleShims,
            comment
        });
    }
    /**
   * Inject the import map into the provided HTML source
   *
   * @param html HTML source to inject into
   * @param opts Injection options
   * @returns HTML source with import map injection
   */ async htmlInject(html, { trace =false , pins =!trace , htmlUrl , rootUrl , preload =false , integrity =false , whitespace =true , esModuleShims =true , comment =true  } = {}) {
        if (comment === true) comment = " Generated by @jspm/generator - https://github.com/jspm/generator ";
        if (typeof htmlUrl === "string") htmlUrl = new URL(htmlUrl);
        if (integrity) preload = true;
        if (this.installCnt !== 0) throw new JspmError("htmlGenerate cannot run alongside other install ops");
        const analysis = analyzeHtml(html, htmlUrl);
        let modules = pins === true ? this.traceMap.pins : Array.isArray(pins) ? pins : [];
        if (trace) {
            const impts = await this.linkHtml(html, htmlUrl);
            modules = [
                ...new Set([
                    ...modules,
                    ...impts
                ])
            ];
        }
        try {
            var { map , staticDeps , dynamicDeps  } = await this.extractMap(modules, htmlUrl, rootUrl);
        } catch (err) {
            // Most likely cause of a generation failure:
            throw new JspmError(`${err.message}\n\nIf you are linking locally against your node_modules folder, make sure that you have all the necessary dependencies installed.`);
        }
        const preloadDeps = preload === true && integrity || preload === "all" ? [
            ...new Set([
                ...staticDeps,
                ...dynamicDeps
            ])
        ] : staticDeps;
        const newlineTab = !whitespace ? analysis.newlineTab : analysis.newlineTab.includes("\n") ? analysis.newlineTab : "\n" + analysis.newlineTab;
        const replacer = new Replacer(html);
        let esms = "";
        if (esModuleShims) {
            let esmsPkg;
            try {
                esmsPkg = await this.traceMap.resolver.resolveLatestTarget({
                    name: "es-module-shims",
                    registry: "npm",
                    ranges: [
                        new SemverRange$2("*")
                    ],
                    unstable: false
                }, this.traceMap.installer.defaultProvider, this.baseUrl.href);
            } catch (err) {
                // This usually happens because the user is trying to use their
                // node_modules as the provider but has not installed the shim:
                let errMsg = `Unable to resolve "es-module-shims@*" under current provider "${this.traceMap.installer.defaultProvider.provider}".`;
                if (this.traceMap.installer.defaultProvider.provider === "nodemodules") {
                    errMsg += `\n\nJspm automatically injects a shim so that the import map in your HTML file will be usable by older browsers.\nYou may need to run "npm install es-module-shims" to install the shim if you want to link against your local node_modules folder.`;
                }
                errMsg += `\nTo disable the import maps polyfill injection, set esModuleShims: false.`;
                throw new JspmError(errMsg);
            }
            let esmsUrl = await this.traceMap.resolver.pkgToUrl(esmsPkg, this.traceMap.installer.defaultProvider) + "dist/es-module-shims.js";
            if (htmlUrl || rootUrl) esmsUrl = relativeUrl(new URL(esmsUrl), new URL(rootUrl !== null && rootUrl !== void 0 ? rootUrl : htmlUrl), !!rootUrl);
            esms = `<script async src="${esmsUrl}" crossorigin="anonymous"${integrity ? ` integrity="${await getIntegrity(esmsUrl, this.traceMap.resolver.fetchOpts)}"` : ""}></script>${newlineTab}`;
            if (analysis.esModuleShims) replacer.remove(analysis.esModuleShims.start, analysis.esModuleShims.end, true);
        }
        for (const preload of analysis.preloads){
            replacer.remove(preload.start, preload.end, true);
        }
        let preloads = "";
        if (preload && preloadDeps.length) {
            let first = true;
            for (let dep of preloadDeps.sort()){
                if (first || whitespace) preloads += newlineTab;
                if (first) first = false;
                if (integrity) {
                    preloads += `<link rel="modulepreload" href="${rootUrl || htmlUrl ? relativeUrl(new URL(dep), new URL(rootUrl || htmlUrl), !!rootUrl) : dep}" integrity="${await getIntegrity(dep, this.traceMap.resolver.fetchOpts)}" />`;
                } else {
                    preloads += `<link rel="modulepreload" href="${rootUrl || htmlUrl ? relativeUrl(new URL(dep), new URL(rootUrl || htmlUrl), !!rootUrl) : dep}" />`;
                }
            }
        }
        // when applying integrity, all existing script tags have their integrity updated
        if (integrity) {
            for (const module of analysis.modules){
                if (!module.attrs.src) continue;
                if (module.attrs.integrity) {
                    replacer.remove(module.attrs.integrity.start - (replacer.source[replacer.idx(module.attrs.integrity.start - 1)] === " " ? 1 : 0), module.attrs.integrity.end + 1);
                }
                const lastAttr = Object.keys(module.attrs).filter((attr)=>attr !== "integrity").sort((a, b)=>module.attrs[a].end > module.attrs[b].end ? -1 : 1)[0];
                replacer.replace(module.attrs[lastAttr].end + 1, module.attrs[lastAttr].end + 1, ` integrity="${await getIntegrity(resolveUrl(module.attrs.src.value, this.mapUrl, this.rootUrl), this.traceMap.resolver.fetchOpts)}"`);
            }
        }
        if (comment) {
            const existingComment = analysis.comments.find((c)=>replacer.source.slice(replacer.idx(c.start), replacer.idx(c.end)).includes(comment));
            if (existingComment) {
                replacer.remove(existingComment.start, existingComment.end, true);
            }
        }
        replacer.replace(analysis.map.start, analysis.map.end, (comment ? "<!--" + comment + "-->" + newlineTab : "") + esms + '<script type="importmap">' + (whitespace ? newlineTab : "") + JSON.stringify(map, null, whitespace ? 2 : 0).replace(/\n/g, newlineTab) + (whitespace ? newlineTab : "") + "</script>" + preloads + (analysis.map.newScript ? newlineTab : ""));
        return replacer.source;
    }
    /**
   * Install a package target into the import map, including all its dependency resolutions via tracing.
   *
   * @param install Package or list of packages to install into the import map.
   *
   * @example
   * ```js
   * // Install a new package into the import map
   * await generator.install('react-dom');
   *
   * // Install a package version and subpath into the import map (installs lit/decorators.js)
   * await generator.install('lit@2/decorators.js');
   *
   * // Install a package version to a custom alias
   * await generator.install({ alias: 'react16', target: 'react@16' });
   *
   * // Install a specific subpath of a package
   * await generator.install({ target: 'lit@2', subpath: './html.js' });
   *
   * // Install an export from a locally located package folder into the map
   * // The package.json is used to determine the exports and dependencies.
   * await generator.install({ alias: 'mypkg', target: './packages/local-pkg', subpath: './feature' });
   * ```
   */ async install(install) {
        return this._install(install);
    }
    async _install(install, mode) {
        // Backwards-compatibility for deprecated options:
        if (this.latest) mode !== null && mode !== void 0 ? mode : mode = "latest-primaries";
        if (this.freeze) mode !== null && mode !== void 0 ? mode : mode = "freeze";
        // If there are no arguments, then we reinstall all the top-level locks:
        if (install === null || install === undefined) {
            await this.traceMap.processInputMap;
            // To match the behaviour of an argumentless `npm install`, we use
            // existing resolutions for everything unless it's out-of-range:
            mode !== null && mode !== void 0 ? mode : mode = "default";
            return this._install(Object.entries(this.traceMap.installer.installs.primary).map(([alias, target])=>{
                const pkgTarget = this.traceMap.installer.constraints.primary[alias];
                // Try to reinstall lock against constraints if possible, otherwise
                // reinstall it as a URL directly (which has the downside that it
                // won't have NPM versioning semantics):
                let newTarget = target.installUrl;
                if (pkgTarget) {
                    if (pkgTarget instanceof URL) {
                        newTarget = pkgTarget.href;
                    } else {
                        newTarget = `${pkgTarget.registry}:${pkgTarget.name}`;
                    }
                }
                var _target_installSubpath;
                return {
                    alias,
                    target: newTarget,
                    subpath: (_target_installSubpath = target.installSubpath) !== null && _target_installSubpath !== void 0 ? _target_installSubpath : undefined
                };
            }), mode);
        }
        // Split the case of multiple install targets:
        if (Array.isArray(install)) {
            if (install.length === 0) {
                const { map , staticDeps , dynamicDeps  } = await this.traceMap.finishInstall();
                this.map = map;
                return {
                    staticDeps,
                    dynamicDeps
                };
            }
            return await Promise.all(install.map((install)=>this._install(install, mode))).then((installs)=>installs.find((i)=>i));
        }
        // Split the case of multiple install subpaths:
        if (typeof install !== "string" && install.subpaths !== undefined) {
            install.subpaths.every((subpath)=>{
                if (typeof subpath !== "string" || subpath !== "." && !subpath.startsWith("./")) throw new Error(`Install subpath "${subpath}" must be equal to "." or start with "./".`);
            });
            return await Promise.all(install.subpaths.map((subpath)=>this._install({
                    target: install.target,
                    alias: install.alias,
                    subpath
                }, mode))).then((installs)=>installs.find((i)=>i));
        }
        // Handle case of a single install target with at most one subpath:
        let error = false;
        if (this.installCnt++ === 0) this.traceMap.startInstall();
        await this.traceMap.processInputMap; // don't race input processing
        try {
            // Resolve input information to a target package:
            let alias, target, subpath;
            if (typeof install === "string" || typeof install.target === "string") {
                ({ alias , target , subpath  } = await installToTarget.call(this, install, this.traceMap.installer.defaultRegistry));
            } else {
                ({ alias , target , subpath  } = install);
                validatePkgName(alias);
            }
            this.log("generator/install", `Adding primary constraint for ${alias}: ${JSON.stringify(target)}`);
            // By default, an install takes the latest compatible version for primary
            // dependencies, and existing in-range versions for secondaries:
            mode !== null && mode !== void 0 ? mode : mode = "latest-primaries";
            await this.traceMap.add(alias, target, mode);
            await this.traceMap.visit(alias + subpath.slice(1), {
                installMode: mode,
                toplevel: true
            }, this.mapUrl.href);
            // Add the target package as a top-level pin:
            if (!this.traceMap.pins.includes(alias + subpath.slice(1))) this.traceMap.pins.push(alias + subpath.slice(1));
        } catch (e) {
            error = true;
            throw e;
        } finally{
            if (--this.installCnt === 0) {
                const { map , staticDeps , dynamicDeps  } = await this.traceMap.finishInstall();
                this.map = map;
                if (!error) return {
                    staticDeps,
                    dynamicDeps
                };
            }
        }
    }
    /**
   * Locking install, retraces all top-level pins but does not change the
   * versions of anything (similar to "npm ci").
   *
   * @deprecated Use install() with the "freeze: true" option.
   */ async reinstall() {
        if (this.installCnt++ === 0) this.traceMap.startInstall();
        await this.traceMap.processInputMap;
        if (--this.installCnt === 0) {
            const { map , staticDeps , dynamicDeps  } = await this.traceMap.finishInstall();
            this.map = map;
            return {
                staticDeps,
                dynamicDeps
            };
        }
    }
    /**
   * Updates the versions of the given packages to the latest versions
   * compatible with their parent's package.json ranges. If no packages are
   * given then all the top-level packages in the "imports" field of the
   * initial import map are updated.
   *
   * @param {string | string[]} pkgNames Package name or list of package names to update.
   */ async update(pkgNames) {
        if (typeof pkgNames === "string") pkgNames = [
            pkgNames
        ];
        if (this.installCnt++ === 0) this.traceMap.startInstall();
        await this.traceMap.processInputMap;
        const primaryResolutions = this.traceMap.installer.installs.primary;
        const primaryConstraints = this.traceMap.installer.constraints.primary;
        // Matching the behaviour of "npm update":
        let mode = "latest-primaries";
        if (!pkgNames) {
            pkgNames = Object.keys(primaryResolutions);
            mode = "latest-all";
        }
        const installs = [];
        for (const name of pkgNames){
            const resolution = primaryResolutions[name];
            if (!resolution) {
                this.installCnt--;
                throw new JspmError(`No "imports" package entry for "${name}" to update. Note update takes package names not package specifiers.`);
            }
            const { installUrl , installSubpath  } = resolution;
            const subpaths = this.traceMap.pins.filter((pin)=>pin === name || pin.startsWith(name) && pin[name.length] === "/").map((pin)=>`.${pin.slice(name.length)}`);
            // use package.json range if present
            if (primaryConstraints[name]) {
                installs.push({
                    alias: name,
                    subpaths,
                    target: {
                        pkgTarget: primaryConstraints[name],
                        installSubpath
                    }
                });
            } else {
                const pkg = await this.traceMap.resolver.parseUrlPkg(installUrl);
                if (!pkg) throw new Error(`Unable to determine a package version lookup for ${name}. Make sure it is supported as a provider package.`);
                const target = {
                    pkgTarget: {
                        registry: pkg.pkg.registry,
                        name: pkg.pkg.name,
                        ranges: [
                            new SemverRange$2("^" + pkg.pkg.version)
                        ],
                        unstable: false
                    },
                    installSubpath
                };
                installs.push({
                    alias: name,
                    subpaths,
                    target
                });
            }
        }
        await this._install(installs, mode);
        if (--this.installCnt === 0) {
            const { map , staticDeps , dynamicDeps  } = await this.traceMap.finishInstall();
            this.map = map;
            return {
                staticDeps,
                dynamicDeps
            };
        }
    }
    async uninstall(names) {
        if (typeof names === "string") names = [
            names
        ];
        if (this.installCnt++ === 0) {
            this.traceMap.startInstall();
        }
        await this.traceMap.processInputMap;
        let pins = this.traceMap.pins;
        const unusedNames = new Set([
            ...names
        ]);
        for(let i = 0; i < pins.length; i++){
            const pin = pins[i];
            const pinNames = names.filter((name)=>name === pin || name.endsWith("/") && pin.startsWith(name));
            if (pinNames.length) {
                pins.splice(i--, 1);
                for (const name of pinNames)unusedNames.delete(name);
            }
        }
        if (unusedNames.size) {
            this.installCnt--;
            throw new JspmError(`No "imports" entry for "${[
                ...unusedNames
            ][0]}" to uninstall.`);
        }
        this.traceMap.pins = pins;
        if (--this.installCnt === 0) {
            const { map  } = await this.traceMap.finishInstall();
            this.map = map;
        }
    }
    async extractMap(pins, mapUrl, rootUrl) {
        if (typeof mapUrl === "string") mapUrl = new URL(mapUrl, this.baseUrl);
        if (typeof rootUrl === "string") rootUrl = new URL(rootUrl, this.baseUrl);
        if (!Array.isArray(pins)) pins = [
            pins
        ];
        if (this.installCnt++ !== 0) throw new JspmError(`Cannot run extract map during installs`);
        this.traceMap.startInstall();
        await this.traceMap.processInputMap;
        if (--this.installCnt !== 0) throw new JspmError(`Another install was started during extract map.`);
        const { map , staticDeps , dynamicDeps  } = await this.traceMap.finishInstall(pins);
        map.rebase(mapUrl, rootUrl);
        map.flatten();
        map.sort();
        map.combineSubpaths();
        return {
            map: map.toJSON(),
            staticDeps,
            dynamicDeps
        };
    }
    /**
   * Resolve a specifier using the import map.
   *
   * @param specifier Module to resolve
   * @param parentUrl ParentURL of module to resolve
   * @returns Resolved URL string
   */ resolve(specifier, parentUrl = this.baseUrl) {
        if (typeof parentUrl === "string") parentUrl = new URL(parentUrl, this.baseUrl);
        const resolved = this.map.resolve(specifier, parentUrl);
        if (resolved === null) throw new JspmError(`Unable to resolve "${specifier}" from ${parentUrl.href}`, "MODULE_NOT_FOUND");
        return resolved;
    }
    get importMap() {
        return this.map;
    }
    getAnalysis(url) {
        if (typeof url !== "string") url = url.href;
        const trace = this.traceMap.tracedUrls[url];
        if (!trace) throw new Error(`The URL ${url} has not been traced by this generator instance.`);
        return {
            format: trace.format,
            staticDeps: trace.deps,
            dynamicDeps: trace.dynamicDeps,
            cjsLazyDeps: trace.cjsLazyDeps || []
        };
    }
    getMap(mapUrl, rootUrl) {
        const map = this.map.clone();
        map.rebase(mapUrl, rootUrl);
        map.flatten();
        map.sort();
        map.combineSubpaths();
        return map.toJSON();
    }
    /**
   * Constructs a new Generator instance.
   *
   * For example:
   *
   * ```js
   * const generator = new Generator({
   *   mapUrl: import.meta.url,
   *   inputMap: {
   *     "imports": {
   *       "react": "https://cdn.skypack.dev/react"
   *     }
   *   },
   *   defaultProvider: 'jspm',
   *   defaultRegistry: 'npm',
   *   providers: {
   *     '@orgscope': 'nodemodules'
   *   },
   *   customProviders: {},
   *   env: ['production', 'browser'],
   *   cache: false,
   * });
   * ```
   * @param {GeneratorOptions} opts Configuration for the new generator instance.
   */ constructor({ baseUrl: baseUrl$1 , mapUrl , rootUrl =undefined , inputMap =undefined , env =[
        "browser",
        "development",
        "module",
        "import"
    ] , defaultProvider , defaultRegistry ="npm" , customProviders =undefined , providers , resolutions ={} , cache =true , ignore =[] , freeze , latest , ipfsAPI , commonJS =false  } = {}){
        /**
   * The number of concurrent installs the generator is busy processing.
   */ this.installCnt = 0;
        // Initialise the debug logger:
        const { log , logStream  } = createLogger();
        this.log = log;
        this.logStream = logStream;
        if (process$1 && process$1.env && process$1.env.JSPM_GENERATOR_LOG) {
            (async ()=>{
                for await (const { type , message  } of this.logStream()){
                    console.log(`\x1b[1m${type}:\x1b[0m ${message}`);
                }
            })();
        }
        // Initialise the resource fetcher:
        let fetchOpts;
        if (cache === "offline") fetchOpts = {
            cache: "force-cache",
            headers: {
                "Accept-Encoding": "gzip, br"
            }
        };
        else if (!cache) fetchOpts = {
            cache: "no-store",
            headers: {
                "Accept-Encoding": "gzip, br"
            }
        };
        else fetchOpts = {
            headers: {
                "Accept-Encoding": "gzip, br"
            }
        };
        if (ipfsAPI) fetchOpts.ipfsAPI = ipfsAPI;
        // Default logic for the mapUrl, baseUrl and rootUrl:
        if (mapUrl && !baseUrl$1) {
            mapUrl = typeof mapUrl === "string" ? new URL(mapUrl, baseUrl) : mapUrl;
            try {
                baseUrl$1 = new URL("./", mapUrl);
            } catch  {
                baseUrl$1 = new URL(mapUrl + "/");
            }
        } else if (baseUrl$1 && !mapUrl) {
            mapUrl = baseUrl$1;
        } else if (!mapUrl && !baseUrl$1) {
            baseUrl$1 = mapUrl = baseUrl;
        }
        this.baseUrl = typeof baseUrl$1 === "string" ? new URL(baseUrl$1, baseUrl) : baseUrl$1;
        if (!this.baseUrl.pathname.endsWith("/")) {
            this.baseUrl = new URL(this.baseUrl.href);
            this.baseUrl.pathname += "/";
        }
        this.mapUrl = typeof mapUrl === "string" ? new URL(mapUrl, this.baseUrl) : mapUrl;
        this.rootUrl = typeof rootUrl === "string" ? new URL(rootUrl, this.baseUrl) : rootUrl || null;
        if (this.rootUrl && !this.rootUrl.pathname.endsWith("/")) this.rootUrl.pathname += "/";
        if (!this.mapUrl.pathname.endsWith("/")) {
            try {
                this.mapUrl = new URL("./", this.mapUrl);
            } catch  {
                this.mapUrl = new URL(this.mapUrl.href + "/");
            }
        }
        // Initialise the resolver:
        const resolver = new Resolver(env, log, fetchOpts, true);
        if (customProviders) {
            for (const provider of Object.keys(customProviders)){
                resolver.addCustomProvider(provider, customProviders[provider]);
            }
        }
        // The node_modules provider is special, because it needs to be rooted to
        // perform resolutions against the local node_modules directory:
        const nmProvider = createProvider(this.baseUrl.href, defaultProvider === "nodemodules");
        resolver.addCustomProvider("nodemodules", nmProvider);
        // We make an attempt to auto-detect the default provider from the input
        // map, by picking the provider with the most owned URLs:
        defaultProvider = detectDefaultProvider(defaultProvider, inputMap, resolver);
        // Initialise the tracer:
        this.traceMap = new TraceMap({
            mapUrl: this.mapUrl,
            rootUrl: this.rootUrl,
            baseUrl: this.baseUrl,
            defaultProvider,
            defaultRegistry,
            providers,
            ignore,
            resolutions,
            commonJS
        }, log, resolver);
        // Reconstruct constraints and locks from the input map:
        this.map = new ImportMap({
            mapUrl: this.mapUrl,
            rootUrl: this.rootUrl
        });
        if (inputMap) this.addMappings(inputMap);
        // Set deprecated global resolution options for backwards compat:
        this.latest = latest;
        this.freeze = freeze;
    }
}
/**
 * _Use the internal fetch implementation, useful for hooking into the same shared local fetch cache._
 *
 * ```js
 * import { fetch } from '@jspm/generator';
 *
 * const res = await fetch(url);
 * console.log(await res.text());
 * ```
 *
 * Use the `{ cache: 'no-store' }` option to disable the cache, and the `{ cache: 'force-cache' }` option to enforce the offline cache.
 */ async function fetch(url, opts = {}) {
    // @ts-ignore
    return fetch$1(url, opts);
}
/**
 * Get the lookup resolution information for a specific install.
 *
 * @param install The install object
 * @param lookupOptions Provider and cache defaults for lookup
 * @returns The resolved install and exact package \{ install, resolved \}
 */ async function lookup(install, { provider , cache  } = {}) {
    const generator = new Generator({
        cache: !cache,
        defaultProvider: provider
    });
    const { target , subpath , alias  } = await installToTarget.call(generator, install, generator.traceMap.installer.defaultRegistry);
    if (typeof target === "string") throw new Error(`Resolved install "${install}" to package specifier ${target}, but expected a fully qualified install target.`);
    const { pkgTarget , installSubpath  } = target;
    if (pkgTarget instanceof URL) throw new Error("URL lookups not supported");
    const resolved = await generator.traceMap.resolver.resolveLatestTarget(pkgTarget, generator.traceMap.installer.getProvider(pkgTarget), generator.baseUrl.href);
    return {
        install: {
            target: {
                registry: pkgTarget.registry,
                name: pkgTarget.name,
                range: pkgTarget.ranges.map((range)=>range.toString()).join(" || ")
            },
            installSubpath,
            subpath,
            alias
        },
        resolved: resolved
    };
}
/**
 * Get the package.json configuration for a specific URL or package.
 *
 * @param pkg Package to lookup configuration for
 * @param lookupOptions Optional provider and cache defaults for lookup
 * @returns Package JSON configuration
 *
 * Example:
 * ```js
 * import { getPackageConfig } from '@jspm/generator';
 *
 * // Supports a resolved package
 * {
 *   const packageJson = await getPackageConfig({ registry: 'npm', name: 'lit-element', version: '2.5.1' });
 * }
 *
 * // Or alternatively provide any URL
 * {
 *   const packageJson = await getPackageConfig('https://ga.jspm.io/npm:lit-element@2.5.1/lit-element.js');
 * }
 * ```
 */ async function getPackageConfig(pkg, { provider , cache  } = {}) {
    const generator = new Generator({
        cache: !cache,
        defaultProvider: provider
    });
    if (typeof pkg === "object" && "name" in pkg) pkg = await generator.traceMap.resolver.pkgToUrl(pkg, generator.traceMap.installer.defaultProvider);
    else if (typeof pkg === "string") pkg = new URL(pkg).href;
    else pkg = pkg.href;
    return generator.traceMap.resolver.getPackageConfig(pkg);
}
/**
 * Get the package base URL for the given module URL.
 *
 * @param url module URL
 * @param lookupOptions Optional provider and cache defaults for lookup
 * @returns Base package URL
 *
 * Modules can be remote CDN URLs or local file:/// URLs.
 *
 * All modules in JSPM are resolved as within a package boundary, which is the
 * parent path of the package containing a package.json file.
 *
 * For JSPM CDN this will always be the base of the package as defined by the
 * JSPM CDN provider. For non-provider-defined origins it is always determined
 * by trying to fetch the package.json in each parent path until the root is reached
 * or one is found. On file:/// URLs this exactly matches the Node.js resolution
 * algorithm boundary lookup.
 *
 * This package.json file controls the package name, imports resolution, dependency
 * resolutions and other package information.
 *
 * getPackageBase will return the folder containing the package.json,
 * with a trailing '/'.
 *
 * This URL will either be the root URL of the origin, or it will be a
 * path "pkgBase" such that fetch(`${pkgBase}package.json`) is an existing
 * package.json file.
 *
 * @example
 * ```js
 *   import { getPackageBase } from '@jspm/generator';
 *   const pkgUrl = await getPackageBase('https://ga.jspm.io/npm:lit-element@2.5.1/lit-element.js');
 *   // Returns: https://ga.jspm.io/npm:lit-element@2.5.1/
 * ```
 */ async function getPackageBase(url, { provider , cache  } = {}) {
    const generator = new Generator({
        cache: !cache,
        defaultProvider: provider
    });
    return generator.traceMap.resolver.getPackageBase(typeof url === "string" ? url : url.href);
}
/**
 * Get the package metadata for the given module or package URL.
 *
 * @param url URL of a module or package for a configured provider.
 * @param lookupOptions Optional provider and cache defaults for lookup.
 * @returns Package metadata for the given URL if one of the configured
 *          providers owns it, else null.
 *
 * The returned metadata will always contain the package name, version and
 * registry, along with the provider name and layer that handles resolution
 * for the given URL.
 */ async function parseUrlPkg(url, { provider , cache  } = {}) {
    const generator = new Generator({
        cache: !cache,
        defaultProvider: provider
    });
    return generator.traceMap.resolver.parseUrlPkg(typeof url === "string" ? url : url.href);
}
/**
 * Returns a list of providers that are supported by default.
 *
 * @returns List of valid provider strings supported by default.
 *
 * To use one of these providers, pass the string to either the "defaultProvider"
 * option or the "providers" mapping when constructing a Generator.
 */ function getDefaultProviders() {
    return getDefaultProviderStrings();
}
async function installToTarget(install, defaultRegistry) {
    if (typeof install === "string") install = {
        target: install
    };
    if (typeof install.target !== "string") throw new Error('All installs require a "target" string.');
    if (install.subpath !== undefined && (typeof install.subpath !== "string" || install.subpath !== "." && !install.subpath.startsWith("./"))) throw new Error(`Install subpath "${install.subpath}" must be a string equal to "." or starting with "./".${typeof install.subpath === "string" ? `\nTry setting the subpath to "./${install.subpath}"` : ""}`);
    const { alias , target , subpath  } = await parseTarget(this.traceMap.resolver, install.target, this.baseUrl, defaultRegistry);
    return {
        target,
        alias: install.alias || alias,
        subpath: install.subpath || subpath
    };
}
function detectDefaultProvider(defaultProvider, inputMap, resolver) {
    // We only use top-level install information to detect the provider:
    const counts = {};
    for (const url of Object.values((inputMap === null || inputMap === void 0 ? void 0 : inputMap.imports) || {})){
        const name = resolver.providerNameForUrl(url);
        if (name) {
            counts[name] = (counts[name] || 0) + 1;
        }
    }
    let winner;
    let winnerCount = 0;
    for (const [name, count] of Object.entries(counts)){
        if (count > winnerCount) {
            winner = name;
            winnerCount = count;
        }
    }
    // TODO: this should be the behaviour once we support full 'providers' opt
    // The leading provider in the input map takes precedence as the provider of
    // the root package. Failing that, the user-provided default is used. The
    // 'providers' field can be used for hard-overriding this:
    // return winner || defaultProvider || "jspm.io";
    return defaultProvider || winner || "jspm.io";
}

export { Generator as G, setPathFns as a, setBabel$1 as b, setBabel as c, analyzeHtml as d, clearCache as e, fetch as f, getPackageConfig as g, getPackageBase as h, getDefaultProviders as i, lookup as l, parseUrlPkg as p, setCreateHash as s };
