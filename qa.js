const { chromium } = require('playwright');
const BAD=/\bNaN\b|undefined|\bnull\b|Infinity|\[object/;
(async()=>{
 const b=await chromium.launch(); const issues=[]; let checks=0;
 const ctx=await b.newContext({viewport:{width:360,height:780},isMobile:true,hasTouch:true});
 await ctx.addInitScript(()=>{ window.__mbpTestHook=true; window.__mbpPro=true; });   // full walkthrough runs as Pro; tests/pro.test.js covers Basic
 const p=await ctx.newPage(); p.on('pageerror',e=>issues.push('JS error: '+e.message)); p.on('console',m=>{ if(m.type()==='error' && !/fonts|ERR_|net::/.test(m.text())) issues.push('console: '+m.text()); });
 await p.route('**/javascript-lp-solver@0.4.24/prod/solver.js',r=>r.fulfill({path:'node_modules/javascript-lp-solver/prod/solver.js',contentType:'application/javascript'}));
 await p.route('**fonts.g*/**',r=>r.abort());
 const url='file://'+process.cwd()+'/macro-budget-planner.html';
 const scan=async(label)=>{ checks++; const r=await p.evaluate((re)=>{const t=document.body.innerText; const m=t.match(new RegExp(re)); return {bad:m?t.slice(Math.max(0,m.index-60),m.index+40):null, sw:document.documentElement.scrollWidth, w:innerWidth, cost:(document.querySelector('.cost')||{}).innerText||''};}, BAD.source);
   if(r.bad) issues.push(label+': bad text "'+r.bad.replace(/\n/g,' ')+'"'); if(r.sw>r.w+1) issues.push(label+': page wider than screen '+r.sw); return r; };
 const tabs=async(label)=>{ for (const t of ['day','shop','out']) { const el=await p.$(`[data-tab=${t}]`); if(!el){issues.push(label+': no tab '+t); continue;} await el.click(); await p.waitForTimeout(120); await scan(label+' tab '+t);} await p.click('[data-tab=day]'); };
 // 1. full sign-up flow
 await p.goto(url); await p.waitForTimeout(300); await scan('welcome');
 await p.click('#guest'); await p.waitForTimeout(200); await scan('guest start');
 await p.click('.opt[data-v=egg]'); await p.waitForTimeout(250); await scan('life');
 const nextDis=await p.$eval('#next',e=>e.disabled); if(!nextDis) issues.push('life step: Continue enabled before choosing');
 await p.click('.opt[data-v=pg]'); await p.click('#pgk [data-k="0"]'); await p.click('[data-gear=fridge]'); await p.click('#meals [data-n="2"]'); await p.click('#next'); await scan('body');
 for(let i=0;i<5;i++) await p.click('#wPlus'); await p.click('.opt[data-v=lose]'); await p.click('#next'); await scan('budget');
 await p.$eval('#budget',e=>{e.value=40;e.dispatchEvent(new Event('input'))}); await p.waitForTimeout(300); await scan('budget 40');
 await p.click('#next'); await p.waitForTimeout(800); await scan('result low budget'); await tabs('low budget');
 // back button from quiz
 // 2. many scenarios via state
 const combos=[]; for (const diet of ['veg','egg','nonveg']) for (const place of ['home','pg','hostel']) for (const budget of [40,120,300,500]) for (const meals of [0,3]) combos.push({diet,place,budget,meals});
 for (const c of combos) {
  const s=Object.assign({kitchen:c.place==='home'||c.place==='pg', pgKitchen:true, gear:{kettle:c.budget>200,microwave:false,fridge:c.budget>300}, weight:60+c.budget%40, goal:['muscle','lose','fit'][c.budget%3], step:4, city:['Delhi NCR','Mumbai','Pune','Other'][c.meals%4+(c.budget>200?1:0)], style:['cheap','balanced','tasty'][c.budget%3], people: c.budget>300?3:1},c);
  if(c.place==='hostel') s.kitchen=false;
  await p.evaluate(st=>localStorage.setItem('mbp',JSON.stringify(st)),s); await p.goto(url); await p.waitForTimeout(150); await p.click('#guest'); await p.waitForTimeout(500);
  const lab=JSON.stringify(c); const ok=await p.$('.cost'); if(!ok){ const h=await p.$eval('h1',e=>e.innerText).catch(()=>'?'); issues.push(lab+': no plan ('+h+')'); continue; }
  await scan(lab); await tabs(lab);
  // day chips
  for (const d of [1,3,6]) { const el=await p.$(`[data-day="${d}"]`); if(el){ await el.click(); await p.waitForTimeout(80); await scan(lab+' day'+d);} }
 }
 // 3. interactions on one plan
 await p.evaluate(()=>localStorage.setItem('mbp',JSON.stringify({diet:'nonveg',kitchen:true,place:'home',meals:1,budget:220,style:'balanced',weight:72,goal:'muscle',step:4,city:'Mumbai'}))); await p.goto(url); await p.waitForTimeout(150); await p.click('#guest'); await p.waitForTimeout(600);
 for (let i=0;i<6;i++){ const sw=await p.$('.swap[data-id]'); if(!sw) break; await sw.click(); await p.waitForTimeout(400); await scan('swap '+i); }
 const undo=await p.$('#undo'); if(undo){ await undo.click(); await p.waitForTimeout(400);} else issues.push('no Undo after swaps');
 await p.click('.stp[data-kind=p] [data-d="1"]'); await p.waitForTimeout(600); await scan('protein+');
 await p.click('.stp[data-kind=c] [data-d="-1"]'); await p.waitForTimeout(600); await scan('carbs-');
 await p.click('[data-style=tasty]'); await p.waitForTimeout(500); await scan('tasty');
 await p.$eval('#tBudget',e=>{e.value=500;e.dispatchEvent(new Event('input'))}); await p.waitForTimeout(700); await scan('budget 500');
 await p.click('[data-tab=out]'); for (const ch of ["Burger King","McDonald's","KFC","Pizza Hut","Domino's"]) { await p.click(`[data-chain="${ch}"]`); await p.waitForTimeout(100); await scan('out '+ch); const a=await p.$('#panel [data-add]'); if(a){ await a.click(); await p.waitForTimeout(400); await p.click('[data-tab=out]'); } }
 await p.click('#onlyPriced'); await p.waitForTimeout(150); await scan('out unpriced'); const more=await p.$('#more'); if(more){ await more.click(); await scan('more'); }
 await p.click('[data-src=lic]'); await p.waitForTimeout(150); await scan('licious'); const lic=await p.$('[data-lic]'); if(lic){ await lic.click(); await p.waitForTimeout(500);} 
 await p.click('[data-tab=day]'); await p.waitForTimeout(150); await scan('day with orders');
 for (let i=0;i<4;i++){ const t=(await p.$$('.tick-btn'))[i]; if(t){ await t.click(); await p.waitForTimeout(60);} } await scan('ticked');
 const fr=await p.$('[data-frac]'); if(fr){ await fr.click(); await p.waitForTimeout(300); }
 await p.click('[data-tab=shop]'); for (const n of [2,4,1]) { await p.click(`[data-people="${n}"]`); await p.waitForTimeout(100); await scan('people '+n); }
 await p.click('.shop [data-edit]'); await p.fill('#pIn','0'); await p.click('#pSave'); const pe=await p.$eval('#pErr',e=>e.innerText); if(!pe) issues.push('price 0 accepted');
 await p.click('#pCancel'); await p.click('#locChange'); await p.selectOption('#lCity','Bengaluru'); await p.click('#locSave'); await p.waitForTimeout(500); await scan('loc change');
 await p.click('#bkOpen'); await p.fill('#bkIn','garbage'); await p.click('#bkRestore'); const be=await p.$eval('#bkErr',e=>e.innerText); if(!be) issues.push('bad backup code: no error');
 await p.click('#restart'); await p.waitForTimeout(200); await scan('restart'); 
 const back=await p.$('#back'); 
 console.log('checks',checks); console.log(issues.length? [...new Set(issues)].join('\n') : 'NO ISSUES');
 await b.close(); })();
