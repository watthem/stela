import { readFileSync } from "node:fs";
import type { Strategy } from "./types.js";
import { run } from "./pipeline.js";

function usage(): never {
  console.error(`stela — git blame for AI answers

Usage: stela <file> [options]

Options:
  --strategy <heading|paragraph|sentence|token>  Chunking strategy (default: paragraph)
  --max-tokens <n>                               Max tokens per chunk (token strategy only)
  --no-validate                                  Skip boundary validation
  --json                                         Output as JSON array (default: NDJSON)
  --stats                                        Print pipeline stats to stderr
`);
  return process.exit(1) as never;
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) usage();

let file = "";
let strategy: Strategy = "paragraph";
let maxTokens: number | undefined;
let doValidate = true;
let jsonOutput = false;
let showStats = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--strategy" && args[i + 1]) {
    strategy = args[++i] as Strategy;
  } else if (arg === "--max-tokens" && args[i + 1]) {
    maxTokens = parseInt(args[++i], 10);
  } else if (arg === "--no-validate") {
    doValidate = false;
  } else if (arg === "--json") {
    jsonOutput = true;
  } else if (arg === "--stats") {
    showStats = true;
  } else if (!arg.startsWith("-")) {
    file = arg;
  }
}

if (!file) usage();

const source = readFileSync(file, "utf-8");
const result = run(source, { strategy, maxTokens, file, validate: doValidate });

if (showStats) {
  console.error(JSON.stringify(result.stats, null, 2));
}

if (jsonOutput) {
  console.log(JSON.stringify(result.chunks, null, 2));
} else {
  for (const chunk of result.chunks) {
    console.log(JSON.stringify(chunk));
  }
}
