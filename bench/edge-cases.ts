import { readFileSync } from "node:fs";
import { run } from "../src/pipeline.js";
import type { Strategy } from "../src/types.js";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function roundTrip(source: string, strategy: Strategy, maxTokens?: number): boolean {
  const result = run(source, { strategy, file: "test", maxTokens });
  const buf = Buffer.from(source);
  for (const chunk of result.chunks) {
    const slice = buf.subarray(chunk.source.byteStart, chunk.source.byteEnd).toString();
    if (slice !== chunk.text) {
      console.log(`    byte-range mismatch: expected ${JSON.stringify(chunk.text)}, got ${JSON.stringify(slice)}`);
      console.log(`    byteStart=${chunk.source.byteStart} byteEnd=${chunk.source.byteEnd}`);
      return false;
    }
  }
  return true;
}

const strategies: Strategy[] = ["heading", "paragraph", "sentence", "token"];

console.log("\n=== Edge Case Tests ===\n");

// --- Empty string ---
console.log("-- Empty string --");
for (const s of strategies) {
  test(`empty string / ${s}`, () => {
    const result = run("", { strategy: s, file: "test" });
    assert(result.chunks.length === 0, `expected 0 chunks, got ${result.chunks.length}`);
  });
}

// --- Single character ---
console.log("-- Single character --");
for (const s of strategies) {
  test(`single char 'x' / ${s}`, () => {
    const result = run("x", { strategy: s, file: "test" });
    assert(result.chunks.length <= 1, `expected 0 or 1 chunk, got ${result.chunks.length}`);
    assert(roundTrip("x", s), "byte-range round-trip failed");
  });
}

// --- Only whitespace ---
console.log("-- Only whitespace --");
for (const s of strategies) {
  test(`whitespace only / ${s}`, () => {
    const result = run("   \n\n\t  \n  ", { strategy: s, file: "test" });
    assert(result.chunks.length === 0, `expected 0 chunks, got ${result.chunks.length}`);
  });
}

// --- Unicode: emoji ---
console.log("-- Emoji --");
const emojiDoc = "👋 Hello world. 🌍 This is a test.\n\n🚀 Rocket paragraph. 💡 Idea here.";
for (const s of strategies) {
  test(`emoji / ${s}`, () => {
    assert(roundTrip(emojiDoc, s), "byte-range round-trip failed for emoji");
  });
}

// --- Unicode: CJK ---
console.log("-- CJK --");
const cjkDoc = "你好世界。这是第一段。\n\n第二段内容在这里。测试中文处理。";
for (const s of strategies) {
  test(`CJK / ${s}`, () => {
    assert(roundTrip(cjkDoc, s), "byte-range round-trip failed for CJK");
  });
}

// --- Unicode: mixed scripts ---
console.log("-- Mixed scripts --");
const mixedDoc = "English text here. 日本語テキスト。\n\nПривет мир. مرحبا بالعالم.\n\n한국어 텍스트. Ελληνικά κείμενο.";
for (const s of strategies) {
  test(`mixed scripts / ${s}`, () => {
    assert(roundTrip(mixedDoc, s), "byte-range round-trip failed for mixed scripts");
  });
}

// --- Unicode: combining characters ---
console.log("-- Combining characters --");
const combiningDoc = "Café résumé naïve. Über große Straße.\n\né = é (combining acute). å = å (combining ring).";
for (const s of strategies) {
  test(`combining chars / ${s}`, () => {
    assert(roundTrip(combiningDoc, s), "byte-range round-trip failed for combining chars");
  });
}

// --- Unicode: surrogate pairs (astral plane) ---
console.log("-- Surrogate pairs (astral plane) --");
const astralDoc = "𝕳𝖊𝖑𝖑𝖔 𝖂𝖔𝖗𝖑𝖉. 𝐓𝐡𝐢𝐬 𝐢𝐬 𝐚 𝐭𝐞𝐬𝐭.\n\n🏳️‍🌈 Flag sequence. 👨‍👩‍👧‍👦 Family emoji.";
for (const s of strategies) {
  test(`astral plane / ${s}`, () => {
    assert(roundTrip(astralDoc, s), "byte-range round-trip failed for astral plane");
  });
}

// --- Very long single paragraph (1MB) ---
console.log("-- Long single paragraph (1MB) --");
test("1MB no-break paragraph / paragraph", () => {
  const word = "abcdefghij ";
  const count = Math.ceil(1_000_000 / word.length);
  const bigParagraph = word.repeat(count).trimEnd() + ".";
  const result = run(bigParagraph, { strategy: "paragraph", file: "test" });
  assert(result.chunks.length === 1, `expected 1 chunk, got ${result.chunks.length}`);
  assert(roundTrip(bigParagraph, "paragraph"), "byte-range round-trip failed for 1MB paragraph");
});

