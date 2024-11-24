# Trail Runner 2.0
## A boot-loader for a local-first web.

This project creates a gateway to an Automerge-powered, local-first web. It allows your browser to load data out of Automerge documents as though they were stored on web servers using nothing but service-worker configured to fetch from the sync-server of your choice.

No bundler! No web server! No problem! Client only, except the sync server.

## A Tour

At it's heart, this is an extremely simple project. When a request comes in, we try to look up the data using Automerge instead of going to servers on the web. How does it work? Let's look at a couple of examples:

1) A simple Automerge URL.

`https://am.pvh.ca/automerge:2WkfNgzAxaS82ckTJaaucAWD36oX/index.html`

The service-worker intercepts the `"fetch"` event sent by the browser and decides the request is a URL it should handle. It breaks the path down into an array splitting on "/".

The first path component is treated specially, to bootstrap the process. In this case, it is an automerge document ID, so that document is loaded and the contents of `doc.["index.html"]` are returned. (A little more on that later.)

2) Nested Automerge documents

`https://am.pvh.ca/automerge:2WkfNgzAxaS82ckTJaaucAWD36oX/assets/index.css`

In this case, the contents of `doc.assets` is another automerge URL. No matter, we simply load the child URL and continue. This can continue arbitrarily deep.

3) A personal namespace

The document IDs are ugly and un-memorable. How can we fix this? By using a trick we borrow from [atproto](https://atproto.com/) of using DNS TXT records to serve hard-to-spoof data. When encountering a path component in this form: `@<domain-name>`, we make a DNS-over-HTTP request via http://dns.google for the TXT records found at `_automerge.<domain-name>`. If that record contains a domain name, we load it and continue our traversal.

This (as of this writing) this is a synonym for the example above:

`https://am.pvh.ca/example/index.html`

Anyone can set up their own _automerge TXT record. Just point to any arbitrary automerge document ID.

4) Index appending.

One last little nuance to make things prettier: we can omit the index.html, and if there is a trailing / on the URL, it will be added automatically. Thus, here is our final URL.

`https://am.pvh.ca/example/`

### Response Generation
After traversing the path, we need to return data to the client. We follow two patterns. If the result of the path traversal is an object with `contentType` and `contents` fields, we return those two items as a Response object. This allows hosting of any kind of data from HTML to PNGs. 

In all other cases, we simply reduce the Automerge document to a JSON object and respond with it. Perhaps this could be used to emulate a low-complexity web API?

## How it works

There are only three files that work together here. The heart of the project is the service-worker which intercepts `"fetch"` events sent by the browser and serves the correct content following the description above.

The `index.html` has only one real responsibility: boot the service-worker.

Last, `404.html` is served by our static site host in response to any invalid requests. For hosts with a running service-worker, this page should not be requested, but a user's first request will be sent to the static host before the service worker boots. It simply records the requested URL and redirects back to `index.html` which returns the favor after the service worker boots. This leads to a slightly annoying "flicker" as the initial page loads but it seems mostly robust.

## Firefox

This implementation uses import statements in the service worker which are not quite supported in Firefox yet. They have been supported in Chrome and Safari for a number of years now so we hope firefox catches up soon.
