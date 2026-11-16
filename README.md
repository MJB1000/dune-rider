# Dune Rider

A dirt bike on an endless field of sand dunes, in the browser. Everything is made by code: no images, no 3D models, no sound files, no game engine. The whole game is one 99 KB `index.html`.

Built on the WebGPU groundwork of [Abyssal Garden](https://github.com/Noniv/abyssal-garden) by Maksymilian Dendura (MIT): the single-file build, the mesh helpers and the no-engine approach come from there. The underwater scene itself is still in this repository's git history (`main` branch).

## Run it

Open `index.html` in a desktop browser with WebGPU (Chrome, Edge, recent Safari), or serve the folder:

```bash
python3 -m http.server 8765
```

then open <http://localhost:8765>.

## Controls

| | Keyboard | Gamepad |
|---|---|---|
| Throttle | `W` or `↑` | Right trigger |
| Brake | `S`, `↓` or `Space` | Left trigger |
| Steer | `A` `D` or `←` `→` | Left stick |
| Power slide: throttle and brake together in a turn | `W` + `S` | Both triggers |
| Rider weight forward / back (hold back and let go to spring off a lip) | `I` `K` | Right stick |
| Rocket boost (hold; a full bar is 3 s, refills in 15 s) | `Shift` | A button |
| Wings out, press again for the second set, again to stow | `F` | |
| Tail fin: swing the nose left / right in the air | `Q` `E` | Shoulder buttons |
| Wing trim, nose up / down | `Z` `X` | |
| Reset the bike | `R` | |
| Rider view / chase view | `C` | |
| Speed of time | `T` | |
| Hour back / on | `[` `]` | |
| Mute | `M` | |
| Pause | `Esc` | |

In the air the throttle lifts the nose and the brake drops it, like a real bike. With the wings out it flies like a falcon: hold throttle to pull the wings in and stoop for speed, let go to spread them and turn the speed into lift, brake to pull up and flare, steer to bank. Every stoop costs a little height. Time in the air scores 100 points a second if you land it.

Flips: with the wings away and more than about 5 m of air under you, let go of throttle and brake, then hold throttle to go over backward or brake to go over forward. One turn takes about 1.2 seconds; let go and the rider levels the bike. Each flip you land is worth 500 points. Throttle held from the ground does not start a flip.

The air moves. A steady wind is pushed up the windward faces of the dunes and sinks behind them, and by day columns of warm air rise off the sand, each marked by a dust devil. With the wings out the readout shows your climb rate and whether you are in lift or sink. The lower wings (a second press of `F`) add area: slower flight and a quarter less sink, which is what lets you circle inside a thermal and climb.

Proximity: gliding fast within 12 m of the sand scores more the closer you are, banked with the air time when you land.

Crashes: the rider is thrown and tumbles, the bike slides and spins, and both carry on down a slope until they stop. Each hard hit breaks bones, and the tally is kept.

Finer points. The sand varies: lee faces are loose and swallow the wheels, windward faces are a firmer crust, pans and ramps are hardpack. Weight forward (`I`) loads the front tyre and soaks up a lip; weight back (`K`) lightens the front, and holding it then letting go springs the bike into the air. Pull the wings past their stalling angle and one drops: let the nose fall to fly again. Within a wingspan of the sand the wings lift more (ground effect). The air is rough behind crests and at the edges of thermals. Pull harder than about 2.7 g for half a second and the wing tips fold back until you have flown slowly for a second.

The tail fin (`Q` `E`) turns the bike flat, the way a helicopter's pedals do. With the wings out it is the fine control: a held fin turns the flight path about 4 degrees a second without banking.

The booster is a bar: hold `Shift` to burn, let go to keep the rest. A full bar is 3 seconds and refills in 15 on the ground, or 45 in the air. It pushes harder the faster you are already going. A full burn in a glide with the wings spread and the brake held is worth about 150 m of climb; in a dive it is worth speed (about 300 km/h) instead. On a flat with the wings out, a burn lifts the nose and the bike takes off like a plane.

## What is in it

- **Dunes**: a 2 km square of sand at 1 m resolution that repeats forever. Megadunes up to about 235 m tall with ordinary dunes on their backs. Long windward climbs, sharp crests, slip faces at the angle of repose. Drawn with a quadtree of detail levels out to about 7 km.
- **First person**: you ride from behind the bars, with the horizon rolling into the lean. `C` switches to a chase camera.
- **Time of day**: the clock starts at your local time and the sun moves. A physically based sky (Rayleigh + Mie scattering) is redrawn as it goes; dune shadows follow the sun; stars and a headlight at night.
- **The look**: rendered in high dynamic range, then bloom, sunlight scattering through haze that the dune shadows cut into, and a film-style grade. Stones and dry scrub sit in the low ground with their own shadows. Resolution adjusts itself to hold the frame rate.
- **Sand**: wind ripples at two scales, grain sparkle near the camera, haze toward the horizon.
- **Bike**: a rigid body on two sprung wheels stepped at 240 Hz, with grip limits, wheelspin, weight transfer and jumps. Full steering asks for the tightest turn the tyres can hold at that speed, the rider eases the throttle and shifts forward in a turn, and steers against a slide. A landing stays down: the dampers hold the bike on the ground, the sand takes a bite out of the speed, the engine labours for a moment, and the view drops and shakes with the hit. Tyre tracks and dust follow the wheels.
- **Ramps**: four dunes in ten have a graded strip of packed sand that leads straight to the crest and ends in a lip.
- **Pans**: about an eighth of the field is hard, dead-flat ground, the longest straight about 500 m, where the dunes shrink away to nothing. You start on one. Packed ground rolls easier than soft sand.
- **Rocket boosters**: two pods on the tail. A 3-second tank shown as a bar, stronger the faster you are moving, that refills in 15 seconds on the ground and 45 in the air.
- **Wings**: three metal sections a side flip out from the frame behind the steering head, with tail fins off the rear fender and an upright rudder that stands up when the bike leaves the ground. The brushed skins catch the sun: a soft sheen, and points of light that flash and move as the wing banks. Launch off a crest with speed and the bike glides at about 6.6 to 1.
- **Sound**: a synthesized single-cylinder engine and wind.

## Change it

Source is in [`source`](source). You need Node.js 18 or newer.

```bash
cd source
npm install
npm run build
```

`npm run build:dev` writes an unminified `dev.html` instead. `npm test` runs the terrain and physics headless and prints speeds, air time and crashes. `node ramps.mjs` rides every megadune ramp. `node falcon.mjs` flies stoop-and-climb cycles. `node handling.mjs` measures cornering, braking, runway take-off and what a burn is worth with the wings in each position. `node sim.mjs` runs the longer stress simulations described in [`BRIEF.md`](BRIEF.md), which is the plan for what gets built next.

| File | What's inside |
|---|---|
| `source/src/terrain.js` | The dune shape (`duneH`), sun position, sand colour, shadow bake, sky |
| `source/src/physics.js` | Bike constants (`BK`: power, grip, suspension) and the simulation step |
| `source/src/bike.js` | The bike and rider model |
| `source/src/shaders.js` | Sand, sky, bike, dust, track, prop and post-processing shaders (WGSL) |
| `source/src/props.js` | Stones and scrub: shapes and where they are scattered |
| `source/src/main.js` | Renderer, camera, controls, dust, tracks, HUD |
| `source/src/audio.js` | Engine and wind sound |
| `source/src/math.js` | Noise, matrices, mesh builder |
| `source/template.html` | The page: menu, loading bar, HUD |

Easy first tweaks: `SUN_EL` in `terrain.js` (sun height), `SAND` (sand colour), `Fmax` and `P` in `physics.js` (engine), the camera distance `cd` in `main.js`.

## License

[MIT](LICENSE)
