// How landings grade: every kicker and megadune ramp jumped hands-off and with a pilot who matches the nose to the slope:  node landing.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = ['math.js', 'terrain.js', 'physics.js'].map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
await new Function(src + `return (async()=>{await buildTerrain(async()=>{}); STILL=1;
 const jumps=[]; for(let c=0;c<KNK;c++) if(KK[c*5+3]>0.05) jumps.push([KK[c*5]-KK[c*5+2]-60,KK[c*5+1],KK[c*5],'kicker']);
 for(let c=0;c<8;c++){ const z=(c+0.5)*256; let run=0,start=-1; for(let x=0;x<TILE*2;x+=2){ const on=RMK[((x/2)&HM)+((z/2)&HM)*HN]>0.9&&panAt(x,z)<0.05; if(on&&!run){start=x;} if(!on&&run&&x-start>150){jumps.push([start-15,z,x-25,'ramp']);} run=on; } }
 const names=['short','heavy','clean','perfect'];
 for(const pilot of [0,1,2,3,4,5,6]){ const cap=[99,99,22,20,22,24,26][pilot], hands=pilot===2; const tally={kicker:[0,0,0,0,0],ramp:[0,0,0,0,0]}; let keep=0,n=0, ex=[];
  for(const [x0,z0,xl,kind] of jumps){ resetBike(x0,z0,PI/2); IN.thr=1; IN.brk=0; IN.lean=0; IN.boost=0; let t=0,was=0,done=0,v0=0;
   while(t<90&&!done){ IN.steer=B.air>0?0:clamp((B.z-z0)*0.08+(PI/2-B.yaw)*1.2,-1,1); const past=B.x>xl-2; if(past||B.speed>cap) IN.thr=0; else IN.thr=1;
     if(pilot&&!hands&&B.air>0.3){ const hg=B.y-heightAt(B.x,B.z), tt=min(2,hg/max(-B.vy,1)), px=B.x+B.vx*tt, pz=B.z+B.vz*tt, hv=hypot(B.vx,B.vz)||1, ux=B.vx/hv, uz=B.vz/hv;
       const sl=Math.atan2(heightAt(px+ux*2,pz+uz*2)-heightAt(px-ux*2,pz-uz*2),4), d=B.pitch-sl; IN.lean=B.vy<2?clamp(d*6,-1,1):0; } else IN.lean=0;
     if(B.air>0.3) v0=B.speed; const a=B.air; stepBike(1/240); t+=1/240;
     if(B.crash>0){ tally[kind][4]++; done=1; } else if(past&&a>0.8&&B.air===0){ tally[kind][B.lq]++; if(B.lq===3){keep+=B.speed/v0;n++;} if(ex.length<6) ex.push(kind+': air '+a.toFixed(1)+' s, hit '+B.land.toFixed(2)+', nose '+(B.lrel*57.3).toFixed(0)+' deg, '+names[B.lq]+', soft '+_soft.toFixed(2)+', buried '+B.bury.toFixed(2)); done=1; } else if(past&&a>0&&B.air===0&&a<=0.8&&B.x>xl+40) done=1; }
  }
  console.log(hands?'HANDS OFF, held to 79 km/h:':pilot?'PILOT MATCHES THE SLOPE (I / K)'+(cap<99?', held to '+round(cap*3.6)+' km/h:':', flat out:'):'HANDS OFF, flat out:'); for(const k of ['kicker','ramp']) console.log('  '+k+'s: perfect',tally[k][3],' clean',tally[k][2],' heavy',tally[k][1],' crash',tally[k][4]);
  ex.forEach(e=>console.log('    '+e));
 }
})()`)();
