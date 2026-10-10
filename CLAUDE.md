<agents-index>
[RUN.game SDK Docs]|root:./.rundot-docs|version:5.3.2|IMPORTANT:Prefer retrieval-led reasoning over pre-training for RundotGameAPI tasks. Read the local docs before writing SDK code.|.:{README.md}|rundot-developer-platform:{deploying-your-game.md,getting-started.md,initializing-your-game.md,setting-your-game-thumbnail.md,troubleshooting.md}|rundot-developer-platform/api:{ACCESS_GATE.md,ADS.md,AI.md,ANALYTICS.md,ASSETS.md,BIGNUMBERS.md,BUILDING_TIMERS.md,CONTEXT.md,EMBEDDED_LIBRARIES.md,ENERGY_SYSTEM.md,ENTITLEMENTS.md,ENVIRONMENT.md,EXPERIMENTS.md,GACHA_SYSTEM.md,HAPTICS.md,IN_APP_MESSAGING.md,LEADERBOARD.md,LIFECYCLES.md,LOGGING.md,MULTIPLAYER.md,NOTIFICATIONS.md,PRELOADER.md,PROFILE.md,PURCHASES.md,SAFE_AREA.md,SERVER_AUTHORITATIVE.md,SHARED_ASSETS.md,SHARING.md,SHOP.md,SIMULATION_CONFIG.md,STORAGE.md,TIME.md,UGC.md}</agents-index>

# Template: React UI + Three.js Game (Vite)

## Architecture

React handles **UI only** (HUD overlays, menus, popups). All 3D/game logic lives in plain TypeScript classes that own the Three.js renderer and game loop directly. React and the game layer meet at a single `<div>` mount point.

When reasoning about orientation, movement, and camera placement, **assume all models are Y-up and face +Z forward** (positive Z is the character’s forward direction). In this right-handed system, **+X is the character’s LEFT** and **−X is the character’s RIGHT**. Do not assume +X = right — this is the most common source of inverted controls.

- **NEVER** use `useEffect` — it is banned in this project. Use `useCallback` refs for mount/unmount logic (see `App.tsx` pattern)
- **NEVER** use React state, effects, or hooks for game logic, asset loading, audio, animation, or scene graph management
- **NEVER** use React Three Fiber (`@react-three/fiber`) or `@react-three/drei` — they are not in this project
- **DO** put game logic in classes (see `GameScene.ts` as the pattern)
- **DO** use React only for DOM UI elements

## File Structure (as-shipped)

