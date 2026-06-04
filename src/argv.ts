import type { z } from "zod";
import { CONFIG, type ServerConfig } from "./config.js";
import { resolveManagedPath, type ResolvedOutputPolicy } from "./filesystem.js";
import { redactArgs } from "./redaction.js";
import {
  type DownloadInputSchema,
  type InspectInputSchema,
  type PlanDownloadInputSchema
} from "./schemas.js";
import type { YtdlpCommand } from "./types.js";

type InspectInput = z.infer<typeof InspectInputSchema>;
type PlanDownloadInput = z.infer<typeof PlanDownloadInputSchema>;
type DownloadInput = z.infer<typeof DownloadInputSchema>;
type DownloadLikeInput = PlanDownloadInput | DownloadInput;

export type ListKind = "formats" | "subtitles" | "thumbnails";

export function ytdlpCommand(args: string[], config: ServerConfig = CONFIG): YtdlpCommand {
  return {
    command: config.ytdlpPath,
    args,
    redactedArgs: redactArgs(args)
  };
}

export function buildMetadataArgs(input: InspectInput, config: ServerConfig = CONFIG): string[] {
  return [...buildInspectBaseArgs(input, config), "--dump-json", input.url];
}

export function buildSingleJsonArgs(input: InspectInput, config: ServerConfig = CONFIG): string[] {
  return [...buildInspectBaseArgs(input, config), "--dump-single-json", input.url];
}

export function buildListArgs(kind: ListKind, input: InspectInput, config: ServerConfig = CONFIG): string[] {
  const flag = kind === "formats" ? "--list-formats" : kind === "subtitles" ? "--list-subs" : "--list-thumbnails";
  return [...buildInspectBaseArgs(input, config), flag, input.url];
}

export function buildSimulationArgs(input: DownloadLikeInput, policy: ResolvedOutputPolicy, config: ServerConfig = CONFIG): string[] {
  return ["--simulate", ...buildDownloadArgs(input, policy, config)];
}

export function buildDownloadArgs(input: DownloadLikeInput, policy: ResolvedOutputPolicy, config: ServerConfig = CONFIG): string[] {
  const args = buildBaseArgs(input, config);

  push(args, "--paths", `home:${policy.outputRoot}`);
  push(args, "--paths", `temp:${policy.tempRoot}`);
  push(args, "--output", policy.outputTemplate);
  args.push(policy.allowOverwrite ? "--force-overwrites" : "--no-overwrites");
  args.push("--newline", "--progress");
  push(args, "--print", "after_move:filepath");

  appendSelectionArgs(args, input, policy, config);
  appendDownloadArgs(args, input);
  appendFormatArgs(args, input);
  appendSubtitleArgs(args, input);
  appendThumbnailArgs(args, input);
  appendPostprocessArgs(args, input);
  appendSponsorBlockArgs(args, input);
  appendExtractorArgs(args, input);

  if (input.kind === "audio" && !input.postprocess.extractAudio) {
    args.push("--extract-audio");
  }
  if (input.kind === "subtitles") {
    args.push("--skip-download");
    if (!input.subtitles.writeSubs && !input.subtitles.writeAutoSubs) args.push("--write-subs");
  }
  if (input.kind === "thumbnail") {
    args.push("--skip-download");
    if (!input.thumbnails.writeThumbnail && !input.thumbnails.writeAllThumbnails) args.push("--write-thumbnail");
  }
  if (input.kind === "playlist" && !input.selection.noPlaylist) args.push("--yes-playlist");

  args.push(input.url);
  return args;
}

function buildInspectBaseArgs(input: InspectInput, config: ServerConfig): string[] {
  const args = buildBaseArgs(input, config);
  if (input.flatPlaylist) args.push("--flat-playlist");
  return args;
}

function buildBaseArgs(input: Pick<InspectInput, "auth" | "network">, config: ServerConfig): string[] {
  const args = ["--ignore-config", "--no-warnings"];
  appendNetworkArgs(args, input.network);
  appendAuthArgs(args, input.auth, config);
  return args;
}

function appendNetworkArgs(args: string[], network: InspectInput["network"]): void {
  push(args, "--proxy", network.proxy);
  if (network.socketTimeout !== undefined) push(args, "--socket-timeout", String(network.socketTimeout));
  push(args, "--source-address", network.sourceAddress);
  push(args, "--impersonate", network.impersonate);
  push(args, "--geo-verification-proxy", network.geoVerificationProxy);
  push(args, "--xff", network.xff);
  if (network.forceIpv4) args.push("--force-ipv4");
  if (network.forceIpv6) args.push("--force-ipv6");
}

