// Counts the kickers (medium ramp dunes on the pans) and rides each one flat out:  node kickers.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = ['math.js', 'terrain.js', 'physics.js'].map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
await new Function(src + `return (async()=>{await buildTerrain(async()=>{}); STILL=1;
 const ks=[]; for(let c=0;c<KNC*KNC;c++) if(KK[c*5+3]>0.05) ks.push([KK[c*5],KK[c*5+1],KK[c*5+2],KK[c*5+3],KK[c*5+4]]);
 console.log(ks.length,'kickers; heights',ks.map(k=>k[3].toFixed(0)).join(' '));
 let ok=0,airs=[],sum=0;
 ks.forEach((k,i)=>{ const [cx,cz,L,H]=k; let back=L+20; while(back<L+260&&panAt(cx-back-10,cz)>0.98&&kickH(cx-back-10,cz)===0) back+=10;
   resetBike(cx-back,cz,PI/2); IN.thr=1; IN.brk=0; IN.boost=0; let t=0,air=0,peak=0,vl=0,crash=0;
   while(t<40){ IN.steer=clamp((B.z-cz)*0.08+(PI/2-B.yaw)*1.2,-1,1); const past=B.x>cx-2; if(past) IN.thr=0; stepBike(1/240); t+=1/240;
     if(B.crash>0){crash=1;break;} if(past){ if(B.air>0){ if(B.air<0.01) vl=B.speed; air=max(air,B.air); peak=max(peak,B.y-heightAt(B.x,B.z)); } else if(air>0.3||B.x>cx+60) break; } }
   if(!crash) ok++; airs.push(air); sum+=air;
   if(i<8) console.log('height '+H.toFixed(0).padStart(2)+' m, run-up '+L.toFixed(0)+' m, approach '+back.toFixed(0).padStart(3)+' m | off the lip at '+(vl*3.6).toFixed(0).padStart(3)+' km/h: '+air.toFixed(1)+' s, '+peak.toFixed(0).padStart(2)+' m up | '+(crash?'CRASH':'landed')); });
 airs.sort((a,b)=>a-b);
 console.log('landed',ok,'/',ks.length,' air: least',airs[0].toFixed(1),' median',airs[airs.length>>1].toFixed(1),' most',airs[airs.length-1].toFixed(1),'s;  kickers giving 2 s or more:',airs.filter(a=>a>=2).length);
})()`)();
