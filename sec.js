const { chromium } = require('playwright');
const { makeStore, newDevice } = require('./tests/helpers');
const _d = new Date(), TODAY = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0');
(async()=>{
 const b=await chromium.launch(); const store=makeStore();
 const p=await newDevice(b, store, { session: { id:'11111111-1111-1111-1111-111111111111', email:'a@b.co', name:'Asha' } });
 const errs=p.errors;
 const reqs=[]; p.on('request',r=>reqs.push(r.url()));
 const url='file://'+process.cwd()+'/macro-budget-planner.html';
 const out=[]; const ok=(c,m)=>out.push((c?'PASS ':'FAIL ')+m);
 // seed a normal user + plan
 await p.goto(url);
 await p.evaluate(()=>{localStorage.setItem('mbp',JSON.stringify({diet:'nonveg',kitchen:true,place:'home',meals:0,step:4,budget:200,city:'Pune'}));});
 await p.reload(); await p.waitForTimeout(900);
 // 1. backup code has no email/name
 await p.click('#bkOpen'); const code=await p.$eval('#bkCode',e=>e.value);
 const dec=JSON.parse(Buffer.from(code,'base64').toString()); ok(!JSON.stringify(dec).includes('a@b.co') && !dec.s.name,'backup has no name/email');
 // 2. XSS payload restore
 const pay={v:1,s:{diet:'nonveg',kitchen:true,place:'home',budget:'200"><img src=x onerror="window.__x=1">',weight:'<svg onload=window.__x=2>',
   myP:'1"><script>window.__x=3</script>',out:[{key:'k',price:'"><img src=x onerror=window.__x=4>'}],myPrices:{'x':{p:'"><b>'}},
   __proto__:{polluted:1},constructor:{prototype:{polluted:1}},exclude:['<b>',3,'9999999'],ate:{'<x>':['a'],[TODAY]:[{}, 'ok']}},u:{name:'<img src=x onerror=window.__x=5>',email:'evil@x'}};
 const raw=JSON.stringify(pay).replace('{"diet"','{"__proto__":{"polluted":1},"diet"');
 const evil=Buffer.from(raw).toString('base64');
 await p.fill('#bkIn',evil); await p.click('#bkRestore'); await p.waitForTimeout(1200);
 for (const t of ['shop','out','day']) { const el=await p.$(`[data-tab=${t}]`); if(el){await el.click(); await p.waitForTimeout(200);} }
 const st=await p.evaluate(()=>({x:window.__x, pol:({}).polluted, S:JSON.parse(localStorage.getItem('mbp')), u:localStorage.getItem('fake_session'), imgs:document.querySelectorAll('img[src=x],svg[onload]').length}));
 ok(st.x===undefined && st.imgs===0,'no injected script/elements ran');
 ok(st.pol===undefined,'no prototype pollution');
 ok(st.S.budget===200 && st.S.weight===70 && st.S.myP===null,'bad numbers fall back to defaults');
 ok(JSON.stringify(st.S.exclude)==='[3]','exclude list cleaned');
 ok(st.u && st.u.includes('a@b.co') && !st.u.includes('evil'),'restore does not overwrite account');
 ok(Object.keys(st.S.ate).join()===TODAY && st.S.ate[TODAY].join()==='ok','ate cleaned');
 // 3. DEFAULTS not mutated by exclude
 const ex=await p.$('[data-ex]'); 
 // 4. logout clears device
 await p.click('#logout'); await p.waitForTimeout(400);
 const after=await p.evaluate(()=>[localStorage.getItem('mbp'),localStorage.getItem('mbp_user'),!!document.querySelector('#guest')]);
 ok(after[1]===null && after[2],'logout clears old account key and returns to welcome');
 ok(after[0]===null || !JSON.parse(after[0]).diet,'logout removes plan');
 ok(!reqs.some(u=>/jsdelivr/.test(u)),'no CDN script requests');
 ok(errs.length===0,'no JS errors '+errs.join('|'));
 console.log(out.join('\n')); await b.close(); process.exit(out.some(l=>l.startsWith('FAIL'))?1:0);
})();
