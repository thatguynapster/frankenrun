---
name: rundot-analytics
description: >-
  Instrument a RUN.game title with telemetry, funnels, crash/error capture, and
  A/B experiment exposure through the RUN SDK analytics API. Use when adding or
  auditing analytics, tracking events, building conversion funnels (login, FTUE,
  purchase), capturing crashes/errors, wiring experiments/feature flags, or when
  the user mentions analytics, telemetry, events, tracking, funnels, or metrics.
---

# RUN.game Analytics & Telemetry

Give a RUN game the telemetry it needs to be understood and improved: what players do, where they drop off, what breaks, and which experiment variants win. This skill enforces a **standard event taxonomy** and ships a **ready-to-paste wrapper** so data is consistent and queryable across every title.

**Tell the creator up front: this is ~15 minutes of work, not a project.** The wrapper is drop-in, the calls are one-liners at moments the code already knows about (level start, first tap, run finished), and there's nothing to design. Never present instrumentation as a half-day or a big lift — creators defer "big" tasks, and deferring this one blinds every later decision. Small caveat, honestly stated: a *fully* granular FTUE funnel on a complex game can take longer, but the required coverage below is minutes.

## Coaching approach — ask, teach, reveal blind spots

Don't just wire up events silently. Use this as a chance to teach the creator *what to measure and why*, and to surface questions they haven't thought to ask. Instrumentation only pays off if they know what decisions the data will drive.

Ask as you go (a couple at a time, not all at once):

