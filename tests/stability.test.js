import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import admin from 'firebase-admin';
import {JSDOM} from 'jsdom';

process.env.ADMIN_EMAIL='owner@example.test';
process.env.ADMIN_PASSWORD='test-only-password';
process.env.SESSION_SECRET='test-only-signing-key-at-least-32-characters';
admin.initializeApp({projectId:'test-only'});
const clone=v=>v===undefined?undefined:structuredClone(v);
const documents=new Map();let transactionTail=Promise.resolve();
function ref(path){return {path,async get(){return snap(path)},async set(value,{merge=false}={}){documents.set(path,merge?{...documents.get(path),...clone(value)}:clone(value))},async delete(){documents.delete(path)}}}
function snap(path){const data=clone(documents.get(path));return {exists:data!==undefined,data:()=>data}}
function collection(name,filter=()=>true){return {doc:id=>ref(`${name}/${id}`),where:(key,op,value)=>collection(name,row=>row[key]===value),async get(){return {docs:[...documents].filter(([key,row])=>key.startsWith(name+'/')&&filter(row)).map(([key])=>snap(key))}}}}
const fakeDb={collection,runTransaction(callback){
  const job=transactionTail.then(async()=>{
    const writes=[];let wrote=false;
    const result=await callback({async get(reference){assert.equal(wrote,false,'Firestore requires all reads before writes');return reference.get()},set(reference,value,options){wrote=true;writes.push(()=>reference.set(value,options))}});
    for(const write of writes)await write();return result;
  });transactionTail=job.catch(()=>{});return job;
}};
Object.defineProperty(admin,'firestore',{value:()=>fakeDb});
const {default:handler}=await import('../api/sync.js');
const {default:health}=await import('../api/health.js');
const {default:upload}=await import('../api/upload.js');
const {signSession}=await import('../lib/session.js');
async function request(url='/api/sync',options={}){
  const parsed=new URL(url,'https://app.test'),req={method:options.method||'GET',headers:options.headers||{},query:Object.fromEntries(parsed.searchParams),body:options.body};
  let status=200,data;
  const res={setHeader(){},status(s){status=s;return this},end(value){data=JSON.parse(value)},json(value){data=value;return this}};
  await (parsed.pathname==='/api/health'?health:parsed.pathname==='/api/upload'?upload:handler)(req,res);
  return {ok:status>=200&&status<300,status,json:async()=>data,data};
}
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const core=fs.readFileSync(new URL('../sync-core.js',import.meta.url),'utf8');
function browser(storage={},hash='home'){
  const dom=new JSDOM(html,{url:`https://app.test/#${hash}`,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  const timers=new Map();let timerId=0;const errors=[];
  w.setTimeout=(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId};w.clearTimeout=id=>timers.delete(id);
  w.setInterval=(fn,delay)=>{timers.set(++timerId,{fn,delay,interval:true});return timerId};w.clearInterval=id=>timers.delete(id);
  w.scrollTo=()=>{};w.alert=message=>errors.push(message);w.confirm=()=>true;w.console={...console,error:(...v)=>errors.push(v.join(' '))};
  w.AbortSignal=AbortSignal;w.fetch=request;
  Object.defineProperty(w.navigator,'onLine',{value:true,writable:true});
  for(const [key,value] of Object.entries(storage))w.localStorage.setItem(key,value);
  vm.runInContext(core,dom.getInternalVMContext());vm.runInContext(script,dom.getInternalVMContext());
  return {w,errors,timers,read:code=>w.eval(code),storage:()=>Object.fromEntries(Array.from({length:w.localStorage.length},(_,i)=>{const key=w.localStorage.key(i);return [key,w.localStorage.getItem(key)]})),async login(type='admin',email='owner@example.test',secret='test-only-password'){
    w.document.querySelector('#loginType').value=type;w.document.querySelector('#loginEmail').value=email;w.document.querySelector('#loginPassword').value=secret;
    await w.document.querySelector('#loginBtn').onclick();assert.equal(w.eval('isVisitor()'),false,errors.join('\n'));
  },async autoSync(){const task=[...timers].find(([,t])=>t.delay===120&&!t.interval);assert.ok(task,'automatic sync scheduled');timers.delete(task[0]);await task[1].fn()}};
}
function root(){return documents.get('mmedpren/global')}
function product(id='p-one'){return {id,name:'Article',category:'Divers',shopId:'main',stock:10,buy:2,sell:5,photo:'',visibleToVisitors:true}}

test('Admin login, refresh, reopened tab, routes, remote session injection and logout',async()=>{
  documents.clear();const a=browser({},'products');assert.equal(a.read('isVisitor()'),true);
  await a.login();assert.equal(a.read('currentRole()'),'admin');assert.equal(a.w.document.querySelector('.panel.active').id,'home');
  assert.ok(!JSON.stringify(a.storage()).includes('test-only-password'));
  for(const route of ['products','reports','staff','shop','settings']){
    const refreshed=browser(a.storage(),route);
    assert.equal(refreshed.read('currentRole()'),'admin');assert.equal(refreshed.w.document.querySelector('.panel.active').id,route==='shop'?'shops':route);
    assert.deepEqual(refreshed.errors,[]);
  }
  a.read('applyRemoteState({users:[],sessionType:"visitor",currentUserId:null,role:"visitor",syncAuth:null})');
  assert.equal(a.read('currentRole()'),'admin');
  a.w.enterVisitorMode();assert.equal(a.read('isVisitor()'),true);assert.equal(a.w.localStorage.getItem('mkg-auth-session-v32'),null);
  assert.equal(browser(a.storage()).read('isVisitor()'),true);
});

test('automatic push, second device, concurrent products, offline recovery and refresh',async()=>{
  documents.clear();const a=browser();await a.login();const b=browser();await b.login();
  a.read(`db.products.push(${JSON.stringify(product())});queueSync('product.create',{productId:'p-one'});save()`);
  await a.autoSync();assert.equal(root().products.length,1);
  await b.read('checkRemoteRevision()');assert.equal(b.read('db.products[0].id'),'p-one');
  a.w.navigator.onLine=false;a.read('db.products[0].name="Offline edit";queueSync("product.update",{productId:"p-one"});save()');
  const reopened=browser(a.storage(),'products');reopened.w.navigator.onLine=false;
  assert.equal(reopened.read('currentRole()'),'admin');assert.equal(reopened.read('db.products[0].name'),'Offline edit');
  reopened.w.navigator.onLine=true;reopened.w.dispatchEvent(new reopened.w.Event('online'));
  const onlineTask=[...reopened.timers.values()].find(t=>t.delay===150);assert.ok(onlineTask);await onlineTask.fn();
  assert.equal(root().products[0].name,'Offline edit');
  // Device B edits a different entity from an older revision.
  b.read(`db.products.push(${JSON.stringify(product('p-two'))});queueSync('product.create',{productId:'p-two'});save()`);await b.autoSync();
  assert.equal(root().products.length,2);assert.equal(root().products.find(p=>p.id==='p-one').name,'Offline edit');
  await reopened.read('checkRemoteRevision()');assert.equal(reopened.read('db.products.length'),2);
});

test('in-flight edits, lost response retry and idempotent stock',async()=>{
  documents.clear();const a=browser();await a.login();a.read(`db.products.push(${JSON.stringify(product())});queueSync('product.create');save()`);await a.autoSync();
  a.read('db.products[0].stock=9;queueSync("product.update");save()');
  a.w.fetch=async(url,options)=>{const result=await request(url,options);if(options?.method==='POST'){a.read('db.products[0].name="Changed during request";queueSync("product.update");save()')}return result};
  await a.read('syncPending({silent:true})');assert.equal(a.read('db.syncQueue.length'),1);assert.equal(a.read('db.products[0].name'),'Changed during request');
  a.w.fetch=request;await a.read('syncPending({silent:true})');assert.equal(root().products[0].stock,9);
  a.read('db.products[0].stock=8;queueSync("product.update");save()');
  a.w.fetch=async(url,options)=>{await request(url,options);throw new Error('response lost')};await a.read('syncPending({silent:true})');
  assert.equal(root().products[0].stock,8);assert.equal(a.read('db.syncQueue.length'),1);
  const retry=browser(a.storage());await retry.read('syncPending({silent:true})');assert.equal(root().products[0].stock,8);assert.equal(retry.read('db.syncQueue.length'),0);
});

test('temporary API failures, expired token, delayed response after logout',async()=>{
  documents.clear();const a=browser();await a.login();a.read('go("reports")');
  for(const status of [500,401]){
    a.w.fetch=async()=>({ok:false,status,json:async()=>({error:'simulated failure'})});await a.read('pullRemote({silent:true})');
    assert.equal(a.read('currentRole()'),'admin');assert.equal(a.w.document.querySelector('.panel.active').id,'reports');
  }
  let complete;const deferred=new Promise(resolve=>complete=resolve);
  a.w.fetch=()=>deferred;const pending=a.read('pullRemote({silent:true})');a.w.enterVisitorMode();
  complete({ok:true,status:200,json:async()=>({state:{products:[product()]},revision:999})});await pending;
  assert.equal(a.read('isVisitor()'),true);assert.notEqual(a.read('db.serverRevision'),999);
});

test('same-field conflicts preserve pending work and logout archives it',async()=>{
  documents.clear();const a=browser();await a.login();a.read(`db.products.push(${JSON.stringify(product())});queueSync('product.create');save()`);await a.autoSync();
  const b=browser();await b.login();
  a.read('db.products[0].name="A";queueSync("product.update");save()');await a.autoSync();
  b.read('db.products[0].name="B";queueSync("product.update");save()');await b.autoSync();
  assert.equal(root().products[0].name,'A');assert.equal(b.read('db.products[0].name'),'B');assert.equal(b.read('db.syncQueue.length'),1);
  b.w.enterVisitorMode();assert.equal(b.read('isVisitor()'),true);assert.ok(b.w.localStorage.getItem('mkg-pending-u-admin'));
  await b.login();assert.equal(b.read('db.products[0].name'),'B');assert.equal(b.read('db.syncQueue.length'),1);
});

test('roles, first agent claim, public ownership, upload authentication and Base64 rejection',async()=>{
  documents.clear();const a=browser();await a.login();
  const seller={id:'u-seller',name:'Seller',email:'seller@example.test',accessCode:'123456',role:'seller',shops:['main'],permissions:['sales.create','sales.own','products.view','orders.waiting','orders.own'],status:'Actif'};
  root().users.push(seller,{...seller,id:'u-other',email:'other@example.test'}, {...seller,id:'u-manager',role:'manager',email:'manager@example.test',permissions:[...seller.permissions,'products.edit','reports.view']});root().products.push(product());
  const staff=browser();await staff.login('staff',seller.email,'123456');assert.equal(staff.read('currentRole()'),'seller');staff.read('go("settings")');assert.equal(staff.w.document.querySelector('.panel.active').id,'home');
  const refreshed=browser(staff.storage(),'products');assert.equal(refreshed.read('currentRole()'),'seller');
  const manager=browser();await manager.login('staff','manager@example.test','123456');assert.equal(manager.read('currentRole()'),'manager');
  const visitor=browser();await visitor.read('pullRemote({silent:true})');assert.equal(visitor.read('db.products[0].buy'),undefined);
  const sid='visitor-a',order={id:'ord-test',visitorSessionId:sid,items:[{productId:'p-one',qty:1}],messages:[],whatsapp:'123'};
  const post=body=>request('/api/sync',{method:'POST',body:JSON.stringify(body)});
  assert.equal((await post({action:'syncPublic',visitorSessionId:sid,orders:[order]})).status,200);
  const claims=await Promise.all(['u-seller','u-other'].map(id=>post({action:'claimOrder',orderId:order.id,auth:{token:signSession({id})}})));
  assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]);
  assert.equal((await post({action:'syncPublic',visitorSessionId:'visitor-attacker',orders:[order]})).status,403);
  const other=await request('/api/sync?scope=private',{headers:{'x-sync-token':signSession({id:'u-other'})}});assert.equal(other.data.state.orders.length,0);
  assert.equal((await request('/api/upload',{method:'POST',body:JSON.stringify({dataUrl:'data:image/png;base64,YQ=='})})).status,401);
  const bad=await post({action:'sync',requestId:'batch-image',auth:{token:signSession({id:'u-admin'})},changes:[{key:'ads',id:'ad-test',before:null,after:{id:'ad-test',image:'data:image/png;base64,YQ=='}}]});assert.equal(bad.status,400);
  const healthResult=await request('/api/health');assert.deepEqual(healthResult.data,{ok:true,provider:'firebase',firestore:true});
});

