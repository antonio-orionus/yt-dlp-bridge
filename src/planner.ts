import type { z } from "zod";
import { buildDownloadArgs } from "./argv.js";
import { CONFIG, type ServerConfig } from "./config.js";
import { resolveManagedPath, resolveOutputPolicy } from "./filesystem.js";
import { redactArgs } from "./redaction.js";
import {
  type PlanDownloadInputSchema,
  type PostprocessInputSchema
} from "./schemas.js";
import type { DetectedDependency, DownloadPlan } from "./types.js";
import { checkEnvironment } from "./environment.js";

type PlanDownloadInput = z.infer<typeof PlanDownloadInputSchema>;
type PostprocessInput = z.infer<typeof PostprocessInputSchema>;

export async function planDownload(input: PlanDownloadInput, config: ServerConfig = CONFIG): Promise<DownloadPlan> {
  const outputPolicy = resolveOutputPolicy(config, input.output);
  const argv = buildDownloadArgs(input, outputPolicy, config);
  const dependencyReasons = requiredDependencyReasons(input);
  const optionalReasons = optionalDependencyReasons(input);
  const environment = await checkEnvironment(config);

  const plan: DownloadPlan = {
    intent: input.kind,
    url: input.url,
    argv,
    redactedArgv: redactArgs(argv),
    outputRoot: outputPolicy.outputRoot,
    outputTemplate: outputPolicy.outputTemplate,
    tempRoot: outputPolicy.tempRoot,
    formatSort: input.format.formatSort,
    requiredDependencies: pickDependencies(environment.dependencies, dependencyReasons),
    optionalDependencies: pickDependencies(environment.dependencies, optionalReasons),
    risks: risksFor(input),
    sideEffects: sideEffectsFor(input, outputPolicy.allowOverwrite),
    commandPreview: {
      command: config.ytdlpPath,
      args: argv,
      redactedArgs: redactArgs(argv)
    },
    overwrite: outputPolicy.allowOverwrite,
    cookies: cookiePlan(input, config),
    expertMode: false
  };

  if (input.format.format) plan.selectedFormat = input.format.format;
  if (input.selection.downloadArchive) {
    plan.archive = {
      path: resolveManagedPath(outputPolicy.outputRoot, input.selection.downloadArchive, "downloadArchive", config.allowArbitraryOutputPaths),
      mode: "read-write"
    };
  }

  return plan;
}

export async function planPostprocess(input: PostprocessInput, config: ServerConfig = CONFIG): Promise<Record<string, unknown>> {
  const dependencyReasons = requiredPostprocessDependencyReasons(input);
  const environment = await checkEnvironment(config);
  const outputPolicy = resolveOutputPolicy(config, input.output);
  return {
    intent: "postprocess",
    url: input.url,
    inputFile: input.inputFile,
    outputRoot: outputPolicy.outputRoot,
    outputTemplate: outputPolicy.outputTemplate,
    tempRoot: outputPolicy.tempRoot,
    requiredDependencies: pickDependencies(environment.dependencies, dependencyReasons),
    risks: postprocessRisks(input),
    sideEffects: postprocessSideEffects(input),
    cookies: {
      enabled: Boolean(input.auth.cookiesFile ?? input.auth.cookiesFromBrowser ?? config.cookiesFile ?? config.cookiesFromBrowser)
    }
  };
}

function requiredDependencyReasons(input: PlanDownloadInput): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  addReason(deps, "yt-dlp", "execute all yt-dlp workflows");
  for (const reason of ffmpegReasons(input)) addReason(deps, "ffmpeg", reason);
  if (needsFfprobe(input)) addReason(deps, "ffprobe", "inspect media streams for audio extraction or conversion");
  for (const downloader of input.download.downloader) {
    const binary = downloader.split(":").pop()?.trim();
    if (binary && !["default", "native"].includes(binary)) addReason(deps, binary, "requested external downloader");
  }
  if (input.network.impersonate) addReason(deps, "curl_cffi", "requested browser impersonation target");
  return deps;
}

function optionalDependencyReasons(input: PlanDownloadInput): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  if (input.extractor.youtube?.fetchPot || input.extractor.youtube?.poToken.length) addReason(deps, "deno", "optional JavaScript runtime for extractor challenges");
  if (input.extractor.youtube?.fetchPot || input.extractor.youtube?.poToken.length) addReason(deps, "node", "optional JavaScript runtime for extractor challenges");
  if (input.postprocess.embedThumbnail) addReason(deps, "AtomicParsley", "legacy thumbnail embedding fallback");
  return deps;
}

function requiredPostprocessDependencyReasons(input: Pick<PostprocessInput, "postprocess" | "sponsorblock">): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  if (
    input.postprocess.extractAudio ||
    input.postprocess.audioFormat ||
    input.postprocess.remuxVideo ||
    input.postprocess.recodeVideo ||
    input.postprocess.embedSubs ||
    input.postprocess.embedThumbnail ||
    input.postprocess.embedMetadata ||
    input.postprocess.embedChapters ||
    input.postprocess.embedInfoJson ||
    input.postprocess.concatPlaylist ||
    input.postprocess.splitChapters ||
    input.postprocess.removeChapters.length > 0 ||
    input.sponsorblock.remove
  ) {
    addReason(deps, "ffmpeg", "requested postprocessing requires muxing, conversion, embedding, section edits, or segment removal");
  }
  if (input.postprocess.extractAudio || input.postprocess.audioFormat) addReason(deps, "ffprobe", "audio extraction/conversion needs stream probing");
  return deps;
}

function needsFfprobe(input: PlanDownloadInput): boolean {
  return input.kind === "audio" || input.postprocess.extractAudio || Boolean(input.postprocess.audioFormat);
}

