import{C as S,F as C,I as O,T as P,U as M,a as E,c as A,b as I,d as L,e as R,f as b,g as _,h as k,i as U,j as B,k as W,l as T,m as D,n as N,o as j,p as x,q as $,r as H,s as q,t as F,u as K,v as V,w as z,x as G,y as J,z as Q,A as X,B as Y,D as Z,E as ee,G as te,H as oe,J as re,K as se,L as ne,M as ae,N as ie,O as ce,P as le,Q as de,R as ue,S as w,V as ge,W as me,X as pe,Y as fe,Z as he,_ as we,$ as ye}from"./index-8a91cad7.js";(function(){const r=document.createElement("link").relList;if(r&&r.supports&&r.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))a(t);new MutationObserver(t=>{for(const e of t)if(e.type==="childList")for(const s of e.addedNodes)s.tagName==="LINK"&&s.rel==="modulepreload"&&a(s)}).observe(document,{childList:!0,subtree:!0});function n(t){const e={};return t.integrity&&(e.integrity=t.integrity),t.referrerPolicy&&(e.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?e.credentials="include":t.crossOrigin==="anonymous"?e.credentials="omit":e.credentials="same-origin",e}function a(t){if(t.ep)return;t.ep=!0;const e=n(t);fetch(t.href,e)}})();const ve="modulepreload",Se=function(o,r){return new URL(o,r).href},h={},Ce=function(r,n,a){if(!n||n.length===0)return r();const t=document.getElementsByTagName("link");return Promise.all(n.map(e=>{if(e=Se(e,a),e in h)return;h[e]=!0;const s=e.endsWith(".css"),v=s?'[rel="stylesheet"]':"";if(!!a)for(let l=t.length-1;l>=0;l--){const d=t[l];if(d.href===e&&(!s||d.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${e}"]${v}`))return;const i=document.createElement("link");if(i.rel=s?"stylesheet":ve,s||(i.as="script",i.crossOrigin=""),i.href=e,document.head.appendChild(i),s)return new Promise((l,d)=>{i.addEventListener("load",l),i.addEventListener("error",()=>d(new Error(`Unable to preload CSS for ${e}`)))})})).then(()=>r()).catch(e=>{const s=new Event("vite:preloadError",{cancelable:!0});if(s.payload=e,window.dispatchEvent(s),!s.defaultPrevented)throw e})},Oe=Object.freeze(Object.defineProperty({__proto__:null,Counter:S,Float64:C,Int:O,Text:P,Uint:M,applyChanges:E,change:A,changeAt:I,clone:L,decodeChange:R,decodeSyncMessage:b,decodeSyncState:_,deleteAt:k,diff:U,dump:B,emptyChange:W,encodeChange:T,encodeSyncMessage:D,encodeSyncState:N,equals:j,free:x,from:$,generateSyncMessage:H,getActorId:q,getAllChanges:F,getBackend:K,getChanges:V,getConflicts:z,getHeads:G,getHistory:J,getLastLocalChange:Q,getMissingDeps:X,getObjectId:Y,init:Z,initSyncState:ee,insertAt:te,isAutomerge:oe,load:re,loadIncremental:se,merge:ne,next:ae,receiveSyncMessage:ie,save:ce,saveIncremental:le,saveSince:de,toJS:ue,use:w,uuid:ge,view:me},Symbol.toStringTag,{value:"Module"})),Pe="automerge:bmVtAiipQaUM5PomP5xg85eCmhj";async function Me(){navigator.serviceWorker.register("service-worker.js",{type:"module"}).then(o=>{console.log("ServiceWorker registration successful with scope:",o.scope)},o=>{console.log("ServiceWorker registration failed:",o)})}async function Ee(){return await pe,w(ye),new fe({storage:new he,network:[],peerId:"frontend-"+Math.round(Math.random()*1e4),sharePolicy:async r=>r.includes("service-worker")})}function y(o){if(navigator.serviceWorker.controller){const r=new MessageChannel;o.networkSubsystem.addNetworkAdapter(new we(r.port1)),navigator.serviceWorker.controller.postMessage({type:"INIT_PORT"},[r.port2])}}await Me();const c=await Ee();y(c);navigator.serviceWorker.oncontrollerchange=function(){console.log("Controller changed!"),y(c)};window.repo=c;window.Automerge=window.automerge=Oe;function Ae(o,r){const n=new URLSearchParams(window.location.search).get(o);if(n)return c.find(n);const a=localStorage.getItem(o);if(a)return c.find(a);{const t=r(c);return localStorage.setItem(o,t.url),t}}window.esmsInitOptions={shimMode:!0,mapOverrides:!0,fetch:window.fetch};window.process={env:{DEBUG_COLORS:"false"},browser:!0,versions:{},stderr:{},cwd:()=>"."};console.log("Bootstrapping...");const g=window.appHandle=Ae("app",o=>c.find(Pe));console.log(g.url);let{importMap:m,name:p,module:f}=await g.doc();console.log("Module downloaded:",p);if(!m||!p||!f)throw new Error("Essential data missing from bootstrap document:",p,f,m);console.log("Applying import map...");await Ce(()=>import("./es-module-shims-45e88955.js").then(o=>o.e),["./es-module-shims-45e88955.js","./index-8a91cad7.js"],import.meta.url);importShim.addImportMap(m);console.log("Importing...");const Ie=`./automerge-repo/${g.url}/fileContents/${f}`,Le=new URL(Ie,window.location).toString(),u=await importShim(Le);console.log(u);console.log("Mounting...");if(u.mount){const o=new URLSearchParams(window.location.search),r=Object.fromEntries(o.entries());u.mount(document.getElementById("root"),{...r,bootstrapDocUrl:g.url})}else console.error("Root module doesn't export a mount function",u);
