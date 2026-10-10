# Setup, auth, and keys

Every command that touches the platform needs a session, and most commands
resolve the game from `game.config.prod.json` in the current directory. Get
those two things right first.

## Log in

```bash
rundot login                            # interactive browser sign-in
rundot login --api-key-stdin < key.txt  # headless / CI
```

| Flag | What it does |
|---|---|
| `--api-key-stdin` | Read an API key from stdin. **This is the headless form to use.** |
| `--api-key <key>` | Discouraged — the key lands in shell history. Prefer `--api-key-stdin`. |
| `--refresh-token <t>` | Resume a previous session from its refresh token. |

`rundot whoami` prints who the current session is: email/userId, and for
`rk_`/`pk_` API-key sessions also the key type and the game it's confined to.
Use it when a command fails with a permissions error before you re-login.

`rundot update` upgrades the CLI itself; `--beta` / `--stable` switch channels.

## Start or register a project

- **`rundot init`**, **`rundot create`**, **`rundot game create`** — three names
  for the same action: create a game and write `game.config.prod.json` in the
  current directory, which every later command reads the game id from.
- **`rundot import <dir>`** — register an existing project with RUN and wire the
  SDK when it's a recognized Vite/npm web app. `--yes` (`-y`) skips the prompt.

Flags shared by `init` / `create`:

| Flag | What it does |
|---|---|
| `--name <name>` | Game name. |
| `--description <text>` | Game description. |
| `--build-path <dir>` | Build/dist folder that `deploy` will upload. |
| `--orientation Portrait\|Landscape\|Both` | Supported orientation. |
| `--keywords "a,b,c"` | Comma-separated keywords (e.g. `"cozy,puzzle"`). |
| `--override` | Overwrite an existing game config file. |
| `--uses-preloader` | **Deprecated** — don't set it on new games. |

## Inspect and edit a game

- **`rundot list-games`** — every game you own or edit.
- **`rundot game info`** — details for the game in the current directory
  (`--game-id <id>` to target another).
- **`rundot game configure`** — rewrite the local config: `--build-path`,
  `--orientation`, `--game-id`, `--uses-preloader`.
- **`rundot game set-name "<name>"`** — rename the game (name is a positional
  argument, not a flag). Siblings: `set-description`, `set-orientation`,
  `set-keywords`, `delete-keyword` — run `rundot game --help` for the full list.

## API keys

Two prefix-typed, game-scoped key classes. The prefix *is* the type:

- **`rk_` deploy keys** — full CI/deploy scope. Created with
  `rundot game api-keys create`.
- **`pk_` playground keys** — playground login only, rejected by every mutation
  or spend route. Created with `rundot playground grant-access`.

```bash
rundot game api-keys create --label "ci"      # prints the secret once
rundot game api-keys list                     # id, label, status, created, expires, prefix
rundot game api-keys revoke --key-id <id>     # add --yes for non-interactive
```

| Command | Flags |
|---|---|
| `rundot game api-keys create` | `--label <text>`, `--expires-in-days <1-365>` (default 365), `--game-id` |
| `rundot game api-keys list` | `--game-id` |
| `rundot game api-keys revoke` | `--key-id <id>` (**required**), `--yes`, `--game-id` |

`regenerate` revokes a key and issues a replacement in one step; run
`rundot game api-keys --help` for it.

**Never print a raw key back to the creator's terminal transcript, never commit
one, and never pass one via `--api-key`.** The secret is shown once at creation.

## Playground access (headless dev server)

`rundot playground grant-access` mints a `pk_` playground key (default TTL 365
days) and writes it into a git-ignored, `0600` `.env.local` as
`RUNDOT_PLAYGROUND_KEY`, so `npm run dev` can sign in headlessly with no config
editing. It refuses to write into a git-tracked `.env.local` unless you pass
`--force`.

| Command | Flags |
|---|---|
| `rundot playground grant-access` | `--expires-in-days <1-365>` (default 365), `--force`, `--game-id` |
| `rundot playground revoke-access` | `--game-id` |

`revoke-access` revokes the key on the server *and* strips the line from
`.env.local`. Do not add an `apiKey:` to `vite.config.ts` — the SDK's Vite
plugin reads `RUNDOT_PLAYGROUND_KEY` from the environment, dev-server-side, and
the raw key is never serialized into the browser.
