import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../js/api-client.js', import.meta.url), 'utf8');
const client = () => import(`data:text/javascript;base64,${Buffer.from(source+`\n// ${Math.random()}`).toString('base64')}`);
const tick = () => new Promise(resolve=>setTimeout(resolve,20));
globalThis.location = {hostname:'127.0.0.1',host:'127.0.0.1:3000',port:'3000',protocol:'http:',href:'http://127.0.0.1:3000/policy-lab.html'};

test('static preview uses discovered backend for HTTP and experiment WebSockets', async () => {
  const urls=[],sockets=[];
  globalThis.fetch = async url => {
    urls.push(url);
    if(url==='/api/v1/health')return {ok:false,json:async()=>{throw Error('HTML preview');}};
    if(url.endsWith('/health'))return {ok:true,json:async()=>({mode:'local-single-user'})};
    return {ok:true,json:async()=>({id:'job',revision:1,status:'running'})};
  };
  globalThis.WebSocket = class {constructor(url){this.url=url.toString();sockets.push(this);}close(){}};
  const api=await client();await api.connectBackend();
  let updates=0;
  const stop=api.observeResource('experiments','job',()=>{updates++;});
  await tick();
  assert.equal(updates,1);
  assert.equal(sockets[0].url,'ws://127.0.0.1:8010/api/v1/experiments/job/stream');
  sockets[0].onmessage({});
  await tick();
  assert.equal(updates,1,'duplicate revision must not repaint');
  assert.ok(urls.includes('http://127.0.0.1:8010/api/v1/experiments/job'));
  stop();
});

test('completed records never open a socket', async () => {
  globalThis.fetch=async()=>({ok:true,json:async()=>({revision:4,status:'completed'})});
  globalThis.WebSocket=class {constructor(){assert.fail('terminal job opened a socket');}};
  const api=await client();let record;
  const stop=api.observeResource('runs','done',r=>{record=r;});
  await tick();assert.equal(record.status,'completed');stop();
});

test('late HTTP responses do not update a disposed page', async () => {
  let resolve;
  globalThis.fetch=()=>new Promise(r=>{resolve=r;});
  const api=await client();let updates=0;
  const stop=api.observeResource('experiments','old',()=>{updates++;});
  stop();
  resolve({ok:true,json:async()=>({revision:1,status:'running'})});
  await tick();assert.equal(updates,0);
});

test('undefined metrics remain unavailable and floating-point negative zero is not shown', async () => {
  const api=await client();
  assert.equal(api.number(null),'—');
  assert.equal(api.number(-1e-12,2),'0');
  assert.equal(api.escapeHTML('<script>'), '&lt;script&gt;');
});