test('empty public catalog does not schedule render/pull loop',async()=>{
  documents.clear();const a=browser();await a.read('pullRemote({silent:true})');
  for(let i=0;i<5;i++)a.read('renderStorefront()');
  assert.equal([...a.timers.values()].filter(t=>t.delay===250).length,0);
});

test('staff sales decrement stock, concurrent sales merge, manager edits and server role revocation',async()=>{
  documents.clear();const owner=browser();await owner.login();root().products.push(product());
  const seller=id=>({id,name:id,email:`${id}@example.test`,accessCode:'123456',role:'seller',shops:['main'],permissions:['sales.create','sales.own','products.view'],status:'Actif'});
  root().users.push(seller('seller-a'),seller('seller-b'));
  const a=browser(),b=browser();await a.login('staff','seller-a@example.test','123456');await b.login('staff','seller-b@example.test','123456');
  for(const client of [a,b]){
    client.read('openSale()');client.w.document.querySelector('#saleProduct').value='p-one';client.w.document.querySelector('#saleQty').value='1';client.w.document.querySelector('#salePaid').value='5';
    client.w.document.querySelector('#saveSaleBtn').onclick();await client.read('syncPending({silent:true})');
    assert.equal(client.read('db.syncQueue.length'),0,client.read('db.lastSyncError'));
  }
  assert.equal(root().products[0].stock,8);assert.equal(root().sales.length,2);
  root().users.find(u=>u.id==='seller-a').status='Suspendu';
  const revoked=await request('/api/sync?scope=private',{headers:{'x-sync-token':a.read('db.syncAuth.token')}});
  assert.equal(revoked.status,401);assert.equal(revoked.data.code,'ACCOUNT_INVALID');
});