- **src/main.tsx** — Entry point. Applies theme via `applyTheme(theme)`, mounts `<App />` inside `ErrorBoundary` and `StrictMode`
- **src/App.tsx** — Shell: mounts `GameScene`, subscribes to game events, renders HUD overlay (score display, game-over panel)
- **src/GameScene.ts** — Game class. Owns Three.js renderer, camera, scene, lights, controls, `requestAnimationFrame` loop, state machine, asset loading, and event emitter. Extend this for game logic
- **src/GameEvents.ts** — Typed event emitter (`GameEventEmitter`) and `GameState` type. The bridge between game logic and React UI
- **src/loadStowKitPack.ts** — Plain async function to load StowKit `.stow` packs. Has a simple cache. No React
- **src/components/** — Reusable UI: `ErrorBoundary`
- **src/theme.ts** — Color tokens and `applyTheme()`. Edit colors here to match your game's aesthetic
- **src/style.css** — Global styles; uses theme CSS color variables (e.g. `var(--color-primary)`)
- **public/** — Static assets. Small essentials here; large assets in **public/cdn-assets/** (deployed to CDN via `rundot deploy`)
- **vite.config.ts** — Vite + `@vitejs/plugin-react` + `rundotGameLibrariesPlugin()` from SDK; `base: './'`; esbuild/build target `es2022`

## Key Patterns

- **3D/Game:** All game logic goes in plain TypeScript classes. `GameScene` owns the Three.js `WebGLRenderer`, camera, scene, and `requestAnimationFrame` loop. Load assets with `loadStowKitPack()`. Use `three` directly — `OrbitControls` from `three/addons/controls/OrbitControls.js`, etc. React never touches the scene graph.
- **StowKit loading:** Always use `loadStowKitPack(packName)` from `src/loadStowKitPack.ts` — it handles CDN fetch, WASM config, and caching. Never load `.stow` files directly with `StowKitLoader.load()` in this template (CDN requires `RundotGameAPI.cdn.fetchAsset`).
- **Game states:** `GameScene` has a state machine (`'loading' | 'playing' | 'paused' | 'gameover'`). The `update()` loop dispatches to `updatePlaying()` etc. based on state. Call `game.pause()`, `game.resume()`, `game.gameOver()`, `game.restart()` to transition. All transitions emit a `stateChange` event.
- **Game events (Game → React):** `GameScene.events` is a typed `GameEventEmitter` from `src/GameEvents.ts`. React subscribes in the `useCallback` ref that mounts the game: `game.events.on('scoreChange', setScore)`. To add a new event, extend `GameEventMap` in `GameEvents.ts` and call `this.events.emit('yourEvent', data)` from `GameScene`. The game class never imports React.
- **HUD overlay:** `App.tsx` renders a `.hud` div as an absolute-positioned sibling of `.scene-container`. It listens to game events and renders score, game-over panel, etc. HUD elements use `pointer-events: none` on the container, `pointer-events: auto` on interactive children.
- **Score:** Call `game.setScore(n)` or `game.addScore(delta)` from game logic — these emit `scoreChange` which the HUD picks up automatically.
- **RundotGameAPI:** Import `RundotGameAPI from '@series-inc/rundot-game-sdk/api'`. Use `RundotGameAPI.cdn.fetchAsset('filename.png')` (returns Promise<Blob>) for CDN assets; `RundotGameAPI.appStorage` for persistence; `RundotGameAPI.ads`, `RundotGameAPI.popups`, `RundotGameAPI.system.getSafeArea()` / `getDevice()` / `getEnvironment()`; `RundotGameAPI.error()` for logging. No initialization in code — SDK is wired by Vite plugin.
- **Theme:** Edit `src/theme.ts`. `applyTheme(theme)` runs once in main.tsx; CSS uses variables like `var(--color-primary)`. Only color tokens — no spacing/radius/font variables.

## What to Modify

- **Game logic** — Put gameplay in `updatePlaying()` inside `GameScene.ts`. Call `this.addScore()` to update score, `this.gameOver()` when the game ends. Create new game classes as needed — all game logic stays in plain TypeScript, no React hooks or state.
- **New events** — Add entries to `GameEventMap` in `src/GameEvents.ts`, emit from `GameScene`, subscribe in `App.tsx`.
- **New HUD elements** — Add React elements inside the `.hud` div in `App.tsx`. Subscribe to game events via `game.events.on(...)`. Never render HUD as 3D text or sprites.
- **New CDN assets** — Add files to `public/cdn-assets/`; load in code with `RundotGameAPI.cdn.fetchAsset('filename.ext')`. Use `public/` for small assets referenced by path.
- **Look and feel** — `src/theme.ts` for colors, `src/style.css` for styles.
- **Build/deploy** — `npm run build`; `rundot deploy` for production (includes CDN upload). Optional: `RUNDOT_GAME_DISABLE_EMBEDDED_LIBS=true` for bundled build.

## StowKit Asset Pipeline

**Adding assets is always a two-step process:**
1. Place source file (FBX, GLB, PNG, WAV) in `assets/`, run `stowkit build`
2. Load from `.stow` pack in game code: `pack.loadMesh('stringId')`, `pack.loadTexture('stringId')`, etc.

- **NEVER** load raw source files directly (`THREE.FBXLoader`, `THREE.TextureLoader`, `THREE.GLTFLoader`, `fetch('assets/...')`)
- **NEVER** manually create `.stowmeta` files — they are auto-generated by `stowkit build`
- **NEVER** use `stowkit store` commands to find local project files — the store is a remote shared registry
- To find local assets: glob `assets/`, read `.stowmeta` files, or run `stowkit status`
- To add an asset: place file in `assets/` → `stowkit build` → use `loadStowKitPack('default')` then `pack.loadMesh()`/`pack.loadTexture()`/etc.
- **CRITICAL: Always run `stowkit build` after adding or modifying any file in `assets/`.** The `.stow` bundle in `public/cdn-assets/` is what the game actually loads at runtime — if you skip the build, new/changed assets won't exist in the pack and `loadMesh()`/`loadTexture()`/etc. will fail silently or throw. This is the #1 forgotten step.
- **Sounds/Audio:** When the user asks for sounds, **first** use the MCP asset store search to find existing sounds — there are many available. Only create/synthesize sounds as a last resort if nothing suitable exists in the store.

## UI Design Guidelines

This runs on phones. Design for **portrait, touch, one-thumb reach**.

### Visual Design — This Is a Game, Not a SaaS Dashboard

Before writing ANY UI code, decide on an aesthetic direction that fits the game (e.g. sci-fi/industrial, fantasy/ornate, casual/toy-like, minimalist/clean, retro/pixel, organic/natural). Commit to it. Every UI element should feel like it belongs in the game world.

**Theme Colors:**
- Pick ONE dominant accent color that matches the game's mood. Add 1–2 supporting accents max. Do not evenly distribute 5 pastel colors — that's a SaaS palette, not a game.
- Update `src/theme.ts` FIRST — set `primary`, `secondary`, `background`, `surface` to match the game's world. Every UI element pulls from these tokens. A space game gets deep blues and cyan accents. A dungeon crawler gets warm stone and gold. A casual game gets bright, saturated primaries.
- **NEVER** use the default purple/blue gradient as shipped — it's a placeholder, not a design choice.

**Dark/Translucent Panels (not white cards):**
- Game UI panels use dark translucent backgrounds: `background: rgba(0, 0, 0, 0.65)` with `backdrop-filter: blur(4px)` — the 3D scene should bleed through.
- **NEVER** use opaque white or light gray backgrounds for any game UI element. This is a game running over a 3D scene — white cards look completely wrong.
- Borders are subtle: `1px solid rgba(255, 255, 255, 0.08)`. Not thick, not high-contrast, not colored borders on every panel.

**Border Radius:**
- Keep it tight: **2–6px**. Games use sharp, intentional corners. `border-radius: 24px` pill shapes are a SaaS/AI-slop tell.
- Exception: circular elements (avatar badges, round buttons) use `border-radius: 50%` — that's geometric, not decorative.

**Typography:**
- **NEVER** use Inter, Roboto, Open Sans, Arial, Lato, or default system fonts. These are invisible — they have zero personality and scream "template."
- Choose a font with character that fits the game: Space Grotesk, Exo 2, Rajdhani, Orbitron (sci-fi), Chakra Petch, Press Start 2P (retro), Fredoka (casual), Cinzel (fantasy). Load via Google Fonts or bundle it.
- HUD values (score, health, timer): use `font-variant-numeric: tabular-nums` so digits don't shift width, plus `text-shadow: 0 1px 3px rgba(0,0,0,0.8)` for readability over the 3D scene.
- Labels and button text: `text-transform: uppercase` + `letter-spacing: 0.05–0.1em` reads as game UI, not web UI.

**Buttons:**
- Game buttons are solid accent color with a subtle lighter border (`2px solid rgba(255,255,255,0.12)`), uppercase text, tight radius.
- `:active` state is mandatory (`:hover` doesn't exist on phones): `transform: scale(0.95)` for tactile press feel.
- **NEVER** use gradient fills on buttons as a default. Flat solid color > generic linear-gradient.
- No `box-shadow: 0 4px 6px rgba(0,0,0,0.1)` — that's a web card shadow. Game buttons either have no shadow or a tight colored glow matching the accent.

**Shadows & Effects:**
- Avoid generic `box-shadow` on everything. If you need depth, use `border` or subtle inner highlight (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.05)`).
- Reserve glow effects (`box-shadow: 0 0 12px var(--color-primary)`) for interactive/active states, not decoration.

**Icons:**
- Use icons over text labels during gameplay — players read icons at a glance, not sentences.
- Emoji icons are fine for prototyping. For polish, use a consistent icon set (Lucide, Phosphor, or custom SVGs).

**What NOT to Do (AI default behaviors to avoid):**
- No "three evenly-spaced cards in a row" layouts
- No hero sections, testimonials, or SaaS page patterns
- No glassmorphism as a default (heavy `backdrop-filter: blur(20px)` on everything)
- No scattered generic `fadeIn` animations on every element
- No pastel/muted color palettes — games need contrast and visual punch
- No `opacity: 0.5` as the disabled state — use `opacity: 0.35` + `grayscale(0.5)` to actually look disabled

**Motion & Feedback:**
- One coordinated entrance animation per screen/modal (elements stagger in). Not every element independently fading in.
- State changes animate meaningfully: health bar drains smoothly, score ticks up, currency flies to the counter.
- Button presses need instant visual feedback (scale, brightness shift, or flash) — a button that doesn't react to touch feels broken on mobile.
- Use CSS transitions on `transform`/`opacity` only (compositor-thread). See "Preventing Jitter" below.

### Layout & Layering
- The `.app-container` caps at 720×1280 (9:16) — design UI within this, not the full viewport
- The canvas (Three.js) composites as its own GPU layer. HTML overlays sit on top naturally — no `z-index` needed if they're siblings of `.scene-container`
- Game HUD overlays: use `position: absolute` within the game container (not `position: fixed` — there's no scrolling, and fixed creates unnecessary compositor layers). Set `pointer-events: none` on the overlay container, `pointer-events: auto` on interactive children only
- Use `RundotGameAPI.system.getSafeArea()` to inset UI away from notches/home indicators — apply returned padding to fixed overlays, not just the app shell
- `.scene-container` fills the app container; overlay HUD elements as absolutely-positioned HTML siblings of the canvas div

### Preventing Jitter Between HTML Overlays and Canvas
- **Only animate `transform` and `opacity`** on overlay elements — these are the only two CSS properties handled by the compositor thread. Animating `top`, `left`, `width`, `height`, `margin`, `padding`, `box-shadow` etc. forces layout on the main thread and competes with your `requestAnimationFrame` game loop, causing mutual stutter
- Use `transform: translate(x, y)` instead of `top`/`left` for positioning animations
- `will-change: transform` promotes an element to its own compositor layer — but it's a **last resort for existing perf problems**, not preventative. Overuse wastes GPU memory. Toggle it via JS before/after animation, don't leave it in stylesheets permanently
- `will-change` creates a new stacking context eagerly — can break z-ordering unexpectedly
- Apply `contain: content` (shorthand for `layout paint style`) on overlay panels — tells the browser that DOM changes inside won't affect anything outside, so it can skip recalculating the rest of the page
- **Don't** re-render React on every game frame — if the game updates a score at 60fps, throttle the React update to every 100–200ms or use a ref + direct DOM mutation for the counter

### Canvas Sizing & DPI
- **Don't use `renderer.setPixelRatio()`** — Three.js docs recommend against it. It silently multiplies sizes behind the scenes and breaks post-processing, GPU picking, `gl_FragCoord`, and screenshot capture
- Instead, handle DPI manually: `const dpr = Math.min(window.devicePixelRatio, 2);` then `renderer.setSize(width * dpr, height * dpr, false)` (false = don't touch CSS). Cap at 2 because DPR 3 (modern iPhones) means 9x pixels — destroys mobile fill rate for minimal visual gain
- Use `ResizeObserver` on the container element, not `window.addEventListener('resize')` — it's element-level (catches tab switches, flexbox reflows), fires between layout and paint, and provides dimensions via `contentRect` without forcing `getBoundingClientRect()` layout thrashing
- **Don't** put `<canvas>` inside a scrollable container — causes janky resize. The canvas belongs in a fixed-size container

### Touch & Interaction
- Minimum touch target: **44×44px** — anything smaller is unusable on phone. Pad icons with transparent hit areas if needed
- Buttons need `:active` state feedback, not just `:hover` (hover doesn't exist on mobile) — use `transform: scale(0.95)` or opacity change on `:active`
- Set `touch-action: none` on the canvas container — prevents the browser from intercepting touches for pan, zoom, or double-tap-to-zoom. The browser resolves `touch-action` by intersecting values up the DOM tree, so setting it on the container covers all children
- If your game calls `preventDefault()` on touch events, you **must** use `{ passive: false }` — browsers default `touchstart`/`touchmove` to passive on window/document/body, and passive listeners silently ignore `preventDefault()`. Prefer `touch-action: none` in CSS over `preventDefault()` — it's more efficient (informs the browser before any event fires)
- For game controls overlaid on the canvas: use transparent `<div>` touch zones positioned over the canvas, **not** Three.js raycasting for UI buttons
- **Prevent text selection and drag on HUD overlays** — emoji, score text, and other HUD content will get selected/dragged by the browser during thumbstick or button interactions. Always set `user-select: none; -webkit-user-select: none;` on the HUD root container. Add `e.preventDefault()` on `mousedown` handlers for draggable controls (thumbsticks, sliders) to prevent the browser's native drag behavior
- **Mouse-based drag controls (thumbsticks, sliders)** — always listen for `mousemove` and `mouseup` on `window`, not on the element itself. If the cursor leaves the element while dragging, the element-level listeners stop firing and the control gets stuck. Start the window listeners on `mousedown` and clean them up on `mouseup`

### Using the Theme System
- **Always use CSS color variables** (`var(--color-primary)`, `var(--color-surface)`) — never hardcode colors in component styles
- Update `src/theme.ts` to match the game's aesthetic BEFORE building any UI — the defaults are placeholders

### Game HUD Patterns
- Score/health/timer: absolutely-positioned HTML elements over the canvas — fast to update, accessible, styled with CSS. **Never** render HUD as 3D text or sprites
- The template ships with a working HUD in `App.tsx`: score display at top, game-over overlay with "Play Again" button. See `.hud` styles in `style.css`
- Animate HUD changes with CSS transitions on `transform`/`opacity` only — don't use JS `requestAnimationFrame` for UI animation, that's for the game loop
- Game → React communication: `game.events.on('scoreChange', setScore)` in the `useCallback` ref that mounts the game. Add new event types to `GameEventMap` in `src/GameEvents.ts`. Game class never imports React
- React → Game communication: call public methods on `gameRef.current` (e.g. `game.restart()`, `game.pause()`)

### Mobile Renderer Settings
- **`antialias`**: Native MSAA (`antialias: true`) is the cheapest AA when NOT using post-processing — but 4x MSAA quadruples the color buffer memory. On low-end mobile, skip AA and render at 1.25–1.5x DPR instead (CSS downscale provides implicit AA)
- **`preserveDrawingBuffer: false`** (default): Lets tiled-rendering mobile GPUs (Adreno, Mali, Apple) discard the framebuffer after compositing instead of writing it back to memory. Only set `true` if you need `canvas.toDataURL()` for screenshots
- **`alpha: true`**: MDN warns that `alpha: false` can be *more* expensive on some platforms (RGB backbuffer emulated on RGBA). Use `alpha: true` with shaders outputting `alpha: 1.0` if you want an opaque canvas. Set `premultipliedAlpha: false` if your blending assumes straight alpha
- **`powerPreference: 'high-performance'`**: Worth setting as a hint, but on mobile (single GPU) it has no effect. On laptops Chrome picks GPU based on AC/battery regardless
- **`failIfMajorPerformanceCaveat: true`**: Causes context creation to fail if the browser would use software rendering — better to show a fallback message than run at 2fps
- **NEVER** use `logarithmicDepthBuffer` — it uses `gl_FragDepth` which disables Early-Z testing on the GPU, devastating for mobile performance
- Keep draw calls under ~100–200 for 60fps on mid-range mobile — use `InstancedMesh` or merged geometries to reduce. Check `renderer.info.render.calls` to monitor

## Character Controller & Joystick Mapping

Models face **+Z forward**, **+Y up** in Three.js's right-handed coordinate system. Because a character facing +Z faces *toward* the default camera (which looks down −Z), **+X is the character's LEFT and −X is the character's RIGHT**. This is the #1 source of inverted controls — getting the X sign wrong.

**The #1 bug:** joystick axes get swapped or negated, producing inverted/rotated controls. Always derive movement from the **character's facing direction**, not raw axis assumptions. Remember: +X = character's LEFT, not right.

**Correct joystick → world mapping (camera behind character, looking +Z):**
```ts
// Screen-space joystick: X right is positive, Y UP is negative (DOM convention)
// +X = character's LEFT, so negate joystick X so "right" moves the character right (−X)
const moveX = -joystickX;      // joystick right → world −X (character's right)
const moveZ = -joystickY;      // joystick up (negative) → world +Z (character's forward)

character.position.x += moveX * speed * delta;
character.position.z += moveZ * speed * delta;
```

**Character rotation to face movement direction:**
```ts
if (moveX !== 0 || moveZ !== 0) {
  const targetAngle = Math.atan2(moveX, moveZ);
  character.rotation.y = targetAngle;
}
```

Verify the rotation is correct:
- Joystick UP → moveX=0, moveZ>0 → `atan2(0, +)` = 0 → faces +Z (forward) ✓
- Joystick RIGHT → moveX<0, moveZ=0 → `atan2(-, 0)` = −π/2 → faces −X (character's right) ✓
- Joystick LEFT → moveX>0, moveZ=0 → `atan2(+, 0)` = π/2 → faces +X (character's left) ✓

**Common mistakes to avoid:**
- Forgetting to negate joystick X — pushing right moves character LEFT (most common inversion bug)
- Forgetting to negate joystick Y — pushing up moves character backward
- Using `atan2(moveZ, moveX)` — rotates character 90° off from movement
- Assuming +X is the character's right — it's the LEFT in this coordinate system
- Applying joystick input in camera-local space without transforming to world space when the camera orbits

**Camera-relative movement (orbiting/rotating camera):**
```ts
const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
forward.y = 0;
forward.normalize();
const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(camera.quaternion);
right.y = 0;
right.normalize();

const move = new THREE.Vector3();
move.addScaledVector(right, joystickX);
move.addScaledVector(forward, -joystickY);
```

## Three.js Gotchas

- `DirectionalLight` targets: always `scene.add(dirLight.target)` — Three.js needs the target in the scene graph for shadow camera orientation
- `castShadow`/`receiveShadow` don't propagate to children — after loading a StowKit mesh, traverse to enable: `mesh.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } })`
- StowKit `pack.loadMesh()` returns a `THREE.Group` with nested children — always traverse when setting per-mesh properties
- Always call `renderer.shadowMap.enabled = true` and set `dirLight.castShadow = true` for shadows to work
- Near clipping plane (`camera.near`) too small causes z-fighting artifacts — if the camera zooms out far, increase `near` (e.g. `0.5` or `1` instead of `0.1`). Keep the near/far ratio reasonable (< 10000:1).

## Game Feel & Juice

A game that plays correctly but *feels* flat will get abandoned in seconds. Polish is not optional — it's the difference between "tech demo" and "game." Every interaction should have a response, every state change should be visible, and the world should feel alive even when the player isn't doing anything.

### Tweens — The Right Way

Use inline tweens driven by the game loop (`delta` from `clock.getDelta()`). Do **not** add a tween library — they're unnecessary overhead for what amounts to interpolating a value over time.

**Simple tween pattern (use this):**
```ts
// In your game class
private cameraShakeTimer = 0;
private cameraShakeIntensity = 0;

shakeCamera(intensity: number, duration: number) {
  this.cameraShakeIntensity = intensity;
  this.cameraShakeTimer = duration;
}

updatePlaying(delta: number) {
  if (this.cameraShakeTimer > 0) {
    this.cameraShakeTimer -= delta;
    const t = this.cameraShakeTimer / 0.3; // normalized 1→0
    const shake = this.cameraShakeIntensity * t;
    this.camera.position.x += (Math.random() - 0.5) * shake;
    this.camera.position.y += (Math.random() - 0.5) * shake;
  }
}
```

**Lerp for smooth transitions (use constantly):**
```ts
// Smooth camera follow, value changes, color transitions, etc.
object.position.lerp(targetPosition, 1 - Math.pow(0.001, delta));

// For scalars:
this.displayScore += (this.actualScore - this.displayScore) * (1 - Math.pow(0.0001, delta));
```

The `Math.pow(0.001, delta)` pattern is frame-rate-independent exponential decay — it reaches the target at the same visual speed whether running at 30fps or 120fps. The smaller the base (0.001 = fast, 0.1 = slow), the snappier the lerp.

**Easing functions (copy-paste these):**
```ts
const easeOutBack = (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
const easeOutElastic = (t: number) => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
```

Use `easeOutBack` for things popping into existence (overshoot feels punchy). Use `easeOutElastic` sparingly for celebration moments. Use `easeInOutCubic` for camera moves and UI slides.

### What to Juice (Priority Order)

1. **Scoring** — When the score changes, the HUD number should scale up briefly (`transform: scale(1.2)` via CSS transition) and the scored object should flash or pop. Never just silently increment a number.
2. **Collisions/impacts** — Camera shake (short, 0.1–0.3s), object squash-and-stretch, particle burst. Even tiny shakes make hits feel real.
3. **Spawning/despawning** — Objects should scale from 0 or fade in. Destroyed objects should shrink, fly away, or burst — never just disappear.
4. **Idle state** — Objects should breathe (subtle sine-wave scale), bob, or rotate slowly. A static scene feels broken. `object.position.y = baseY + Math.sin(time * 2) * 0.05;`
5. **Touch/tap feedback** — The tapped object should react instantly (scale pulse, brightness flash). Latency between tap and visual response must be under one frame.
6. **State transitions** — Game over should have a dramatic pause (freeze game for 0.5s, then show overlay). Starting a new game should have a countdown or whoosh, not just a state flip.

### Squash and Stretch

The most important animation principle for game feel. When an object moves fast, stretch it along its velocity. When it lands or impacts, squash it:
```ts
// On impact:
mesh.scale.set(1.3, 0.7, 1.3); // squash
// Then lerp back to (1, 1, 1) over ~0.2s

// While falling/moving fast:
const speed = velocity.length();
const stretch = 1 + speed * 0.1;
mesh.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
```

### Screen Shake

Shake is the cheapest, highest-impact juice. Use it for every hit, explosion, and big score event. Keep it short (0.1–0.3s) and small (0.02–0.1 units) — players should feel it, not get nauseous.

### Particles

For web/mobile, emit particles as simple `THREE.Points` or small billboard quads. Keep particle counts low (10–30 per burst, not 200). Recycle particles from a pool — don't create/destroy geometry per burst.

### HUD Juice (CSS-only)

HUD animations are CSS-only — never use `requestAnimationFrame` for UI animation:
```css
.hud-score {
  transition: transform 150ms ease-out;
}
.hud-score.bump {
  transform: scale(1.25);
}
```
Toggle the `.bump` class from React, remove it after the transition. For number ticking, use the exponential lerp pattern via `requestAnimationFrame` *only* if you need smooth sub-frame counting — otherwise CSS transitions on `transform` are sufficient and cheaper.

### What NOT to Do

- **Don't over-juice** — If everything bounces, shakes, and particles constantly, nothing stands out. Reserve elastic/overshoot easing for celebration moments, use subtle lerps for everything else.
- **Don't use CSS animations for game objects** — CSS animations run on the compositor thread and can't be synced to your game clock. Use them only for HUD elements.
- **Don't add a tween library** (GSAP, Tween.js, etc.) — they add bundle size and a second animation loop competing with your `requestAnimationFrame`. The lerp + timer patterns above cover 99% of game tween needs.
- **Don't animate material colors per-frame** — it's a GPU state change that breaks batching. Pre-bake color variants or use vertex colors.

## Skinned Mesh + Animation

`clone(true)` on a `SkinnedMesh` does **NOT** rebind the skeleton — every clone still points at the original bones, so they all T-pose or move in unison. And calling `loadSkinnedMesh()` per instance is way too expensive (re-decodes geometry + textures from scratch). The correct pattern is **load once, clone with rebind**.

### Step 1 — Load template once (expensive, do it once at startup)
```ts
this.enemyTemplate = await pack.loadSkinnedMesh('character/my_character');
this.enemyWalkClip = await pack.loadAnimationClip('animations/anim_walk');
// Don't add the template to the scene — it's just a source to clone from
```

### Step 2 — Clone helper (rebinds skeleton to cloned bones)
```ts
function cloneSkinnedMesh(source: THREE.Group): THREE.Group {
  const clone = source.clone(true);

  const sourceBones: THREE.Bone[] = [];
  const cloneBones: THREE.Bone[] = [];
  source.traverse((n) => { if ((n as THREE.Bone).isBone) sourceBones.push(n as THREE.Bone); });
  clone.traverse((n) =>  { if ((n as THREE.Bone).isBone) cloneBones.push(n as THREE.Bone); });

  clone.traverse((n) => {
    const sm = n as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const newBones = sm.skeleton.bones.map(
      (b) => cloneBones[sourceBones.indexOf(b)] ?? b
    );
    sm.skeleton = new THREE.Skeleton(newBones, sm.skeleton.boneInverses);
    sm.bind(sm.skeleton, sm.bindMatrix);
  });

  return clone;
}
```

### Step 3 — Per spawn (cheap — just a CPU-side array remap)
```ts
const charGroup = cloneSkinnedMesh(this.enemyTemplate);
scene.add(charGroup);
const mixer = new THREE.AnimationMixer(charGroup);
mixer.clipAction(this.enemyWalkClip).play();
```

### Step 4 — Every frame
```ts
mixer.update(delta);
```

### Step 5 — On death/removal
```ts
mixer.stopAllAction();
scene.remove(charGroup);
```

### Quick Reference
| Method | When to use |
|--------|-------------|
| `loadSkinnedMesh(id)` | Once, to get the template mesh |
| `loadAnimationClip(id)` | Once, to get reusable clip data |
| `loadAnimation(group, id)` | Convenience — loads + plays in one call. Only use for one-off instances |
| `cloneSkinnedMesh()` + `new AnimationMixer` | Every subsequent instance — clone template, rebind skeleton, drive independently |

- **NEVER** call `loadSkinnedMesh()` per enemy/instance — it re-decodes the full mesh from the asset pack every time
- **NEVER** rely on `clone(true)` alone for skinned meshes — you will get T-posing clones that all share one skeleton

[Run.3DEngine Docs Index]|root:.rundot/3d-engine-docs|core:{Component.md,GameObject.md,VenusGame.md}|patterns:{ComponentCommunication.md,CreatingGameObjects.md,MeshColliders.md,MeshLoading.md}|physics:{Colliders.md,PhysicsSystem.md,RigidBodyComponent.md}|rendering:{AssetManager.md,InstancedRenderer.md,MeshRenderer.md,SkeletalRenderer.md}|systems:{AnimationSystem.md,AudioSystem.md,InputManager.md,LightingSystem.md,NavigationSystem.md,ParticleSystem.md,PrefabSystem.md,SplineSystem.md,StowKitSystem.md,TweenSystem.md,UISystem.md}