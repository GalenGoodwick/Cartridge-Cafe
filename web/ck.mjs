import { chromium } from 'playwright'
const OUT='/private/tmp/claude-501/-Users-galengoodwick/175748ea-2e13-4691-8fb2-4a055288c620/scratchpad/'
const b=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']})
const p=await b.newPage({viewport:{width:1200,height:820}})
let comp=false,q=false,qmsg=null;p.on('console',m=>{const x=m.text();if(/Pipeline compiled/i.test(x))comp=true;if(/QUARANTIN/i.test(x)){q=true;qmsg=x.slice(0,120)}})
await p.goto('http://localhost:3000/space/fighter',{waitUntil:'domcontentloaded',timeout:30000})
await p.waitForTimeout(9000); await p.screenshot({path:OUT+'chunk.png'})
console.log('compiled:',comp,'quarantined:',q, qmsg||'')
await b.close()
