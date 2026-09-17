import { writeFileSync } from "node:fs";

const PARAGRAPHS = 5000;
const lines: string[] = [];

lines.push("# Synthetic Benchmark Document");
lines.push("");
lines.push("Generated for stela pipeline stress testing.");
lines.push("");

for (let i = 0; i < PARAGRAPHS; i++) {
  if (i % 50 === 0) {
    const level = (i % 150 === 0) ? 2 : 3;
    lines.push(`${"#".repeat(level)} Section ${Math.floor(i / 50) + 1}`);
    lines.push("");
  }

  const sentenceCount = 2 + (i % 5);
  const sentences: string[] = [];
  for (let s = 0; s < sentenceCount; s++) {
    const words = 8 + (s % 12);
    const wordList: string[] = [];
    for (let w = 0; w < words; w++) {
      const len = 3 + ((i * 7 + s * 3 + w) % 8);
      const chars = "abcdefghijklmnopqrstuvwxyz";
      let word = "";
      for (let c = 0; c < len; c++) {
        word += chars[(i + s + w + c) % 26];
      }
      wordList.push(word);
    }
    sentences.push(wordList.join(" ") + ".");
  }
  lines.push(sentences.join(" "));
  lines.push("");

  // Add some edge cases
  if (i % 200 === 0 && i > 0) {
    lines.push(`(unbalanced bracket here [with nested {content`);
    lines.push("");
  }
  if (i % 300 === 0 && i > 0) {
    lines.push("");  // extra blank lines
    lines.push("");
  }
}

const content = lines.join("\n");
writeFileSync("bench/fixture-5k.md", content);

const sizeKB = Buffer.byteLength(content) / 1024;
console.log(`Generated bench/fixture-5k.md: ${PARAGRAPHS} paragraphs, ${sizeKB.toFixed(0)} KB`);
