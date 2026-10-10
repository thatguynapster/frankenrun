---
name: rundot-polish-feel
description: >-
  Make a RUN game look and feel finished instead of vibe-coded-default: locked art
  direction, render pipeline, grounding, juice/game feel, layered effects, HUD
  presentation, and the screenshot loop — plus the mobile fundamentals
  (portrait-first, anchored responsive layouts, safe-area insets, touch-safe
  sizing). Use when a game looks generic, flat, floaty or "AI-made", when adding
  lighting, particles, hit feedback or HUD, or when the user mentions polish,
  juice, game feel, screenshake, haptics, presentation, mobile, portrait, landscape,
  screen size, safe area, thumb zone, touch targets, HUD clutter, or fat-fingering.
---

# RUN.game Polish & Feel

Two halves of the same job: **how the game looks and feels** (the polish layers), and **how it holds up in a hand on a phone** (the mobile fundamentals). Both are what separate a game that reads as shipped from one that reads as a tech demo.

## The default look, and why it happens

You know it: sky-blue background, pure-green ground, a red box gliding between grey boulders, Arial text in a purple rounded rectangle. Every code-generating model learned from the same starter tutorials and template projects, so when a prompt doesn't specify an art direction the model falls back to the statistical average of everything it has read — and that average is sky blue and purple gradients.

**The fix is not a better model. The fix is knowing what to ask for.** Everything below is a thing to ask for by name.

## Coaching approach — ask, teach, reveal blind spots

Creators usually can't see either problem. They've stopped seeing their own visuals after the hundredth run, and they build and test on one screen — often a desktop browser — so they've never felt the game in one hand with a thumb. Your job is to make both concrete. Ask, then teach.

Ask as you go (a couple at a time, not all at once):

- If you screenshotted this right now and put it next to ten other games, would anyone stop on yours? What would make them?
- Did you pick a colour palette and a shape language before you started, or did the colours just accumulate?
- When the player hits something, what does the *screen* do in the next tenth of a second?
- Does your world feel like a place, or like objects floating on a flat plane?
- Have you played this on a real phone, held in one hand, with your thumb? What felt awkward?
- Which hand and which thumb reaches your most-used buttons? Can they be reached without shifting grip?
- Does your layout still work on the smallest and largest phones, or is it tuned to one size?
- Is anything important tucked under the notch, the home bar, or the host's UI chrome?
- Are any tap targets small enough to fat-finger? What happens on a mis-tap?
- Portrait or landscape — and is that a deliberate genre choice or just how it happened?

Teach the why, and name the blind spots: a model cannot see what it renders, so nothing catches a blurry, flat, z-fighting screen except a human looking at it. Phones vary wildly in size, so absolute pixel placement that looks fine on the dev machine breaks on real devices. Notches and home indicators eat the screen edges. Fingers are far less precise than a mouse. All of this is invisible from a dev setup — get them onto hardware early.

## Diagnose first: which layer is missing?

Look at a screenshot and a clip before recommending anything. The tells, in the order they're usually missing:

| Tell | Missing layer |
|---|---|
| Colours don't belong to each other; primary red/green/blue | 1 — art direction |
| Flat, plasticky, mysteriously blurry on phones | 2 — pipeline |
| Objects float; no sense of distance or place | 3 — grounding |
| Hits land with no impact; everything moves linearly | 4 — juice |
| Explosions are twenty identical blobs fading at once | 5 — rhythm |
| Arial in a purple box parked mid-screen | 6 — UI presentation |
| Obvious visual bugs nobody caught (`WAVE undefined`) | 7 — eyes |

Work the earliest missing layer first — later layers can't rescue an unlocked palette.

---

# Part 1 — The seven polish layers

## Layer 1: Art direction — write it down before you prompt

The highest-leverage thing available, and it costs nothing: **pick a palette before you build, write it down, and never use a colour outside it.**