test("1MB no-break paragraph / token (max 256)", () => {
  const word = "abcdefghij ";
  const count = Math.ceil(1_000_000 / word.length);
  const bigParagraph = word.repeat(count).trimEnd() + ".";
  const result = run(bigParagraph, { strategy: "token", file: "test", maxTokens: 256 });
  assert(result.chunks.length > 1, `expected >1 chunk for token split, got ${result.chunks.length}`);
  assert(roundTrip(bigParagraph, "token", 256), "byte-range round-trip failed for 1MB token split");
});

// --- All headings, no content ---
console.log("-- All headings, no content --");
const headingsOnly = "# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six";
test("all headings / heading", () => {
  const result = run(headingsOnly, { strategy: "heading", file: "test" });
  assert(result.chunks.length === 6, `expected 6 chunks, got ${result.chunks.length}`);
  assert(roundTrip(headingsOnly, "heading"), "byte-range round-trip failed for headings-only");
});

// --- Deeply nested brackets ---
console.log("-- Deeply nested brackets --");
const nestedBrackets = "(( [[ {{ content }} ]] ) and some text. More (text here.";
test("nested brackets / paragraph", () => {
  const result = run(nestedBrackets, { strategy: "paragraph", file: "test" });
  assert(roundTrip(nestedBrackets, "paragraph"), "byte-range round-trip failed");
  const chunk = result.chunks[0];
  assert(chunk.assessment.reasons.includes("unbalanced_brackets"),
    `expected unbalanced_brackets, got ${chunk.assessment.reasons}`);
});

// --- Balanced brackets should pass ---
console.log("-- Balanced brackets --");
const balancedBrackets = "((content)) and (more) [things] {here}. Done.";
test("balanced brackets / paragraph", () => {
  const result = run(balancedBrackets, { strategy: "paragraph", file: "test" });
  const chunk = result.chunks[0];
  assert(!chunk.assessment.reasons.includes("unbalanced_brackets"),
    `should not have unbalanced_brackets, got ${chunk.assessment.reasons}`);
});

// --- Real-world file ---
console.log("-- Real-world file --");
test("package.json as input / paragraph", () => {
  const pkg = readFileSync("package.json", "utf-8");
  assert(roundTrip(pkg, "paragraph"), "byte-range round-trip failed for package.json");
});

test("tsconfig.json as input / sentence", () => {
  const tsconfig = readFileSync("tsconfig.json", "utf-8");
  assert(roundTrip(tsconfig, "sentence"), "byte-range round-trip failed for tsconfig.json");
});

// --- Check that validate=false skips validation but keeps assessment ---
console.log("-- validate=false --");
test("validate=false still produces assessment", () => {
  const result = run("Some text here.", { strategy: "paragraph", file: "test", validate: false });
  const chunk = result.chunks[0];
  assert(chunk.validation.boundaryClean === true, "should have clean validation when disabled");
  assert(chunk.assessment.verdict !== undefined, "should still have assessment verdict");
});

// --- NDJSON output format check ---
console.log("-- Output format --");
test("chunk matches types.ts contract", () => {
  const result = run("Hello world. Test.", { strategy: "paragraph", file: "test" });
  const chunk = result.chunks[0];
  assert(typeof chunk.id === "string", "id should be string");
  assert(typeof chunk.index === "number", "index should be number");
  assert(typeof chunk.text === "string", "text should be string");
  assert(typeof chunk.source.file === "string", "source.file should be string");
  assert(typeof chunk.source.byteStart === "number", "byteStart should be number");
  assert(typeof chunk.source.byteEnd === "number", "byteEnd should be number");
  assert(typeof chunk.source.contentHash === "string", "contentHash should be string");
  assert(typeof chunk.source.strategy === "string", "strategy should be string");
  assert(typeof chunk.validation.boundaryClean === "boolean", "boundaryClean should be boolean");
  assert(typeof chunk.validation.complete === "boolean", "complete should be boolean");
  assert(Array.isArray(chunk.validation.warnings), "warnings should be array");
  assert(typeof chunk.assessment.verdict === "string", "verdict should be string");
  assert(typeof chunk.assessment.confidence.score === "number", "confidence.score should be number");
  assert(typeof chunk.assessment.confidence.boundaryScore === "number", "boundaryScore should be number");
  assert(typeof chunk.assessment.confidence.completenessScore === "number", "completenessScore should be number");
  assert(typeof chunk.assessment.confidence.hashVerified === "boolean", "hashVerified should be boolean");
  assert(Array.isArray(chunk.assessment.reasons), "reasons should be array");
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
