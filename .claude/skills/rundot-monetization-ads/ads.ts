import RundotGameAPI from '@series-inc/rundot-game-sdk/api';

/**
 * Ad monetization helper for RUN games.
 *
 * - Rewarded ads: preflight + grant ONLY when the reward was actually earned.
 * - Interstitials: enforce a frequency cap so you never spam forced ads.
 * - Every placement is attributed (adDisplayId) and fires the analytics
 *   catalog's monetization taxonomy (`ad_requested` / `ad_shown` /
 *   `ad_reward_granted` / `ad_failed` — see rundot-analytics/event-catalog.md).
 *
 * Ads do not show on Desktop and are hidden for platform subscribers — both
 * cases resolve `false`, so treat the boolean as your grant/shown gate, never
 * as "an ad definitely played".
 */

function track(name: string, payload?: Record<string, string | number | boolean>): void {
  try {
    void Promise.resolve(RundotGameAPI.analytics?.recordCustomEvent?.(name, payload)).catch(() => {});
  } catch {
    /* analytics must never break gameplay */
  }
}

// ---- Rewarded ads ---------------------------------------------------------

export async function isRewardedReady(): Promise<boolean> {
  try {
    return await RundotGameAPI.ads.isRewardedAdReadyAsync();
  } catch {
    return false;
  }
}

/**
 * Show a rewarded ad for a placement. Resolves `true` ONLY when the reward was
 * earned — call your grant logic on `true`, never otherwise.
 */
export async function showRewarded(placement: {
  id: string;
  name?: string;
  rewardId?: string;
}): Promise<boolean> {
  track('ad_requested', { placement: placement.id, type: 'rewarded' });
  try {
    if (!(await RundotGameAPI.ads.isRewardedAdReadyAsync())) {
      track('ad_failed', { placement: placement.id, type: 'rewarded', reason: 'unavailable' });
      return false;
    }
    const earned = await RundotGameAPI.ads.showRewardedAdAsync({
      adDisplayId: placement.id,
      adDisplayName: placement.name ?? placement.id,
    });
    if (earned) {
      track('ad_shown', { placement: placement.id, type: 'rewarded' });
      track('ad_reward_granted', { placement: placement.id, reward_id: placement.rewardId ?? placement.id });
    } else {
      track('ad_failed', { placement: placement.id, type: 'rewarded', reason: 'abandoned' });
    }
    return earned;
  } catch {
    track('ad_failed', { placement: placement.id, type: 'rewarded', reason: 'error' });
    return false;
  }
}

// ---- Interstitials (frequency-capped) -------------------------------------

/** Minimum seconds between interstitials. Tune per genre/audience. */
const MIN_INTERSTITIAL_INTERVAL_S = 75;
/** Suppress interstitials for the first N sessions to protect new players. */
const SUPPRESS_FIRST_SESSIONS = 2;

const SESSION_COUNT_KEY = 'ad_session_count';

let lastInterstitialAt = 0;
// localStorage is NOT available in the game iframe — session count lives in
// appStorage (per-player, survives reinstall), cached here for sync reads.
let sessionCountCache: number | null = null;

async function readSessionCount(): Promise<number> {
  try {
    const raw = await RundotGameAPI.appStorage.getItem(SESSION_COUNT_KEY);
    const n = raw == null ? 0 : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Call once per session start (e.g. alongside your session_start event). */
export async function noteSessionStart(): Promise<void> {
  const next = (await readSessionCount()) + 1;
  sessionCountCache = next;
  try {
    await RundotGameAPI.appStorage.setItem(SESSION_COUNT_KEY, String(next));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * Show an interstitial at a natural break IF the frequency cap allows it.
 * Returns true if an ad was actually displayed.
 */
export async function maybeShowInterstitial(placement: {
  id: string;
  name?: string;
}): Promise<boolean> {
  const sessions = sessionCountCache ?? (sessionCountCache = await readSessionCount());
  if (sessions <= SUPPRESS_FIRST_SESSIONS) return false;

  const now = Date.now();
  if (now - lastInterstitialAt < MIN_INTERSTITIAL_INTERVAL_S * 1000) return false;

  // Frequency-cap early returns above aren't requests; past them, we are.
  track('ad_requested', { placement: placement.id, type: 'interstitial' });
  try {
    if (!(await RundotGameAPI.ads.isInterstitialAdReadyAsync())) {
      track('ad_failed', { placement: placement.id, type: 'interstitial', reason: 'unavailable' });
      return false;
    }
    const shown = await RundotGameAPI.ads.showInterstitialAd({
      adDisplayId: placement.id,
      adDisplayName: placement.name ?? placement.id,
    });
    if (shown) {
      lastInterstitialAt = now;
      track('ad_shown', { placement: placement.id, type: 'interstitial' });
    } else {
      track('ad_failed', { placement: placement.id, type: 'interstitial', reason: 'not_shown' });
    }
    return shown;
  } catch {
    track('ad_failed', { placement: placement.id, type: 'interstitial', reason: 'error' });
    return false;
  }
}
