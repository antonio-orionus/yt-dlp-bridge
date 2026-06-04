import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDownloadArgs,
  buildMetadataArgs,
  CommandExecutionError,
  listLongFlags,
  loadConfig,
  parseFinalPaths,
  parseFormats,
  parseJsonLines,
  parseProgress,
  parseSubtitles,
  parseThumbnails,
  planDownload,
  redactArgs,
  redactText,
  resolveOutputPolicy,
  toStructuredError,
  isPathInsideWith,
  UPSTREAM_OPTION_CATALOG
} from "../src/index.js";

type PlanInput = Parameters<typeof planDownload>[0];

function makePlanInput(overrides: Partial<PlanInput> = {}): PlanInput {
  const base: PlanInput = {
    url: "https://example.com/video",
    kind: "video",
    format: { formatSort: [] },
    output: { allowOverwrite: false },
    network: {},
    selection: { matchFilters: [], breakMatchFilters: [] },
    download: { retrySleep: [], downloadSections: [], downloader: [], downloaderArgs: [] },
    subtitles: {},
    thumbnails: {},
    auth: {},
    postprocess: { postprocessorArgs: [], parseMetadata: [], replaceInMetadata: [], removeChapters: [], usePostprocessor: [] },
    sponsorblock: {},
    extractor: { extractorArgs: [] }
  };

  return {
    ...base,
    ...overrides,
    format: { ...base.format, ...overrides.format },
    output: { ...base.output, ...overrides.output },
    network: { ...base.network, ...overrides.network },
    selection: { ...base.selection, ...overrides.selection },
    download: { ...base.download, ...overrides.download },
    subtitles: { ...base.subtitles, ...overrides.subtitles },
    thumbnails: { ...base.thumbnails, ...overrides.thumbnails },
    auth: { ...base.auth, ...overrides.auth },
    postprocess: { ...base.postprocess, ...overrides.postprocess },
    sponsorblock: { ...base.sponsorblock, ...overrides.sponsorblock },
    extractor: { ...base.extractor, ...overrides.extractor }
  };
}

describe("source-derived option catalog", () => {
  it("contains the upstream parser-derived yt-dlp option surface", () => {
    expect(UPSTREAM_OPTION_CATALOG.source).toBe("yt_dlp.options.create_parser");
    expect(UPSTREAM_OPTION_CATALOG.optionCount).toBeGreaterThan(300);
    expect(listLongFlags()).toContain("--dump-json");
    expect(listLongFlags()).toContain("--merge-output-format");
    expect(listLongFlags()).toContain("--extractor-args");
  });
});

describe("argv generation", () => {
  it("builds metadata args without shell interpolation", () => {
    const args = buildMetadataArgs({
      url: "https://example.com/watch?v=abc",
      responseFormat: "json",
      flatPlaylist: false,
      limit: 50,
      offset: 0,
      auth: {},
      network: {}
    });

    expect(args).toEqual(["--ignore-config", "--no-warnings", "--dump-json", "https://example.com/watch?v=abc"]);
  });

  it("builds audio download args with extraction and safe output policy", () => {
    const config = loadConfig({ YTDLP_MCP_OUTPUT_ROOT: path.join(os.tmpdir(), "yt-dlp-bridge-test") });
    const policy = resolveOutputPolicy(config, {});
    const args = buildDownloadArgs(
      makePlanInput({ kind: "audio" }),
      policy,
      config
    );

    expect(args).toContain("--extract-audio");
    expect(args).toContain("--no-overwrites");
    expect(args).toContain("--paths");
    expect(args.at(-1)).toBe("https://example.com/video");
  });

  it("rejects input-provided auth file sources unless server policy allows them", () => {
    const input = {
      url: "https://example.com/watch?v=abc",
      responseFormat: "json" as const,
      flatPlaylist: false,
      limit: 50,
      offset: 0,
      auth: { cookiesFile: path.join(os.tmpdir(), "cookies.txt") },
      network: {}
    };

    expect(() => buildMetadataArgs(input)).toThrow(/auth\.cookiesFile/);
    expect(buildMetadataArgs(input, loadConfig({ YTDLP_MCP_COOKIES_FILE: input.auth.cookiesFile }))).toContain(input.auth.cookiesFile);
  });
});

describe("filesystem policy", () => {
  it("rejects parent-directory traversal in relative output templates", () => {
    const config = loadConfig({ YTDLP_MCP_OUTPUT_ROOT: path.join(os.tmpdir(), "yt-dlp-bridge-test") });
    expect(() => resolveOutputPolicy(config, { outputTemplate: "../outside.%(ext)s" })).toThrow(/parent-directory traversal/);
    expect(() => resolveOutputPolicy(config, { outputTemplate: "..\\outside.%(ext)s" })).toThrow(/parent-directory traversal/);
  });

  it("checks path containment with Windows path semantics", () => {
    expect(isPathInsideWith(path.win32, "C:\\downloads", "C:\\downloads\\video.mp4")).toBe(true);
    expect(isPathInsideWith(path.win32, "C:\\downloads", "C:\\other\\video.mp4")).toBe(false);
  });

  it("resolves managed roots and archive files under configured roots", () => {
    const config = loadConfig({
      YTDLP_MCP_OUTPUT_ROOT: path.join(os.tmpdir(), "yt-dlp-bridge-test", "downloads"),
      YTDLP_MCP_TEMP_ROOT: path.join(os.tmpdir(), "yt-dlp-bridge-test", "temp")
    });
    const policy = resolveOutputPolicy(config, { outputRoot: "playlist", tempRoot: "job-1" });
    const args = buildDownloadArgs(makePlanInput({ selection: { matchFilters: [], breakMatchFilters: [], downloadArchive: "archive.txt" } }), policy, config);
    const archiveIndex = args.indexOf("--download-archive");

    expect(policy.outputRoot).toBe(path.join(config.outputRoot, "playlist"));
    expect(policy.tempRoot).toBe(path.join(config.tempRoot, "job-1"));
    expect(args[archiveIndex + 1]).toBe(path.join(policy.outputRoot, "archive.txt"));
  });

  it("rejects temp roots outside the configured temp root", () => {
    const config = loadConfig({
      YTDLP_MCP_OUTPUT_ROOT: path.join(os.tmpdir(), "yt-dlp-bridge-test", "downloads"),
      YTDLP_MCP_TEMP_ROOT: path.join(os.tmpdir(), "yt-dlp-bridge-test", "temp")
    });

    expect(() => resolveOutputPolicy(config, { tempRoot: path.dirname(config.tempRoot) })).toThrow(/tempRoot/);
  });
});

