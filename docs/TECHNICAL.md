# Stock Video Editor — technical documentation

← [Overview](../README.md) · [User guide](presentation/README.md)

> Paths in this document are relative to the repository root.

A local web tool for preparing video footage for stock sites.

- **Stage 1 — segmentation.** Drop raw footage in the browser → the backend analyses optical flow
  and proposes 7–40 s segments with uniform camera motion → you review and edit them on a timeline →
  "Confirm" writes `manifest.json`.
- **Stage 2 — export.** Every confirmed segment gets preview frames, a location (GPS from the file or a
  manual location, reverse geocoding, nearby landmarks), technical features, and a title, description,
  keywords and categories written by a local vision model (**gemma4:31b in Ollama**). After your review the
  clips are cut frame-accurately and packed into a folder + ZIP with CSV files for **Adobe Stock,
  Shutterstock, Pond5 and Envato**. See [Stage 2: export for stock sites](#stage-2-export-for-stock-sites).

## Requirements

- Node.js 24+, pnpm 11 (`corepack enable`)
- Docker (Docker Desktop) — the API runs in a container together with ffmpeg/ffprobe and SQLite.
  Without Docker you need `ffmpeg` and `ffprobe` in `PATH` (macOS: `brew install ffmpeg`).
- [Ollama](https://ollama.com) on the host with `gemma4:31b` for stage 2 (see [Ollama setup](#ollama-setup)).
- Internet access for reverse geocoding (OpenStreetMap Nominatim) and landmark search (Wikipedia);
  everything else, including the model, runs locally.

## Quick start

```bash
pnpm install
pnpm dev:api      # docker compose up --build api  → http://localhost:3333
pnpm dev:web      # nx serve web                    → http://localhost:4200
```

Open http://localhost:4200, create a project and drop MP4/MOV files onto the window.

On start the API container runs `pnpm install` (the Linux `node_modules` live in named volumes so
the native `better-sqlite3` build does not clash with the macOS one), applies DB migrations and runs
`nx serve api` in watch mode — code changes on the host are picked up automatically.

### Without Docker

```bash
DATA_DIR=./data pnpm nx serve api   # requires ffmpeg/ffprobe in PATH
pnpm nx serve web
```

If ffmpeg is missing, the API exits with a clear error and a hint.

### Production (Docker)

```bash
pnpm prod:up     # build both images and start the stack in the background
pnpm prod:logs   # follow the logs
pnpm prod:down   # stop it (data and DB are kept)
```

Open http://localhost:8080. `docker-compose.prod.yml` builds two images from
`docker/prod.Dockerfile`:

- `api` — the esbuild bundle with its production dependencies plus ffmpeg/ffprobe. Migrations run
  on start. Its port is not published.
- `web` — nginx serving the web build. It proxies `/api` and `/media` to the API
  (`docker/nginx.conf`), so the stack has one origin.

The production stack has its own data and DB, separate from the dev ones. Video files go to
`./data-prod` on the host and the SQLite DB to the named volume `dbdata` of the
`stock-video-editor-prod` project. Settings:

| Variable            | Default                             | Meaning                                      |
| ------------------- | ----------------------------------- | -------------------------------------------- |
| `WEB_PORT`          | `8080`                              | host port of the web UI                      |
| `PROD_DATA_DIR`     | `./data-prod`                       | host directory for video files and manifests |
| `QUEUE_CONCURRENCY` | `1`                                 | videos processed at the same time            |
| `LOG_LEVEL`         | `info`                              | API log level                                |
| `OLLAMA_URL`        | `http://host.docker.internal:11434` | Ollama on the host                           |
| `OLLAMA_MODEL`      | —                                   | default model for the export settings        |

## Commands

| Command                  | What it does                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `pnpm precheck`          | everything CI runs: format check, lint, typecheck, test, build, knip (ffmpeg tests skipped if no ffmpeg) |
| `pnpm precheck:docker`   | the same inside the Linux container with ffmpeg, i.e. exactly what CI runs                               |
| `pnpm test:docker`       | all tests inside the container, including ffmpeg integration tests                                       |
| `pnpm db:generate`       | generate a Drizzle migration after changing `apps/api/src/db/schema.ts`                                  |
| `docker compose down -v` | stop the API and **delete** the volumes with the DB and `node_modules`                                   |

## Environment variables (API)

| Variable                       | Default                                                      | Description                                                                 |
| ------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `DATA_DIR`                     | `./data` (`/data` in Docker)                                 | sources, proxies, sprites, analysis cache, manifests                        |
| `DB_PATH`                      | `$DATA_DIR/app.sqlite` (`/var/lib/dfs/app.sqlite` in Docker) | SQLite file                                                                 |
| `DATA_DIR_HOST`                | = `DATA_DIR` (`$PWD/data` in Docker)                         | how `DATA_DIR` is seen from the host — only used to display paths in the UI |
| `PORT` / `HOST`                | `3333` / `0.0.0.0`                                           | API address                                                                 |
| `QUEUE_CONCURRENCY`            | `1`                                                          | how many videos are processed at the same time                              |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe`                                         | binary paths                                                                |
| `LOG_LEVEL`                    | `info`                                                       | pino log level                                                              |
| `OLLAMA_URL`                   | — (`http://host.docker.internal:11434` in Docker)            | default Ollama URL for the export settings                                  |
| `OLLAMA_MODEL`                 | —                                                            | default model for the export settings (otherwise `gemma4:31b`)              |

For `docker compose` you can set `API_PORT`, `QUEUE_CONCURRENCY`, `LOG_LEVEL`, `OLLAMA_URL`, `DATA_DIR_HOST`
(the host folder mounted at `/data`; defaults to `./data`).
`API_URL` for `nx serve web` is where Vite proxies `/api` and `/media` (default `http://localhost:3333`).

In Docker the DB lives in the named volume `dbdata`, not on the bind mount: SQLite (WAL) locking is
unreliable over the Docker Desktop file share. Video files and `manifest.json` are in `./data` on the host.

## Layout

```
apps/api                 Fastify: REST, tus (/api/uploads), SSE, processing queue, Drizzle/SQLite
apps/web                 React + Vite + Tailwind; Zustand (editor, undo/redo), TanStack Query
libs/shared/contracts    zod schemas and types: Project, SourceVideo, Segment, metrics, events, manifest, validation,
                         ExportSettings, ClipContext, ClipMetadata, ExportClip, ExportJob
libs/api/video-analysis  MotionAnalyzer (opencv-js in worker_threads), features, classification, segmentation
libs/api/ffmpeg          ffmpeg/ffprobe wrappers, detailed probe (colour, GPS tag, camera), DJI telemetry reader
libs/api/export-pipeline stage-2 orchestrator (resumable steps, LLM queue), steps, file naming, archive builder
libs/api/geo             Nominatim reverse/forward geocoding, Wikipedia/Overpass landmarks, rate limit, cache port
libs/api/tech-analysis   shot type, resolution label, Envato movement, capture time, sun position, season
libs/api/llm             Ollama client, versioned prompts (prompts/*.md), validation + retries, post-processing
libs/api/stock-csv       StockCsvAdapter + one adapter per platform, config/*.json with categories and limits
libs/web/timeline        timeline component (thumbnails, graph, segments, zoom, snapping)
docker/                  dev API image (api.Dockerfile, Node 24 + ffmpeg); production images (prod.Dockerfile:
                         `api` and nginx `web` targets); nginx.conf serves the SPA and proxies /api and /media
```

### Processing pipeline

`uploading → queued → probing → proxy → analyzing → ready | failed`; progress reaches the browser
via SSE (`GET /api/projects/:id/events`).

1. **Upload** — tus (`@tus/server` + `tus-js-client`): 64 MB chunks, up to 3 files in parallel,
   resumable after interruptions. The file is moved to `DATA_DIR/videos/<id>/source.<ext>` without re-encoding.
2. **probing** — `ffprobe`: duration, fps, size (rotation-aware), codec. Then the file is identified (see
   [Duplicate detection](#duplicate-detection)): a quick fingerprint, a SHA-256 of the whole file (streamed, so
   multi-GB sources stay in this step for a while) and the detailed probe (`mediaInfo`: colour, GPS tag,
   camera, creation time).
3. **proxy** — H.264 8-bit, short side ≤ 720 px, 15-frame GOP (precise seeking), `+faststart`;
   a thumbnail sprite (a frame every 2 s, at most 600, 10 columns) plus its layout stored in the DB.
4. **analyzing** — ffmpeg decodes the proxy into 320 px grayscale frames at `analysisFps` and pipes them
   to the worker; features are cached in `features.json`, graph metrics in `metrics.json`.

After an API restart, unfinished videos are re-queued automatically, and videos stored before duplicate
detection existed get their fingerprint, hash and `mediaInfo` filled in the background.

### Duplicate detection

- **Before upload** the browser computes a fingerprint of each file: SHA-256 over `"<size>\n"` + the first and
  the last 8 MB (`fingerprintRanges` in `libs/shared/contracts`, the whole file when it is smaller) and calls
  `POST /api/videos/duplicates`. Stored videos (in any project) with the same size and fingerprint, and the
  same duration when the browser can read it (± tolerance), are shown in a dialog: **Skip** or **Upload anyway**
  per file, or for all of them. The fingerprint is sent as tus metadata but never trusted.
- **After upload** the server recomputes the fingerprint and the full `contentHash`. A video whose hash, size,
  duration, fps, resolution, codec and creation time match an earlier upload gets `duplicateOfId`; the video card
  shows "Duplicate of …" (and the project, when it is another one). Duplicates are flagged, never deleted.

## Segmentation algorithm

For every pair of consecutive frames a dense Farneback optical flow is computed (opencv-js, WASM).
The flow is fitted with an affine model `u = a + c1·x + c2·y`, `v = b + c3·x + c4·y` around the frame centre.
It yields these features (shifts in frame widths per second, independent of resolution and fps):

| Feature                     | Meaning                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `dx`, `dy`                  | mean image shift                                                                                          |
| `div`                       | isotropic divergence (scale) — forward/backward motion                                                    |
| `rot`                       | frame rotation                                                                                            |
| `px`                        | horizontal parallax: top of frame (background) and bottom (foreground) move differently — orbit signature |
| `py`                        | vertical parallax — ascend/descend (as opposed to camera tilt)                                            |
| `fit`                       | how well a smooth model explains the flow (0…1) — "smoothness"                                            |
| `coherence`                 | share of vectors aligned with the mean                                                                    |
| `magVar`                    | variance of flow magnitude (spikes = jerks)                                                               |
| `sharpness`                 | variance of the Laplacian                                                                                 |
| `brightness`, `overexposed` | mean luma and share of clipped pixels                                                                     |

**Classification** (`libs/api/video-analysis/src/lib/classify.ts`, thresholds in `config.ts`):
low activity → `static`; low `fit` → `erratic`; dominant rotation → orbit (top-down spin);
focus of expansion inside the frame or dominant scale → `forward`/`backward`;
horizontal parallax with top and bottom moving in opposite directions → `orbit_left/right`;
otherwise horizontal → `pan_left/right`; vertical with parallax → `ascend/descend`, without → `tilt_up/down`.

**Segmentation** (`segmenter.ts`):

1. smooth labels (mode) and features (median) over `smoothWindowSec`;
2. boundaries: class change; speed jump (medians before vs after); strong jerk; blur
   (sharpness < 35 % of the video median); over/under-exposure — such samples are cut out;
3. merge same-class runs separated by short label flicker (≤ `mergeGapSec`);
4. trim 0.5 s at both ends; drop runs shorter than `minDuration`; runs longer than `maxDuration` are split
   into `round(length / targetDuration)` pieces at the most stable points near the ideal cuts;
5. drop `erratic`, and `static` unless "include hovering shots" is on;
6. `score` = 0.35·smoothness + 0.25·speed stability + 0.2·sharpness + 0.2·exposure − a penalty for slight
   jerks; `reasons` are explanations such as "Smooth motion: orbit left", "Slight jerk at 00:14".

Segment times are rounded to source frames.

### Parameters (editable in the UI)

| Parameter        | Default | Description                                                            |
| ---------------- | ------- | ---------------------------------------------------------------------- |
| `minDuration`    | 7 s     | shorter segments are dropped / flagged                                 |
| `maxDuration`    | 40 s    | longer segments are split / flagged                                    |
| `targetDuration` | 25 s    | preferred piece length when splitting                                  |
| `analysisFps`    | 5       | analysis frame rate; changing it requires a new frame-by-frame pass    |
| `sensitivity`    | 1.5     | threshold multiplier: higher = more boundaries and stricter smoothness |
| `includeStatic`  | off     | keep hovering shots                                                    |

"Recalculate" reuses the cached features, so it takes a fraction of a second (unless `analysisFps`
changed). Only untouched AI segments are replaced; manually created or edited ones are kept.

Performance: Farneback at 320×180 in opencv-js takes about 5 ms per frame pair; one minute of video at
5 fps is analysed in ~2–3 s plus proxy decoding time.

## Editor

Timeline: thumbnail strip, speed (blue line) and smoothness (green area) graph with a strip of the detected
motion type, and segments (colour = motion type; rejected ones are hatched, invalid ones have an amber border).
Drag blocks or groups, resize with edge handles, snapping to frames, neighbouring segment edges, the playhead
and I/O marks. Dragging across empty track space creates a segment; Shift/⌘ + drag selects with a box.
Ctrl/⌘ + wheel zooms, wheel scrolls. Changes are autosaved 1 s after editing.

| Key                        | Action                                            |
| -------------------------- | ------------------------------------------------- |
| Space                      | play / pause                                      |
| J / K / L                  | reverse / stop / forward (press again for faster) |
| ← / →                      | previous / next frame                             |
| Shift + ← / →              | 1 second                                          |
| I / O                      | set in / out point; N — segment from I–O          |
| S                          | split at playhead                                 |
| A                          | accept / reject                                   |
| M                          | merge selected                                    |
| Delete / Backspace         | delete selected                                   |
| ⌘/Ctrl + Z, ⇧ + ⌘/Ctrl + Z | undo / redo                                       |

Shortcuts work with any keyboard layout (physical key codes are used).

## API

All paths except `/media` are prefixed with `/api`. Validation uses the zod schemas from `libs/shared/contracts`.

```
GET/POST /projects                  PUT /projects/:id/settings
GET/DELETE /projects/:id            GET /projects/:id/summary
GET      /projects/:id/videos       GET /projects/:id/events          (SSE)
POST     /projects/:id/reanalyze    POST /projects/:id/confirm
POST     /projects/:id/reopen       (confirmed → draft; discards the export and manifest.json)
*        /uploads                   (tus; metadata projectId, filename, fingerprint?)
POST     /videos/duplicates         { files: [{ key, sizeBytes, fingerprint, durationSec? }] } → { matches }
GET/DELETE /videos/:id              POST /videos/:id/retry
PUT      /videos/:id/reviewed       { reviewed }
GET      /videos/:id/metrics        POST /videos/:id/reanalyze  { settings? }
GET/PUT  /videos/:id/segments       (PUT replaces the video's whole segment set)
GET      /storage                   disk usage by data type and project, free space
POST     /storage/cleanup           delete encoded clips, archives and leftovers (409 while one runs)
GET      /health                    liveness ({ ok: true })
GET      /status                    system checks: database, storage, ffmpeg/ffprobe, Ollama, geocoder
GET      /media/:videoId/proxy.mp4 | sprite.jpg   (no /api prefix; HTTP Range supported; sources are never served)
```

A confirmed project is read-only (changes → `409`) until it is reopened. `POST /projects/:id/reopen` makes it
an editable draft again and **discards the whole export**: AI metadata, manual edits, approvals, encoded clips,
the archive and `manifest.json`. Confirming again starts the export from scratch.
`DELETE /projects/:id` stops processing and permanently removes the project with all its videos
(originals, proxies, sprites, analysis cache), unfinished uploads, segments and `manifest.json`.

## Manifest (contract for stage 2)

`DATA_DIR/projects/<projectId>/manifest.json`, schema `SegmentationManifestSchema` in `libs/shared/contracts`:

```jsonc
{
  "manifestVersion": 1,
  "projectId": "…",
  "confirmedAt": "2026-10-07T14:39:33.533Z",
  "settings": {
    "minDuration": 7,
    "maxDuration": 40,
    "targetDuration": 25,
    "analysisFps": 5,
    "sensitivity": 1.5,
    "includeStatic": false,
  },
  "videos": [
    {
      "videoId": "…",
      "originalFilename": "DJI_0042.MP4",
      "sourcePath": "/data/videos/…/source.mp4",
      "durationSec": 65,
      "fps": 29.97,
      "width": 3840,
      "height": 2160,
      "segments": [
        {
          "segmentId": "…",
          "startSec": 0.5,
          "endSec": 34.1,
          "startFrame": 15,
          "endFrame": 1023,
          "motionType": "pan_right",
          "score": 0.93,
          "origin": "ai",
        },
      ],
    },
  ],
}
```

Only accepted segments are included; frames are `round(t · fps)` and times are recomputed from frames.
`sourcePath` is the path inside the API (in Docker `/data/…`, which is `./data/…` on the host).
After writing, `SegmentsConfirmedHandler.onSegmentsConfirmed(manifest)` is called
(`apps/api/src/services/stage2.ts`), which starts the stage-2 export pipeline.

## Stage 2: export for stock sites

After "Confirm" the export starts in the background and the **Export** screen
(`/projects/:id/export`, also reachable from a confirmed project) shows its progress.

### Ollama setup

1. Install Ollama: macOS/Windows from https://ollama.com/download, Linux:
   `curl -fsSL https://ollama.com/install.sh | sh`. Start it (the app, or `ollama serve`).
2. Download the model (~20 GB):

   ```bash
   ollama pull gemma4:31b
   ```

3. Check it: `curl http://localhost:11434/api/tags` lists `gemma4:31b`. The Export screen and
   `GET /api/export/health` show a clear message with the `ollama pull …` command when the model is missing
   or Ollama is not reachable.

The API container reaches the host's Ollama at `http://host.docker.internal:11434` (set via `OLLAMA_URL` in
`docker-compose.yml`; `extra_hosts` makes it work on Linux too). Without Docker the default is
`http://localhost:11434`. Both can be changed in **Export settings**.

**Hardware.** `gemma4:31b` (Q4_K_M) needs about 20 GB for the weights plus a few GB for the context with
two 1280 px frames:

- Apple Silicon with **32 GB+ unified memory** (64 GB is comfortable), or
- an NVIDIA GPU with **24 GB VRAM** (RTX 3090/4090) — less VRAM works with partial CPU offload, much slower,
- CPU only is possible but takes minutes per clip.

On the Apple Silicon development machine one clip with two frames took ~25–35 s. LLM requests are strictly sequential (one at a time);
`keep_alive` keeps the model loaded between clips. Thinking mode is off by default (much slower, rarely
better for this task).

### Pipeline

Each confirmed segment is a **clip** with the status
`queued → frames → geo → tech → llm → review → cut → done | failed`. Progress per clip and for the whole
export arrives via SSE (`export.clip.progress`, `export.clip.updated`, `export.updated`).

Every step is idempotent: its result is stored in SQLite (`export_clips`) and on disk
(`DATA_DIR/export-work/<jobId>/<clipId>/`) together with a hash of its inputs. After a crash or restart a
clip continues from its current step; on re-runs (new location, regenerate, retry) steps whose inputs did not
change are skipped — editing metadata never re-runs the model or the encoding.
Frames, geo, tech and cutting run in parallel (`concurrency`, default 2); LLM calls run one at a time.

1. **frames** — 2 frames from the **source** (1 for clips shorter than 15 s) near 30 % and 70 % of the clip,
   each moved to the sharpest stage-1 sample (Laplacian variance) within ±1 s. A full-size JPEG goes to the
   archive (`previews/`), a 1280 px copy to the model; 10-bit, log and HLG/PQ footage gets a simple contrast
   normalisation so the model does not see a flat grey picture.
2. **geo** — see [Location](#location).
3. **tech** (no LLM) — duration, fps, resolution label (4K/2.7K/HD), codec, bit depth, colour transfer, audio;
   shot type: `hyperlapse`/`timelapse` from the file name or metadata (or real elapsed time > 1.5 × video time,
   when known), `slow_motion` for ≥ 100 fps with slow-motion conform enabled, otherwise `high_frame_rate`,
   else `real_time`; camera movement (stage-1 motion type) mapped to Envato terms (Arc, Tracking Left/Right,
   Tilt Up/Down, Aerial, Drone); capture time, light (sunrise, golden hour, day, sunset, blue hour, night via
   `suncalc`), hemisphere-aware season, GPS altitude, drone model.
4. **llm** — `POST {ollamaUrl}/api/chat` with the frames (`images`), a JSON Schema in `format` (category
   lists are enums in the schema), `temperature`, `keep_alive`, `think`. The answer is validated with zod;
   invalid JSON, unknown categories or exceeded limits are sent back to the model with the error text (up to
   2 retries). After the last retry an answer with only length problems is accepted and trimmed; otherwise
   the clip fails with the reason and can be retried. Post-processing trims at word boundaries,
   lowercases and de-duplicates keywords (including simple plurals) and removes technical terms, brand names,
   filler words and odd characters (lists in `libs/api/stock-csv/config/common.json`). Raw requests (images
   elided) and responses are written to `DATA_DIR/llm-logs/` for prompt debugging.
5. **review** — unless **auto-approve** is on, clips wait for you: edit, regenerate (optionally with a hint
   such as "this is Kazan Cathedral" or by picking one of the landmark candidates) and approve.
6. **cut** — frame-accurate re-encode of exactly the manifest frames (stream copy can only cut on keyframes):
   H.264 High, 8-bit 4:2:0, CRF (default 16) with a bitrate cap (default 100 Mbps at 4K, scaled for smaller
   frames), source resolution and frame rate, `+faststart`, **no audio**, `.mov` by default; or ProRes 422 HQ.
   H.265 is never produced (Envato does not accept HEVC). Slow-motion conform plays every source frame at
   25/30 fps (`setpts`), so the clip gets longer — the duration is checked against the platform limits.
   `creation_time` is set to the clip's capture time; GPS tags are removed unless **Keep GPS** is on.

### Location

Priority:

1. **Manual location** of the video (Export screen → "Location per video"): `lat, lon` or free text
   ("Kizhi, Russia"), which is forward-geocoded with Nominatim. It overrides the file's GPS.
2. **GPS from the file**:
   - the ISO 6709 location tag (`location`, `com.apple.quicktime.location.ISO6709`) that phones and some
     cameras write;
   - the **DJI telemetry stream** (`djmd`, "DJI meta", per-frame protobuf) written by e.g. DJI Mini 4 Pro.
     The track is read once and cached in `DATA_DIR/videos/<id>/telemetry.json`; the clip uses the point in the
     middle of the clip, and the start/end points give the flight direction. For forward (backward) flights the
     camera heading is assumed to be the flight direction (its opposite), which is used to mark landmarks
     "in view".
3. Otherwise the place is **unknown** and the model is told not to name any place.

Reverse geocoding uses **Nominatim** with `accept-language=en` (stock metadata is English); the local
name is kept separately. Nominatim rules are respected: your own User-Agent with contact
(**Export settings → Nominatim User-Agent** — please put your e-mail there), at most 1 request per second,
and a SQLite cache keyed by coordinates snapped to a ~50 m grid (`geo_cache` table), so repeated runs and
neighbouring clips do not hit the service again. Landmarks come from **Wikipedia geosearch** (with Wikidata
ids) within the configured radius (default 2 km), optionally also from **OpenStreetMap Overpass**
(`tourism`, `historic`, `natural`, `man_made`). They are sorted by "in the camera's field of view" (when the
heading is known), then by distance.

**Capture time.** In `auto` mode a timestamp in the file name (`DJI_20240714213000_0001_D.MP4`,
`dji_fly_20260811_133558_…`) is taken as local time at the GPS position (time zone from the coordinates);
without one, DJI `creation_time` is treated as local time labelled UTC (older DJI aircraft do this) and other
cameras' `creation_time` as real UTC. `utc` / `local` force one interpretation.

### Review in the UI

- Table: preview, step/status with progress, place, shot type, title, keyword count and one badge per
  enabled platform (green / amber / red, hover for the messages).
- Clip panel: frames, the proxy looping the segment, location and landmark candidates ("Use as subject"
  regenerates with that landmark), editable title / description / subject, keyword chips (Enter or comma to
  add, drag to reorder, counter up to 50), categories per platform, editorial and recognizable-buildings
  flags, Regenerate (with a hint), Approve, Retry, Exclude.
- Bulk actions: approve all, find & replace in keywords, add / remove a keyword on the selected clips
  (or all clips when nothing is selected).
- **Build archive** is enabled when every clip is done or excluded. Afterwards the ZIP download link, the
  folder path and `report.md` are shown.

### Archive

```
DATA_DIR/exports/
  export_{project}_{yyyymmdd_hhmm}/
    videos/        final clips ({subject}_{place}_{motion}_{yyyymmdd}_{nnn}.mov)
    previews/      the frames the metadata was generated from (<clip>_1.jpg, <clip>_2.jpg)
    csv/           adobe_stock_{author}_{yyyy_mm_dd}.csv, shutterstock.csv, pond5.csv, envato.csv
    metadata.json  per clip: source, context (frames, geo, tech), raw model answer, model, prompt
                   version, attempts, final values, validation
    report.md      clip count, per-platform warnings/errors, clips with place confidence low/unknown,
                   clips recommended for editorial
  export_{project}_{yyyymmdd_hhmm}.zip
```

The ZIP is streamed with `archiver` (ZIP64; videos stored, everything else deflated) and downloaded from
`GET /api/exports/:jobId/download` with HTTP Range support. Rebuilding without changes reuses the existing
archive (hash of all inputs); after edits a new archive is built and the previous one is removed. The LLM and
the encoding are never re-run by a rebuild.

**File names** follow the template (default `{subject}_{place}_{motion}_{date}_{n}`): only `a-z0-9_`
(diacritics and Cyrillic transliterated, no spaces or hyphens), at most 80 characters with the extension,
unique within the export, and identical in every CSV — the folder can be uploaded via FTP as it is.

### Export settings

`GET/PUT /api/settings/export`, stored in SQLite; the UI is at **Export settings**.

| Setting                                  | Default                                                                | Description                                          |
| ---------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| `ollamaUrl`                              | `http://localhost:11434` (Docker: `http://host.docker.internal:11434`) | Ollama server                                        |
| `model`                                  | `gemma4:31b`                                                           | any vision model in Ollama                           |
| `think`                                  | off                                                                    | Ollama thinking mode                                 |
| `temperature`                            | 0.3                                                                    | sampling temperature                                 |
| `llmTimeoutSec`                          | 600                                                                    | timeout per request                                  |
| `keepAlive`                              | `30m`                                                                  | how long Ollama keeps the model loaded               |
| `autoApprove`                            | off                                                                    | cut right after generation, no review                |
| `concurrency`                            | 2                                                                      | clips processed in parallel by non-LLM steps         |
| `encoding.codec`                         | `h264`                                                                 | `h264` (High, 8-bit) or `prores_hq` (ProRes 422 HQ)  |
| `encoding.crf`                           | 16                                                                     | x264 quality                                         |
| `encoding.maxBitrateMbps`                | 100                                                                    | bitrate cap at 4K (scaled by pixel count)            |
| `encoding.container`                     | `mov`                                                                  | `mov` or `mp4`                                       |
| `slowMoConform`                          | `off`                                                                  | `25` / `30`: play ≥ 100 fps footage as slow motion   |
| `embedGps`                               | off                                                                    | keep GPS tags in delivered files                     |
| `creationTimeMode`                       | `auto`                                                                 | see [Location](#location)                            |
| `filenameTemplate`                       | `{subject}_{place}_{motion}_{date}_{n}`                                | placeholders `{subject} {place} {motion} {date} {n}` |
| `adobeAuthor`                            | `author`                                                               | used in the Adobe CSV file name                      |
| `copyright`                              | empty                                                                  | Pond5 `copyright`                                    |
| `pond5Price` / `pond5PriceLarge`         | 50 / 100                                                               | Pond5 prices, USD                                    |
| `envatoPriceSingle` / `envatoPriceMulti` | 15 / 30                                                                | Envato prices, USD (written as `$N`)                 |
| `poiRadiusM`                             | 2000                                                                   | landmark search radius                               |
| `nominatimUserAgent`                     | app name                                                               | **put your contact e-mail here** (Nominatim policy)  |
| `useOverpass`                            | off                                                                    | also query OpenStreetMap Overpass                    |
| `enabledPlatforms`                       | all four                                                               | platforms that get a CSV and validation badges       |

### CSV fields

All files are UTF-8, comma-separated, quoted per RFC 4180 (`csv-stringify`), one row per clip, header
exactly as listed. Violations of platform limits never stop the export: they become badges in the UI and
entries in `report.md`.

**Adobe Stock** — `adobe_stock_{author}_{yyyy_mm_dd}.csv`

| Column   | Value                                                         |
| -------- | ------------------------------------------------------------- |
| Filename | delivery file name                                            |
| Title    | ≤ 70 characters                                               |
| Keywords | 5–50, comma-separated, most relevant first, no technical data |
| Category | number from `config/adobe.json` (1 Animals … 21 Travel)       |
| Releases | empty                                                         |

**Shutterstock** — `shutterstock.csv`

| Column      | Value                                                         |
| ----------- | ------------------------------------------------------------- |
| Filename    | delivery file name                                            |
| Description | `Title. Description` if ≤ 200 characters, otherwise the title |
| Keywords    | 7–50, comma-separated                                         |
| Categories  | 1–2 values from `config/shutterstock.json`, comma-separated   |
| Editorial   | `Yes` / `No`                                                  |

**Pond5** — `pond5.csv`, columns in this order: `originalfilename, title (≤ 80), description (≤ 2000),
keywords (5–50), city, region, country, specifysource (drone model), containsaudio (no), release (empty),
copyright, price, pricelarge, editorial (yes/no), datecreated (mm/dd/yyyy)`. There are no `modelreleased` /
`propertyreleased` columns: Pond5 rejects the whole row ("You don't have access level high enough to set
modelreleased") for regular contributor accounts. Text is transliterated (é → e, Кижи → Kizhi) and the characters
`& å ñ é ß ® © § ç ä ø ü " ' ( ) \ / ? @ %` are removed (`&` → "and", `%` → "percent", `@` → "at").
Editorial clips get title and description in the form `City, Country YYYY/MM/DD: …` (the slashes of the date
are added after sanitising). Without a known capture date the export date is used and a warning is reported.

**Envato (Stock Video)** — `envato.csv`

| Column                                                                     | Value                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Filename\*, Title\* (< 100), Description\*                                 | from the metadata                                                                                                                                                                                |
| Keywords\*                                                                 | ≤ 50; only `a-z A-Z 0-9 .` and spaces, ≤ 100 characters each, not digits only, no leading dot, field ≤ 2048 characters; with `splitMultiwordKeywords: true` multi-word tags are split into words |
| Category                                                                   | one value from `config/envato.json`                                                                                                                                                              |
| Price: Single Use / Multi-use License ($USD)\*                             | `$N` from settings                                                                                                                                                                               |
| Recognisable people?                                                       | `No`                                                                                                                                                                                             |
| Recognisable buildings?                                                    | `Yes` / `No` (model answer, editable)                                                                                                                                                            |
| Is Motion Graphics?, AudioJungle Track (IDs)                               | empty                                                                                                                                                                                            |
| Color                                                                      | `Full Color`                                                                                                                                                                                     |
| Pace                                                                       | `Real Time` / `Slow Motion` / `Time Lapse` (from the shot type)                                                                                                                                  |
| Movement                                                                   | `Aerial, Drone` + `Arc` (orbit), `Tracking Left/Right` (pan), `Tilt Up/Down`                                                                                                                     |
| Composition / Setting                                                      | `Wide Shot` / `Outdoors`                                                                                                                                                                         |
| No. of People, Gender, Age, Ethnicity, Alpha Channel, Looped, Source Audio | empty                                                                                                                                                                                            |

### Updating categories, limits and prompts

- **Platform configs** live in `libs/api/stock-csv/config/*.json` (`adobe`, `shutterstock`, `pond5`, `envato`,
  `common`): header, categories, limits (title/keyword lengths, min/max duration, max file size), Envato
  pace/movement vocabularies, Pond5 forbidden characters, and the keyword stop lists. Each file has
  `lastVerified` (date of the last check) and `verified` (checked against the official template). Edit the
  JSON, update `lastVerified`, restart the API — no code change needed. The files are validated with zod at
  start-up, and a broken file stops the API with a readable error. The production build copies them to
  `dist/stock-config/`.
- **Adding a platform**: one adapter file in `libs/api/stock-csv/src/lib/adapters/` implementing
  `StockCsvAdapter` (+ its config JSON) and one line in `adapters/index.ts` (`ADAPTER_FACTORIES`); settings,
  validation badges, CSV export and the UI pick it up from that list.
- **Prompt**: `libs/api/llm/prompts/metadata.v1.md` (system part, `=== USER ===`, user part; placeholders
  `{{…}}`). Do not edit a released version in place: copy it to `metadata.v2.md` and set `PROMPT_VERSION` in
  `libs/api/llm/src/lib/prompt.ts`. The version is stored with every result and is part of the LLM step hash,
  so clips are regenerated after a version change only when they are re-run.

### Stage-2 API

```
POST /projects/:id/export          start (or resume) the export from manifest.json (confirm does this automatically)
POST /projects/:id/export/regenerate  discard the export and run every clip through the whole pipeline again
GET  /projects/:id/export          job, clips with status/context/metadata/validation, videos
PATCH /clips/:id/metadata          title, description, subject, keywords, categories, editorial, recognizableBuildings
POST /clips/:id/regenerate         { hint?, poiName? } — re-run the model
POST /clips/:id/retry              re-run a failed step
POST /clips/approve                { clipIds } — review → cut
POST /clips/:id/exclude            { excluded }
POST /clips/keywords               bulk { op: add | remove | replace, clipIds, … }
PATCH /videos/:id/location         { location } — manual location; re-runs geo and the model for its clips
GET  /clips/:id/frames/:index      preview frame (?variant=llm for the model input)
POST /projects/:id/export/build    build the archive in the background (202)
GET  /exports/:jobId/download      the ZIP (HTTP Range)
GET/PUT /settings/export           export settings
GET  /export/health                Ollama reachable + model installed
GET  /stock-platforms              registered platforms (label, lastVerified, verified)
GET  /stock-categories             category lists
```

### Tests

`pnpm nx run-many -t test` runs everything that does not need ffmpeg; `pnpm test:docker` adds frame
extraction and cutting with real ffmpeg (exact frame counts, slow-motion conform). The CSV adapters have
file snapshots in `libs/api/stock-csv/src/lib/adapters/__snapshots__/`. A test against a real Ollama is
opt-in:

```bash
OLLAMA_IT=1 [OLLAMA_IT_IMAGE=frame.jpg] pnpm nx test llm
```

### Platform templates: what is not verified

The official CSV templates can only be downloaded from the contributor dashboards, so the column layouts
and vocabularies here follow the task specification and are marked `verified: false` in the configs. Before
the first real upload, download each template and compare; **the platform's template wins** — fix the JSON
config (or the adapter) and set `verified: true`. Points to check in particular:

- **Envato**: exact spelling of the Stock Footage categories (`config/envato.json`), whether keywords may
  contain spaces (otherwise set `splitMultiwordKeywords: true`), the Movement / Pace vocabularies, and the
  maximum clip length (60 s assumed).
- **Pond5**: whether the editorial caption date keeps the slashes (`/` is otherwise a forbidden character),
  and the `release` format.
- **Shutterstock**: whether categories are separated by a comma, and the editorial caption format
  (Shutterstock usually wants "City, Country - Month Day, Year: …" for editorial).
- **Adobe Stock**: keyword separator (comma + space is used) and whether `Releases` may be left empty.
- Duration and file size limits in every config (`minDurationSec`, `maxDurationSec`, `maxFileSizeBytes`).

## Deviations from the original spec

- **No SRT telemetry** (by decision): `telemetryPath` in the manifest is never filled. Stage 2 reads the
  location from the video file itself (see [Location](#location)).
- **Analysis worker** — the API bundle itself (`main.js`) started in `worker_threads` with a flag in
  `workerData`: Nx esbuild cannot place extra entry points next to `main.js`, and this avoids worker path lookups.
- **Media serving** uses `@fastify/send` instead of `@fastify/static` (the latter had a type conflict with the zod type provider).
- There is no separate "rotation" motion type: a frame spinning around its centre (top-down) is classified as an orbit
  (content clockwise → `orbit_left`).
- An extra `queued` status between upload and processing.
- **Stage 2, location**: SRT files are not used; GPS comes from the file (ISO 6709 tag or the DJI `djmd`
  telemetry stream — the field layout is verified for DJI Mini 4 Pro; other DJI models are read with the same
  layout only if the values pass sanity checks). Gimbal yaw/pitch are not decoded; the camera heading is
  estimated from the flight direction for forward/backward flights only, otherwise landmarks are sorted by
  distance ("in view: unknown").
- **Stage 2, timelapse by elapsed time**: implemented (`detectShotType` with `realElapsedSec`), but there is no
  source of real elapsed time without SRT, so in practice timelapse/hyperlapse is detected from the file name
  and metadata.
- **Stage 2, adding a platform** needs one line in the adapter registry in addition to the adapter file.
- **Stage 2, LLM limits**: after the last retry an answer that only exceeds length limits is accepted and
  trimmed (instead of failing the clip); invalid structure, unknown categories or fewer than 5 keywords still
  fail it.
- **Stage 2, platform templates** were not checked against the official downloads (see above).