test('expired and forged tokens, request without credentials, legacy password cleanup',async()=>{
  documents.clear();const owner=browser();await owner.login();
  const payload=Buffer.from(JSON.stringify({sub:'u-admin',exp:Date.now()-1})).toString('base64url');
  const signature=crypto.createHmac('sha256',process.env.SESSION_SECRET).update(payload).digest('base64url');
  const expired=await request('/api/sync?scope=private',{headers:{'x-sync-token':`${payload}.${signature}`}});
  assert.equal(expired.status,401);assert.equal(expired.data.code,'TOKEN_EXPIRED');
  assert.equal((await request('/api/sync?scope=private',{headers:{'x-sync-token':'forged.token'}})).data.code,'TOKEN_INVALID');
  assert.equal((await request('/api/sync?scope=private')).status,401);
  const data=owner.storage();data['mkg-full-v31']=JSON.stringify({users:[{password:'old-secret'}],syncAuth:{secret:'old-secret'}});
  const migrated=browser(data);assert.ok(!JSON.stringify(migrated.storage()).includes('old-secret'));assert.equal(migrated.read('currentRole()'),'admin');
});

test('save-only business actions are queued; background rendering never writes',async()=>{
  documents.clear();const a=browser();await a.login();
  a.read('db.shops.push({id:"shop-second",name:"Second",location:"Test"});save()');
  assert.equal(a.read('db.syncQueue.length'),1);await a.read('syncPending({silent:true})');assert.equal(root().shops.length,2);
  const revision=root().revision;a.read('render();render()');assert.equal(a.read('db.syncQueue.length'),0);assert.equal(root().revision,revision);
});