describe("redaction", () => {
  it("redacts secret args and signed URL query parameters", () => {
    expect(redactArgs(["--password", "secret", "--cookies", "/tmp/cookies.txt"])).toEqual(["--password", "[REDACTED]", "--cookies", "[REDACTED]"]);
    expect(redactText("https://example.com/video?X-Amz-Signature=secret&x=1")).toContain("X-Amz-Signature=[REDACTED]");
  });
});

describe("structured parsers", () => {
  it("parses JSON lines and reports invalid lines", () => {
    const parsed = parseJsonLines('{"id":"a"}\nnot-json\n{"id":"b"}');
    expect(parsed.items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(parsed.parseErrors).toHaveLength(1);
  });

  it("parses common yt-dlp list/progress outputs", () => {
    expect(parseFormats("ID  EXT RESOLUTION | NOTE\n137 mp4 1920x1080 30fps | video only")).toMatchObject([{ formatId: "137", extension: "mp4", resolution: "1920x1080", fps: 30 }]);
    expect(parseSubtitles("Available subtitles for id:\nLanguage Name Formats\nen English vtt, ttml")).toMatchObject([{ language: "en", source: "manual" }]);
    expect(parseThumbnails("ID Width Height URL\n0 1280 720 https://example.com/thumb.jpg")).toMatchObject([{ id: "0", url: "https://example.com/thumb.jpg" }]);
    expect(parseProgress("[download]  42.0% of 10.00MiB at 1.00MiB/s ETA 00:05")).toMatchObject([{ phase: "download", percent: 42 }]);
    expect(parseFinalPaths("[download] done\n/tmp/video.mp4").paths).toEqual(["/tmp/video.mp4"]);
  });
});

describe("planner dependency inference", () => {
  it("requires ffmpeg and ffprobe for audio extraction", async () => {
    const config = loadConfig({
      YTDLP_MCP_YTDLP_PATH: process.execPath,
      YTDLP_MCP_OUTPUT_ROOT: path.join(os.tmpdir(), "yt-dlp-bridge-test"),
      YTDLP_MCP_TIMEOUT_MS: "1000"
    });
    const plan = await planDownload(
      makePlanInput({ kind: "audio" }),
      config
    );

    expect(plan.requiredDependencies.map((dependency) => dependency.name)).toEqual(expect.arrayContaining(["yt-dlp", "ffmpeg", "ffprobe"]));
    expect(plan.requiredDependencies.find((dependency) => dependency.name === "ffmpeg")?.requiredFor.join(" ")).toMatch(/audio extraction/);
    expect(plan.requiredDependencies.find((dependency) => dependency.name === "ffmpeg")?.requiredFor.join(" ")).not.toMatch(/audio\/video merge/);
  });

  it("explains multiple ffmpeg requirements in one plan", async () => {
    const config = loadConfig({
      YTDLP_MCP_YTDLP_PATH: process.execPath,
      YTDLP_MCP_OUTPUT_ROOT: path.join(os.tmpdir(), "yt-dlp-bridge-test"),
      YTDLP_MCP_TIMEOUT_MS: "1000"
    });
    const plan = await planDownload(
      makePlanInput({
        format: { format: "137+140", formatSort: [], mergeOutputFormat: "mp4" },
        subtitles: { convertSubs: "srt" },
        thumbnails: { convertThumbnails: "jpg" },
        postprocess: { postprocessorArgs: [], parseMetadata: [], replaceInMetadata: [], removeChapters: ["sponsor"], usePostprocessor: [] }
      }),
      config
    );
    const reasons = plan.requiredDependencies.find((dependency) => dependency.name === "ffmpeg")?.requiredFor.join("\n") ?? "";

    expect(reasons).toMatch(/audio\/video merge/);
    expect(reasons).toMatch(/remux requested/);
    expect(reasons).toMatch(/subtitle conversion/);
    expect(reasons).toMatch(/thumbnail conversion/);
    expect(reasons).toMatch(/chapter or SponsorBlock/);
  });
});

describe("structured error adapter", () => {
  it("classifies command stderr through ytdlp-errors", () => {
    const error = new CommandExecutionError("failed", {
      command: "yt-dlp",
      args: ["https://example.com"],
      stdout: "",
      stderr: "ERROR: Unsupported URL: https://example.com",
      exitCode: 1,
      durationMs: 10
    });

    expect(toStructuredError(error)).toMatchObject({ kind: "unsupportedUrl", retryable: false, exitCode: 1 });
  });
});
