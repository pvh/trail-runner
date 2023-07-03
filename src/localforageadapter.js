import e from "localforage"
import { StorageAdapter as o } from "@automerge/automerge-repo"
class LocalForageStorageAdapter extends o {
  load(o) {
    return e.getItem(o)
  }
  save(o, r) {
    e.setItem(o, r)
  }
  remove(o) {
    e.removeItem(o)
  }
}
export { LocalForageStorageAdapter }
