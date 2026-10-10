# Frankenrun — Build Spec

Oct 9, 2026 · @Napster

## Overview

Frankenrun is a real-time multiplayer racing game where players stitch together monsters from body parts and race them through real Accra streets, losing and stealing parts as they go. It is an entry for RUN.world's October Jam (theme: **Monster Mash**) and must be built, published and entered on RUN.world.

**The core loop:** the host picks start and end points on a map of Accra → the game generates a checkpoint route → each player builds a monster from 3 slots of parts → players race checkpoint to checkpoint on any road they like → collisions knock parts off, loose parts can be picked up → first to the final checkpoint wins.

**Why it fits the theme:** "Monster" = every racer is a monster. "Mash" = the build screen mashes parts together, and the race mashes them apart. Parts are verbs (swing, climb, glide, slime), not stat bumps.

### Jam dates (all times noon PT)

| Date | What happens |
| --- | --- |
| Oct 8 | Theme revealed; building opened. Nothing started before this counts. |
| Oct 15 | Community voting opens. **A playable build must be public by this date.** |
| Nov 2 | Submissions close. Entry must be published to public AND entered via Creator Hub → Enter the jam. |
| Nov 6 | Voting and judging close. |

### Success criteria

1. 2–8 players can race each other in real time on a real Accra route, on mobile web and desktop.
2. At least 4 monster builds that play noticeably differently.
3. Losing and stealing parts mid-race works and is visible.
4. Loads in under 10 s on a mid-range phone over 4G.
5. Published to public and entered in the jam before Nov 2.

### Target prizes

Game Votes (community), Game Editor's Picks, and the Special Categories **Best Social Features** and **Best Use of Theme**.

## Hard constraints (never violate)