- Define the palette at the top of the project and make it a law: every colour in the game comes from that list and nowhere else.
- **One dominant hue family, one accent, and the accent has to be earned.** Reserve it for a single meaning — markings on the hero and the enemy ring, or energy: engine flames, bullets, cores. That discipline is what makes a scene read as one universe instead of a pile of assets.
- **Shape language is the other half.** Spiky and dangerous, or round and friendly? Decide, write it down, tell the model. Palette + shape family *is* the art direction.
- **Generated art obeys the same law.** Prompt one concept image in the locked palette, then feed it to an image-to-3D model, and generate every other asset in the same session with the same style words. That's why they look like they belong together. Drop all the art into the project *before* the first code prompt — leave the visuals to the model and you get rounded rectangles in default purple.

**2D:** identical. Sites like Lospec have thousands of ready palettes, and any AI-generated sprite can be quantised down to the chosen colours so mismatched assets snap into one world.

**Perf: zero. This layer is free forever.**

> This one belongs upstream — lock it at the same time as the core loop, before any real art or code exists. If a creator is arriving here with an already-built game, retrofit it: pick the palette from the best-looking thing already in the game, then re-generate or re-tint everything else to match.

## Layer 2: Pipeline — how the engine turns math into visuals

Starter code ships flat and blurry, and the fixes are almost insultingly small. Ask for them by name:

- **ACES tone mapping** — the difference between plastic and cinematic.
- **Pixel ratio clamped to 2** — the difference between crisp and mysteriously blurry on every phone and retina display. Models leave this out constantly.
- **Antialiasing.**
- **Real lighting.** Ambient-only lighting (what generated code usually ships) multiplies every face by the same colour — that is exactly why everything looks flat. Replace the ambient light with a **warm key light and a cool sky fill**.
- **A little post-processing goes a long way**: one bloom pass, bonus points for a vignette. The vignette doesn't even need a shader — a CSS `radial-gradient` overlay div is free and looks the same.

Two traps that look like mysteries and are each one line:

- Standard materials with `metalness > 0.1` render **black** with no environment map — including materials inside loaded GLB files.
- Canvas textures painted by hand need `texture.colorSpace = THREE.SRGBColorSpace` or the colours wash out.

**2D:** size the buffer at CSS size × `devicePixelRatio` and scale the context — same crispness fix.

**Perf: pixel ratio 3 renders nine times the fragments of ratio 1, so clamp at 2. Every post pass is a full-screen render target; on mobile, stop at bloom.**

## Layer 3: Grounding — make the world feel like a place

Objects floating on a flat colour plane are the fastest tech-demo tell there is.

- **Blob shadows first.** A soft dark ellipse under every character and prop, scaled and faded with height. One radial-gradient texture, and it glues everything to the floor. Real shadow maps are the expensive version — a single shadow-casting point light renders the whole scene six times. The blob costs nothing and reads almost as well.
- **Aerial perspective.** Fog matched to the horizon colour, a gradient sky instead of a flat one, and distant silhouette ridges hand-tinted toward the sky, so *far* means lighter and hazier. A planet, a star field, a few drifting clouds — each is minutes of work, and together they give the sky depth a flat colour never will.
- **Level design is polish too.** A dead-straight corridor of randomly scattered rocks reads as generated. Give the path a curve (layered sine waves are enough) and place props *relative to the path* so boulders hug the corners. Suddenly the camera sways, parallax works, and the same twenty rocks feel intentional.

**2D:** blob-shadow ellipses under sprites, two or three parallax layers, gradient sky, far layers desaturated toward the sky colour.

**Perf: fog, gradients and blob shadows are near free. Real-time shadows are the thing to fear on mobile.**

## Layer 4: Juice — make the screen feel physical

Game feel comes from presentation, not from input. The same tap feels dead or electric depending on what the screen does in the next tenth of a second. Ask for these in this order:

- **Hitstop.** Freeze the game for **3–6 frames** on light hits, up to **20** on kills, by multiplying delta time by a `timeScale` you can zero. While frozen, flash the victim white and jitter its *rendered position only* — never its hitbox. The freeze exists so the flash can be read.
- **Camera kick.** One directional nudge along the impact vector, two or three frames out, eased back. Beats random shaking every time. If you do shake, keep it **under 200 ms**.
- **Easing everywhere.** Nothing in nature moves linearly. Ease out for movement, overshoot for pops, bounce for landings, squash and stretch on anything that lands or gets hit.

