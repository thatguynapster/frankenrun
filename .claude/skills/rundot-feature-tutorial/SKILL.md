---
name: rundot-feature-tutorial
description: Add a tutorial to a RUN game — data-driven message sequences with a box-shadow spotlight/cutout renderer and show-once persistence, entirely SDK-free. Ships copy-in TypeScript templates extracted from a shipped RUN game plus an AI-first integration guide. Use when a creator wants onboarding, FTUE, a guided tour, button highlighting or spotlights, or a tooltip sequence for new players.
---

# Add a tutorial to a RUN game

Copy-in implementation extracted from a shipped RUN game. The authoritative
integration guide is `systems/tutorial/README.md` — read it top to bottom
before writing code. It derives every game-specific decision (which sequences
exist, what each spotlights, when they trigger) from the host game's own code,
so you should not need to ask the developer questions.

## What's in this skill

| Path | What |
|---|---|
| `systems/tutorial/README.md` | Full integration guide: wiring steps, config reference, derive-from-host table, verification checklist |
| `systems/tutorial/tutorial.ts` | Overlay core: message sequences, spotlight targeting, show-once set (no SDK dependency) |
| `systems/tutorial/tutorial.html` | Overlay markup to paste as the last child of the host's `<body>` |
| `systems/tutorial/tutorial.css` | Mask, spotlight cutout, speech card, and arrow styling |

## How to integrate (summary — the README is authoritative)

1. Read `systems/tutorial/README.md` fully.
2. Inventory the host game: rendering/UI approach, where
   `RundotGameAPI.initializeAsync()` is awaited, whether a per-frame
   `update(dt)` loop exists, and any existing persistence to integrate with.
3. Copy the templates into the host (suggested home: `src/helpers/tutorial/`),
   keeping file names. If the host is plain JavaScript, strip the type
   annotations while copying — the runtime code is identical.
4. Adapt every `ADAPT:` comment; game-specific content goes in the
   `create...(config)` factory config, machinery below it should not change.
5. Wire per the README's numbered steps, then run its verification checklist —
   actually play through a sequence on a fresh profile, don't just confirm it
   compiles.

## What to put in the sequences (design, not machinery)

This skill gives you the renderer; it does not decide what to teach. Before
authoring the `create...(config)` content, read `rundot-ftue-onboarding` — the
design framework the sequences should obey. The rules that most often change
what you write here:

- **Show, don't tell.** If the player can learn it by tapping, dragging,
  building or merging, make them do it. A spotlight plus three words beats a
  card of prose — and every extra step is another chance to quit.
- **Teach contextually.** One sequence per moment the system first matters,
  triggered then — not a run of cards at boot. Most systems should start locked.
- **Mark the target unmissably.** The spotlight cutout is the point: pair it
  with the host's own highlight/`!` affordance so the next action reads even
  with the overlay dismissed.
- **No foot-guns during onboarding.** Don't spotlight a button that can waste
  currency, sell an essential, or take a dead-end upgrade.
- **Hand off to quests.** The scripted sequences end early; early quests carry
  the teaching from there (`rundot-feature-daily-quests`).
- **Instrument each sequence** as an ordered, once-ever FTUE funnel step, and
  **re-map the funnel in the same commit** whenever you add, merge or reorder a
  sequence — otherwise you're measuring an onboarding flow that no longer
  exists. Target 50–60%+ tutorial completion (`rundot-analytics`).

## Global RUN rules (always apply)

- Every `RundotGameAPI` call can reject, and an unhandled rejection crashes
  the game — keep the template's try/catch posture in code you add.
- Await `RundotGameAPI.initializeAsync()` once at boot before any other SDK call.
- Degrade gracefully outside the RUN host: local dev uses deterministic SDK
  mocks; follow the feature README for expected behavior, and treat unexpected
  `null`/failure as "unknown", never as an error state.
- Persist aggressively on `lifecycles.onSleep` (that's what it's for); never
  rely on `onQuit` firing. Don't fire other fresh SDK RPCs (e.g. scheduling
  notifications) from `onSleep`/`onQuit` — a hard close tears down the runtime
  before the RPC lands; do that work while the app is alive.

## Related skills

The show-once set persists in a save blob: `rundot-feature-save`.
Design of the sequences themselves: `rundot-ftue-onboarding`.
Funnel instrumentation for each beat: `rundot-analytics`.

**[Tutorials That Don't Suck](https://run.world/blog/tutorials-that-dont-suck/)**
— the RUN blog post behind the design rules above, worked through
[Dead Stop](https://w.run/ohaimark/dead-stop-td).
