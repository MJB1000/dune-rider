// The air tricks, one at a time, in still air:  node tricks.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = ['math.js', 'terrain.js', 'physics.js'].map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
await new Function(src + `return (async()=>{await buildTerrain(async()=>{}); STILL=1;
 const H=1/240, hag=()=>B.y-heightAt(B.x,B.z);
 const glide=(h,flap)=>{ resetBike(700,900,PI/2); B.y+=h; B.vx=27; B.wingOn=1; B.wing=1; B.wdep=1; B.flapOn=flap?1:0; B.flap=flap?1:0; B.air=1; for (const k in IN) IN[k]=0; };
 const run=(s,f)=>{ for(let t=0;t<s;t+=H){ if(f) f(t); stepBike(H); if(!isFinite(B.x+B.y+B.q+B.r)) throw 'NaN'; if(B.crash>0) return 'CRASH'; } return ''; };
 // barrel roll in a steady glide
 { glide(300); run(3); const y0=B.y, v0=B.speed, yaw0=B.yaw; IN.trick=1; const c=run(3); console.log('barrel roll: rolls '+B.rolls+', height lost '+(y0-B.y).toFixed(1)+' m in 3 s (a plain glide loses '+(()=>{const yy=B.y; run(3); return (yy-B.y).toFixed(1);})()+'), heading moved '+((B.yaw-yaw0)*57.3).toFixed(0)+' deg '+c); }
 // loop out of a stoop: stoop for s seconds, let go, hold the brake
 for (const s of [3, 4, 5.5]) { glide(600); run(2); const y0=B.y; IN.tuck=1; run(s); const v=B.speed; IN.tuck=0; IN.brk=1; let low=1e9, top=-1e9, done=-1; const c=run(16,(t)=>{ if(done<0){ low=min(low,B.y); top=max(top,B.y); if(B.loops) done=t; } }); console.log(s+' s stoop ('+(v*3.6).toFixed(0)+' km/h) then hold S: '+(done<0?'no loop':'loop in '+done.toFixed(1)+' s, '+(top-low).toFixed(0)+' m tall, top '+(top-y0).toFixed(0)+' m from where the stoop began')+' '+c); }
 // loop from a plain dive: push the nose down for 4 s, then hold the brake
 { glide(400); run(2); IN.thr=0; run(0.2); IN.thr=1; run(4); const v=B.speed; IN.thr=0; IN.brk=1; const c=run(12); console.log('plain dive to '+(v*3.6).toFixed(0)+' km/h then hold S: loops '+B.loops+' folded '+B.folded+' '+c); }
 // both pairs of wings in a stoop
 { glide(600,1); run(1); IN.tuck=1; run(1.5); console.log('stoop with both pairs out: upper '+B.wing.toFixed(2)+', lower '+B.flap.toFixed(2)); run(3); const v=B.speed; IN.tuck=0; run(1.2); console.log('   4.5 s: '+(v*3.6).toFixed(0)+' km/h; 1.2 s after letting go: upper '+B.wing.toFixed(2)+', lower '+B.flap.toFixed(2)); }
 // 360 and superman off a drop without wings
 const drop=(h)=>{ resetBike(700,900,PI/2); B.y+=h; B.vx=18; B.air=0.5; for (const k in IN) IN[k]=0; };
 { drop(14); IN.trick=-1; let done=-1; const c=run(1.6,(t)=>{ if(B.spins&&done<0) done=t; }); let ya=Math.atan2(B.vx,B.vz)-B.yaw; ya-=round(ya/TAU)*TAU; console.log('360: spins '+B.spins+' after '+done.toFixed(2)+' s, nose off the flight path at 1.6 s '+(ya*57.3).toFixed(0)+' deg, height left '+hag().toFixed(1)+' m '+c); }
 { drop(14); IN.grab=1; run(1); const sm=B.sm; IN.grab=0; run(0.4); const sm2=B.sm; const c=run(3); console.log('superman: out '+sm.toFixed(2)+' after 1 s, back '+sm2.toFixed(2)+' 0.4 s after letting go, landing: '+(c||'rode away')); }
 { drop(14); IN.grab=1; const c=run(4); console.log('superman held into the ground: '+(c||'rode away')); }
})()`)();
