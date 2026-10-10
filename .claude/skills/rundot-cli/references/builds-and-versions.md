# Builds, versions, and releases

`rundot deploy` (see [deploy.md](deploy.md)) is upload + publish in one step.
These are the pieces underneath it, for when you need them separately.

## Upload a build without publishing

**`rundot game upload-build`** uploads the build folder and creates a new
version, but doesn't change what players see.

| Flag | What it does |
|---|---|
| `--build-path <dir>` | Folder to upload. Defaults to the config's build path. |
| `--bump major\|minor\|patch` | Which part of the version to bump. Default `minor`. |
| `--game-id <id>` | Target a specific game. |
| `--uses-preloader` | **Deprecated.** |

## See what exists

- **`rundot game list-versions`** — every version of the game with its creation
  time. `--game-id <id>` to target another game.
- **`rundot game info`** — game id, name, description, created-at, latest
  version, keywords, and the releases with what each points at.

## Change what players see

- **`rundot game set-public`** — make the game visible on the explore page.
  `--version <v>` chooses which version (default `latest`).
- **`rundot game set-private`** — hide it from explore; the share link still works.

A published game goes to `review` first; `rundot game info` shows the release
state.

## Releases

A release is a named pointer from a channel to a version (plus optional server /
runtime config), so `public` and `private` can sit on different builds. Older
CLIs and docs called these *tags*; the `list-tags` / `update-tag` /
`delete-tag` / `copy-tag` spellings still work as hidden aliases, but use the
`release` names.

- **`rundot game list-releases`** — every release and what it points at.
- **`rundot game update-release <release>`** — re-point one release. The
  release name is a positional argument.

| Flag on `update-release` | What it does |
|---|---|
| `--version <v>` | Point the release at this version. |
| `--unset-version` | Clear the version pointer. |
| `--server-config-id <id>` | Attach a server config to the release. |
| `--unset-server-config-id` | Clear the server config. |
| `--runtime-config-id <id>` | Attach a runtime config. |
| `--game-id <id>` | Target a specific game. |

`rundot game delete-release <release>` and
`rundot game copy-release <source> <target>` also exist — run
`rundot game --help`.

## Server config and live ops

Server-side game config is a separate axis from the build:

- `rundot game list-server-configs`, `rundot game upload-server-config`,
  and `rundot game list-runtime-configs` —
  manage the configs a release can point at.
- `rundot migrate-config` — migrate an older local config file forward
  (`--dry-run` to see the change first).
- `rundot liveops` — `push`, `history`, `show`, `diff`, and `rollback` live-ops
  config for a running game without a full deploy. Commands that target a
  release take `--release private|review` (default `private`; `public` is
  reached through the approval flow). Run `rundot liveops --help`; each
  subcommand's own `--help` lists its flags.

Leaderboards, player stats, and collectibles have their own top-level groups
too (`rundot leaderboard`, and — beta-gated — `rundot stats` and
`rundot collectibles`). They're operator tooling rather than part of the ship
flow; reach for `--help` there.
