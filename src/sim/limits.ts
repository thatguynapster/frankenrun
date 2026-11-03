// The one place that decides how many players a room holds. Everything else (the session config, the room config
// in rundot/realtime.config.json written by `npm run gen:identity`, the start grid, the lobby) follows this number.
// To raise it, change it here and run `npm run gen:identity`, then redeploy.

/** Players per room. The finished game is meant to hold 10; it is 4 while the netcode and phones are tested. */
export const MAX_PLAYERS = 4;
