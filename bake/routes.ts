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
  'osu-backstreets': {
    id: 'osu-backstreets',
    name: 'Osu Back Streets',
    start: [5.5493, -0.1782],
    end: [5.5612, -0.1765],
    roadsFile: 'bake/cache/roads-osu.json',
  },
  cantonments: {
    id: 'cantonments',
    name: 'Osu to Cantonments',
    start: [5.5697, -0.1725],
    end: [5.5512, -0.1719],
    roadsFile: 'bake/cache/roads-osu.json',
  },
  jamestown: {
    id: 'jamestown',
    name: 'Jamestown Maze',
    start: [5.5433, -0.2162],
    end: [5.5532, -0.2064],
    roadsFile: 'bake/cache/roads-jamestown.json',
  },
  // The end is the point 3.8 km along Ring Road from Kwame Nkrumah Circle (the full road to Danquah Circle is 5.5 km).
  'ring-sprint': {
    id: 'ring-sprint',
    name: 'Ring Road Sprint',
    start: [5.57, -0.215],
    end: [5.568015, -0.18296],
    roadsFile: 'bake/cache/roads-ring.json',
  },
};
