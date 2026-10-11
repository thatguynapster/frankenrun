// Preset route definitions for the bake (dev-only). Start/end are lat,lon and are snapped to the road graph.
export interface RouteDef {
  readonly id: string;
  readonly name: string;
  readonly start: readonly [number, number];
  readonly end: readonly [number, number];
  /** Cached roads file that covers the whole route (from fetch-roads.ts). */
  readonly roadsFile: string;
}

export const ROUTES: Readonly<Record<string, RouteDef>> = {
  route1: {
    id: 'route1',
    name: 'Route 1',
    start: [5.5525, -0.1796],
    end: [5.5653, -0.1748],
    roadsFile: 'bake/cache/roads-ring.json',
  },
};
