// Stoop-and-climb cycles with the wings, falcon style:  node falcon.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = ['math.js', 'terrain.js', 'physics.js'].map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
await new Function(src + `return (async()=>{await buildTerrain(async()=>{}); STILL=1;
 // start high with the wings out, then repeat: tuck (throttle) for tuckS seconds, spread and pull up (brake) until the climb tops out
 const cycles=(tuckS)=>{ resetBike(700,900,PI/2); const base=B.y; B.y+=400; B.vx=27; B.wingOn=1; B.wing=1; B.wdep=1; IN.thr=0; IN.brk=0; IN.steer=0; let t=0, out=[], phase=0, pt=0, vtop=0, low=B.y, rose=0, start=B.y;
   while(t<200 && out.length<5){ if(phase===0){ IN.tuck=1; IN.brk=0; pt+=1/240; vtop=max(vtop,B.speed); if(pt>tuckS){phase=1; pt=0; low=B.y; rose=0;} } else { IN.tuck=0; IN.brk=1; pt+=1/240; low=min(low,B.y); if(B.vy>0.5) rose=1; if((rose&&B.vy<=0)||pt>9){ out.push((start-base).toFixed(0)+' -> dive to '+(low-base).toFixed(0)+' m at '+(vtop*3.6).toFixed(0)+' km/h -> back up to '+(B.y-base).toFixed(0)+' m (lost '+(start-B.y).toFixed(0)+')'); phase=0; pt=0; vtop=0; start=B.y; } }
     stepBike(1/240); t+=1/240; if(!isFinite(B.x+B.y+B.q)) return ['NaN']; if(B.gF>0||B.gR>0||B.crash>0){ out.push(B.crash>0?'CRASH':'landed'); break; } }
   return out; };
 for (const s of [2, 4]) { console.log(s + ' s stoops from 400 m:'); for (const l of cycles(s)) console.log('   ' + l); }
})()`)();
