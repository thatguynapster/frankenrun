// The preset routes players can race (each one is a baked map under public/cdn-assets/accra/).
// Add a route: define it in bake/routes.ts, bake it (npm run bake -- <id>), then list it here.

export interface RouteInfo {
  readonly id: string;
  readonly name: string;
  readonly km: number;
  readonly blurb: string;
}

export const ROUTES: readonly RouteInfo[] = [
  { id: 'route1', name: 'Osu-Labone Twist', km: 2.6, blurb: 'Back lanes with a sharp turn every 200 m' },
  { id: 'osu-backstreets', name: 'Osu Back Streets', km: 2.1, blurb: 'The tightest: short, twisty and busy with corners' },
  { id: 'cantonments', name: 'Osu to Cantonments', km: 3.0, blurb: 'Long residential run with 14 sharp turns' },
  { id: 'jamestown', name: 'Jamestown Maze', km: 2.1, blurb: 'Old-town lanes, narrow and unforgiving' },
  { id: 'ring-sprint', name: 'Ring Road Sprint', km: 3.8, blurb: 'Flat out on Ring Road: no sharp turns, top speed wins' },
];

export const DEFAULT_ROUTE = ROUTES[0]!.id;

export function routeInfo(id: string): RouteInfo | undefined {
  return ROUTES.find((r) => r.id === id);
}

/** Public matchmaking pools everyone on one route, which changes every day (UTC) so quick match visits them all. */
export function featuredRoute(now: number = Date.now()): RouteInfo {
  return ROUTES[Math.floor(now / 86_400_000) % ROUTES.length]!;
}
