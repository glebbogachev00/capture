'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS VM test executable. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto').webcrypto;
async function run(mode) {
  const logs={textContent:''}, requests=[], objects=new Map();
  const context=vm.createContext({window:{},location:{origin:'http://127.0.0.1:4998'},crypto,
    document:{getElementById:()=>logs,querySelectorAll:()=>[]},
    fetch:async (path,options)=>{
      assert.match(path,/^\/api\/img\/acceptance-[a-z0-9-]+$/);
      assert.equal(options.credentials,'same-origin');
      assert.equal(options.cache,'no-store');
      assert.equal(options.redirect,'error');
      requests.push({path,method:options.method});
      const headers={'content-type':'application/json','cache-control':'private, no-store'};
      if(mode==='missing-no-store')delete headers['cache-control'];
      if(options.method==='HEAD')return new Response(null,{status:mode==='denied'?403:404,headers});
      if(options.method==='PUT'){
        const body=JSON.parse(options.body);const existed=objects.has(path);
        if(!existed || mode==='both-success')objects.set(path,body.src);
        return new Response(JSON.stringify({ok:true,stored:mode==='both-success'||!existed}),{headers});
      }
      if(mode==='read-error')throw new Error('synthetic network failure');
      return new Response(JSON.stringify({src:objects.get(path)}),{headers});
    }
  });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'fixtures/sandbox-image-publication-acceptance.js'),'utf8'),context);
  vm.runInContext("fixture={owner:'00000000-0000-4000-8000-000000000001'}",context);
  let failed=false;try{await vm.runInContext('runConcurrency()',context);}catch{failed=true;}
  if(mode==='denied'){
    assert.equal(requests.length,1);assert.equal(requests[0].method,'HEAD');assert.equal(failed,true);
  }else{
    const batch=context.window.captureConcurrencyBatch;
    assert.equal(batch.length,5);assert.equal(new Set(batch.map(x=>x.id)).size,5);
    assert.equal(requests.length,25);assert.equal(requests.filter(x=>x.method==='PUT').length,10);
    assert.equal(failed,mode!=='correct');assert.ok(batch.every(x=>x.pass===(mode==='correct')));
    if(mode==='both-success')assert.ok(batch.every(x=>x.stable && !x.exactlyOne && x.reads.every(r=>r.bytes==='GIF')));
  }
  return {mode,requests:requests.length,failedAsExpected:failed};
}
(async()=>{for(const mode of ['correct','both-success','missing-no-store','denied','read-error'])console.log(await run(mode));console.log('PASS bounded batch; failures retain all five records; no PUT after non-404');})().catch(e=>{console.error(e);process.exitCode=1;});
