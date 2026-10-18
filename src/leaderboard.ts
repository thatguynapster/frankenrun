// Best finish time per preset route, on the RUN leaderboard (one board "mode" per route, lowest time ranks first).
// The score is the finish time in milliseconds. Config: rundot/leaderboard.config.json (kept in step with src/routes.ts).
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';

/** The leaderboard is built but switched off for now: no Best times button, no results line, no submissions. */
export const SHOW_LEADERBOARD = false;

export type BoardPeriod = 'alltime' | 'weekly';

export interface BoardEntry {
  readonly rank: number;
  readonly name: string;
  readonly ms: number;
  readonly mine: boolean;
}

export interface Board {
  readonly entries: readonly BoardEntry[];
  /** The player's own rank on this board, or null when they have not finished it. */
  readonly myRank: number | null;
  readonly total: number;
}

export interface Submission {
  readonly accepted: boolean;
  readonly rank: number | null;
  /** The platform's reason when the time was not recorded (for example it was not a personal best). */
  readonly reason: string;
}

/** A board call that hangs must not leave the screen waiting forever. */
const within = <T>(promise: Promise<T>, ms = 10000): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('leaderboard timed out')), ms))]);

export const formatTime = (ms: number): string => {
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  return `${m}:${(total - m * 60).toFixed(1).padStart(4, '0')}`;
};

/** Records a finish time. Never throws: a board that is unreachable just means no ranking this time. */
export async function submitTime(route: string, ms: number, meta: Record<string, string | number | boolean>): Promise<Submission | null> {
  try {
    await RundotGameAPI.initializeAsync();
    // One submission feeds every period of the route's board (all time and this week).
    const r = await within(RundotGameAPI.leaderboard.submitScore({ score: Math.round(ms), duration: Math.round(ms / 1000), mode: route, metadata: meta }));
    return { accepted: r.accepted, rank: r.accepted ? (r.rank ?? null) : null, reason: r.reason ?? '' };
  } catch (e) {
    console.warn('[leaderboard] submit failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** The top times on a route plus the player's rank. Returns null when the board cannot be reached. */
export async function loadBoard(route: string, period: BoardPeriod, limit = 10): Promise<Board | null> {
  try {
    await RundotGameAPI.initializeAsync();
    const me = RundotGameAPI.getProfile().id;
    const page = await within(RundotGameAPI.leaderboard.getPagedScores({ mode: route, period, limit }));
    return {
      entries: page.entries.map((e, i) => ({ rank: e.rank ?? i + 1, name: e.username, ms: e.score, mine: e.profileId === me })),
      myRank: page.playerRank ?? null,
      total: page.totalEntries,
    };
  } catch (e) {
    console.warn('[leaderboard] load failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
