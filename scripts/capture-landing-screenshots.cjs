const {chromium}=require('/Users/glebbogachev/Documents/Retake/node_modules/playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch();
 try{
 const context=await browser.newContext({viewport:{width:680,height:1000},deviceScaleFactor:2,reducedMotion:'reduce'});
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:3148/app',{waitUntil:'networkidle'});
 // Synthetic history only, in a disposable browser. No model response is mocked.
 const fixture=await page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('capture',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
  const now=Date.now();const ledger=[];
  const texts=['I want to make time for a small creative project each week.','The app idea could start with a simple prototype.','Ask a friend to try the first version.'];
  for(let day=0;day<75;day++){
   if(day%6===4||day%7===2)continue;
   for(let n=0;n<(day===0?3:1+day%4);n++)ledger.push({id:`example-${day}-${n}`,at:now-day*86400000-n*60000,raw:texts[n%3],clean:texts[n%3],kind:'thread',source:'typed',targetId:'example-thread',restored:true});
  }
  await new Promise((resolve,reject)=>{const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(JSON.stringify({actions:[],threads:[],intentions:[],principles:[],ledger,corrections:[]}), 'capture:data:v1');tx.oncomplete=resolve;tx.onerror=reject});
  db.close();return {sampleEntries:ledger.length,privateData:false};
 });
 await page.reload({waitUntil:'networkidle'});
 await page.getByRole('button',{name:'0 OPEN · 0 THREADS'}).click();
 await page.locator('.record-cell').last().click();
 const frame=page.locator('.record-frame');await frame.scrollIntoViewIfNeeded();
 fs.mkdirSync('public/screenshots',{recursive:true});
 await frame.screenshot({path:'public/screenshots/record-heatmap.png'});
 await page.getByRole('button',{name:/← capture/i}).click();
 await page.getByRole('button',{name:'Distill instead of capture'}).click();
 await page.getByRole('button',{name:"I have an idea for an app but it's fuzzy.",exact:true}).click();
 await page.locator('.distill-view').screenshot({path:'public/screenshots/distill-mode.png'});
 console.log(JSON.stringify({fixture,record:await frame.count(),screenshots:['public/screenshots/record-heatmap.png','public/screenshots/distill-mode.png'],distill:'Real app starter selected; unsent draft, no simulated AI answer.'}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
