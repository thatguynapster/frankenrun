# Generating assets, and what they cost

`rundot generate` produces game assets from prompts and bills the creator (or
the game) in credits. `rundot assets` lists and deletes what's been generated.
`rundot credits` shows the spend.

## The generate group

Run `rundot generate --help` for the full list; these are the ones creators use.

| Command | What it makes |
|---|---|
| `rundot generate image` | An image from a text prompt. |
| `rundot generate music` | Music from a text prompt. |
| `rundot generate sfx` | A sound effect. |
| `rundot generate video` | A video from a text prompt, a start/end frame, or reference media. Long generations run as an async job; the command waits for it. |
| `rundot generate tts` | Text-to-speech audio. |
| `rundot generate text` | A chat completion from a messages file. |

Discovery / cost commands in the same group: `rundot generate image-models`,
`rundot generate video-models`, `rundot generate text-models`,
`rundot generate list-voices`,
`rundot generate estimate <kind>` (cost of a generation **without** running it).
`design-voice` and `save-voice` are also in the group — `--help` them if a creator asks.

### Flags worth knowing

Almost every generate command shares these:

| Flag | What it does |
|---|---|
| `--prompt "<text>"` | The prompt. **Required** on image / music / sfx / video. |
| `--out <path>` | Where to write the result. |
| `--game-id <id>` | Bill the game instead of your own creator balance. Omit for creator-billed. |
| `--json` | Machine-readable output. Use it when you're parsing rather than showing. |
| `--model <id>` | Pick a model on image / text (see `rundot generate image-models` / `text-models`). Video and audio pick with `--provider` instead. |

Command-specific ones you'll actually reach for:

- `rundot generate image`: `--aspect-ratio 16:9`, `--seed <n>`,
  `--negative-prompt "<text>"`, `--remove-background`, `--reference-image <ref>`
  (a local path, HTTPS URL, data URI, or creator-storage key; repeatable, up to
  10), `--image-size 1K|2K|4K`.
- `rundot generate music` / `sfx`: `--duration <seconds>` (music requires it,
  3–300; sfx ranges differ per provider).
- `rundot generate video`: `--provider <id>` (default `seedance-2.0`; list with
  `video-models`), `--mode text-to-video|image-to-video|reference-to-video`,
  `--duration <seconds>`, `--aspect-ratio 9:16`, `--resolution 480p|720p|1080p`,
  `--start-image-url` / `--end-image-url` (HTTPS) for image-to-video. Provider
  support for each flag differs — read `--help` before choosing.
- `rundot generate tts`: `--text` and `--voice-id` are both **required**.
- `rundot generate text`: `--model` and `--messages-file` are both **required**;
  `--system "<prompt>"` or `--system @path`.

Anything beyond that: `rundot generate <subcommand> --help`. 3D-model generation
(model, remesh, rig, animate) lives under `rundot game` — get the exact command
names from `rundot game --help` rather than guessing.

## Credits

`rundot credits` reports usage and balance.

| Flag | What it does |
|---|---|
| `--period today\|this_week\|this_month\|last_month\|all_time` | Window. Default `this_month`. |
| `--group-by service\|model\|app\|consumer` | How to break the total down. Default `service`. |
| `--game-id <id>` | Only this game's usage. |
| `--consumer sdk\|cli\|simulation\|admin` | Only spend from one surface. |

Estimate before you spend on anything expensive: `rundot generate estimate`.

## Managing generated assets

Generated assets occupy a storage quota, so deleting is a real operation.

- **`rundot assets list`** — `--service <name>` (one service only),
  `--status active|removed` (default `active`), `--limit <n>` (default 20, max
  100), `--game-id <id>`.
- **`rundot assets rm <generation-id>`** — `--service <name>` is **required**
  (`imagegen`, `spritegen`, `audiogen`, or `threedgen`; the id alone doesn't
  identify the partition). Get both the id and the service from
  `rundot assets list`.

Deleting is not undoable from the CLI. Confirm with the creator before removing
anything you didn't just generate.