function risksFor(input: PlanDownloadInput): string[] {
  const risks: string[] = [];
  if (input.kind === "video" && (!input.format.format || input.format.format.includes("+"))) {
    risks.push("Default or combined format selection may choose separate audio/video streams; merging requires ffmpeg.");
  }
  if (input.kind === "playlist") risks.push("Playlist downloads can create many files; use playlist ranges and download archives for repeatable runs.");
  if (input.auth.password || input.auth.twofactor || input.auth.videoPassword) risks.push("Authentication secrets are accepted and will be redacted from command previews and errors.");
  if (input.download.downloaderArgs.length > 0 || input.postprocess.postprocessorArgs.length > 0) risks.push("Advanced downloader/postprocessor args can change process behavior; prefer reviewed presets.");
  if (input.sponsorblock.remove) risks.push("SponsorBlock removal changes media content and requires ffmpeg.");
  if (input.selection.downloadArchive) risks.push("Download archive will be written by yt-dlp using extractor IDs.");
  return risks;
}

function postprocessRisks(input: PostprocessInput): string[] {
  const risks: string[] = [];
  if (input.postprocess.recodeVideo) risks.push("Recoding can be slow and lossy depending on codec/container choices.");
  if (input.postprocess.removeChapters.length > 0) risks.push("Chapter removal changes media content.");
  if (input.sponsorblock.remove) risks.push("SponsorBlock removal changes media content.");
  if (input.postprocess.postprocessorArgs.length > 0) risks.push("Postprocessor args are advanced and should be reviewed.");
  return risks;
}

function sideEffectsFor(input: PlanDownloadInput, overwrite: boolean): string[] {
  const sideEffects = ["create output files", "create temporary files"];
  if (overwrite) sideEffects.push("overwrite existing files");
  if (input.selection.downloadArchive) sideEffects.push("update download archive");
  if (input.kind === "audio" || input.postprocess.extractAudio) sideEffects.push("extract audio with ffmpeg");
  if (input.postprocess.remuxVideo) sideEffects.push("remux media container");
  if (input.postprocess.recodeVideo) sideEffects.push("recode media");
  if (input.postprocess.embedSubs || input.postprocess.embedThumbnail || input.postprocess.embedMetadata) sideEffects.push("embed assets/metadata");
  if (input.sponsorblock.remove) sideEffects.push("remove SponsorBlock segments");
  return sideEffects;
}

function postprocessSideEffects(input: PostprocessInput): string[] {
  const sideEffects: string[] = [];
  if (input.postprocess.remuxVideo) sideEffects.push("remux media container");
  if (input.postprocess.recodeVideo) sideEffects.push("recode media");
  if (input.postprocess.extractAudio || input.postprocess.audioFormat) sideEffects.push("extract or convert audio");
  if (input.postprocess.embedSubs || input.postprocess.embedThumbnail || input.postprocess.embedMetadata) sideEffects.push("embed assets/metadata");
  if (input.postprocess.splitChapters) sideEffects.push("split media by chapters");
  if (input.postprocess.removeChapters.length > 0 || input.sponsorblock.remove) sideEffects.push("remove media segments");
  return sideEffects;
}

function cookiePlan(input: PlanDownloadInput, config: ServerConfig): DownloadPlan["cookies"] {
  const file = input.auth.cookiesFile ?? config.cookiesFile;
  const browser = input.auth.cookiesFromBrowser ?? config.cookiesFromBrowser;
  if (file) return { enabled: true, source: "file", value: file };
  if (browser) return { enabled: true, source: "browser", value: browser };
  return { enabled: false };
}

function ffmpegReasons(input: PlanDownloadInput): string[] {
  const reasons: string[] = [];
  if (input.kind === "audio" || input.postprocess.extractAudio || input.postprocess.audioFormat) reasons.push("audio extraction or conversion requires ffmpeg");
  if ((input.kind === "video" && (!input.format.format || input.format.format.includes("+"))) || (input.kind === "audio" && Boolean(input.format.format?.includes("+")))) {
    reasons.push("selected/default formats may require audio/video merge");
  }
  if (input.format.mergeOutputFormat || input.postprocess.remuxVideo) reasons.push("remux requested");
  if (input.postprocess.recodeVideo) reasons.push("recode requested");
  if (input.subtitles.convertSubs) reasons.push("subtitle conversion requested");
  if (input.thumbnails.convertThumbnails) reasons.push("thumbnail conversion requested");
  if (input.download.downloadSections.length > 0) reasons.push("section download/cutting requested");
  if (input.postprocess.splitChapters || input.postprocess.removeChapters.length > 0 || input.sponsorblock.remove) reasons.push("chapter or SponsorBlock segment editing requested");
  if (input.postprocess.embedSubs || input.postprocess.embedThumbnail || input.postprocess.embedMetadata || input.postprocess.embedChapters || input.postprocess.embedInfoJson) reasons.push("asset or metadata embedding requested");
  return reasons;
}

function addReason(map: Map<string, string[]>, dependency: string, reason: string): void {
  const current = map.get(dependency) ?? [];
  if (!current.includes(reason)) current.push(reason);
  map.set(dependency, current);
}

function pickDependencies(all: DetectedDependency[], requirements: Map<string, string[]>): DetectedDependency[] {
  const byName = new Map(all.map((dependency) => [dependency.name, dependency]));
  return [...requirements].map(([name, requiredFor]) => {
    const detected = byName.get(name);
    if (!detected) {
      return {
        name,
        status: "unknown",
        requiredFor,
        notes: ["Dependency is not directly detectable by this bridge."]
      };
    }
    return {
      ...detected,
      requiredFor
    };
  });
}
