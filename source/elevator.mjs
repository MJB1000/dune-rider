// The glider's elevator, the rider's-weight fine pitch and the air brake, in still air:  node elevator.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = ['math.js', 'terrain.js', 'physics.js'].map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
await new Function(src + `return (async()=>{
 TH = new Float32Array(TN*TN); RMK = new Float32Array(HN*HN); STILL=1; const H=1/240;
 const run=(s,f)=>{ for(let i=0;i<s*240;i++){ if(f) f(i/240); stepBike(H); } };
 const zero=()=>{ IN.thr=0; IN.brk=0; IN.steer=0; IN.boost=0; IN.lean=0; IN.tuck=0; IN.yaw=0; };
 const glide=()=>{ resetBike(100,100,0); zero(); B.y=600; B.vz=22; B.wingOn=1; B.wing=1; B.wdep=1; run(6); };
 const steady=(name,f)=>{ glide(); let thr=0, stl=0; run(4,f); let v=0, vy=0, a=0, n=0; run(4,(t)=>{ f(t+4); v+=B.speed; vy+=B.vy; a+=B.alpha; n++; thr=max(thr,B.thr); if(B.stl) stl++; });
   v/=n; vy/=n; console.log('  '+name.padEnd(30)+' '+(v*3.6).toFixed(0).padStart(3)+' km/h, sink '+(-vy).toFixed(1).padStart(4)+' m/s, glide '+(hypot(v*v-vy*vy>0?Math.sqrt(v*v-vy*vy):0,0)/max(-vy,0.01)).toFixed(1).padStart(4)+':1, angle of attack '+(a/n*57.3).toFixed(1)+' deg'+(stl?', STALLED '+(stl/n*100).toFixed(0)+'% of the time':'')+(thr>0.02?', ENGINE ON '+thr.toFixed(2):'')); };
 console.log('STEADY GLIDE, held for 8 s (measured over the last 4):');
 steady('hands off', ()=>{});
 steady('W (nose down)', ()=>{ IN.thr=1; });
 steady('S (nose up)', ()=>{ IN.brk=1; });
 steady('I (weight forward)', ()=>{ IN.lean=1; });
 steady('K (weight back)', ()=>{ IN.lean=-1; });
 steady('S + K (past the edge)', ()=>{ IN.brk=1; IN.lean=-1; });
 steady('W + S (air brake)', ()=>{ IN.thr=1; IN.brk=1; });
 steady('W + S + I (steep approach)', ()=>{ IN.thr=1; IN.brk=1; IN.lean=1; });
 console.log('TAPS: pitch change 1 s after a tap or hold of S:');
 for (const d of [0.05,0.1,0.2,0.4,1]) { glide(); const p0=B.pitch; run(1,(t)=>{ IN.brk=t<d?1:0; }); const mid=B.wp; glide(); const p1=B.pitch; let pk=0, wpk=0; run(1.2,(t)=>{ IN.brk=t<d?1:0; pk=max(pk,B.pitch-p1); wpk=max(wpk,B.wp); }); console.log('  '+(d*1000).toFixed(0).padStart(4)+' ms: elevator peaks at '+(wpk*100).toFixed(0).padStart(3)+'%, nose up '+(pk*57.3).toFixed(1)+' deg'); }
 console.log('TAKE-OFF with the throttle held: does the nose get pushed down?');
 { resetBike(100,100,0); zero(); B.wingOn=1; IN.thr=1; let t=0, off=-1, minp=9, pl=0, thrAir=0; while(t<25){ IN.boost=B.speed>16.7&&t<9?1:0; stepBike(H); t+=H; if(B.air>0.5){ if(off<0) off=t; minp=min(minp,B.pitch); pl=max(pl,B.pl); thrAir=max(thrAir,B.air>1?B.thr:0); } if(off>0&&t>off+4) break; }
   console.log('  left the ground at '+off.toFixed(1)+' s, lowest pitch in the next 4 s '+(minp*57.3).toFixed(1)+' deg, push armed '+pl+', engine in the air '+thrAir.toFixed(2)+', crashed '+(B.crash>0)); }
 console.log('TAIL FIN: heading after 2 s of E, wings out:');
 { glide(); const y0=B.yaw; run(2,()=>{ IN.yaw=1; }); console.log('  rudder '+B.wy.toFixed(2)+', heading '+((B.yaw-y0)*57.3).toFixed(1)+' deg'); }
 console.log('NO WINGS: throttle in the air still revs and lifts the nose:');
 { resetBike(100,100,0); zero(); B.y+=40; B.vz=20; run(0.3); IN.thr=1; const p0=B.pitch; run(0.5); console.log('  engine '+B.thr.toFixed(2)+', pitch '+((B.pitch-p0)*57.3).toFixed(0)+' deg'); }
})()`)();
