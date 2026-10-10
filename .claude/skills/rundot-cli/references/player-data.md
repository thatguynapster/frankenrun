# Player data: storage, files, profiles

These are operator commands — they read and write **real players' data** for a
game you own or edit. Read before you write, and never clear or overwrite a
player's data without the creator explicitly asking for that player.

The `storage`, `files`, and `profile` groups resolve the game from
`game.config.prod.json` (or `--game-id`). Run `rundot storage --help` /
`rundot files --help` to confirm the subcommands on this version.

## Find a player

`rundot profile search <query>` looks up profiles by username and prints their
profile IDs. Every storage and files command takes a profile ID, so this is
usually step one.

## Key-value storage

`rundot storage <subcommand> <profile-id> …`. Shared flags: `--game-id <id>` and
`--scope app|owner` (default `app` — the game's own bucket; `owner` is the
creator-owned bucket).

| Command | What it does |
|---|---|
| `rundot storage data <profile-id>` | Every key-value pair. `--format table\|json\|raw`, `--save <file>`, `--as-of <ISO-8601>` (Firestore point-in-time read). |
| `rundot storage keys <profile-id>` | Just the keys. `--save <file>`. |
| `rundot storage get <profile-id> <key>` | One value. `--format auto\|json\|raw`, `--save <file>`. |
| `rundot storage usage <profile-id>` | Storage usage for that player. `--save <file>`. |
| `rundot storage export <profile-id>` | Snapshot to a file (`--save`) or stdout. `--username <name>` instead of the ID, `--as-of <ISO-8601>` for a past state. |
| `rundot storage set <profile-id> <key> <value>` | Write one string value. |
| `rundot storage remove <profile-id> <key>` | Delete one key. |
| `rundot storage clear <profile-id>` | **Destructive** — wipes the whole bucket. `--yes` to skip the prompt. |
| `rundot storage import <profile-id>` | **Destructive** — restore a snapshot, replacing existing data. `--file <path>` is required and `--game-id` must match the snapshot. `--yes` to skip the prompt. |

The read-then-restore pair is the useful one: `rundot storage export` with
`--as-of` grabs a player's state from before a bad write, and
`rundot storage import` puts it back.

## Player files

`rundot files <subcommand>`, same `--game-id`, most take a `<profile-id>`.

| Command | What it does |
|---|---|
| `rundot files list <profile-id>` | Files for a player. `--prefix <p>`, `--limit <n>`, `--cursor <c>` (from the previous page's `nextCursor`), `--json`. |
| `rundot files get <profile-id> <key>` | Metadata plus a signed URL. `--json`. |
| `rundot files usage [profile-id]` | Usage for one player, or app-wide when the ID is omitted. `--json`. |
| `rundot files quota` | The creator's storage quota. |
| `rundot files upload <file>` | Upload. `--key <k>` (defaults to the filename), `--visibility private\|public`, `--profile-id <id>` to restore into a player's space. |
| `rundot files delete <profile-id> <key>` | **Destructive.** `--yes`. |
| `rundot files clear <profile-id>` | **Destructive** — every file for that player. `--yes`. |

`rundot files visibility <key> <visibility>` flips one file public/private, and
`rundot files transform` runs media operations (concat, trim, thumbnail, fade,
upscale, …) — get its exact arguments from `rundot files transform --help`.

## Rules

- **Read first.** `data`/`keys`/`get`/`list` are free of consequence; the
  mutating commands are not.
- **Snapshot before a destructive write.** `rundot storage export --save` costs
  nothing and makes `clear`/`import` recoverable.
- **`--yes` is a real decision.** Passing it to skip a confirmation prompt is
  the same as agreeing to the destruction; only do it when the creator asked.
- **Never paste a player's raw storage dump into a shared channel.** Use
  `--save` and reference the file.
