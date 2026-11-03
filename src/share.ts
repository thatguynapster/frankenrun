// Sharing: a link that opens the game on a friend's phone, and a result post. Both use the platform's share links;
// a room link carries the room code so the game can offer to join it on launch.
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';

export interface Invite {
  readonly room: string;
  /** The host's gametag, for the confirmation ("Join Kwame's race?"). May be empty. */
  readonly host: string;
}

const ROOM_CODE = /^[A-Z0-9]{3,8}$/;

const clean = (value: unknown, max: number): string =>
  // eslint-disable-next-line no-control-regex
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';

/** Reads how the game was launched. Returns the room to offer, or null for any other kind of start. */
export async function readInvite(): Promise<Invite | null> {
  try {
    await RundotGameAPI.initializeAsync();
    let intent = await RundotGameAPI.app.resolveLaunchIntent({ maxWaitMs: 800 });
    if (intent.kind === 'timed_out') intent = await RundotGameAPI.app.resolveLaunchIntent({ maxWaitMs: 1500 });
    if (intent.kind !== 'share' && intent.kind !== 'deeplink') return null;
    const room = clean(intent.params['room'], 8).toUpperCase();
    if (intent.params['kind'] !== 'room' || !ROOM_CODE.test(room)) return null;
    return { room, host: clean(intent.params['host'], 24) };
  } catch {
    return null; // no launch info is the normal case outside a share
  }
}

export interface ShareOutcome {
  readonly ok: boolean;
  /** The platform's error text when the link could not be made (shown so a failure can be diagnosed). */
  readonly error: string;
  readonly url: string;
}

async function share(params: Record<string, string>, title: string, description: string): Promise<ShareOutcome> {
  try {
    await RundotGameAPI.initializeAsync();
    const result = await RundotGameAPI.social.shareLinkAsync({ shareParams: params, metadata: { title, description } });
    return { ok: true, error: '', url: result.shareUrl };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[share] shareLinkAsync failed:', error, e);
    return { ok: false, error: error.slice(0, 160), url: '' };
  }
}

/** Invites a friend to the room. On a phone this opens the share sheet; on a computer it copies the link. */
export function shareRoom(code: string, hostName: string): Promise<ShareOutcome> {
  return share(
    { kind: 'room', room: code, host: hostName },
    'Race me in Frankenrun!',
    hostName ? `${hostName} is stitching a monster and racing through the streets of Accra. Join room ${code}.` : `Stitch a monster and race through the streets of Accra. Join room ${code}.`,
  );
}

export interface ResultSummary {
  readonly place: number;
  readonly racers: number;
  readonly seconds: number;
  readonly partsLost: number;
  readonly partsStolen: number;
}

const ordinal = (n: number): string => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/** Shares how a race went, with a link back into the game. */
export function shareResult(r: ResultSummary): Promise<ShareOutcome> {
  const title = r.place === 1 ? `I won a Frankenrun race in ${r.seconds.toFixed(1)}s!` : `I finished ${ordinal(r.place)} of ${r.racers} in Frankenrun (${r.seconds.toFixed(1)}s)`;
  const description = `Lost ${r.partsLost} ${r.partsLost === 1 ? 'part' : 'parts'}, stole ${r.partsStolen}. Think you can beat it? Stitch a monster and race through Accra.`;
  return share({ kind: 'result', place: String(r.place), time: r.seconds.toFixed(1) }, title, description);
}
