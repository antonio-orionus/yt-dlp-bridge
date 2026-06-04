import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON ?? "python3";
const result = spawnSync(python, ["scripts/extract-ytdlp-options.py"], {
  encoding: "utf8",
  env: process.env
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.stderr.write(result.stdout);
  process.exit(result.status ?? 1);
}

const current = JSON.parse(readFileSync("src/generated/ytdlp-options.json", "utf8"));
const generated = JSON.parse(result.stdout);

const currentNormalized = JSON.stringify(current, null, 2);
const generatedNormalized = JSON.stringify(generated, null, 2);

if (currentNormalized !== generatedNormalized) {
  console.error("src/generated/ytdlp-options.json is out of sync with yt_dlp.options.create_parser().");
  console.error(`current version/count: ${current.ytDlpVersion}/${current.optionCount}`);
  console.error(`generated version/count: ${generated.ytDlpVersion}/${generated.optionCount}`);
  process.exit(1);
}

console.error("yt-dlp option catalog is in sync.");
