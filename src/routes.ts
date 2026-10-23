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

// ---------- how each route looks: a spooky atmosphere per route ----------

export interface RouteTheme {
  readonly name: string;
  readonly sky: number;
  readonly fog: number;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly hemiSky: number;
  readonly hemiGround: number;
  readonly hemiIntensity: number;
  readonly moonColor: number;
  /** The moon seen in the sky. */
  readonly moonDisc: number;
  readonly stars: boolean;
  readonly storm: boolean;
  /** Multiplies the buildings' colours, so the whole street takes on the route's mood. */
  readonly cityTint: number;
  /** Checkpoint rings and wisps. */
  readonly accent: number;
}

const MOONLIT: RouteTheme = { name: 'Moonlit Night', sky: 0x232b52, fog: 0x232b52, fogNear: 50, fogFar: 230, hemiSky: 0xb8c4ff, hemiGround: 0x3a3358, hemiIntensity: 2.4, moonColor: 0xeaf0ff, moonDisc: 0xf2f4ff, stars: true, storm: false, cityTint: 0xffffff, accent: 0x3bd1ff };

export const THEMES: Readonly<Record<string, RouteTheme>> = {
  route1: MOONLIT,
  'osu-backstreets': { name: 'Haunted Mist', sky: 0x142a22, fog: 0x1f3d2e, fogNear: 14, fogFar: 125, hemiSky: 0x9fe0b8, hemiGround: 0x20382c, hemiIntensity: 2.3, moonColor: 0xd6ffe4, moonDisc: 0xcfffe0, stars: false, storm: false, cityTint: 0xc9e8d4, accent: 0x7dff9a },
  cantonments: { name: 'Blood Moon', sky: 0x2e1220, fog: 0x3a1626, fogNear: 38, fogFar: 200, hemiSky: 0xffb0a0, hemiGround: 0x3a1c2c, hemiIntensity: 2.3, moonColor: 0xffc0b0, moonDisc: 0xff5a4a, stars: true, storm: false, cityTint: 0xffd6cc, accent: 0xff6a5a },
  jamestown: { name: 'Witching Hour', sky: 0x1c1236, fog: 0x2b1b4c, fogNear: 22, fogFar: 150, hemiSky: 0xc9b0ff, hemiGround: 0x2e2050, hemiIntensity: 2.4, moonColor: 0xe2d4ff, moonDisc: 0xd9c4ff, stars: true, storm: false, cityTint: 0xe2d6ff, accent: 0xc78bff },
  'ring-sprint': { name: 'Storm Night', sky: 0x10162a, fog: 0x1a2342, fogNear: 40, fogFar: 260, hemiSky: 0x9fb6e8, hemiGround: 0x232c4a, hemiIntensity: 2.2, moonColor: 0xb8c8ee, moonDisc: 0x8fa3d0, stars: false, storm: true, cityTint: 0xdbe6ff, accent: 0x6fd0ff },
};

export function themeFor(routeId: string): RouteTheme {
  return THEMES[routeId] ?? MOONLIT;
}