- **Haptics.** The one feedback channel that isn't on the screen, and it's free: `RundotGameAPI.triggerHapticAsync(HapticFeedbackStyle.Heavy)`. Match the style to the event — `Light`/`Medium`/`Heavy` for impacts by weight, `Success` on a reward or completed goal, `Warning`/`Error` on an invalid action. Fire it on the *same frame* as the hitstop and flash; a pulse that lands late reads as lag, not impact. Respect rhythm and give it cooldowns — a game that buzzes constantly feels cheap, not premium.

None of that costs a single millisecond of GPU time — it is the highest ratio of feel to effort in game development. Then spend the budget where it shows: **propulsion and big moments**. Engine flames as tube meshes with a dissolve shader (a noise threshold rising with age, so the flame erodes into embers instead of fading like a ghost); flames exit straight and stiff, only the cooled tail bends. Any signature moment follows a three-act rule worth reusing: **anticipation, climax, dissipation.**

Two haptics facts worth knowing before you wire it up: `triggerHapticAsync` **no-ops gracefully** on hosts with no vibration hardware, so you can call it defensively without guards — but like every SDK call it returns a promise that can reject, and an **unhandled rejection crashes the game**, so always attach a `.catch()`. You only need capability detection to drive *UI* (hiding a haptics toggle): read `RundotGameAPI.system.getDevice().haptics` → `{ supported, enabled }` **after `initializeAsync`** (it throws before) and cache it. The flat `hapticsEnabled` on the same payload is legacy shorthand for `haptics.enabled`.

**2D:** every timing above transfers directly; Phaser has camera shake, flash and zoom built in.

**Perf: juice is free until particles enter the picture. Overdraw from stacked transparent sprites is the number one mobile framerate killer — fewer, smaller, shorter-lived.**

## Layer 5: Rhythm — effects that play in sequence

Ask a model for an explosion and you get twenty identical orange blobs fading out linearly over a second and a half, all at once. That's a single loud note. A good effect is a *phrase*: it plays in sequence, and the sequence is what the eye reads as quality.

A good explosion is **five layers, each starting on its own beat, brightest one dying first**:

1. White flash — 1–3 frames
2. Radial spikes — ~140 ms
3. Sparks in mixed sizes — hold, then erode over ~400 ms
4. One expanding ring
5. Dark smoke, lingering last at low opacity where it never steals focus

Total particle count: **maybe 25**. Diablo III ships effects with 7–12 live particles. Richness comes from layering and timing, not count.

Two rules do most of the work:

- **Mixed sizes** — one big element, several medium, many tiny specks. Uniform particle size is the single most recognisable amateur tell.
- **Value discipline** — white-hot core, one hue, dark accents baked in so the effect reads against a bright sky as well as a dark one.

**Scale the effect to the value of the moment.** A pickup gets a small pop; a kill gets the full stack; a boss gets slow motion and a cascade arriving in waves. When everything is celebrated equally, nothing is.

**2D:** the same five beats as sprite layers, straight out of a Phaser or Pixi emitter.

**Perf: overdraw kills, not count. Shrink and separate particles before deleting them, and prefer additive blending — cheaper, and needs no sorting.**

## Layer 6: UI presentation — the half of the screen you forgot

Half of every screenshot is interface, and default AI interface is Arial in purple boxes parked wherever the model felt like it.

- **One display font and one clean sans** from Google Fonts. **Tabular numerals** on anything that counts.
- **An 8px spacing grid.**
- **Everything anchored to the edges** — the centre of the screen belongs to the game. Any banner that must cross it lives for **under 1.2 s**.
- **Every piece of text over gameplay carries a subtle shadow** so it survives a bright sky.

Then make the data feel alive:

- Scores **count up with easing** and pop when they change.
- Rewards **fly from the kill to the counter**, and the counter ticks when they land — every effect terminates at the ledger that changed.
- Damage is an **edge vignette with a transparent centre**, never a full-screen red slab.
- **Gauges beat bars.** A radial arc with a tick track, a gradient stroke, a glow and a dot riding the arc's tip, shifting colour as danger closes — same data as a rectangle, ten times the instrument.

**2D:** identical. This is the one layer that is the same in 2D and 3D, because the HUD is DOM either way.

**Perf: `backdrop-filter` is a real GPU cost on phones, and drawing text into a canvas every frame is slow — cache it.**

## Layer 7: Eyes — give the model yours

Here is the meta-problem behind every ugly vibe-coded game: **the model cannot see what it renders.** Tests pass, the build runs, the model reports success, and the game is blurry, z-fighting, and wearing a HUD that says `WAVE undefined`. Nobody looked, so nothing caught it.

- **Run a screenshot loop: change, look, direct, repeat.**
- **Direct like an art director, not a programmer.** "Reduce the bloom about 20 percent." "The trail doesn't start at the nozzle." "The mountains show their bottom edge." Those sentences fix more visual bugs than any prompt engineering.
- **When eyeballing isn't precise enough, calibrate.** Add sliders behind a hidden dev flag, tune the emitters by eye in thirty seconds, and bake the numbers back into code. Expose the tunable, tune it visually, commit the value. Models are excellent at adding dev panels — use that.
- **Test on a real phone early.** The median player is not on the creator's machine. RUN makes this easy: `rundot deploy` privately, open it on the device, and nobody sees it but them.

---

# Part 2 — Mobile fundamentals

RUN games run on phones. Design for **portrait, touch, one-thumb reach**, and for the fact that no two screens are the same size.

## Why mobile is a stricter brief than desktop — and a better one

Mobile isn't a shrunk-down desktop game, and treating it as one is why players bounce before they finish the tutorial. The difference is *habit shape*. Desktop might buy one solid two-hour session, and then you're out of sight until they sit down at a desk again. Mobile fits into the micro-moments of a day — a run on the commute, a claim at lunch, a check before bed — which is **five to eight touchpoints a day instead of one**, and that high-frequency loop is what makes a game sticky in a way desktop struggles to match.

What mobile gives you:

- **Direct tactile feedback.** Tapping, swiping and pinching on glass is a physical connection to the game world that a mouse click can't match — which is why Layer 4's juice pays off harder here.
- **Micro-session pressure.** It forces you to strip clutter and get to instant gratification. A player should be able to open, complete a run or claim a reward, and exit **inside 60 seconds**.
- **Scale.** Everyone carries a phone. A thumb-friendly UI lowers the barrier for millions of casual players who find keyboard hotkeys overwhelming.

The catch: because sessions come in short bursts, the UX has to be *instantaneous*. Clumsy controls or a menu that's a chore to tap through don't cost you a session — they cost you the daily habit, and players abandon it without hesitating. Everything below is in service of that.

## Orientation: portrait-first

- **Default to portrait (9:16).** It's how players hold a phone in a feed, and it's the safe assumption for almost every genre.
- **Use landscape only when the genre genuinely needs it** — e.g. twin-stick action, racing, or side-scrollers where horizontal space is the point. If you go landscape, commit to it and lock it; don't try to support both well with one layout.
- Design UI within the app container (caps at 720×1280, 9:16), not the raw viewport.

## Responsive by anchoring, not absolute placement

The single biggest mobile-layout mistake is positioning UI at fixed pixel coordinates that only look right on the device you tested. Instead:

- **Anchor every HUD element to a corner or edge** (top-left score, bottom-right action button) so it stays put as the screen grows or shrinks. Use `position: absolute` with `top/left/right/bottom` + a margin, not computed x/y.
- **Scale sizes with the viewport, clamped.** Use `clamp(min, vw-based, max)` for font and icon sizes so they grow on tablets and shrink on small phones but never become unreadable or huge.
- **Never hardcode a coordinate** derived from one screen's width/height. If you must place something relative to gameplay, compute it from the current container size (via `ResizeObserver`), not a constant.
- Read the device when you need to branch layout: `RundotGameAPI.system.getDevice()` gives `orientation`, `deviceType`, `screenSize`, `pixelRatio`, and `fontScale`.