The RUN.world sandbox blocks most browser and network features; a build that ignores these will render blank or fail silently after deploy. Source: [Runtime Environment](https://github.com/series-ai/venus-sdk-docs/blob/main/rundot-developer-platform/runtime-environment.md).

| Rule | Consequence if broken | Do instead |
| --- | --- | --- |
| No network calls to any host except your own game origin and Google Fonts | Mapbox, OSM tile servers, Overpass, your own backend: all blocked | Bake all map data into `public/cdn-assets/` at build time |
| No `localStorage`, `sessionStorage`, `IndexedDB`, cookies, `caches`, Service Workers | Throws or silently does nothing | `RundotGameAPI.appStorage` |
| No custom auth (Firebase, OAuth) | Blocked | Platform identity via Profiles API |
| No `requestFullscreen()` / `requestPointerLock()` | Fails | System API fullscreen; design controls that need no pointer lock |
| No `window.open`, nested iframes | Blocked | Sharing API |
| No `Math.random`, `Date.now`, `performance.now`, or network data inside the Syncplay `step` | Desync between clients | Syncplay seeded RNG and tick counts |
| Vite `build.target` below `es2022` | Embedded-library loader never resolves; blank screen | `build.target: 'es2022'` |
| Game bundle over 100 MB zipped | Deploy rejected | Large assets in `public/cdn-assets/`, loaded via CDN API |
| Anything started before Oct 8 noon PT, copyrighted characters or names | Disqualified | Original monsters only (Frankenstein, werewolf, mummy etc. are public-domain archetypes) |

Also respect the Safe Area (`RundotGameAPI.system.getSafeArea()`): host UI draws in the same viewport.

## Tech stack and setup

TypeScript + Vite + Three.js for rendering, Syncplay for deterministic multiplayer and physics, RUN.world SDK for everything platform-side. Node 20+.

| Package / tool | Version rule | Used for |
| --- | --- | --- |
| `rundot` CLI | latest stable | login, init, deploy, jam scaffold, AI docs setup |
| `@series-inc/rundot-game-sdk` | latest | storage, profiles, leaderboards, assets CDN, sharing, Vite plugins |
| `@series-inc/rundot-syncplay` | `@rc` tag, **`--save-exact`**, must resolve to ≥ 5.26.0 | rooms, rollback netcode, 3D physics, deterministic vehicle controller |
| `three` | exactly `0.183.2` (or `0.170.0`) | rendering; exact match makes it a host-embedded library outside your bundle |
| `vite` | current | build, `build.target: 'es2022'` |
| Node bake tools (`osmium`, or `osmtogeojson` + custom script) | dev-only | map pipeline, never shipped |

### Setup commands

```bash
# 1. CLI (Windows: irm https://github.com/series-ai/rundot-cli-releases/releases/latest/download/install.ps1 | iex)
curl -fsSL https://github.com/series-ai/rundot-cli-releases/releases/latest/download/install.sh | bash
rundot login

# 2. Start from the official 3D template, then
npm install @series-inc/rundot-game-sdk@latest
npm install --save-exact @series-inc/rundot-syncplay@rc
npm install --save-exact three@0.183.2

# 3. Load SDK docs into the coding agent
rundot ai setup

# 4. Register and ship
rundot init --name "Frankenrun" --build-path ./dist
npm run build && rundot deploy           # private test build
rundot deploy --public                   # public build (needed for the jam)
```

3D template: [run-template-3d-react](https://github.com/series-ai/run-template-3d-react). Local testing uses the SDK playground (`npm run dev`); see [Testing Locally With Playground](https://github.com/series-ai/venus-sdk-docs/blob/main/rundot-developer-platform/playground.md).

### Docs the agent must read before coding

- [Runtime Environment](https://github.com/series-ai/venus-sdk-docs/blob/main/rundot-developer-platform/runtime-environment.md)
- [Syncplay](https://github.com/series-ai/venus-sdk-docs/blob/main/rundot-developer-platform/api/SYNCPLAY.md) and [Syncplay 3D physics](https://github.com/series-ai/venus-sdk-docs/blob/main/rundot-developer-platform/api/SYNCPLAY-PHYSICS.md)
- [Assets / CDN](https://github.com/series-ai/venus-sdk-docs/blob/main/rundot-developer-platform/api/ASSETS.md) and [Embedded Libraries](https://github.com/series-ai/venus-sdk-docs/blob/main/rundot-developer-platform/api/EMBEDDED_LIBRARIES.md)
- [Deploying Your Game](https://github.com/series-ai/venus-sdk-docs/blob/main/rundot-developer-platform/deploying-your-game.md)

### Suggested project layout

```
frankenrun/
  bake/            # Node scripts: OSM extract → tiles + road graph (dev only)
  public/cdn-assets/accra/   # baked tiles, road graph, manifest
  src/sim/         # deterministic: step.ts, runtime.ts, parts.ts, race.ts (no DOM, no Math.random)
  src/net/         # room create/join, input codec
  src/render/      # Three.js scene, monster rigs, camera, interpolation
  src/ui/          # lobby, route picker, build screen, HUD, results
  src/map/         # tile loader, A* router (host only)
```

## Session flow

The host chooses the route before the room exists, because Syncplay fixes the session config at room creation. Everyone then loads the same tiles, builds a monster and races inside one deterministic session.

&#91;embedded content: session flow · host and guest paths\]

Rematch on the same route stays in the room and returns to the build phase. A new route means the host goes back to the route picker and creates a new room; the old room broadcasts the new code so players follow automatically.

## Monster system

A monster = 1 body + up to 3 parts (one per slot: **Legs**, **Arms**, **Head/Back**). Every part adds a verb, not just a stat; every part has a cost. All numbers below are starting values for tuning, kept in one data file (`src/sim/parts.ts`) so they can be balanced without code changes.

### Bodies (chassis, never lost)

| Body | Mass | Hits to lose a part | Base accel | Turn rate | Launch? |
| --- | --- | --- | --- | --- | --- |
| Stitched Brute | 1.4 | 3 | 0.8 | 0.8 | Yes |
| Bone Rattler | 0.7 | 1 | 1.2 | 1.1 | Yes |
| Slime Blob | 1.0 | 2 | 0.9 | 1.0 | Later |
| Mummy Wrap | 1.0 | 2 | 1.0 | 1.0 | Later |

### Parts

| Part | Slot | Verb (what it lets you do) | Cost | Launch? |
| --- | --- | --- | --- | --- |
| Werewolf Legs | Legs | Highest top speed on straights | Low grip: slides wide in corners | Yes |
| Spider Legs | Legs | Climb over low walls, medians, gutters (obstacles ≤ 1.5 m tagged `climbable`) | Top speed −25% | Yes |
| Hopper Haunches | Legs | Hold to charge, release to leap over obstacles | No steering mid-air | Later |
| Ghost Wisp | Legs | Float; ignore slick surfaces | Cannot ram; easily pushed | Later |
| Tentacles | Arms | Grab nearest pole/corner anchor within 6 m, swing round it without braking | 3 s cooldown; a miss spins you out | Yes |
| Crab Claws | Arms | Hit a rival from behind to steal one of their parts | Mass +0.2 | Yes |
| Bat Wings | Arms | Glide after a jump/leap, extending distance | Grip −15% while equipped | Later |
| Slime Gland | Head/Back | Drop a 4 s slick trail; anyone on it loses grip | Doubling back over your own trail slows you | Yes |
| Jack-o'-Lantern Head | Head/Back | Highlights shortcut roads to next checkpoint on minimap | No combat use | Yes |
| Dragon Lungs | Head/Back | Fire cone knocks one part off target ahead | 10 s cooldown | Later |
| Hunchback Hump | Head/Back | Holds one spare part, auto-equips when a slot empties | Mass +0.2 | Later |

Folklore set (stretch, after milestone 3): Sasabonsam Hook-Feet (legs, hang from wires/trees), Anansi Silk (arms, tether a rival to a pole), Mmoatia Backwards Feet (legs, fake minimap trail).

### Part loss and pickup

1. A collision above an impulse threshold counts as a **hit**. When hits reach the body's threshold, one random equipped part detaches (Syncplay seeded RNG), and the hit counter resets.
2. A detached part becomes a world pickup at the impact point. It persists until picked up or 30 s pass.
3. Driving through a pickup equips it if its slot is empty; if the slot is full, it is ignored (Hump stores it instead).
4. Crab Claws: a rear hit steals a part directly into the attacker's matching empty slot, or drops it if full.
5. **Losing parts has an upside:** each missing slot = mass −0.15, top speed +5%. A fully stripped torso is slow to accelerate but light. This is the comeback mechanic.
6. Ability state (cooldowns, charges) counts in **ticks**, never seconds of wall-clock.

### Build screen

Players pick body + one part per slot before each race. Default build is pre-selected so a player can ready up in one tap. Builds are saved per player with `appStorage` and restored next session.

## Race rules

Races are **checkpoint races**: the generated route only places checkpoints; players may take any drivable road between them. Local knowledge and shortcuts are the point of using a real city.

### Route generation (host only)

1. Host taps a start and an end point inside the baked Accra boundary. Points snap to the nearest node on the road graph.
2. Host's client runs A\* on the baked road graph (edge cost = length; skip `highway=footway|path|steps|service` unless tagged drivable).
3. **Distance rule:** route length must be 1.5–4.0 km. Outside that range, the picker shows the length in red and blocks Start.
4. Place checkpoints along the route every \~400 m, always one at each major turn (> 60°), plus start and finish. Cap: 12 checkpoints.
5. Compute the tile set = every 500 m tile within 150 m of the route.
6. Write `{ routeId, checkpoints[], tileIds[], seed }` into the Syncplay **session config** (hard cap 65,536 bytes; this payload should be < 2 KB). Clients never recompute the route.

### Presets

Ship 3 hand-picked preset routes (e.g. Oxford Street run, Ring Road sprint, Independence Square loop). The lobby offers presets first and "Custom route" second. Presets are the routes most voters will try, so they get hand tuning.

### Race rules

- Checkpoints must be hit **in order**; a checkpoint is a vertical cylinder, radius 12 m.
- Countdown 3-2-1 with all players frozen; inputs before GO are ignored.
- Off-road (no road surface under the monster, and not on a `climbable` surface) = 50% top speed. No invisible walls.
- Stuck/flipped: hold Reset for 1 s → respawn at last checkpoint, 2 s penalty freeze.
- Finish = first to the final checkpoint. Others get 30 s to finish after the winner, then DNF.
- Results screen: position, time, parts lost, parts stolen. Best time per preset route goes to a RUN leaderboard.
- Player count: 2–8 per room. Late join allowed only before countdown.

## Multiplayer and determinism

Every client runs the same deterministic simulation at **30 Hz** under Syncplay's predict-and-rollback netcode; only inputs travel over the network. Anything that decides who wins lives inside `step`; everything you see and hear lives outside it.

### Rules for `src/sim/`

- A value is authoritative only if `step` writes it into the state that `captureState` returns. Positions, parts, cooldowns, checkpoint progress, race phase and results all live there.
- Never read `Math.random`, `Date`, `performance.now`, DOM, network or render state inside `step`. Use Syncplay's seeded RNG, seeded from the session config `seed`.
- Count time in ticks (30 ticks = 1 s).
- Mix the physics world digest into captured state, as the [physics docs](https://github.com/series-ai/venus-sdk-docs/blob/main/rundot-developer-platform/api/SYNCPLAY-PHYSICS.md) describe, so a physics divergence shows up as a checksum mismatch.
- Rendering reads the projection via `getPresentationFrame()` + `renderAlpha` and interpolates; it never writes back.

### Race phases (inside the sim)

`BUILD` (players choose body + parts via commands, ready-up) → `COUNTDOWN` (90 ticks) → `RACING` → `RESULTS`. Build choices are sim commands so every client agrees on every monster.

### Input codec

```ts
defineSyncplayInputCodec({
  throttle: { kind: 'int', min: -100, max: 100 }, // negative = reverse
  steer:    { kind: 'int', min: -100, max: 100 },
  arms:     { kind: 'boolean' },   // tentacle grab / claw
  head:     { kind: 'boolean' },   // slime / fire
  legs:     { kind: 'boolean' },   // leap / climb
  reset:    { kind: 'boolean' },
})
```

Abilities trigger on the **rising edge**, detected in `step` by comparing to the previous tick's input stored in state. That keeps the default `repeat-last` remote prediction safe.

### Physics

- One Syncplay 3D physics world (`@series-inc/rundot-syncplay/physics/3d`), fixed step = sim tick.
- **World is flat** (y = 0 ground plane). Elevation, bridges and flyovers are ignored for the jam.
- Buildings in loaded tiles = static boxes or cooked hulls (`cookConvexDecomposition` at bake time, not runtime).
- Monsters run with the deterministic raycast vehicle controller `stepDeterministicVehicleState3D` (revision 2). Body and parts set its mass, grip, engine force and steering parameters.
- Tentacle swing = a temporary joint from the monster to a static anchor (pre-baked anchor points at junction corners), released on button up or after 60 ticks.
- Road vs off-road is a 2D surface lookup from baked road polygons, not a collider.

### Rooms

- Room type `deterministic`, declared in `rundot/realtime.config.json`.
- Private race: `createSyncplayRoom()` → share the room code / share link via the Sharing API. Public race: `quickMatchSyncplayRoom()` against preset routes only.
- `maxPlayers: 8`.
- Session config is fixed when the room is created, so the host picks the route **before** creating the room. A rematch on a new route = a new room; the old room broadcasts the new code and clients follow automatically.
- Map tiles are loaded from the CDN, so they are an external deterministic input: include the map bake hash in `deterministicVersion`, and verify each tile's digest (listed in the tile manifest) before frame 0.

### Desync handling

Log checksum mismatches with frame number and player slot; in dev builds, dump both captured states for diffing. A desync during a race shows "Connection problem, rejoining" and uses Syncplay late-join recovery.

## Map data pipeline

All map data is baked offline from OpenStreetMap into compact binary tiles and shipped in `public/cdn-assets/accra/`; the game never contacts a map service. OSM data is © OpenStreetMap contributors under ODbL: show that credit on the title screen and in the game description.

### Bake boundary (default, adjust before first bake)

Central Accra, roughly Jamestown to the airport and Ring Road to Osu: south 5.530, west −0.235, north 5.615, east −0.155. These coordinates are approximate and should be checked on a map. At 500 m tiles that is about 18 × 19 tiles.

### Steps (`bake/`, Node script, deterministic output)

1. **Extract:** download the Ghana extract from [Geofabrik](https://download.geofabrik.de/africa/ghana.html); `osmium extract --bbox` to the boundary. Commit the source `.osm.pbf` date in the manifest.
2. **Filter:** keep `highway=*` (drivable classes + `pedestrian` as off-road-legal), `building=*`, `barrier=wall`, and `highway=street_lamp` if present.
3. **Project:** local metres around origin (5.5600, −0.2000): `x = (lon − lon0) · cos(lat0) · 111320`, `z = −(lat − lat0) · 110540`. Flat world, no elevation.
4. **Simplify:** Douglas–Peucker, 1.5 m on roads, 1.0 m on buildings; drop buildings under 20 m².
5. **Road graph:** nodes at intersections and ends, edges with length and class. One file `roadgraph.bin` for host routing (budget ≤ 3 MB).
6. **Road surface:** buffer each road by its width (by class: primary 10 m, secondary 8 m, residential 6 m, else 4 m) into polygons per tile for the on-road lookup and rendering.
7. **Anchors:** tentacle anchor points at junction corners (and street lamps if mapped), max 1 per 20 m.
8. **Quantize + encode:** per tile, coordinates as Int16 decimetres relative to the tile's south-west corner; building height = `building:levels × 3 m`, default 6 m, one byte. Binary layout: header (tile id, counts) → road polygons → buildings → climbable walls → anchors.
9. **Compress:** gzip each tile; decompress in game with `DecompressionStream('gzip')`.
10. **Manifest:** `manifest.json` with boundary, origin, tile size, OSM date, bake hash, and per tile: id, byte length, sha256.

### Budgets

| Asset | Budget | If over |
| --- | --- | --- |
| One tile (gzipped) | ≤ 150 KB | Raise building simplification, drop smallest buildings |
| All tiles | ≤ 25 MB | Shrink boundary |
| `roadgraph.bin` | ≤ 3 MB | Drop service roads |
| Tiles loaded for one race | ≤ 4 MB | Tighten route buffer from 150 m to 100 m |

The bake script prints the size of every tile and fails the build if any budget is exceeded.

### Runtime loading

After the room's session config arrives: fetch the listed `tileIds` with `RundotGameAPI.cdn.fetchAsset` in parallel, verify each sha256 against the manifest, build colliders and meshes, then report ready. Show a progress bar during this load.

## Rendering, controls and UI

Mobile web is the primary target; desktop must work too. Target 60 fps on a mid-range Android phone, minimum 30 fps.

### Look

- Low-poly, flat-shaded, no textures on the city. Buildings = extruded footprints in 3–4 muted night colours; roads = flat dark polygons with a lighter edge line.
- Night-time palette with a moon light and fog to hide tile edges and cap draw distance (\~250 m).
- Monsters = simple primitives per part (capsules, cones, spheres) so a part can visibly pop off and bounce away. Parts carry a distinct colour per slot so players read a build at a glance.
- Merge all buildings of a tile into one mesh; instance repeated props.
- Checkpoints = tall glowing rings; next checkpoint has a screen-edge arrow when off-screen.

### Camera

Third-person chase camera, smoothed; pulls back with speed. Short shake on hits and part loss.

### Controls

| Action | Touch | Keyboard | Gamepad |
| --- | --- | --- | --- |
| Steer | Left thumb drag zone | A / D or ← / → | Left stick |
| Throttle / brake-reverse | Auto-throttle on; brake button | W / S | RT / LT |
| Arms ability | Button | J | X |
| Head ability | Button | K | Y |
| Legs ability | Button | Space | A |
| Reset | Hold button 1 s | R (hold) | Back (hold) |

Ability buttons show their part icon and a cooldown ring; empty slots show a greyed-out button. Keep all buttons inside the Safe Area.

### Screens

1. **Title**: Play (quick match), Host race, Join with code, OSM credit.
2. **Route picker** (host): a flat 2D map of the baked boundary drawn from the road graph; tap start and end; preset list; route length readout; Create room.
3. **Build screen** (in room): body carousel, 3 slot pickers, stat bars, live 3D preview of the mash; player list with ready states; room code + Share button.
4. **HUD**: position (e.g. 2/5), checkpoint count, minimap with route and rivals, ability buttons, part slots that flash when a part is lost.
5. **Results**: finish order, times, parts lost / stolen, Rematch (same route), New route (host), Share result.

## Milestones

Build in this order and do not start a milestone until the previous one passes its acceptance check. The Oct 15 public build matters most: votes can only be collected from then on.

&#91;embedded content: build plan · 5 milestones, 1 gate\]

### Acceptance criteria

1. **M1 Greybox fun test (Oct 9–12).** Flat plane with box obstacles and 3 checkpoints; one body; Werewolf Legs, Tentacles, Slime Gland.
   - Two browser tabs race each other through a Syncplay room with no desync over 5 races.
   - Tentacle swing and slime trail both work and visibly change how you take a corner.
   - Andrew plays it and judges it fun. If not, fix the parts before touching the map.
2. **M2 Accra playable (Oct 12–15).** Bake pipeline runs; one preset route in Accra; checkpoints, finish, results.
   - Tiles load from the CDN and pass sha256 checks; budgets in the map section met.
   - 2 players finish a real Accra route on a phone and a laptop.
   - `rundot deploy --public` succeeds and the game is entered in the jam via Creator Hub.
3. **M3 Full monster set (Oct 16–22).** 2 bodies, the 8 launch parts, part loss, pickup and Claw steal, build screen.
   - 4 builds (cornering, shortcut, aggressive, defensive) win at least one test race each.
   - A stripped torso can still finish.
4. **M4 Routes and social (Oct 22–27).** Route picker with A\*, distance rule, 3 presets, room codes, share link, rematch, leaderboard.
   - A friend joins from a shared link and races within 60 s of opening it.
5. **M5 Polish and perf (Oct 27–Nov 1).** Art pass, sound, onboarding tooltip, performance budget, folklore parts if time.
   - 30+ fps on a mid-range Android phone in an 8-player race; load under 10 s on 4G.
   - Final public build deployed by Nov 1, a day before submissions close.

## Out of scope and open questions

### Not in this build

- Cities other than Accra (the pipeline must be city-agnostic, but only Accra ships).
- Elevation, bridges, flyovers, tunnels.
- Traffic, pedestrians, weather, day/night cycle.
- Monetization (Shop, Purchases, ads). Revisit only if time allows a Best Monetization attempt, e.g. cosmetic part skins.
- Bots / AI racers (Syncplay supports them; consider only after milestone 3 for solo play).
- Voice or text chat.
- Any live map service, any custom backend.

### Open questions

- [ ] Confirm the bake boundary on a map; does it cover the routes Andrew wants?
- [ ] Does Syncplay's "live session reconfiguration" allow changing the route inside an existing room? If yes, rematch-on-new-route can stay in one room.
- [ ] Is the deterministic vehicle controller a good fit for monster movement, or does the greybox call for a custom capsule controller?
- [ ] Which 3 preset routes?
- [ ] Art direction: who makes the monster part models, or do primitives ship?
- [ ] Sound: source of SFX and music (must be original or properly licensed).