test('impersonation survives reload and remote updates without replacing the authenticated owner',async()=>{
  documents.clear();const a=browser();await a.login();
  root().users.push({id:'agent-test',name:'Agent',role:'seller',email:'agent@example.test',shops:['main'],permissions:['sales.create'],status:'Actif'});
  await a.read('pullRemote({silent:true})');a.w.impersonateUser('agent-test');
  const reloaded=browser(a.storage(),'products');assert.equal(reloaded.read('db.currentUserId'),'agent-test');
  assert.equal(reloaded.read('db.sessionUser.id'),'u-admin');assert.equal(reloaded.read('db.impersonatedByAdminId'),'u-admin');
  await reloaded.read('pullRemote({silent:true})');assert.equal(reloaded.read('db.currentUserId'),'agent-test');
  reloaded.w.document.querySelector('#returnAdminBtn').onclick();assert.equal(reloaded.read('currentRole()'),'admin');
});

test('public order chat and finalization preserve ownership and decrement stock exactly once',async()=>{
  documents.clear();const a=browser();await a.login();root().products.push(product());
  const visitor=browser();await visitor.read('pullRemote({silent:true})');visitor.w.addVisitorCart('p-one');
  visitor.w.document.querySelector('#visitorWhatsappInput').value='0970000000';visitor.w.document.querySelector('#visitorNameInput').value='Client';
  visitor.w.document.querySelector('#createVisitorOrderBtn').onclick();await visitor.read('syncPending({silent:true})');
  assert.equal(visitor.read('db.syncQueue.length'),0,visitor.read('db.lastSyncError'));
  const orderId=visitor.read('db.orders[0].id');await a.read('pullRemote({silent:true})');a.w.selectOrder(orderId);
  await a.w.document.querySelector('#claimOrderBtn').onclick();
  a.w.document.querySelector('#finalizeOrderBtn').onclick();a.w.document.querySelector('#confirmFinalizeOrderBtn').onclick();
  await a.read('syncPending({silent:true})');assert.equal(a.read('db.syncQueue.length'),0,a.read('db.lastSyncError'));
  assert.equal(root().products[0].stock,9);assert.equal(root().sales.length,1);
  assert.equal(documents.get(`mmedpren_orders/${orderId}`).payload.status,'completed');
  await visitor.read('pullRemote({silent:true})');assert.equal(visitor.read('db.orders[0].status'),'completed');
});

