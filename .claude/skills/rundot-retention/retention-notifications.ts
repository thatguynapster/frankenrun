/**
 * Drop-in return-notification scheduler for a RUN.game title.
 *
 * Copy into `src/retention/retention-notifications.ts`. Schedules a friendly
 * re-engagement cadence anchored to the player's most recent session, and
 * attributes notification-driven returns. Edit RETURN_NOTIFICATIONS
 * copy/cadence to the game's voice — keep it short so players don't opt out.
 */
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';

const HOUR = 60 * 60;

export interface ReturnNotification {
  id: string;
  title: string;
  body: string;
  delaySeconds: number;
}

/** Lapse cadence, re-anchored to every session. Keep the list short. */
export const RETURN_NOTIFICATIONS: ReturnNotification[] = [
  { id: 'day1', title: 'Your castle awaits', body: 'Come back and claim your daily reward!', delaySeconds: 24 * HOUR },
  { id: 'day2', title: 'We miss you', body: 'Your streak is waiting — one quick run?', delaySeconds: 48 * HOUR },
  { id: 'day3', title: 'New tides rolling in', body: 'Jump back in before your progress cools off.', delaySeconds: 72 * HOUR },
];

function notifId(id: string): string {
  return `retention_${id}`;
}

async function schedule(n: ReturnNotification): Promise<void> {
  await RundotGameAPI.notifications.scheduleAsync(n.title, n.body, n.delaySeconds, notifId(n.id), {
    groupId: 'retention',
    payload: { retention_id: n.id },
  });
}

/**
 * Re-anchor the whole return cadence to *now*. Call once at session START:
 * - Session-end hooks (`onSleep`/`onQuit`) are unreliable for RPCs — a hard
 *   close tears down the runtime before the schedule call lands.
 * - Re-anchoring every entry keeps lapse nudges honest: an active player's
 *   48h/72h "we miss you" reminders keep sliding forward and never fire.
 */
export async function refreshReturnNotifications(): Promise<void> {
  try {
    for (const n of RETURN_NOTIFICATIONS) {
      await RundotGameAPI.notifications.cancelNotification(notifId(n.id));
    }
    for (const n of RETURN_NOTIFICATIONS) {
      await schedule(n);
    }
  } catch (err) {
    RundotGameAPI.error('retention: failed to refresh notifications', err);
  }
}

/** Cancel a scheduled reminder once its task is done (e.g. the daily reward was claimed). */
export async function cancelReturnNotification(id: string): Promise<void> {
  try {
    await RundotGameAPI.notifications.cancelNotification(notifId(id));
  } catch (err) {
    RundotGameAPI.error('retention: failed to cancel notification', err);
  }
}

/**
 * Detect a notification-launched session. Call once at startup. Returns the
 * retention id that opened the app (for deep-linking + attribution), or null.
 */
export async function resolveReturnNotificationLaunch(): Promise<string | null> {
  try {
    const intent = await RundotGameAPI.app.resolveLaunchIntent({ maxWaitMs: 800 });
    if (intent.kind !== 'notification') return null;
    const id = intent.params?.['retention_id'];
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}