function appendAuthArgs(args: string[], auth: InspectInput["auth"], config: ServerConfig): void {
  push(args, "--username", auth.username);
  push(args, "--password", auth.password);
  push(args, "--twofactor", auth.twofactor);
  if (auth.netrc) {
    requireConfigFilePolicy("auth.netrc", config);
    args.push("--netrc");
  }
  if (auth.netrcLocation) requireConfigFilePolicy("auth.netrcLocation", config);
  if (auth.netrcCmd) requireConfigFilePolicy("auth.netrcCmd", config);
  push(args, "--netrc-location", auth.netrcLocation);
  push(args, "--netrc-cmd", auth.netrcCmd);
  push(args, "--video-password", auth.videoPassword);
  push(args, "--cookies", configuredOrAllowed(auth.cookiesFile, config.cookiesFile, "auth.cookiesFile", config));
  push(args, "--cookies-from-browser", configuredOrAllowed(auth.cookiesFromBrowser, config.cookiesFromBrowser, "auth.cookiesFromBrowser", config));
}

function appendSelectionArgs(args: string[], input: DownloadLikeInput, policy: ResolvedOutputPolicy, config: ServerConfig): void {
  const selection = input.selection;
  push(args, "--playlist-items", selection.playlistItems);
  if (selection.noPlaylist) args.push("--no-playlist");
  if (selection.yesPlaylist) args.push("--yes-playlist");
  push(args, "--min-filesize", selection.minFilesize);
  push(args, "--max-filesize", selection.maxFilesize);
  push(args, "--date", selection.date);
  push(args, "--datebefore", selection.dateBefore);
  push(args, "--dateafter", selection.dateAfter);
  pushRepeated(args, "--match-filters", selection.matchFilters);
  pushRepeated(args, "--break-match-filters", selection.breakMatchFilters);
  if (selection.ageLimit !== undefined) push(args, "--age-limit", String(selection.ageLimit));
  push(args, "--download-archive", selection.downloadArchive ? resolveManagedPath(policy.outputRoot, selection.downloadArchive, "downloadArchive", config.allowArbitraryOutputPaths) : undefined);
  if (selection.maxDownloads !== undefined) push(args, "--max-downloads", String(selection.maxDownloads));
  if (selection.breakOnExisting) args.push("--break-on-existing");
  if (selection.breakPerInput) args.push("--break-per-input");
  if (selection.skipPlaylistAfterErrors !== undefined) push(args, "--skip-playlist-after-errors", String(selection.skipPlaylistAfterErrors));
}

function configuredOrAllowed(inputValue: string | undefined, configuredValue: string | undefined, label: string, config: ServerConfig): string | undefined {
  if (inputValue !== undefined && inputValue !== configuredValue) requireConfigFilePolicy(label, config);
  return inputValue ?? configuredValue;
}

function requireConfigFilePolicy(label: string, config: ServerConfig): void {
  if (!config.allowConfigFiles) throw new Error(`${label} requires YTDLP_MCP_ALLOW_CONFIG_FILES=true or a matching server-level environment setting`);
}

function appendDownloadArgs(args: string[], input: DownloadLikeInput): void {
  const download = input.download;
  if (download.concurrentFragments !== undefined) push(args, "--concurrent-fragments", String(download.concurrentFragments));
  push(args, "--limit-rate", download.limitRate);
  push(args, "--throttled-rate", download.throttledRate);
  push(args, "--retries", download.retries);
  push(args, "--file-access-retries", download.fileAccessRetries);
  push(args, "--fragment-retries", download.fragmentRetries);
  pushRepeated(args, "--retry-sleep", download.retrySleep);
  if (download.keepFragments) args.push("--keep-fragments");
  push(args, "--buffer-size", download.bufferSize);
  push(args, "--http-chunk-size", download.httpChunkSize);
  if (download.playlistRandom) args.push("--playlist-random");
  if (download.lazyPlaylist) args.push("--lazy-playlist");
  if (download.hlsUseMpegts) args.push("--hls-use-mpegts");
  pushRepeated(args, "--download-sections", download.downloadSections);
  pushRepeated(args, "--downloader", download.downloader);
  pushRepeated(args, "--downloader-args", download.downloaderArgs);
}

function appendFormatArgs(args: string[], input: DownloadLikeInput): void {
  const format = input.format;
  push(args, "--format", format.format);
  pushRepeated(args, "--format-sort", format.formatSort);
  if (format.formatSortReset) args.push("--format-sort-reset");
  if (format.formatSortForce) args.push("--format-sort-force");
  if (format.videoMultistreams) args.push("--video-multistreams");
  if (format.audioMultistreams) args.push("--audio-multistreams");
  if (format.preferFreeFormats) args.push("--prefer-free-formats");
  if (format.checkFormats) args.push("--check-formats");
  if (format.checkAllFormats) args.push("--check-all-formats");
  push(args, "--merge-output-format", format.mergeOutputFormat);
}