test('service worker update, API bypass, offline fallback and old cache cleanup',async()=>{
  const handlers={},stores=new Map([['mmedpren-v32',new Map()],['unrelated-cache',new Map()]]);
  const key=v=>typeof v==='string'?v:v.url;
  const caches={async keys(){return [...stores.keys()]},async delete(k){return stores.delete(k)},async open(k){if(!stores.has(k))stores.set(k,new Map());const store=stores.get(k);return {async addAll(){},async put(k,v){store.set(key(k),v)},async match(k){return store.get(key(k))}}}};
  let network='new deployment',claimed=false,skipped=false;
  const context={URL,Request:class {constructor(url,options){this.url=url;this.options=options}},Response,caches,fetch:async()=>{if(network===null)throw new Error('offline');return new Response(network)},self:{location:{origin:'https://app.test',href:'https://app.test/sw.js'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>skipped=true,clients:{claim:async()=>claimed=true}}};
  vm.runInNewContext(fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8'),context);
  let work;handlers.install({waitUntil:p=>work=p});await work;assert.equal(skipped,true);
  handlers.activate({waitUntil:p=>work=p});await work;assert.equal(claimed,true);assert.ok(stores.has('unrelated-cache'));assert.ok(!stores.has('mmedpren-v32'));
  const fetchEvent=async(path,mode='navigate')=>{let result;handlers.fetch({request:{url:'https://app.test'+path,method:'GET',mode},respondWith:p=>result=p});return result};
  assert.equal(await (await fetchEvent('/')).text(),'new deployment');network=null;
  assert.equal(await (await fetchEvent('/index.html')).text(),'new deployment');
  await assert.rejects(fetchEvent('/api/sync','cors'),/offline/);
});
