import RundotGameAPI from '@series-inc/rundot-game-sdk/api';

/**
 * Shop purchase helper for RUN games.
 *
 * Wraps `RundotGameAPI.shop.purchase` with:
 *  - an idempotency key (prevents double charges on retry),
 *  - automatic stale-catalog re-fetch + one retry,
 *  - client-side analytics funnel events.
 *
 * The platform records server-side purchase/refund analytics automatically;
 * these client events cover the store *conversion funnel* (view → click → buy).
 */

function track(name: string, payload?: Record<string, string | number | boolean>): void {
  try {
    void Promise.resolve(RundotGameAPI.analytics?.recordCustomEvent?.(name, payload)).catch(() => {});
  } catch {
    /* analytics must never break the store */
  }
}

function trackPurchaseFunnelStep(
  step: number,
  name: string,
  payload?: Record<string, string | number | boolean>,
): void {
  try {
    void Promise.resolve(RundotGameAPI.analytics?.trackFunnelStep?.(step, name, 'purchase', 2)).catch(() => {});
  } catch {
    /* analytics must never break the store */
  }
  track(name, { funnel: 'purchase', funnel_step: step, ...payload });
}

function isStaleCatalogError(err: unknown): boolean {
  // The SDK surfaces this as a RundotApiError with code 'stale_catalog';
  // don't match on the human-readable message, it's not contractual.
  return (err as { code?: string } | null)?.code === 'stale_catalog';
}

/**
 * Legacy cancel path. Current SDKs resolve a dismissed top-up paywall as
 * `{ success: false, cancelled: true }`; hosts paired with an older SDK copy
 * still reject with this code. Kept so the wrapper behaves identically on both.
 */
function isUserCancelledError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'USER_CANCELLED';
}

export interface BuyResult {
  success: boolean;
  order?: Extract<
    Awaited<ReturnType<typeof RundotGameAPI.shop.purchase>>,
    { success: true }
  >['order'];
  reason?: 'cancelled' | 'error';
  error?: unknown;
}

/** Fire when the storefront opens. */
export function trackShopOpened(source: string): void {
  trackPurchaseFunnelStep(1, 'shop_opened', { source });
}

/** Fire when the player opens an item's detail view. */
export function trackItemViewed(item: { itemId: string; name?: string; category?: string; price?: string }): void {
  trackPurchaseFunnelStep(2, 'item_selected', {
    item_id: item.itemId,
    item_name: item.name ?? item.itemId,
    ...(item.category ? { item_category: item.category } : {}),
    ...(item.price ? { price: item.price } : {}),
  });
}

/**
 * Buy a catalog item. Handles idempotency, one stale-catalog retry, and
 * funnel analytics. Returns a normalized result — never throws.
 */
export async function buyItem(itemId: string, priceLabel?: string): Promise<BuyResult> {
  trackPurchaseFunnelStep(3, 'checkout_started', { item_id: itemId, ...(priceLabel ? { price: priceLabel } : {}) });

  const attempt = async (): Promise<Awaited<ReturnType<typeof RundotGameAPI.shop.purchase>>> => {
    const idempotencyKey = crypto.randomUUID();
    return RundotGameAPI.shop.purchase(itemId, idempotencyKey);
  };

  try {
    let result;
    try {
      result = await attempt();
    } catch (err) {
      if (!isStaleCatalogError(err)) throw err;
      // Catalog changed under us — refresh and retry once.
      await RundotGameAPI.shop.getCatalog();
      result = await attempt();
    }

    if (result.success) {
      trackPurchaseFunnelStep(4, 'purchase_complete', {
        item_id: itemId,
        price: result.order.finalPrice.value,
        currency: result.order.finalPrice.type,
      });
      return { success: true, order: result.order };
    }
    track('purchase_failed', { item_id: itemId, reason: 'cancelled' });
    return { success: false, reason: 'cancelled' };
  } catch (err) {
    if (isUserCancelledError(err)) {
      track('purchase_failed', { item_id: itemId, reason: 'cancelled' });
      return { success: false, reason: 'cancelled' };
    }
    track('purchase_failed', {
      item_id: itemId,
      reason: typeof (err as { code?: unknown } | null)?.code === 'string'
        ? (err as { code: string }).code
        : 'error',
    });
    return { success: false, reason: 'error', error: err };
  }
}

/**
 * Show a cheap, generous first-time offer only to players who have never paid.
 * Returns true if the player is a candidate for the starter-pack offer.
 */
export async function shouldOfferStarterPack(): Promise<boolean> {
  try {
    return !(await RundotGameAPI.iap.hasUserMadePurchase());
  } catch {
    return false;
  }
}