See [`mobile-hud.css`](mobile-hud.css) for corner-anchor classes and clamped sizing tokens.

## Safe area — stay out from under notches and host chrome

The host reports insets (device notches + toolbar/feed header). Everything interactive or important must sit inside them.

- Read `RundotGameAPI.system.getSafeArea()` **after the SDK initializes** (never at module top level — it throws pre-init on a real device). It's static; read once and cache.
- Apply it as padding on your HUD root. [`safe-area.ts`](safe-area.ts) exposes it as CSS variables (`--safe-top/right/bottom/left`) so your CSS can anchor against them.

## The thumb zone — place UI by ergonomics, not by taste

**Over 70% of mobile interactions happen with a single thumb.** That thumb sweeps an arc from the bottom corner, so the screen has three bands and each one has a job:

- **Bottom half — primary controls.** Movement stick, attack button, inventory drawer, the main CTA on a menu. Anything tapped repeatedly lives here.
- **Middle — secondary information.** Health bars, status, contextual interactions. Readable, occasionally tappable, not where the thumb rests.
- **Top corners — destructive or rare actions.** Pause, settings, account logout, reset. Put them where the thumb *doesn't* naturally land, deliberately, so nobody quits a run by accident mid-fight.

That last one is the rule creators get backwards most often: awkward placement is a *feature* for anything you don't want mis-tapped.

## Touch-safe sizing — don't make players fat-finger

Fat-finger mistakes are among the fastest ways to lose a mobile player — the game feels broken even though the code is fine.

- **Minimum touch target 44×44px (iOS) / 48×48dp (Android).** Anything smaller is a mis-tap. Pad small icons with a transparent hit area to reach it even if the glyph is smaller.
- **Keep 8–12px of empty space between actionable buttons** so adjacent taps don't collide — especially near the bottom where thumbs land during fast play.
- **Every touch gets instant affordance.** A press animation (`:active` → `transform: scale(0.95)`) fires the moment the finger lands, not when the action resolves, paired with `triggerHapticAsync(HapticFeedbackStyle.Light)` for UI chrome. A button that doesn't react feels broken even when it worked.
- **Keep text legible:** clamp HUD/body text so it never drops below ~14px; use `font-variant-numeric: tabular-nums` for counters and `text-shadow` for contrast over the 3D scene.
- **Respect `fontScale`** (accessibility): if `getDevice().fontScale > 1.2`, prefer a more compact layout so scaled-up text still fits.

## Progressive disclosure — declutter the HUD

A desktop game can afford a HUD full of mini-maps, status effects, quick-slots and chat logs. On a 6-inch phone that destroys clarity, and clarity is the whole game in a 60-second session.

- **Hide secondary menus** inside swipeable drawers or collapsible sub-menus rather than surfacing everything at once.
- **Show information only when it's relevant** — the ammo count appears when aiming or firing, not permanently.
- **One primary CTA per screen** in non-gameplay flows (level select, shop, results). If two things are equally emphasised, neither is.

This is the same discipline as Layer 6: the centre of the screen belongs to the game.

## Interruptions & frictionless resume

Mobile players play on trains, in a coffee queue, in the gap before a meeting. The session *will* be interrupted — the only question is whether it survives it.

- **Auto-save often**, so a call, a low-battery kill or an app switch never costs progress. Persist on `lifecycles.onSleep`; never rely on `onQuit` firing. `rundot-feature-save` ships a versioned `appStorage` save blob with migrations and lifecycle flushing.
- **Design a real pause state** for phone calls and app switches — the game should resume exactly where it left, not restart the level or eat an input.
- **Eliminate tedious text input.** Every on-screen keyboard is a chance to quit. Use choices, defaults, and a randomise button (for names) instead of asking a player to type on glass.

## Canvas sizing & DPI

