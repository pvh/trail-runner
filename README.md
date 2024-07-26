# Trail Runner
## Because boots were too heavy for moving fast.

## A Tour

We load Automerge-Repo in the frontend and then again in a ServiceWorker and get them talking to each other.

Once we have that, we call import on some JS code we hope to find in an initial document and from there... we're off to the races!

## Technical Notes

The specifics of service worker registration are quite subtle. We always want to have a service worker but sometimes the browser might put it to sleep, or replace it during upgrades, or it can crash... If you run into a corner-case we haven't handled, improvements are welcome.

