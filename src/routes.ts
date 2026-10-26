// The preset routes players can race (each one is a baked map under public/cdn-assets/accra/).
// Add a route: define it in bake/routes.ts, bake it (npm run bake -- <id>), then list it here. Listing it here also puts it
// in the determinism test (scripts/determinism-test.ts), which tests every route in this file.

export interface CityInfo {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly blurb: string;
}

/** The cities with routes, in the order the picker shows them. A city folder of the same id holds its baked maps. */
export const CITIES: readonly CityInfo[] = [
  { id: 'accra', name: 'Accra', country: 'Ghana', blurb: 'Back lanes, old town and Ring Road' },
  { id: 'london', name: 'London', country: 'England', blurb: 'Brick terraces, fog and winding old streets' },
];

export interface RouteInfo {
  readonly id: string;
  /** The city this route is in (see CITIES). */
  readonly city: string;
  readonly name: string;
  readonly km: number;
  readonly blurb: string;
}

export const ROUTES: readonly RouteInfo[] = [
  { id: 'route1', city: 'accra', name: 'Osu-Labone Twist', km: 2.6, blurb: 'Back lanes with a sharp turn every 200 m' },
  { id: 'osu-backstreets', city: 'accra', name: 'Osu Back Streets', km: 2.1, blurb: 'The tightest: short, twisty and busy with corners' },
  { id: 'cantonments', city: 'accra', name: 'Osu to Cantonments', km: 3.0, blurb: 'Long residential run with 14 sharp turns' },
  { id: 'jamestown', city: 'accra', name: 'Jamestown Maze', km: 2.1, blurb: 'Old-town lanes, narrow and unforgiving' },
  { id: 'ring-sprint', city: 'accra', name: 'Ring Road Sprint', km: 3.8, blurb: 'Flat out on Ring Road: no sharp turns, top speed wins' },
  { id: 'london-westminster-soho', city: 'london', name: 'Westminster to Soho', km: 2.4, blurb: 'From the Houses of Parliament up to the bright lights of Soho' },
  { id: 'london-shoreditch', city: 'london', name: 'Shoreditch Back Streets', km: 1.8, blurb: 'Short and busy: four sharp turns through the east end' },
  { id: 'london-piccadilly', city: 'london', name: 'Piccadilly to Holborn', km: 2.9, blurb: 'Flat out along Piccadilly: wide, straight and fast' },
];

/** The routes of one city, in picker order. */
export function routesOf(cityId: string): readonly RouteInfo[] {
  return ROUTES.filter((r) => r.city === cityId);
}

export function cityInfo(cityId: string): CityInfo | undefined {
  return CITIES.find((c) => c.id === cityId);
}

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

/** A mood per city for routes that do not have their own. */
const CITY_THEMES: Readonly<Record<string, RouteTheme>> = {
  london: { name: 'Pea-Soup Fog', sky: 0x2a2f3a, fog: 0x3a404c, fogNear: 16, fogFar: 140, hemiSky: 0xc4ccd8, hemiGround: 0x2c3040, hemiIntensity: 2.3, moonColor: 0xdde4f0, moonDisc: 0xdfe6f2, stars: false, storm: false, cityTint: 0xdfe4ee, accent: 0xff5a4a },
  newyork: { name: 'Neon Blackout', sky: 0x120a24, fog: 0x1c1038, fogNear: 30, fogFar: 190, hemiSky: 0xb09cff, hemiGround: 0x241a46, hemiIntensity: 2.3, moonColor: 0xd8c8ff, moonDisc: 0xe8d8ff, stars: false, storm: false, cityTint: 0xe6dcff, accent: 0xffd23b },
  tokyo: { name: 'Rainy Neon Night', sky: 0x0e1426, fog: 0x18223c, fogNear: 28, fogFar: 170, hemiSky: 0x9fd0ff, hemiGround: 0x1c2a48, hemiIntensity: 2.2, moonColor: 0xb8d8ff, moonDisc: 0x9ec4f0, stars: false, storm: true, cityTint: 0xd8e8ff, accent: 0xff3f9a },
  mexicocity: { name: 'Day of the Dead Dusk', sky: 0x2e1430, fog: 0x4a1e3a, fogNear: 34, fogFar: 200, hemiSky: 0xffc0a0, hemiGround: 0x3c1c34, hemiIntensity: 2.4, moonColor: 0xffd8b8, moonDisc: 0xffb070, stars: true, storm: false, cityTint: 0xffe2cc, accent: 0xff9a2e },
};

export function themeFor(routeId: string): RouteTheme {
  const city = routeInfo(routeId)?.city;
  return THEMES[routeId] ?? (city !== undefined ? CITY_THEMES[city] : undefined) ?? MOONLIT;
}
