import{E as p,i as S,a as y,h as b,s as k,C as $,D as A,p as d,g as E,b as m,c as D}from"./CollectionSynchronizer-d734ae39.js";import{H as B,e as F,d as J}from"./CollectionSynchronizer-d734ae39.js";import{N as Q}from"./NetworkAdapter-b7a01c72.js";import{d as f}from"./browser-f8dbb0d6.js";import{s as H,g as u,a as I,l as x,i as R}from"./index-aa8104e2.js";import{S as X}from"./StorageAdapter-3886844f.js";import"./_commonjsHelpers-de833af9.js";const T=r=>`${r.senderId}:${r.sessionId}`;class U extends p{peerId;#e;#t={};#s=0;#a=Math.random().toString(36).slice(2);#n={};#i=0;#r=[];constructor(e,t=z()){super(),this.peerId=t,this.#e=f(`automerge-repo:network:${this.peerId}`),e.forEach(s=>this.addNetworkAdapter(s))}addNetworkAdapter(e){this.#r.push(e),e.once("ready",()=>{this.#i++,this.#e("Adapters ready: ",this.#i,"/",this.#r.length),this.#i===this.#r.length&&this.emit("ready")}),e.on("peer-candidate",({peerId:t})=>{this.#e(`peer candidate: ${t} `),this.#t[t]||(this.#t[t]=e),this.emit("peer",{peerId:t})}),e.on("peer-disconnected",({peerId:t})=>{this.#e(`peer disconnected: ${t} `),delete this.#t[t],this.emit("peer-disconnected",{peerId:t})}),e.on("message",t=>{if(!S(t)){this.#e(`invalid message: ${JSON.stringify(t)}`);return}if(this.#e(`message from ${t.senderId}`),y(t)){const s=T(t);(this.#n[s]===void 0||t.count>this.#n[s])&&(this.#n[s]=t.count,this.emit("message",t));return}this.emit("message",t)}),e.on("close",()=>{this.#e("adapter closed"),Object.entries(this.#t).forEach(([t,s])=>{s===e&&delete this.#t[t]})}),e.connect(this.peerId)}send(e){const t=this.#t[e.targetId];if(!t){this.#e(`Tried to send message but peer not found: ${e.targetId}`);return}if(this.#e(`Sending message to ${e.targetId}`),y(e)){const s="count"in e?e:{...e,count:++this.#s,sessionId:this.#a,senderId:this.peerId};this.#e("Ephemeral message",s),t.send(s)}else{const s={...e,senderId:this.peerId};this.#e("Sync message",s),t.send(s)}}isReady=()=>this.#i===this.#r.length;whenReady=async()=>{if(!this.isReady())return new Promise(e=>{this.once("ready",()=>{e()})})}}function z(){return`user-${Math.round(Math.random()*1e5)}`}function g(r){let e=0;r.forEach(i=>{e+=i.length});const t=new Uint8Array(e);let s=0;return r.forEach(i=>{t.set(i,s),s+=i.length}),t}function w(r){const e=k.hash(r);return Array.from(new Uint8Array(e)).map(i=>("00"+i.toString(16)).slice(-2)).join("")}function M(r){let e=new TextEncoder,t=g(r.map(s=>e.encode(s)));return w(t)}class N{#e;#t=new Map;#s=new Map;#a=f("automerge-repo:storage-subsystem");#n=!1;constructor(e){this.#e=e}async#i(e,t){const s=H(t,this.#s.get(e)??[]);if(s&&s.length>0){const i=[e,"incremental",w(s)];this.#a(`Saving incremental ${i} for document ${e}`),await this.#e.save(i,s),this.#t.has(e)||this.#t.set(e,[]),this.#t.get(e).push({key:i,type:"incremental",size:s.length}),this.#s.set(e,u(t))}else return Promise.resolve()}async#r(e,t,s){this.#n=!0;const i=I(t),h=M(u(t)),a=[e,"snapshot",h],o=new Set(s.map(c=>c.key).filter(c=>c[2]!==h));this.#a(`Saving snapshot ${a} for document ${e}`),this.#a(`deleting old chunks ${Array.from(o)}`),await this.#e.save(a,i);for(const c of o)await this.#e.remove(c);const n=this.#t.get(e)?.filter(c=>!o.has(c.key))??[];n.push({key:a,type:"snapshot",size:i.length}),this.#t.set(e,n),this.#n=!1}async loadDoc(e){const t=await this.#e.loadRange([e]),s=[],i=[];for(const o of t){const n=P(o.key);n!=null&&(i.push({key:o.key,type:n,size:o.data.length}),s.push(o.data))}this.#t.set(e,i);const h=g(s);if(h.length===0)return null;const a=x(R(),h);return this.#s.set(e,u(a)),a}async saveDoc(e,t){if(!this.#o(e,t))return;let s=this.#t.get(e)??[];this.#h(s)?this.#r(e,t,s):this.#i(e,t),this.#s.set(e,u(t))}async remove(e){this.#e.removeRange([e,"snapshot"]),this.#e.removeRange([e,"incremental"])}#o(e,t){const s=this.#s.get(e);if(!s)return!0;const i=u(t);return!b(i,s)}#h(e){if(this.#n)return!1;let t=0,s=0;for(const i of e)i.type==="snapshot"?t+=i.size:s+=i.size;return s>=t}}function P(r){if(r.length<2)return null;const e=r[r.length-2];return e==="snapshot"||e==="incremental"?e:null}class O extends p{#e;networkSubsystem;storageSubsystem;#t={};sharePolicy=async()=>!0;constructor({storage:e,network:t,peerId:s,sharePolicy:i}){super(),this.#e=f("automerge-repo:repo"),this.sharePolicy=i??this.sharePolicy,this.on("document",async({handle:n,isNew:c})=>{if(a)if(n.on("heads-changed",async({handle:l,doc:v})=>{await a.saveDoc(l.documentId,v)}),c)await a.saveDoc(n.documentId,n.docSync());else{const l=await a.loadDoc(n.documentId);l&&n.update(()=>l)}n.on("unavailable",()=>{this.#e("document unavailable",{documentId:n.documentId}),this.emit("unavailable-document",{documentId:n.documentId})}),this.networkSubsystem.isReady()?n.request():(n.awaitNetwork(),this.networkSubsystem.whenReady().then(()=>{n.networkReady()}).catch(l=>{this.#e("error waiting for network",{err:l})})),h.addDocument(n.documentId)}),this.on("delete-document",({documentId:n})=>{a&&a.remove(n).catch(c=>{this.#e("error deleting document",{documentId:n,err:c})})});const h=new $(this);h.on("message",n=>{this.#e(`sending sync message to ${n.targetId}`),o.send(n)});const a=e?new N(e):void 0;this.storageSubsystem=a;const o=new U(t,s);this.networkSubsystem=o,o.on("peer",async({peerId:n})=>{this.#e("peer connected",{peerId:n}),h.addPeer(n)}),o.on("peer-disconnected",({peerId:n})=>{h.removePeer(n)}),o.on("message",async n=>{await h.receiveMessage(n)})}#s(e,t){if(this.#t[e])return this.#t[e];if(!e)throw new Error(`Invalid documentId ${e}`);const s=new A(e,{isNew:t});return this.#t[e]=s,s}get handles(){return this.#t}create(){const{documentId:e}=d(E()),t=this.#s(e,!0);return this.emit("document",{handle:t,isNew:!0}),t}find(e){if(!m(e)){let i=D(e);if(i)console.warn("Legacy UUID document ID detected, converting to AutomergeUrl. This will be removed in a future version."),e=i;else throw new Error(`Invalid AutomergeUrl: '${e}'`)}const{documentId:t}=d(e);if(this.#t[t])return this.#t[t].isUnavailable()&&setTimeout(()=>{this.#t[t].emit("unavailable",{handle:this.#t[t]})}),this.#t[t];const s=this.#s(t,!1);return this.emit("document",{handle:s,isNew:!1}),s}delete(e){m(e)&&({documentId:e}=d(e)),this.#s(e,!1).delete(),delete this.#t[e],this.emit("delete-document",{documentId:e})}}export{$ as CollectionSynchronizer,A as DocHandle,B as HandleState,Q as NetworkAdapter,U as NetworkSubsystem,O as Repo,X as StorageAdapter,N as StorageSubsystem,F as cbor,J as generateAutomergeUrl,m as isValidAutomergeUrl,S as isValidMessage,d as parseAutomergeUrl};
