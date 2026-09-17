import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { run } from "./pipeline.js";
import type { Strategy } from "./types.js";

const usage = `stela — git blame for AI answers

Usage: stela <UTF-8-text-file> [options]

  --strategy <heading|paragraph|sentence|word>  Default: paragraph
  --max-words <n>                              Positive word limit (word strategy)
  --no-validate                                Skip quality checks; still verify bytes
  --json                                       JSON array (default: NDJSON)
  --stats                                      Pipeline stats to stderr
  --help, -h                                   Show help

Legacy aliases: --strategy token and --max-tokens count words, NOT model tokens.
PDF/DOCX and binary inputs are unsupported. Extract UTF-8 text first.
`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      strategy: { type: "string" },
      "max-words": { type: "string" },
      "max-tokens": { type: "string" },
      "no-validate": { type: "boolean" },
      json: { type: "boolean" }, stats: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) console.log(usage);
  else {
    if (positionals.length !== 1) throw new Error("provide exactly one UTF-8 text file; use --help for usage");
    const file = positionals[0];
    const strategy = values.strategy ?? "paragraph";
    if (!["heading", "paragraph", "sentence", "word", "token"].includes(strategy)) throw new Error(`unknown strategy: ${strategy}`);
    if (values["max-words"] !== undefined && values["max-tokens"] !== undefined) throw new Error("provide --max-words or --max-tokens, not both");
    const limitText = values["max-words"] ?? values["max-tokens"];
    let maxWords: number | undefined;
    if (limitText !== undefined) {
      if (!/^[0-9]+$/.test(limitText) || !Number.isSafeInteger(Number(limitText)) || Number(limitText) <= 0) throw new Error("word limit must be a positive safe integer");
      if (strategy !== "word" && strategy !== "token") throw new Error("word limit requires --strategy word");
      maxWords = Number(limitText);
    }
    if (strategy === "token" || values["max-tokens"] !== undefined) console.error("stela: deprecated token options count words, not model tokens; use --strategy word --max-words");
    if ([".pdf", ".doc", ".docx", ".zip"].includes(extname(file).toLowerCase())) throw new Error("unsupported document format; extract UTF-8 text first");
    const result = run(readFileSync(file), { file, strategy: strategy as Strategy, maxWords, validate: !values["no-validate"] });
    if (values.stats) console.error(JSON.stringify(result.stats, null, 2));
    if (values.json) console.log(JSON.stringify(result.chunks, null, 2));
    else for (const chunk of result.chunks) console.log(JSON.stringify(chunk));
  }
} catch (error) {
  console.error(`stela: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
