// Handling on flat ground and booster + wing combinations:  node handling.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = ['math.js', 'terrain.js', 'physics.js'].map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
await new Function(src + `return (async()=>{
 TH = new Float32Array(TN*TN); RMK = new Float32Array(HN*HN); STILL=1; const H=1/240;
 const run=(s,f)=>{ for(let i=0;i<s*240;i++){ if(f) f(i/240); stepBike(H); } };
 const start=(v)=>{ resetBike(100,100,0); IN.thr=0; IN.brk=0; IN.steer=0; IN.boost=0; run(1); B.vz=v; };
 for (const full of [0,1]) { console.log('STEADY TURN, full lock held 4 s, '+(full?'throttle pinned':'speed held'));
 console.log(' km/h   lat g   radius m  slide deg  t63 s   exit km/h  settle s');
 for (const v of [5, 10, 15, 20, 30]) {
   start(v); IN.steer=1; const tr=[]; let t63=-1, rs=0, n=0, bs=0; const samp=[];
   run(4,(t)=>{ IN.thr=full||B.speed<v?1:0; samp.push(B.r); if(t>2.5){ rs+=B.r; n++; const vl=B.vx*cos(B.yaw)-B.vz*sin(B.yaw); bs+=Math.atan2(vl,max(B.vlong,0.1)); } });
   const r=rs/n; for(let i=0;i<samp.length;i++) if(samp[i]>=0.63*r){ t63=i/240; break; }
   const sp=B.speed; IN.steer=0; let settle=-1, i=0; run(2,(t)=>{ if(settle<0 && abs(B.r)<0.1*abs(r)) settle=t; if(v===15&&!full&&(t*240|0)%36===0) tr.push(B.r.toFixed(2)+'/'+B.steer.toFixed(3)); }); if(tr.length) console.log('   release trace r/steer: '+tr.join(' '));
   console.log(' '+(v*3.6).toFixed(0).padStart(4)+'  '+(sp*r/9.81).toFixed(2).padStart(6)+'  '+(sp/r).toFixed(0).padStart(8)+'  '+(bs/n*57.3).toFixed(1).padStart(9)+'  '+t63.toFixed(2).padStart(5)+'  '+(sp*3.6).toFixed(0).padStart(9)+'  '+settle.toFixed(2).padStart(8));
 } }
 console.log('LANE CHANGE: 0.7 s right, 0.7 s left at 72 km/h -> sideways move and leftover heading');
 start(20); IN.thr=1; const x0=B.x; run(0.7,()=>{IN.steer=1}); run(0.7,()=>{IN.steer=-1}); IN.steer=0; run(1.5); console.log('  moved '+(B.x-x0).toFixed(1)+' m, heading '+(B.yaw*57.3).toFixed(1)+' deg, yaw rate '+B.r.toFixed(3));
 console.log('BRAKING from 108 km/h: '); start(30); const z0=B.z; let tb=0; IN.brk=1; stepBike(H); while(B.speed>0.5&&tb<20){ stepBike(H); tb+=H; } console.log('  '+(B.z-z0).toFixed(0)+' m in '+tb.toFixed(1)+' s'+(B.crash>0?' CRASH':''));
 console.log('0-100 km/h on flat: '); start(0); IN.thr=1; let ta=0; while(B.speed<27.8&&ta<40){ stepBike(H); ta+=H; } console.log('  '+ta.toFixed(1)+' s; top speed after 40 s:'); run(40); console.log('  '+(B.speed*3.6).toFixed(0)+' km/h');
 console.log('RUNWAY: wings out + throttle (+boost at 60 km/h) on flat');
 for (const bo of [0,1]) { start(0); B.wingOn=1; IN.thr=1; let t=0, off=-1, peak=0; while(t<30){ IN.boost=bo&&B.speed>16.7&&t<9?1:0; if(B.air>0.5){ IN.thr=0; IN.brk=B.vy<-8||(B.vy<0&&B.y-heightAt(B.x,B.z)<8)?1:0; } stepBike(H); t+=H; if(off<0&&B.gF===0&&B.gR===0&&B.y>2) off=t; peak=max(peak,B.y); if(B.crash>0) break; } console.log('  boost '+bo+': airborne at '+(off<0?'never':off.toFixed(1)+' s')+', peak '+peak.toFixed(0)+' m, '+(B.speed*3.6).toFixed(0)+' km/h'+(B.crash>0?' CRASH':'')); }
 console.log('BURN IN THE AIR from 400 m, gliding at 72 km/h. Energy height = y + v2/2g');
 const air=(name,f)=>{ resetBike(100,100,0); B.y=400; B.vz=20; B.wingOn=1; B.wing=1; B.wdep=1; IN.thr=0; IN.brk=0; IN.steer=0; IN.boost=0; run(3); const e0=B.y+B.speed*B.speed/19.62; let peak=0, pmax=0, vmax=0, gmax=0, pv=B.vy; const y0=B.y;
   for(let i=0;i<12*240;i++){ const t=i/240; f(t); const v0=[B.vx,B.vy,B.vz]; stepBike(H); const g=hypot(B.vx-v0[0],B.vy-v0[1]+9.81*H,B.vz-v0[2])/H/9.81; gmax=max(gmax,g); peak=max(peak,B.y-y0); pmax=max(pmax,abs(B.pitch)); vmax=max(vmax,B.speed); }
   console.log('  '+name.padEnd(34)+' peak '+(peak>=0?'+':'')+peak.toFixed(0).padStart(4)+' m, top '+(vmax*3.6).toFixed(0).padStart(3)+' km/h, max pitch '+(pmax*57.3).toFixed(0).padStart(3)+' deg, max '+gmax.toFixed(1)+' g, energy '+((B.y+B.speed*B.speed/19.62)-e0>=0?'+':'')+((B.y+B.speed*B.speed/19.62)-e0).toFixed(0)+' m'); };
 air('no burn, hands off', ()=>{});
 air('burn, wings spread, hands off', (t)=>{ IN.boost=t<3?1:0; });
 air('burn, wings spread, pull up', (t)=>{ IN.boost=t<3?1:0; IN.brk=t<3?1:0; });
 air('burn tucked, then spread', (t)=>{ IN.boost=t<3?1:0; IN.thr=t<2?1:0; });
 air('stoop 3 s, burn tucked, spread', (t)=>{ IN.thr=t<5?1:0; IN.boost=t>3&&t<6?1:0; });
 air('stoop 3 s, then spread + burn', (t)=>{ IN.thr=t<3?1:0; IN.boost=t>3&&t<6?1:0; });
 air('stoop 3 s, spread + burn + pull', (t)=>{ IN.thr=t<3?1:0; IN.boost=t>3&&t<6?1:0; IN.brk=t>3&&t<6?1:0; });
 air('stoop 2 s, spread + burn + pull', (t)=>{ IN.thr=t<2?1:0; IN.boost=t>2&&t<5?1:0; IN.brk=t>2&&t<5?1:0; });
 air('stoop 3 s, no burn, spread + pull', (t)=>{ IN.thr=t<3?1:0; IN.brk=t>3&&t<6?1:0; });
 air('stoop 3 s, burn, spread + pull', (t)=>{ IN.thr=t<5?1:0; IN.boost=t>3&&t<6?1:0; IN.brk=t>5&&t<8?1:0; });
})()`)();
