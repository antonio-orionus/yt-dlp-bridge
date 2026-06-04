import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const assets = [
  ["src/generated/ytdlp-options.json", "dist/generated/ytdlp-options.json"]
];

for (const [source, target] of assets) {
  const resolvedTarget = resolve(target);
  mkdirSync(dirname(resolvedTarget), { recursive: true });
  copyFileSync(resolve(source), resolvedTarget);
}