- What's the one question about your players you most wish you could answer right now?
- What does a "good" session look like to you — and how would you know if it happened?
- Where do you *think* players drop off? (Then: the funnel will tell us if you're right.)
- If the game crashed for 10% of players, would you currently know? How?
- When you change something, how will you tell if it made the game better or worse?

Teach the why: events are worthless unless someone reads them and acts. A crash you can't see is churn you can't explain. A funnel is how you find the exact beat that's losing players instead of guessing. Name the blind spot most first-timers miss — *they ship with no crash capture and no FTUE funnel, then wonder why D1 is low with no way to investigate.*

## Step 0 — Check what already exists first

Many RUN templates ship basic analytics. Do NOT duplicate them. Before writing anything:

1. Look for an `src/analytics/` folder or any `recordCustomEvent` / `trackFunnelStep` calls.
2. If present, **audit** it against the [coverage checklist](#required-coverage) and fill gaps. Keep the existing wrapper/naming conventions.
3. If absent, drop in [`analytics.ts`](analytics.ts) and wire the required coverage.

## The RUN analytics primitives

```typescript
import RundotGameAPI from '@series-inc/rundot-game-sdk/api'

// Structured, queryable telemetry (fire-and-forget — never rejects fatally, but swallow anyway)
RundotGameAPI.analytics.recordCustomEvent('level_complete', { level: 5, score: 1200 })
RundotGameAPI.analytics.trackFunnelStep(2, 'tutorial_movement', 'ftue', 1)

// Debug/support logs — flat STRINGS, NOT queryable fields
RundotGameAPI.log('scene ready', { level: 1 })
RundotGameAPI.error('asset failed', err)

// Experiment/flag resolution (see event-catalog.md) — exposure auto-recorded
const { values } = await RundotGameAPI.liveops.getConfigAsync()
```

**The one rule that matters most:** `log`/`error` produce flattened strings for humans debugging; `recordCustomEvent` produces structured fields you can filter and aggregate in dashboards. For anything you want to **query** (including crashes), use `recordCustomEvent`. For a crash you also want visible in mobile support logs, fire **both**.

Custom events only surface in *dashboards* after the RUN Operators team is told the event name exists — note this to the user when defining new events. The **CLI needs no such step**: `rundot analytics export custom_event_metrics_30d` returns p50/p75/p90/p95/p99 for the numeric parameters on your custom events, sliced by platform and game version, as soon as the events land. Two rules make a param readable: send it **flat and numeric** (`load_ms: 200`, never `timings: { load_ms: 200 }` — a nested object cannot be measured), and expect the export to be **capped** (top 25 events, 20 params each, 10 most recent versions; `rundot analytics queries` prints the current caps). That is why numeric payload values (`load_ms`, `retry_count`, `score`) are worth sending — a string param can be counted, but only a numeric one can be measured.

## Required coverage

Every title should be emitting these. Audit for each; add what's missing.

```
- [ ] session_start           — once per session (app opened / became playable)
- [ ] login / auth funnel     — funnel 'auth', if the game has any gated entry
- [ ] ftue funnel             — funnel 'ftue', granular + linear + once-ever (see FTUE below)
- [ ] core gameplay actions   — level_start / level_complete / level_failed, key verbs
- [ ] progression milestones  — first_win, level unlocks, big-number thresholds
- [ ] monetization events     — ad_shown/ad_reward, purchase funnel + purchase_complete
- [ ] error_occurred          — try/catch failures + window error + unhandledrejection
- [ ] experiment exposure     — auto-recorded by liveops.getConfigAsync (see Experiments)
```

Full names, payload fields, and funnel step tables are in [event-catalog.md](event-catalog.md). Use it as the source of truth so games stay comparable.

## Naming rules (non-negotiable)

- Event and funnel names are **stable `snake_case`** (`boss_defeated`, never `Event1` or `bossDefeated`). Renaming later breaks historical queries.
- Payload keys are `snake_case`. Send IDs, not blobs (`level_id: 'w3_l2'`, not the whole level object).
- Funnel **step numbers are fixed** once shipped. `funnelOrder` positions a funnel in the overall journey (auth=0, ftue=1, purchase=2…) and must be consistent across all steps of that funnel.

## Instrumentation patterns

Use the helpers in [`analytics.ts`](analytics.ts) rather than calling the SDK ad hoc — it swallows fire-and-forget rejections and centralizes naming.

**Wrap the SDK once:**
```typescript
import { trackEvent, trackFunnel } from './analytics/analytics'

trackEvent('wave_cleared', { wave: 4, remaining_hp: 12 })
trackFunnel(3, 'checkout_started', 'purchase', 2, { item_id: 'gold_100' })
```

**Crashes & errors — install once at startup, and wrap risky calls:**
```typescript
import { installErrorCapture, trackError } from './analytics/analytics'

installErrorCapture() // window 'error' + 'unhandledrejection' → error_occurred

try {
  await pack.loadMesh('boss')
} catch (err) {
  trackError('load_boss_mesh', err) // logs via error() AND records error_occurred
}
```

**The boot triad — the first three events of every game:** before anything else, fire `load_started` (the literal first call the game makes), `load_finished`, and `first_tap` (first player input). These should land within seconds of each other for every session. Their value is diagnostic: if something is broken at load — a crash, an asset stall, a platform regression — the gap between these steps is the only place you'll see it. A game whose sessions suddenly shorten to a few seconds with no boot triad is un-diagnosable; with it, you can tell "never loaded" from "loaded and bounced" in one export.

**A funnel must be registered, and boot-only doesn't count:** raw events firing is not the same as a funnel existing — steps only show up as a funnel when they're wired through `trackFunnelStep` with a shared funnel name and fixed step numbers. Two common failure modes to audit for:
- **Events without a funnel:** `ftue_*` / `first_*` / `run_*` events fire as `recordCustomEvent` but no funnel is defined over them. The fix is cheap — register funnel steps over events that already exist; no new instrumentation needed. This single change unblocks diagnosis.
- **Boot-only funnel:** a funnel whose only step is `game_loaded`. It can prove 100% of sessions loaded and nothing else — no first action, no first completion, no drop-off. Every funnel needs **≥3 steps** minimum: loaded → first action → first completion (e.g. `game_loaded → run_started → run_finished`).

**FTUE / login funnels — granular, linear, once-ever:** the FTUE funnel is the most important funnel in a new game. Instrument it so it reads as a clean funnel:

- **Granular:** every discrete beat is its own step — each tutorial text shown AND dismissed, first enemy spawns AND dies, first reward, first tap. Do not collapse "the tutorial" into one step. Expect 15–40+ steps, not a handful.
- **Linear:** fixed order, numbered sequentially, no branches. Step N+1 only after step N.
- **Once-ever:** each step fires the first time it happens and never again, or reinstalls/replays pollute the funnel.

Use `trackFunnelStepOnce`, which persists marks in `localStorage`. Correct instrumentation yields **monotonically decreasing** step counts.
```typescript
import { trackFunnelStepOnce } from './analytics/analytics'

trackFunnelStepOnce(1, 'ftue_load_complete', 'ftue', 'ftue_load', 1)
trackFunnelStepOnce(2, 'ftue_tutorial_01_shown', 'ftue', 'ftue_tut01_shown', 1)
trackFunnelStepOnce(3, 'ftue_tutorial_01_dismissed', 'ftue', 'ftue_tut01_dismissed', 1)
trackFunnelStepOnce(4, 'ftue_first_enemy_spawned', 'ftue', 'ftue_enemy_spawn', 1)
trackFunnelStepOnce(5, 'ftue_first_enemy_defeated', 'ftue', 'ftue_enemy_dead', 1)
```

**Flush on background:** batch nothing critical mid-frame; lifecycle hooks are the safe flush point.
```typescript
RundotGameAPI.lifecycles.onSleep(() => trackEvent('session_pause'))
RundotGameAPI.lifecycles.onQuit(() => trackEvent('session_end'))
```

## Experiments & feature flags

Creator A/B tests run on **LiveOps**: `liveops.getConfigAsync()` resolves config values with deterministic experiment `assignments`, and the platform records `liveops_experiment_exposure` **automatically** when an assignment resolves — never fire your own exposure event.
```typescript
const { values, assignments } = await RundotGameAPI.liveops.getConfigAsync()
// `values` already includes assigned variant values; exposure is auto-recorded.
```
(`RundotGameAPI.getExperiment` is deprecated, platform-managed-only — don't wire it into new games.)

`getFeatureFlag` / `getFeatureGate` return plain booleans — build a fallback for when a flag is rolled off. Details and the exposure event schema are in [event-catalog.md](event-catalog.md).

## Read funnel data (RUN CLI)

Don't guess where players drop — **pull the funnel from RUN** before recommending FTUE fixes. Requires `export RUNDOT_BETA_FEATURES=1` and owner/editor access on the game.

```bash
export RUNDOT_BETA_FEATURES=1
rundot list-games                                          # find --game-id
rundot analytics queries                                   # list exportable queries
rundot analytics export funnel_steps_30d --game-id <id>    # funnel step counts + conversion %
rundot analytics export retention_by_platform_30d --game-id <id>
rundot analytics export error_breakdown_7d --game-id <id>  # crashes while diagnosing churn
```

**`funnel_steps_30d` columns:** `funnel_name`, `step_number`, `step_name`, `unique_sessions`, `unique_players`, `previous_step_sessions`, `step_conversion_pct`.

**How to read it:**
- **Know which build was live.** Exports are a time window, not a live snapshot of today's code. Cross-check campaign dates, last `rundot deploy`, and the creator profile check-in log. The step counts that matter for a diagnosis are from sessions on the build *after* the fix — until then, you're mostly looking at the old broken experience.
- **Fixes lag in the data.** If a funnel or retention fix shipped recently, assume metrics are stale until fresh traffic accumulates (~50 sessions on the changed funnel is a reasonable re-check threshold; retention needs longer). Don't recommend pivots or scale-up off pre-fix numbers alone.
- Filter rows where `funnel_name` is `ftue` (or `onboarding` if the game uses a separate granular funnel).
- Steps should be **monotonically decreasing** in `unique_sessions`. If step N+1 has *more* sessions than step N, the funnel ordering or once-ever dedup is wrong — fix instrumentation before trusting the data.
- The **largest % drop** between consecutive steps is the priority fix. Cross-check with the `onboarding` funnel if the game has finer-grained tutorial steps.
- Pair with `retention_by_platform_30d` — low D1 on the platform you bought traffic on (e.g. mobile-web) tells you whether UA audience matches who actually retains.

Summarize the funnel back to the creator: step counts, the biggest drop, and whether the shape is trustworthy (monotonic or broken). Route product fixes to `rundot-ftue-onboarding`; route instrumentation fixes here.

## After deploying instrumentation — verify events actually arrive

Shipping the code is not the finish line; events only exist once a real session on the **live public build** fires them. A depressingly common failure chain: the agent claims it deployed → it actually deployed privately (or not at all) → nobody plays the new build → the new steps never appear → the creator waits days for data that will never come. Close the loop the same day:

1. **Confirm the deploy is public** — check the live game page, not the deploy log or the agent's word.
2. **Play one session on the live build yourself** so every new event and funnel step fires at least once.
3. **Re-export** (`rundot analytics export funnel_steps_30d`) and confirm the new steps appear. If your test session's steps aren't there, the instrumentation or the deploy is broken — find out now, not after a week of empty data.

## Audit workflow

When asked to review a game's analytics:

```
- [ ] Pull funnel_steps_30d + retention_by_platform_30d via rundot analytics export (don't rely on creator memory)
- [ ] Note which build/deploy was live when the bulk of that data was collected; flag if a fix shipped after that window
- [ ] Locate existing analytics wrapper / raw SDK calls
- [ ] Map current events against event-catalog.md; list gaps
- [ ] Flag non-snake_case, unstable, or blob-payload events
- [ ] Verify FTUE funnel is granular, linear, once-ever (counts should decrease monotonically)
- [ ] Confirm error_occurred covers try/catch + window + unhandledrejection
- [ ] Confirm experiments read via liveops.getConfigAsync (exposure is auto-recorded)
- [ ] Confirm session_start + lifecycle flush exist
- [ ] Report findings; apply fixes reusing the existing wrapper
```

## Anti-patterns

- ❌ Reading funnel_steps_30d without checking whether a recent fix has had time to accumulate new sessions — old exports describe the old build.
- ❌ Putting queryable data only in `log()` strings — it can't be aggregated. Use `recordCustomEvent`.
- ❌ Renaming/renumbering events or funnel steps after launch — breaks trend data.
- ❌ Firing FTUE/login funnel steps on every play — inflates the funnel; dedup once-ever.
- ❌ Collapsing the FTUE into a few coarse steps — you lose the ability to see *which* beat loses players. Instrument every beat.
- ❌ A boot-only funnel (single `game_loaded` step) — it can only prove the app loaded. Minimum 3 steps: loaded → first action → first completion.
- ❌ Firing rich raw events but never registering a funnel over them — the data exists but drop-off is invisible. Register funnels over events that already fire before adding new instrumentation.
- ❌ Declaring instrumentation "done" at deploy time without playing a live session and confirming the new steps appear in an export — private/failed deploys fire nothing, and agents sometimes report deploys that didn't happen.
- ❌ Awaiting analytics in the game loop or `.catch()`-ing manually everywhere — use the swallowing wrapper.
- ❌ Sending whole objects as payloads — send IDs and scalars.
- ❌ Reading an experiment without recording exposure — you can't measure impact.

## Resources

- [event-catalog.md](event-catalog.md) — standard event names, payloads, and funnel step tables.
- [analytics.ts](analytics.ts) — drop-in wrapper (`trackEvent`, `trackFunnel`, `trackFunnelStepOnce`, `trackError`, `installErrorCapture`).
- `rundot-marketing-social` — once instrumented, always run `rundot socials prepare` to drive free sessions and populate the funnels you're measuring.