- **Never call `renderer.setPixelRatio()`** — it silently multiplies sizes and breaks picking/screenshots. Handle DPI manually: cap DPR at 2 (`Math.min(window.devicePixelRatio, 2)`), then `renderer.setSize(w * dpr, h * dpr, false)` and set the canvas CSS size to `w`/`h`. This is Layer 2's pixel-ratio clamp — the same one line fixes blur *and* protects fill rate.
- Use a **`ResizeObserver`** on the container (element-level, fires between layout and paint) rather than `window` resize. [`responsive-canvas.ts`](responsive-canvas.ts) wires this up.

## Interaction & jitter

- Set `touch-action: none` on the canvas/app container to stop browser pan, zoom, and double-tap-to-zoom. Prefer this over `preventDefault()`; if you do call `preventDefault` on touch, register the listener `{ passive: false }`.
- For drag controls (thumbsticks/sliders), attach `mousemove`/`mouseup` to `window`, not the element, or the control sticks when the finger/cursor leaves it. Set `user-select: none` on the HUD root so labels/emoji don't get selected mid-drag.
- Animate **only `transform` and `opacity`** on overlays (compositor-thread) — animating `top`/`left`/`width`/`box-shadow` forces layout and fights the game loop, causing mutual stutter.
- `:hover` doesn't exist on phones — press feedback has to come from `:active`, not hover (see the thumb-zone section above).

## Checklist

```
Look & feel
- [ ] Palette written down at the top of the project; no colour used outside it
- [ ] Shape language decided (spiky/round) and stated in every art prompt
- [ ] ACES tone mapping, antialiasing, DPR clamped to 2
- [ ] Ambient-only lighting replaced with a warm key + cool sky fill
- [ ] One bloom pass; vignette (CSS radial-gradient is fine)
- [ ] Blob shadow under every character and prop
- [ ] Fog matched to horizon, gradient sky, distant ridges tinted toward the sky
- [ ] Path curves; props placed relative to the path, not scattered
- [ ] Hitstop 3–6 frames (20 on kills) + white flash; camera kick under 200ms
- [ ] Haptics on impacts and outcomes, same frame as the hit, with a cooldown
- [ ] Easing on everything; squash/stretch on landings and hits
- [ ] Explosions built as 5 timed beats, mixed sizes, ~25 particles
- [ ] Effect scale matches the value of the moment
- [ ] One display font + one sans; tabular numerals; 8px grid
- [ ] Scores count up and pop; rewards fly to the counter and tick on landing
- [ ] Damage as an edge vignette, never a full-screen red slab
- [ ] Screenshot loop run — a human looked at every state

Mobile
- [ ] A player can open, do one meaningful thing, and exit in under 60 seconds
- [ ] Portrait by default; landscape only if the genre demands it (and then locked)
- [ ] Every HUD element anchored to a corner/edge, not absolute coordinates
- [ ] Font/icon sizes use clamp() — never too small, never oversized
- [ ] Safe-area insets read after init and applied to the HUD
- [ ] Primary controls in the bottom half; destructive/rare actions in the top corners
- [ ] All touch targets ≥ 44×44px (48dp Android), 8–12px apart
- [ ] Press feedback fires on touch-down, not on action resolve (visual + Light haptic)
- [ ] Text ≥ ~14px, tabular-nums on counters, readable over the 3D scene
- [ ] fontScale > 1.2 handled with a compact layout
- [ ] No setPixelRatio; DPR capped at 2; ResizeObserver drives canvas size
- [ ] touch-action: none on the canvas; drag listeners on window
- [ ] Overlays animate transform/opacity only; buttons have an :active state
- [ ] Secondary menus behind drawers; contextual info shown only when relevant
- [ ] One primary CTA per non-gameplay screen
- [ ] Auto-save on onSleep; pause survives a phone call; no typed text input
- [ ] Played on a real phone, one hand, before shipping
```

## Anti-patterns

**Look & feel**