function appendSubtitleArgs(args: string[], input: DownloadLikeInput): void {
  const subtitles = input.subtitles;
  if (subtitles.writeSubs) args.push("--write-subs");
  if (subtitles.writeAutoSubs) args.push("--write-auto-subs");
  push(args, "--sub-format", subtitles.subFormat);
  push(args, "--sub-langs", subtitles.subLangs);
  push(args, "--convert-subs", subtitles.convertSubs);
}

function appendThumbnailArgs(args: string[], input: DownloadLikeInput): void {
  const thumbnails = input.thumbnails;
  if (thumbnails.writeThumbnail) args.push("--write-thumbnail");
  if (thumbnails.writeAllThumbnails) args.push("--write-all-thumbnails");
  push(args, "--convert-thumbnails", thumbnails.convertThumbnails);
}

function appendPostprocessArgs(args: string[], input: DownloadLikeInput): void {
  const postprocess = input.postprocess;
  if (postprocess.extractAudio) args.push("--extract-audio");
  push(args, "--audio-format", postprocess.audioFormat);
  push(args, "--audio-quality", postprocess.audioQuality);
  push(args, "--remux-video", postprocess.remuxVideo);
  push(args, "--recode-video", postprocess.recodeVideo);
  pushRepeated(args, "--postprocessor-args", postprocess.postprocessorArgs);
  if (postprocess.keepVideo) args.push("--keep-video");
  if (postprocess.postOverwrites) args.push("--post-overwrites");
  if (postprocess.embedSubs) args.push("--embed-subs");
  if (postprocess.embedThumbnail) args.push("--embed-thumbnail");
  if (postprocess.embedMetadata) args.push("--embed-metadata");
  if (postprocess.embedChapters) args.push("--embed-chapters");
  if (postprocess.embedInfoJson) args.push("--embed-info-json");
  pushRepeated(args, "--parse-metadata", postprocess.parseMetadata);
  pushRepeated(args, "--replace-in-metadata", postprocess.replaceInMetadata);
  if (postprocess.xattrs) args.push("--xattrs");
  push(args, "--concat-playlist", postprocess.concatPlaylist);
  push(args, "--fixup", postprocess.fixup);
  if (postprocess.splitChapters) args.push("--split-chapters");
  pushRepeated(args, "--remove-chapters", postprocess.removeChapters);
  if (postprocess.forceKeyframesAtCuts) args.push("--force-keyframes-at-cuts");
  pushRepeated(args, "--use-postprocessor", postprocess.usePostprocessor);
}

function appendSponsorBlockArgs(args: string[], input: DownloadLikeInput): void {
  push(args, "--sponsorblock-mark", input.sponsorblock.mark);
  push(args, "--sponsorblock-remove", input.sponsorblock.remove);
  push(args, "--sponsorblock-chapter-title", input.sponsorblock.chapterTitle);
  push(args, "--sponsorblock-api", input.sponsorblock.api);
}

function appendExtractorArgs(args: string[], input: DownloadLikeInput): void {
  const extractor = input.extractor;
  push(args, "--extractor-retries", extractor.extractorRetries);
  if (extractor.allowDynamicMpd) args.push("--allow-dynamic-mpd");
  if (extractor.hlsSplitDiscontinuity) args.push("--hls-split-discontinuity");
  pushRepeated(args, "--extractor-args", extractor.extractorArgs);

  const youtube = extractor.youtube;
  if (!youtube) return;

  push(args, "--extractor-args", keyed("youtube", "lang", youtube.lang));
  push(args, "--extractor-args", keyed("youtube", "comment_sort", youtube.commentSort));
  push(args, "--extractor-args", keyed("youtube", "max_comments", youtube.maxComments));
  push(args, "--extractor-args", keyed("youtube", "fetch_pot", youtube.fetchPot));
  pushJoined(args, "youtube", "skip", youtube.skip);
  pushJoined(args, "youtube", "player_client", youtube.playerClient);
  pushJoined(args, "youtube", "formats", youtube.formats);
  pushJoined(args, "youtube", "po_token", youtube.poToken);
}

function keyed(namespace: string, key: string, value: string | undefined): string | undefined {
  return value ? `${namespace}:${key}=${value}` : undefined;
}

function pushJoined(args: string[], namespace: string, key: string, values: string[]): void {
  if (values.length > 0) push(args, "--extractor-args", `${namespace}:${key}=${values.join(",")}`);
}

function push(args: string[], flag: string, value: string | undefined): void {
  if (value !== undefined && value !== "") args.push(flag, value);
}

function pushRepeated(args: string[], flag: string, values: string[]): void {
  for (const value of values) push(args, flag, value);
}
