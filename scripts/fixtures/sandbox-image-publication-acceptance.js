'use strict';
// Temporary localhost-only acceptance client. Authentication remains browser-managed.
// No SDK, cookie/storage credential access, board API, payment API, or external requests.
const EXPECTED = 'http://127.0.0.1:4998';
const PROJECT = 'pwpklwihwmxdehfdsoij.supabase.co';
const out = document.getElementById('results');
const buttons = [...document.querySelectorAll('button')];
let fixture = null;
let lastConcurrency = null;
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt0AAAAASUVORK5CYII=';
const alternative = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function log(name, details) { out.textContent += '\n' + JSON.stringify({name, ...details}); }
function check(name, pass, status) { log(name, {pass, ...(status === undefined ? {} : {status})}); if (!pass) throw new Error('check failed'); }
async function request(path, init = {}) {
  if (location.origin !== EXPECTED || !(/^\/api\/cloud\/identity$|^\/login$|^\/api\/img\/acceptance-[a-zA-Z0-9_-]+$/.test(path))) throw new Error('target refused');
  return fetch(path, {...init, credentials:'same-origin', cache:'no-store', redirect:'error'});
}
async function identity() {
  const publicPage = await request('/login');
  const text = await publicPage.text();
  const hosts = [...new Set((text + publicPage.headers.get('content-security-policy')).match(/[a-z0-9]+\.supabase\.co/g))];
  check('Exact sandbox public config', publicPage.status === 200 && hosts.length === 1 && hosts[0] === PROJECT);
  const r = await request('/api/cloud/identity');
  const data = await r.json();
  check('Authenticated identity (not entitlement)', r.status === 200 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.owner));
  log('Verified account UUID', {owner:data.owner});
  if (fixture && fixture.owner !== data.owner) throw new Error('account changed; reload harness for another account');
  fixture ??= {owner:data.owner, id:'acceptance-'+crypto.randomUUID(), paid:false};
  log('Synthetic fixture', {id:fixture.id, retained:true});
  return fixture;
}
async function img(method, id, src, owner = fixture.owner) {
  const headers = {};
  if (owner !== null) headers['X-Capture-Owner'] = owner;
  if (src !== undefined) headers['Content-Type'] = 'application/json';
  return request('/api/img/'+id, {method, headers, ...(src === undefined ? {} : {body:JSON.stringify({src})})});
}
async function status(name, method, id, expected, src, owner) {
  const r = await img(method,id,src,owner);
  check(name, r.status === expected, r.status);
  check(name+' no-store', (r.headers.get('cache-control') || '').includes('no-store'));
  return r;
}
async function recover(name, id, expected) {
  const r = await status(name,'GET',id,200);
  const body = await r.json();
  check(name+' exact bytes',body.src === expected);
  document.getElementById('fixture').src = body.src;
}
async function inspectConcurrency() {
  check('Concurrency diagnostic exists in this page',lastConcurrency !== null);
  const c = lastConcurrency;
  log('Concurrent response evidence',{id:c.id,responses:c.responses});
  const reads = [];
  const sources = [];
  for (let i = 0; i < 2; i++) {
    const r = await img('GET',c.id,undefined,c.owner);
    const body = await r.json().catch(()=>null);
    const source = body?.src;
    sources.push(source);
    reads.push({status:r.status,matchesPixel:source===pixel,matchesAlternative:source===alternative});
    if (source === pixel || source === alternative) document.getElementById('fixture').src = source;
  }
  const stable = reads.every(r=>r.status===200 && (r.matchesPixel || r.matchesAlternative)) && sources[0]===sources[1];
  log('Concurrent immutable recovery evidence',{id:c.id,reads,stable});
  // Keep attribution assertion, but NEVER let it suppress recovery evidence.
  check('Concurrent writes HTTP success',c.responses.every(r=>r.status===200));
  check('Concurrent recovered source is stable and submitted',stable);
  check('Exactly one concurrent immutable winner',c.responses.filter(r=>r.stored===true).length===1 && c.responses.filter(r=>r.stored===false).length===1);
  check('Attributed winner matches recovered bytes',sources[0]===(c.responses[0].stored ? pixel : alternative));
}
async function runConcurrency() {
  // Five bounded rounds per user click. Preserve ALL evidence even on attribution
  // failure. No retry of PUT, no cleanup, and no writes unless fresh HEAD is 404.
  const batch = [];
  window.captureConcurrencyBatch = batch;
  for (let round = 0; round < 5; round++) {
    const id = 'acceptance-'+crypto.randomUUID();
    log('Batch fixture before requests',{round:round+1,id,retained:true});
    const fresh = await img('HEAD',id);
    if (fresh.status !== 404) {
      log('Batch aborted before upload',{id,status:fresh.status});
      throw new Error('fresh HEAD prerequisite failed');
    }
    const responses = await Promise.all([pixel,alternative].map(async source => {
      try {
        const r = await img('PUT',id,source);
        const body = await r.json().catch(()=>null);
        return {status:r.status,stored:typeof body?.stored === 'boolean' ? body.stored : null,noStore:(r.headers.get('cache-control') || '').includes('no-store')};
      } catch { return {status:null,stored:null,noStore:false}; }
    }));
    lastConcurrency = {id,owner:fixture.owner,responses};
    const reads = [];
    const sources = [];
    for (let i=0;i<2;i++) {
      try {
        const r = await img('GET',id);
        const body = await r.json().catch(()=>null);
        sources.push(body?.src);
        reads.push({status:r.status,bytes:body?.src===pixel?'PNG':body?.src===alternative?'GIF':'unexpected',noStore:(r.headers.get('cache-control') || '').includes('no-store')});
      } catch {
        sources.push(null);
        reads.push({status:null,bytes:'unexpected',noStore:false});
      }
    }
    const winner = responses.findIndex(r=>r.stored===true);
    const stable = reads.every(r=>r.status===200 && r.bytes!=='unexpected') && sources[0]===sources[1];
    const exactlyOne = responses.filter(r=>r.stored===true).length===1 && responses.filter(r=>r.stored===false).length===1;
    const attributed = exactlyOne && sources[0]===[pixel,alternative][winner];
    const pass = responses.every(r=>r.status===200 && r.noStore) && reads.every(r=>r.noStore) && (fresh.headers.get('cache-control') || '').includes('no-store') && stable && attributed;
    const result = {round:round+1,id,responses,reads,stable,exactlyOne,attributed,pass};
    batch.push(result);
    log('Batch concurrency evidence',result);
  }
  window.captureConcurrencyBatch = batch;
  log('Batch complete',{rounds:batch.length,passed:batch.filter(r=>r.pass).length,failed:batch.filter(r=>!r.pass).length,ids:batch.map(r=>r.id),retained:true});
  check('All five concurrent immutable creates pass',batch.length===5 && batch.every(r=>r.pass));
}
const actions = {
  concurrency: async () => { await identity(); await runConcurrency(); },
  lastConcurrency: async () => { await identity(); await inspectConcurrency(); },
  inspect: async () => {
    const f = await identity();
    const r = await img('HEAD',f.id);
    log('Current image entitlement/storage probe', {status:r.status, meaning:r.status === 402 ? 'Authenticated but unpaid: run unpaid tests' : r.status === 404 ? 'Entitled and fixture absent: paid phase ready' : r.status === 204 ? 'Entitled and fixture exists' : 'BLOCKED: not entitlement proof'});
  },
  unpaid: async () => {
    const f = await identity();
    for (const method of ['HEAD','GET','PUT']) await status('Unpaid own '+method,method,f.id,402,method === 'PUT' ? pixel : undefined);
    log('Unpaid A phase complete',{pass:true});
  },
  paid: async () => {
    const f = await identity();
    await status('Missing owner precondition','HEAD',f.id,428,undefined,null);
    await status('Wrong owner precondition','HEAD',f.id,412,undefined,'acceptance-wrong-owner');
    if (!f.paid) {
      await status('Paid missing metadata','HEAD',f.id,404);
      const r = await status('Paid synthetic upload','PUT',f.id,200,pixel);
      check('Created immutable object',(await r.json()).stored === true);
      f.paid = true;
    }
    await status('Paid metadata','HEAD',f.id,204);
    await recover('Paid recovery',f.id,pixel);
    const duplicate = await status('Duplicate alternate image no overwrite','PUT',f.id,200,alternative);
    check('Duplicate acknowledges retained object',(await duplicate.json()).stored === false);
    await recover('Original bytes survive duplicate',f.id,pixel);
    await status('Unsupported SVG rejected','PUT',f.id+'-mime',400,'data:image/svg+xml;base64,PHN2Zy8+');
    await status('Invalid raster rejected','PUT',f.id+'-invalid',400,'data:image/png;base64,YWJj');
    await runConcurrency();
    log('Paid A app-route phase complete',{pass:true, concurrency_fixture:lastConcurrency.id, scope:'cookie-bound app image routes only; direct RLS/account B/reload/board UI not tested'});
  },
  expired: async () => {
    const f = await identity();
    check('Paid fixture exists from earlier phase',f.paid);
    for (const method of ['HEAD','GET','PUT']) await status('Expired own '+method,method,f.id,402,method === 'PUT' ? pixel : undefined);
    log('Expired A phase complete',{pass:true});
  }
};
for (const button of buttons) button.addEventListener('click',async () => {
  buttons.forEach(b=>b.disabled=true);
  try { await actions[button.id](); }
  catch { log('STOP',{reason:'Prerequisite/request/assertion failed. No credentials or raw response bodies logged. See last check.'}); }
  finally { buttons.forEach(b=>b.disabled=false); }
});
