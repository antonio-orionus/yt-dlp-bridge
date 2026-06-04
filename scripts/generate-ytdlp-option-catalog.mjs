import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const outputPath = resolve("src/generated/ytdlp-options.json");
const python = process.env.PYTHON ?? "python3";
const env = { ...process.env };

const result = spawnSync(python, ["scripts/extract-ytdlp-options.py"], {
  encoding: "utf8",
  env
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.stderr.write(result.stdout);
  process.exit(result.status ?? 1);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, result.stdout);
console.error(`Wrote ${outputPath}`);
