// Preset route definitions for the bake (dev-only). Start/end are lat,lon and are snapped to the road graph.
export interface RouteDef {
  readonly id: string;
  readonly name: string;
  readonly start: readonly [number, number];
  readonly end: readonly [number, number];
  /** Waypoints between start and end, to keep the route on the intended streets. */
  readonly via?: readonly (readonly [number, number])[];
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
  // ---- London ----
  'london-westminster-soho': { id: 'london-westminster-soho', name: 'Westminster to Soho', start: [51.4995, -0.127], end: [51.5152, -0.1415], roadsFile: 'bake/cache/roads-london-westminster-soho.json' },
  'london-shoreditch': { id: 'london-shoreditch', name: 'Shoreditch Back Streets', start: [51.523, -0.077], end: [51.529, -0.098], roadsFile: 'bake/cache/roads-london-shoreditch.json' },
  'london-piccadilly': { id: 'london-piccadilly', name: 'Piccadilly to Holborn', start: [51.5027, -0.1527], end: [51.5174, -0.12], via: [[51.51, -0.1342]], roadsFile: 'bake/cache/roads-london-westminster-soho.json' },
  // ---- New York (proposed; not yet baked) ----
  'newyork-midtown': { id: 'newyork-midtown', name: 'Midtown Grid', start: [40.758, -73.9855], end: [40.7359, -73.9911], roadsFile: 'bake/cache/roads-newyork-midtown.json' },
  'newyork-lower-manhattan': { id: 'newyork-lower-manhattan', name: 'Lower Manhattan Maze', start: [40.7033, -74.017], end: [40.7158, -73.9937], roadsFile: 'bake/cache/roads-newyork-lower-manhattan.json' },
  'newyork-brooklyn': { id: 'newyork-brooklyn', name: 'Brooklyn Brownstones', start: [40.672, -73.978], end: [40.7033, -73.989], roadsFile: 'bake/cache/roads-newyork-brooklyn.json' },
  'newyork-west-village': { id: 'newyork-west-village', name: 'West Village Twist', start: [40.7308, -73.9973], end: [40.7424, -74.006], roadsFile: 'bake/cache/roads-newyork-west-village.json' },
  // ---- Tokyo (proposed; not yet baked) ----
  'tokyo-shibuya-shinjuku': { id: 'tokyo-shibuya-shinjuku', name: 'Shibuya to Shinjuku', start: [35.658, 139.7016], end: [35.6896, 139.7004], roadsFile: 'bake/cache/roads-tokyo-shibuya-shinjuku.json' },
  'tokyo-asakusa-akihabara': { id: 'tokyo-asakusa-akihabara', name: 'Asakusa to Akihabara', start: [35.7148, 139.7967], end: [35.6984, 139.7731], roadsFile: 'bake/cache/roads-tokyo-asakusa-akihabara.json' },
  'tokyo-ginza-kanda': { id: 'tokyo-ginza-kanda', name: 'Ginza to Kanda', start: [35.6655, 139.7707], end: [35.6918, 139.7708], roadsFile: 'bake/cache/roads-tokyo-ginza-kanda.json' },
  'tokyo-harajuku-ebisu': { id: 'tokyo-harajuku-ebisu', name: 'Harajuku to Ebisu', start: [35.6702, 139.7027], end: [35.6467, 139.71], roadsFile: 'bake/cache/roads-tokyo-harajuku-ebisu.json' },
  // ---- Mexico City ----
  'mexicocity-reforma': { id: 'mexicocity-reforma', name: 'Reforma Run', start: [19.4236, -99.175], end: [19.435, -99.1405], roadsFile: 'bake/cache/roads-mexicocity-reforma.json' },
  'mexicocity-centro': { id: 'mexicocity-centro', name: 'Centro Histórico Maze', start: [19.426, -99.1245], end: [19.4416, -99.139], via: [[19.433, -99.1325]], roadsFile: 'bake/cache/roads-mexicocity-centro.json' },
  'mexicocity-roma-condesa': { id: 'mexicocity-roma-condesa', name: 'Roma and Condesa', start: [19.4105, -99.173], end: [19.43, -99.1585], via: [[19.4195, -99.162]], roadsFile: 'bake/cache/roads-mexicocity-roma-condesa.json' },
  'mexicocity-coyoacan': { id: 'mexicocity-coyoacan', name: 'Coyoacán Cobbles', start: [19.3565, -99.1735], end: [19.3553, -99.1625], via: [[19.3498, -99.1618]], roadsFile: 'bake/cache/roads-mexicocity-coyoacan.json' },
};
