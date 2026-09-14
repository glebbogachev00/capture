const {chromium}=require('/Users/glebbogachev/Documents/Retake/node_modules/playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const base=process.env.BASE_URL||'http://127.0.0.1:3148';
const dir=`outputs/content-release/${new URL(base).hostname}`;
fs.mkdirSync(dir,{recursive:true});
(async()=>{
 const browser=await chromium.launch();
 const results=[];
 try {
 for(const width of [390,760,761,1440]) {
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage();const errors=[];const failed=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/_vercel/'))failed.push(`${r.status()} ${r.url()}`)});
  const response=await page.goto(base,{waitUntil:'networkidle'});assert.equal(response.status(),200);
  assert.equal(await page.locator('h1').innerText(),'Messy thoughts that sort themselves.');
  assert.equal(await page.locator('.site-hero .site-lede').innerText(),'Say what’s on your mind. Capture keeps related ideas together, separates out tasks, and helps you find your thoughts later.');
  assert.equal(await page.locator('.capture-walkthrough').count(),0);
  const text=await page.locator('body').innerText();
  for(const term of ['Thought capture','new or existing threads','pulls out the things to do','not a replacement for Notion or Obsidian','Distill mode','Your history, ready for your agent.','Export a backup before clearing browser data.'])assert(text.toLowerCase().includes(term.toLowerCase()),term);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
  assert.equal(await page.locator('#distill-heading').innerText(),'When you need to think it through.');
  assert.equal(await page.locator('#handoff-heading').innerText(),'Your history, ready for your agent.');
  assert.equal(await page.locator('#distill-title').innerText(),'Distill mode');
  assert.equal(await page.locator('#handoff-title').innerText(),'Agent handoff');
  for(const id of ['distill','handoff']) assert((await page.locator(`#${id} > p`).innerText()).trim());
  const sections=await page.evaluate(()=>{
   const kinds=document.querySelector('.site-kind-grid').getBoundingClientRect();
   const d=document.querySelector('[aria-labelledby="distill-heading"]');
   const h=document.querySelector('[aria-labelledby="handoff-heading"]');
   const frame=d.querySelector('.feature-screenshot-frame').getBoundingClientRect();
   const img=d.querySelector('.feature-screenshot-frame img').getBoundingClientRect();
   return {topLevel:[d,h].every(e=>e.parentElement.classList.contains('site-wrap')),ordered:kinds.bottom<=d.getBoundingClientRect().top&&d.getBoundingClientRect().bottom<=h.getBoundingClientRect().top,headingsAbove:[d,h].every(e=>e.querySelector('.movement').getBoundingClientRect().bottom<=e.querySelector('.site-card').getBoundingClientRect().top),left:img.left-frame.left,right:frame.right-img.right};
  });
  assert(sections.topLevel&&sections.ordered&&sections.headingsAbove,JSON.stringify(sections));
  assert(sections.left>=24&&sections.right>=24,JSON.stringify(sections));
  results.push({width,sections});
  for(const img of await page.locator('.site-app-logos img').all()) assert(await img.evaluate(i=>i.complete&&i.naturalWidth>0),'brand image');
  await page.screenshot({path:`${dir}/hero-${width}.png`});
  if(width<=760) {
   const toggle=page.getByRole('button',{name:'Open navigation'});
   assert(await toggle.isVisible());
   assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   await toggle.click();assert(await page.getByRole('button',{name:'Close navigation'}).isVisible());
   for(const label of ['About','Writing','Install','Pricing'])assert(await page.getByRole('navigation',{name:'Capture links'}).getByRole('link',{name:label,exact:true}).isVisible());
   await page.screenshot({path:`${dir}/menu-${width}.png`});
   await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   assert(await toggle.evaluate(e=>e===document.activeElement));
   await toggle.click();await page.getByRole('navigation',{name:'Capture links'}).getByRole('link',{name:'Writing',exact:true}).click();
   await page.waitForURL('**/writing');assert.equal(await page.getByRole('button',{name:'Open navigation'}).getAttribute('aria-expanded'),'false');
   await page.goto(base,{waitUntil:'networkidle'});
  } else assert(!(await page.locator('.site-nav-toggle').isVisible()));
  if(width===390||width===1440){
   for(const [name,selector] of [['topics','.site-day'],['apps','.site-other-apps'],['distill','[aria-labelledby="distill-heading"]'],['handoff','[aria-labelledby="handoff-heading"]']]) {
    const element=page.locator(selector);await element.scrollIntoViewIfNeeded();for(const img of await element.locator('.feature-card-image img').all()){await img.evaluate(i=>i.decode());assert(await img.evaluate(i=>i.complete&&i.naturalWidth>0));}await element.screenshot({path:`${dir}/${name}-${width}.png`});
   }
   await page.getByRole('button',{name:'Watch the 25-second demo'}).click();
   await page.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.readyState>=2));
   const media=await page.locator('video').first().evaluate(v=>({src:v.currentSrc,width:v.videoWidth,readyState:v.readyState}));
   assert(media.width>0);results.push({width,media});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);results.push({width,menu:'passed',copy:'passed',overflow:false,errors,failed});
  await context.close();
 }
 const page=await browser.newPage({viewport:{width:390,height:844}});
 for(const route of ['/about','/writing','/install','/pricing','/app','/og-clarity.png']){
  const response=await page.goto(base+route,{waitUntil:'networkidle'});assert.equal(response.status(),200,route);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${route}`);
  if(['/about','/writing','/install','/pricing'].includes(route)){
   await page.getByRole('button',{name:'Open navigation'}).click();assert.equal(await page.getByRole('button',{name:'Close navigation'}).getAttribute('aria-expanded'),'true');
   await page.keyboard.press('Escape');
  }
  results.push({route,status:response.status()});
 }
 fs.writeFileSync(`${dir}/results.json`,JSON.stringify({base,results},null,2));
 console.log(JSON.stringify({base,results},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
