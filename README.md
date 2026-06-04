# yt-dlp-bridge

[![npm version](https://img.shields.io/npm/v/yt-dlp-bridge.svg)](https://www.npmjs.com/package/yt-dlp-bridge)
[![npm downloads](https://img.shields.io/npm/dm/yt-dlp-bridge.svg)](https://www.npmjs.com/package/yt-dlp-bridge)
[![CI](https://github.com/antonio-orionus/yt-dlp-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/antonio-orionus/yt-dlp-bridge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

TypeScript library for safe, no-shell `yt-dlp` integration in Node.js services: policy-aware command planning, argv generation, environment checks, process execution, output parsing, secret redaction, and structured errors.

`yt-dlp-bridge` is intentionally MCP-agnostic. It is the integration layer used by `yt-dlp-mcp-server`, but it works anywhere a Node.js service needs to plan or run `yt-dlp` without shell interpolation.

- [Install](#install)
- [Features](#features)
- [Usage](#usage)
- [API](#api)
- [Configuration](#configuration)
- [Requirements](#requirements)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Install

```bash
npm install yt-dlp-bridge
# pnpm add yt-dlp-bridge
# yarn add yt-dlp-bridge
# bun add yt-dlp-bridge
```

Requires Node.js >= 22.13 and ESM.

```ts
import { PlanDownloadInputSchema, loadConfig, planDownload } from "yt-dlp-bridge";

const config = loadConfig();
const input = PlanDownloadInputSchema.parse({
  url: "https://www.youtube.com/watch?v=BaW_jenozKc",
  kind: "audio",
  postprocess: { audioFormat: "mp3" },
  output: { outputRoot: "audio" }
});

const plan = await planDownload(input, config);
console.log(plan.commandPreview.redactedArgs);
console.log(plan.requiredDependencies);
```

## Features

- Source-derived option catalog generated from `yt_dlp.options.create_parser`.
- Safe argv builders that return argument arrays instead of shell command strings.
- Dependency-aware download and post-processing plans for `yt-dlp`, `ffmpeg`, `ffprobe`, external downloaders, browser impersonation, and JavaScript runtimes.
- Managed output policy for output roots, temp roots, archive files, overwrite behavior, and parent-directory traversal checks.
- Secret redaction for auth flags, cookies, signed URLs, and command previews.
- Parsers for JSON lines, format lists, subtitle lists, thumbnail lists, progress output, and final output paths.
- Structured error adaptation through [`ytdlp-errors`](https://www.npmjs.com/package/ytdlp-errors).
- ESM and TypeScript declarations.

## Usage

### Inspect metadata

Use the Zod schemas to fill defaults before passing inputs into the low-level builders.

```ts
import { InspectInputSchema, buildMetadataArgs } from "yt-dlp-bridge";

const input = InspectInputSchema.parse({
  url: "https://www.youtube.com/watch?v=BaW_jenozKc"
});
const args = buildMetadataArgs(input);
// ["--ignore-config", "--no-warnings", "--dump-json", "https://www.youtube.com/watch?v=BaW_jenozKc"]
```

### Plan a download

`planDownload` resolves output policy, builds the final argv, redacts secrets, checks available dependencies, and explains risks and side effects before anything is downloaded.

```ts
import { PlanDownloadInputSchema, loadConfig, planDownload } from "yt-dlp-bridge";

const config = loadConfig({
  YTDLP_MCP_OUTPUT_ROOT: "/srv/downloads",
  YTDLP_MCP_TEMP_ROOT: "/srv/downloads/.tmp"
});
const input = PlanDownloadInputSchema.parse({
  url: "https://www.youtube.com/watch?v=BaW_jenozKc",
  kind: "video",
  selection: { downloadArchive: "archive.txt" },
  format: { format: "bv*+ba/b" },
  output: { outputTemplate: "%(playlist_index)s-%(title).180B [%(id)s].%(ext)s" }
});

const plan = await planDownload(input, config);
console.log(plan.argv);
console.log(plan.risks);
console.log(plan.sideEffects);
```

### Run a planned command

The runner uses `spawn` with `shell: false`, bounded output capture, timeouts, and structured failures.

```ts
import { PlanDownloadInputSchema, loadConfig, planDownload, runCommand, toStructuredError } from "yt-dlp-bridge";

const config = loadConfig();
const input = PlanDownloadInputSchema.parse({
  url: "https://www.youtube.com/watch?v=BaW_jenozKc",
  kind: "video"
});
const plan = await planDownload(input, config);

try {
  const result = await runCommand(plan.commandPreview.command, plan.commandPreview.args, {
    timeoutMs: config.defaultTimeoutMs,
    maxOutputBytes: config.maxOutputBytes
  });
  console.log(result.stdout);
} catch (error) {
  console.error(toStructuredError(error));
}
```

### Query the option catalog

The bundled catalog is generated from `yt_dlp.options.create_parser` for yt-dlp `2026.03.17` and contains 323 upstream options.

```ts
import { UPSTREAM_OPTION_CATALOG, findOptionByFlag, listLongFlags, optionMetadata } from "yt-dlp-bridge";

const format = findOptionByFlag("--format");
console.log(UPSTREAM_OPTION_CATALOG.optionCount);         // 323
console.log(listLongFlags().includes("--dump-json"));     // true
console.log(format ? optionMetadata(format) : undefined);
```

## API

| Area | Exports |
| --- | --- |
| Argv builders | `ytdlpCommand`, `buildMetadataArgs`, `buildSingleJsonArgs`, `buildListArgs`, `buildSimulationArgs`, `buildDownloadArgs` |
| Planning | `planDownload`, `planPostprocess` |
| Config and environment | `loadConfig`, `CONFIG`, `checkEnvironment` |
| Filesystem policy | `resolveOutputPolicy`, `resolveManagedPath`, `ensureWithinRoot`, `isPathInside`, `isPathInsideWith`, `hasParentTraversal`, `ensureDirectory`, `readArchive` |
| Option catalog | `UPSTREAM_OPTION_CATALOG`, `listLongFlags`, `findOptionByFlag`, `optionMetadata` |
| Parsers | `parseJsonLines`, `sanitizeMetadataItem`, `sanitizeMetadataItems`, `paginate`, `parseFormats`, `parseSubtitles`, `parseThumbnails`, `parseProgress`, `parseFinalPaths` |
| Process and errors | `runCommand`, `CommandExecutionError`, `toStructuredError` |
| Redaction | `redactArgs`, `redactText`, `excerpt` |
| Schemas and types | Zod input schemas and TypeScript interfaces |

## Configuration

`loadConfig(env?)` reads environment variables and applies conservative defaults. Pass a partial `ProcessEnv` object to override specific values.

| Variable | Default | Purpose |
| --- | --- | --- |
| `YTDLP_MCP_YTDLP_PATH` or `YTDLP_PATH` | `yt-dlp` | Path or command name for `yt-dlp`. |
| `YTDLP_MCP_FFMPEG_PATH` or `FFMPEG_PATH` | `ffmpeg` | Optional ffmpeg override for environment checks. |
| `YTDLP_MCP_FFPROBE_PATH` or `FFPROBE_PATH` | `ffprobe` | Optional ffprobe override for environment checks. |
| `YTDLP_MCP_OUTPUT_ROOT` | `~/Downloads/yt-dlp-mcp` | Managed output root. |
| `YTDLP_MCP_TEMP_ROOT` | OS temp under `yt-dlp-mcp` | Managed temp root. |
| `YTDLP_MCP_ALLOW_ARBITRARY_OUTPUT_PATHS` | `false` | Allow output paths outside the configured roots. |
| `YTDLP_MCP_ALLOW_CONFIG_FILES` | `false` | Allow user-provided cookies, netrc, and config-file inputs. |
| `YTDLP_MCP_ALLOW_PLUGIN_DIRS` | `false` | Allow user-provided plugin directory paths. |
| `YTDLP_MCP_COOKIES_FILE` | unset | Server-level cookies file. |
| `YTDLP_MCP_COOKIES_FROM_BROWSER` | unset | Server-level browser cookie source for `--cookies-from-browser`. |
| `YTDLP_MCP_ENABLE_EXPERT` | `false` | Enable higher-risk expert-mode integrations. |
| `YTDLP_MCP_TIMEOUT_MS` | `900000` | Default command timeout (ms). |
| `YTDLP_MCP_MAX_OUTPUT_BYTES` | `4194304` | Maximum retained stdout/stderr bytes. |
| `YTDLP_MCP_JS_RUNTIMES` | `deno,node,bun,quickjs` | JavaScript runtimes considered for extractor challenges. |

## Requirements

- Node.js >= 22.13, ESM.
- `yt-dlp` installed when planning or running yt-dlp workflows.
- `ffmpeg` and `ffprobe` for audio extraction, merge, remux, recode, segment editing, subtitle/thumbnail conversion, and embedding workflows.
- Python `yt_dlp` package (or `PYTHONPATH` pointing at a yt-dlp checkout) when regenerating or verifying the option catalog.

## Development

```bash
git clone https://github.com/antonio-orionus/yt-dlp-bridge.git
cd yt-dlp-bridge
pnpm install
```

| Command | Description |
| --- | --- |
| `pnpm run build` | Compile TypeScript and copy generated assets into `dist`. |
| `pnpm test` | Run Vitest tests. |
| `pnpm run typecheck` | TypeScript check without emitting. |
| `pnpm run generate:options` | Regenerate the option catalog from Python `yt_dlp`. |
| `pnpm run verify:options` | Verify the catalog matches Python `yt_dlp`. |

## Troubleshooting

**`yt-dlp` is missing** — Install `yt-dlp` or set `YTDLP_MCP_YTDLP_PATH`. `checkEnvironment()` reports detected command, status, version, and notes.

**`ffmpeg`/`ffprobe` missing** — Install the binary or set `YTDLP_MCP_FFMPEG_PATH` / `YTDLP_MCP_FFPROBE_PATH`. Planning still returns dependency info so callers can surface which workflow requires the missing tool.

**`auth.cookiesFile requires YTDLP_MCP_ALLOW_CONFIG_FILES=true`** — User-provided config-file paths are blocked by default. Prefer server-level `YTDLP_MCP_COOKIES_FILE` or enable `YTDLP_MCP_ALLOW_CONFIG_FILES=true` only after reviewing the trust boundary.

**`outputTemplate must not contain parent-directory traversal`** — Relative templates cannot contain `..` segments unless `YTDLP_MCP_ALLOW_ARBITRARY_OUTPUT_PATHS=true`.

Bugs and feature requests: [GitHub Issues](https://github.com/antonio-orionus/yt-dlp-bridge/issues).

## License

[MIT](LICENSE)