- ❌ Prompting for art without a written palette and shape language — you get the statistical average, which is sky blue and purple.
- ❌ Ambient-only lighting, no tone mapping, uncapped pixel ratio — flat and blurry, and each is a one-line fix.
- ❌ `metalness > 0.1` with no environment map — renders black, looks like a model bug.
- ❌ Objects sitting on a flat plane with no blob shadow, fog, or sky gradient — instant tech-demo read.
- ❌ A dead-straight corridor of randomly scattered props — reads as generated no matter how good the assets are.
- ❌ Impact with no hitstop or flash — the tap feels dead however good the input code is.
- ❌ Shipping without haptics — it's one call, it degrades to a no-op on hosts without hardware, and it's the only feedback channel that isn't competing for screen space.
- ❌ Buzzing on every frame or every UI event — constant haptics read as cheap; give them rhythm and cooldowns.
- ❌ An un-`.catch()`ed `triggerHapticAsync` — a fire-and-forget call that rejects is still an unhandled rejection, and that crashes the game.
- ❌ Reading `getDevice().haptics` at module load — it throws before `initializeAsync` completes.
- ❌ Random screen shake instead of a directional kick, or shake over 200ms.
- ❌ Twenty identical particles fading out together — one loud note instead of a phrase.
- ❌ Uniform particle sizes — the most recognisable amateur tell there is.
- ❌ Celebrating every event equally — when everything is a big moment, nothing is.
- ❌ Arial in a purple box in the middle of the screen; unshadowed text over a bright sky.
- ❌ Shipping without looking — the model can't see the screen, so `WAVE undefined` ships.
- ❌ Guessing at emitter positions repeatedly instead of exposing a dev slider and tuning by eye.

**Mobile**

- ❌ Absolute pixel coordinates from one test device — breaks on every other screen.
- ❌ Supporting portrait and landscape equally with one layout — pick one.
- ❌ Icons/buttons under 44px or crowded closer than ~8px — guaranteed mis-taps.
- ❌ Pause, settings or reset placed in the thumb's natural arc — players will end runs by accident.
- ❌ Porting a desktop HUD wholesale — mini-map, quick-slots, status row and chat on a 6-inch screen leaves no game.
- ❌ Two equally-weighted CTAs on a menu screen — the player picks neither.
- ❌ Losing progress to a phone call or an app switch — auto-save on `onSleep`, don't trust `onQuit`.
- ❌ Asking a player to type on glass when a choice, a default, or a randomise button would do.
- ❌ Ignoring safe area — UI hides under the notch or host toolbar.
- ❌ `renderer.setPixelRatio()` or uncapped DPR — kills fill rate on 3x phones.
- ❌ Animating layout properties on overlays — stutter against the render loop.
- ❌ Relying on `:hover` for feedback, or no press feedback at all.
- ❌ Never opening the game on a real phone — every problem above stays invisible.

## Resources

- [safe-area.ts](safe-area.ts) — read host insets after init and expose as CSS variables.
- [responsive-canvas.ts](responsive-canvas.ts) — `ResizeObserver`-based canvas sizing with DPR capped at 2.
- [mobile-hud.css](mobile-hud.css) — corner-anchor classes, clamped sizing tokens, touch-target + press-feedback patterns.
- **[Designing for the Thumb: How to Master Mobile Game UX](https://run.world/blog/designing-for-the-thumb-how-to-master-mobile-game-ux-and-why-it-beats-desktop/)** — the RUN blog post behind Part 2: thumb zones, touch targets, progressive disclosure, and designing for interruption.
- `rundot-feature-save` — versioned `appStorage` save blob with lifecycle flushing, for frictionless resume.
- `rundot-sdk` — `triggerHapticAsync`, `getDevice()` boot order, and the error-handling posture every SDK call needs.
- **[Your Game Is Not Ugly, It Is Unfinished](https://run.world/blog/your-game-is-not-ugly-it-is-unfinished/)** — the RUN blog post the seven layers come from, with side-by-side demos of each layer and a downloadable model-facing spec.
- Further reading on juice: Vlambeer's *The Art of Screenshake*, and Jonasson & Purho's *Juice It or Lose It* — twenty minutes each, both worth the time.
