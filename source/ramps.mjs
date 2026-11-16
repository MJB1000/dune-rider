// Rides every megadune ramp in simulation, holding the line the way a rider would:  node ramps.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = ['math.js', 'terrain.js', 'physics.js'].map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
await new Function(src + `return (async()=>{await buildTerrain(async()=>{});
 const feet=[]; for(let c=0;c<8;c++){ const z=(c+0.5)*256; let run=0,start=-1; for(let x=0;x<TILE*2;x+=2){ const on=RMK[((x/2)&HM)+((z/2)&HM)*HN]>0.9&&panAt(x,z)<0.05; if(on&&!run){start=x;} if(!on&&run&&x-start>150){feet.push([start,z,x-start]);} run=on; } }
 const ride=(x0,z0,len,boost,wings)=>{ resetBike(x0-15,z0,PI/2); IN.thr=1; IN.brk=0; let t=0,crash=0,top=B.y,h0=B.y,vmin=99,air=0,peak=0,why='',vl=0,xl=0,far=0;
   while(t<90){ IN.steer=clamp((B.z-z0)*0.08+(PI/2-B.yaw)*1.2,-1,1); IN.boost=boost&&B.air===0&&B.speed<30?1:0; const past=B.x-x0>len-25; if(wings&&past&&B.air>0.4) B.wingOn=1; if(B.wingOn){ IN.thr=0; IN.brk=(B.y-heightAt(B.x,B.z))<6?1:0; } const sp=B.speed, pt=B.pitch; stepBike(1/240); t+=1/240;
     if(B.crash>0){crash=1; why=' at '+(B.x-x0).toFixed(0)+'m, '+(sp*3.6).toFixed(0)+' km/h, pitch '+pt.toFixed(2)+', off line '+(B.z-z0).toFixed(1)+'m'; break;} top=max(top,B.y); if(t>3&&!past) vmin=min(vmin,B.speed);
     if(past){ if(B.air>0){ if(B.air<0.01){vl=B.speed;xl=B.x;} air=max(air,B.air); peak=max(peak,B.y-heightAt(B.x,B.z)); far=B.x-xl; } else if(air>0.6) break; } }
   return 'ramp '+String(len).padStart(3)+'m, rise '+(top-h0).toFixed(0).padStart(3)+'m | slowest '+(vmin*3.6).toFixed(0).padStart(3)+' km/h | off the lip at '+(vl*3.6).toFixed(0).padStart(3)+' km/h: '+air.toFixed(1)+' s, '+far.toFixed(0).padStart(3)+' m, '+peak.toFixed(0).padStart(2)+' m up | '+(crash?'CRASH'+why:'landed'); };
 console.log(feet.length,'megadune ramps');
 let ok=[0,0,0];
 feet.forEach((f,i)=>{ const a=ride(f[0],f[1],f[2],0,0), b=ride(f[0],f[1],f[2],1,0), c=ride(f[0],f[1],f[2],1,1); if(!/CRASH/.test(a))ok[0]++; if(!/CRASH/.test(b))ok[1]++; if(!/CRASH/.test(c))ok[2]++; if(i<5){ console.log('throttle      :',a); console.log('boost         :',b); console.log('boost + wings :',c); } });
 console.log('landed safely: throttle',ok[0],'/',feet.length,' boost',ok[1],'/',feet.length,' boost + wings',ok[2],'/',feet.length);
})()`)();
