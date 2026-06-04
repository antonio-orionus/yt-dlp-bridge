# yt-dlp-bridge

[![npm version](https://img.shields.io/npm/v/yt-dlp-bridge.svg)](https://www.npmjs.com/package/yt-dlp-bridge)
[![npm downloads](https://img.shields.io/npm/dm/yt-dlp-bridge.svg)](https://www.npmjs.com/package/yt-dlp-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js >=22.13](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen.svg)](package.json)

TypeScript primitives for building safe, policy-aware integrations on top of `yt-dlp`: command planning, argv generation, environment checks, process execution, output parsing, redaction, and structured errors.

`yt-dlp-bridge` is intentionally MCP-agnostic. It is the integration layer used by `yt-dlp-mcp-server`, but it can be used anywhere a Node.js service needs to plan or run `yt-dlp` without shell interpolation.

## Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Usage](#usage)
- [API Surface](#api-surface)
- [Configuration](#configuration)
- [Requirements](#requirements)
- [Development](#development)
- [Release](#release)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Features

- Source-derived option catalog generated from `yt_dlp.options.create_parser`.
- Safe argv builders that return argument arrays instead of shell command strings.
- Dependency-aware download and post-processing plans for `yt-dlp`, `ffmpeg`, `ffprobe`, external downloaders, browser impersonation, and JavaScript runtimes.
- Managed output policy for output roots, temp roots, archive files, overwrite behavior, and parent-directory traversal checks.
- Secret redaction for auth flags, cookies, signed URLs, and command previews.
- Parsers for JSON lines, format lists, subtitle lists, thumbnail lists, progress output, and final output paths.
- Structured error adaptation through [`ytdlp-errors`](https://www.npmjs.com/package/ytdlp-errors).
- ESM and TypeScript declarations out of the box.

## Quick Start

```bash
npm install yt-dlp-bridge
```

```ts
import {
  PlanDownloadInputSchema,
  loadConfig,
  planDownload
} from "yt-dlp-bridge";

const config = loadConfig();
const input = PlanDownloadInputSchema.parse({
  url: "https://www.youtube.com/watch?v=BaW_jenozKc",
  kind: "audio",
  postprocess: {
    audioFormat: "mp3"
  },
  output: {
    outputRoot: "audio"
  }
});

const plan = await planDownload(input, config);

console.log(plan.commandPreview.command);
console.log(plan.commandPreview.redactedArgs);
console.log(plan.requiredDependencies);
```

## Installation

For package consumers:

```bash
npm install yt-dlp-bridge
```

For source development, this repository uses pnpm:

```bash
git clone https://github.com/antonio-orionus/yt-dlp-bridge.git
cd yt-dlp-bridge
pnpm install
pnpm run build
pnpm test
```

## Usage

### Build Inspect Arguments

Use the Zod schemas to fill defaults before passing inputs into the low-level builders.

```ts
import { InspectInputSchema, buildMetadataArgs } from "yt-dlp-bridge";

const input = InspectInputSchema.parse({
  url: "https://www.youtube.com/watch?v=BaW_jenozKc"
});

const args = buildMetadataArgs(input);

console.log(args);
// ["--ignore-config", "--no-warnings", "--dump-json", "https://www.youtube.com/watch?v=BaW_jenozKc"]
```

### Plan a Download

`planDownload` resolves output policy, builds the final argv, redacts secrets, checks available dependencies, and explains risks and side effects before anything is downloaded.

```ts
import {
  PlanDownloadInputSchema,
  loadConfig,
  planDownload
} from "yt-dlp-bridge";

const config = loadConfig({
  YTDLP_MCP_OUTPUT_ROOT: "/srv/downloads",
  YTDLP_MCP_TEMP_ROOT: "/srv/downloads/.tmp"
});

const input = PlanDownloadInputSchema.parse({
  url: "https://www.youtube.com/watch?v=BaW_jenozKc",
  kind: "video",
  selection: {
    downloadArchive: "archive.txt"
  },
  format: {
    format: "bv*+ba/b"
  },
  output: {
    outputTemplate: "%(playlist_index)s-%(title).180B [%(id)s].%(ext)s"
  }
});

const plan = await planDownload(input, config);

console.log(plan.argv);
console.log(plan.risks);
console.log(plan.sideEffects);
```

### Run a Planned Command

The runner uses `spawn` with `shell: false`, bounded output capture, timeouts, and structured failures.

```ts
import {
  PlanDownloadInputSchema,
  loadConfig,
  planDownload,
  runCommand,
  toStructuredError
} from "yt-dlp-bridge";

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

### Inspect the Option Catalog

The bundled catalog in this release is generated from `yt_dlp.options.create_parser` for yt-dlp `2026.03.17` and contains 323 upstream options.

```ts
import {
  UPSTREAM_OPTION_CATALOG,
  findOptionByFlag,
  listLongFlags,
  optionMetadata
} from "yt-dlp-bridge";

const format = findOptionByFlag("--format");

console.log(UPSTREAM_OPTION_CATALOG.optionCount);
console.log(listLongFlags().includes("--dump-json"));
console.log(format ? optionMetadata(format) : undefined);
```

## API Surface

| Area | Exports |
| --- | --- |
| Argv builders | `ytdlpCommand`, `buildMetadataArgs`, `buildSingleJsonArgs`, `buildListArgs`, `buildSimulationArgs`, `buildDownloadArgs` |
| Planning | `planDownload`, `planPostprocess` |
| Configuration and environment | `loadConfig`, `CONFIG`, `checkEnvironment` |
| Filesystem policy | `resolveOutputPolicy`, `resolveManagedPath`, `ensureWithinRoot`, `isPathInside`, `isPathInsideWith`, `hasParentTraversal`, `ensureDirectory`, `readArchive` |
| Option catalog | `UPSTREAM_OPTION_CATALOG`, `listLongFlags`, `findOptionByFlag`, `optionMetadata` |
| Parsers | `parseJsonLines`, `sanitizeMetadataItem`, `sanitizeMetadataItems`, `paginate`, `parseFormats`, `parseSubtitles`, `parseThumbnails`, `parseProgress`, `parseFinalPaths` |
| Process and errors | `runCommand`, `CommandExecutionError`, `toStructuredError` |
| Redaction | `redactArgs`, `redactText`, `excerpt` |
| Schemas and types | Zod input schemas and TypeScript interfaces exported from `src/index.ts` |

## Configuration

`loadConfig()` reads environment variables and applies conservative defaults.

| Variable | Default | Purpose |
| --- | --- | --- |
| `YTDLP_MCP_YTDLP_PATH` or `YTDLP_PATH` | `yt-dlp` | Path or command name used for `yt-dlp`. |
| `YTDLP_MCP_FFMPEG_PATH` or `FFMPEG_PATH` | `ffmpeg` | Optional ffmpeg override for environment checks. |
| `YTDLP_MCP_FFPROBE_PATH` or `FFPROBE_PATH` | `ffprobe` | Optional ffprobe override for environment checks. |
| `YTDLP_MCP_OUTPUT_ROOT` | `~/Downloads/yt-dlp-mcp` | Managed output root. |
| `YTDLP_MCP_TEMP_ROOT` | OS temp directory under `yt-dlp-mcp` | Managed temp root. |
| `YTDLP_MCP_ALLOW_ARBITRARY_OUTPUT_PATHS` | `false` | Allows output and temp paths outside the configured roots. |
| `YTDLP_MCP_ALLOW_CONFIG_FILES` | `false` | Allows user-provided cookies, netrc, and related config-file inputs unless they match server-level settings. |
| `YTDLP_MCP_COOKIES_FILE` | unset | Server-level cookies file. |
| `YTDLP_MCP_COOKIES_FROM_BROWSER` | unset | Server-level browser cookie source for `--cookies-from-browser`. |
| `YTDLP_MCP_ENABLE_EXPERT` | `false` | Enables higher-risk expert-mode integrations in callers that expose them. |
| `YTDLP_MCP_TIMEOUT_MS` | `900000` | Default command timeout. |
| `YTDLP_MCP_MAX_OUTPUT_BYTES` | `4194304` | Maximum retained stdout or stderr bytes. |
| `YTDLP_MCP_JS_RUNTIMES` | `deno,node,bun,quickjs` | JavaScript runtimes considered for extractor challenges. |

## Requirements

- Node.js >= 22.13.
- ESM import support.
- `yt-dlp` installed when planning or running real yt-dlp workflows.
- `ffmpeg` and `ffprobe` for audio extraction, audio/video merge, remuxing, recoding, segment editing, subtitle conversion, thumbnail conversion, and embedding workflows.
- Python `yt_dlp` package, or `PYTHONPATH` pointed at a yt-dlp source checkout, when regenerating or verifying the option catalog.

## Development

| Command | Description |
| --- | --- |
| `pnpm run build` | Compile TypeScript and copy generated assets into `dist`. |
| `pnpm test` | Run Vitest tests. |
| `pnpm run typecheck` | Run TypeScript without emitting files. |
| `pnpm run generate:options` | Regenerate the source-derived yt-dlp option catalog from Python `yt_dlp`. |
| `pnpm run verify:options` | Verify that the generated option catalog matches Python `yt_dlp`. |
| `pnpm pack --dry-run` | Preview the package contents before publishing. |

## Release

GitHub Actions handles CI and npm publishing:

- `.github/workflows/ci.yml` runs typecheck, tests, build, and package dry-run on pull requests and pushes to `main`.
- `.github/workflows/publish.yml` publishes to npm when a `vX.Y.Z` tag is pushed and the tag matches `package.json`.
- Publishing uses npm trusted publishing with GitHub Actions OIDC and `npm publish --access public`; no `NPM_TOKEN` secret is required when the trusted publisher is configured. npm automatically generates provenance for trusted publishes from GitHub Actions.

The npm trusted publisher should point at:

```text
repository: antonio-orionus/yt-dlp-bridge
workflow file: publish.yml
environment: npm
```

Release flow:

```bash
pnpm version patch
git push origin main --follow-tags
```

## Project Structure

```text
yt-dlp-bridge/
├── .github/workflows/    # CI and npm publish automation
├── src/                 # TypeScript source and generated option catalog
├── tests/               # Vitest coverage for argv, policy, parsers, planning, and errors
├── scripts/             # Option catalog generation and package asset scripts
├── dist/                # Built package output
├── package.json         # Package metadata, exports, scripts, and npm keywords
└── README.md            # Package and repository documentation
```

## Troubleshooting

### `yt-dlp` is missing

Install `yt-dlp` or set `YTDLP_MCP_YTDLP_PATH` to the executable path. `checkEnvironment()` reports the detected command, status, version, and notes.

### `ffmpeg` or `ffprobe` is missing

Install the missing binary or set `YTDLP_MCP_FFMPEG_PATH` and `YTDLP_MCP_FFPROBE_PATH`. Planning still returns dependency information so callers can explain which workflow requires the missing tool.

### `auth.cookiesFile requires YTDLP_MCP_ALLOW_CONFIG_FILES=true`

User-provided config-file paths are blocked by default. Prefer server-level `YTDLP_MCP_COOKIES_FILE` or enable `YTDLP_MCP_ALLOW_CONFIG_FILES=true` only when the caller has reviewed the trust boundary.

### `outputTemplate must not contain parent-directory traversal`

Relative output templates cannot contain `..` path segments unless arbitrary output paths are explicitly allowed by policy.

## Contributing

Use the development commands above before opening a pull request. Bugs and feature requests can be reported through [GitHub Issues](https://github.com/antonio-orionus/yt-dlp-bridge/issues).

## License

[MIT](LICENSE)
