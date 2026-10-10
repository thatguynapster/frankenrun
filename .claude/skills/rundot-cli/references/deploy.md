# Deploy a RUN game

`rundot deploy` uploads an **already-built** game — it does not build for you.
The full flow for a new game is `login` → `init` → build → `deploy`; for an
existing game it's build → `deploy`.

## Deploy

1. Log in if you aren't already: `rundot login`.
2. For a new game, initialize it once in the project root: `rundot init`
   (this writes `game.config.prod.json`).
3. Build the game so the output (dist) folder is up to date — typically
   `npm run build`. `rundot deploy` deploys this folder, so build before every deploy.
4. Draft patch notes for this deploy (what changed, player-facing) and show them
   to the user for approval before deploying. Once approved, pass them via
   `rundot deploy --changelog "<notes>"`. For multi-line markdown notes, write
   them to a file and pass `--changelog-file <path>` instead.
5. From the game's project root, run `rundot deploy`. It uses the build folder
   configured in `game.config.prod.json` (it prompts if that isn't set).
6. Read the command's output — `rundot` reports the result of the deploy there.

## Flags

| Flag | What it does |
|---|---|
| `--build-path <dir>` | Folder to upload. Defaults to the one in `game.config.prod.json`. |
| `--game-id <id>` | Target a specific game instead of the one in the config. |
| `--bump major\|minor\|patch` | Which part of the version to bump. Default `minor`. |
| `--public` | Make this version visible on the explore page (goes to review). |
| `--changelog "<md>"` | Release notes for this version, shown on the game's About tab. |
| `--changelog-file <path>` | Read the release notes from a file. Mutually exclusive with `--changelog`. |
| `--json` | Print one JSON line (`success`, `gameId`, `version`, `shareUrl`, `visibility`) instead of the human summary. On failure it prints `{"success":false,"error":…}` and still exits 1. |
| `--uses-preloader` | **Deprecated.** Don't set it on new games; draw your own in-game loading screen. |
| `--announce` | Beta only (`RUNDOT_BETA_FEATURES=1`): announce a public release to fans. Without beta it's an unknown option and the deploy is a quiet release. |

Useful checks: `rundot list-games` lists your games; `rundot game info` prints
details for the game configured in the current directory.

Headless / CI example:

```bash
RUNDOT_SKIP_UPDATE_CHECK=1 rundot deploy \
  --game-id abc123 --build-path ./dist \
  --bump patch --json --changelog-file ./notes.md
```

## Publish and unpublish

`deploy --public` publishes the version it just uploaded. To change visibility
without deploying:

- `rundot game set-public` — make the game visible on the explore page.
  `--version <v>` picks which version (default `latest`).
- `rundot game set-private` — hide it from explore. The share link keeps working.

## Present the publishing result

Give the creator one playable share link from the deploy result, with its actual
unlisted or pending-review status. For a social post, use the prepared platform's
tracked link unchanged. A thumbnail is image media: offer it only as a clearly
labeled image attachment or download when requested. Never present an asset URL
as a play link or add a raw thumbnail URL to suggested post text.

## If a deploy fails

Read the exact error `rundot` printed — it names the cause. Fix that cause
before retrying; don't retry blindly. See
[deploy-checklist.md](deploy-checklist.md) for the things to verify, and
[troubleshooting.md](troubleshooting.md) for exit codes and env vars.
