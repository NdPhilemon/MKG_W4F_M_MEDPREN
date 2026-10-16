const CACHE="mmedpren-v37-sales-money-media";
const CORE=["./index.html","./sync-core.js","./logo.png","./manifest.webmanifest"];
self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.addAll(CORE.map(url=>new Request(url,{cache:"reload"})));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("mmedpren-")&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch",event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=="GET"||url.origin!==self.location.origin)return;
  if(url.pathname.startsWith("/api/")){event.respondWith(fetch(request,{cache:"no-store"}));return}
  const html=request.mode==="navigate"||url.pathname.endsWith("/index.html")||url.pathname==="/";
  const core=html||CORE.some(path=>new URL(path,self.location.href).pathname===url.pathname);
  if(!core)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),key=html?"./index.html":request;
    try{
      const response=await fetch(request,{cache:"no-store"});
      if(!response.ok)throw new Error("HTTP "+response.status);
      await cache.put(key,response.clone());return response;
    }catch{
      return await cache.match(key)||new Response("Application indisponible hors connexion",{status:503});
    }
  })());
});
