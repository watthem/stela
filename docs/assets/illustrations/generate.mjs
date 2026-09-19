import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputDir = dirname(fileURLToPath(import.meta.url));

const C = {
  ink: '#0a0a0a',
  slab: '#111111',
  raised: '#181817',
  text: '#e8e6e1',
  dim: '#8a8880',
  rule: '#2c2b28',
  amber: '#F5A623',
  green: '#5CB85C',
  red: '#E06060',
  blue: '#6EA8D9',
};

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

function text(x, y, value, className = 'body', anchor = 'start') {
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function line(x1, y1, x2, y2, className = 'line') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${className}"/>`;
}

function box(x, y, width, height, className = 'box', rx = 6) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" class="${className}"/>`;
}

function frame({ title, kicker, description, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(title)}</title>
  <desc id="description">${escapeXml(description)}</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.amber}"/>
    </marker>
    <style>
      .bg { fill: ${C.ink}; }
      .box { fill: ${C.slab}; stroke: ${C.rule}; stroke-width: 1.5; }
      .raised { fill: ${C.raised}; stroke: ${C.rule}; stroke-width: 1.5; }
      .amber-box { fill: #251b0d; stroke: ${C.amber}; stroke-width: 2; }
      .green-box { fill: #122014; stroke: ${C.green}; stroke-width: 2; }
      .red-box { fill: #241313; stroke: ${C.red}; stroke-width: 2; }
      .title { fill: ${C.text}; font: 600 36px 'Space Grotesk', Inter, Arial, sans-serif; letter-spacing: -0.7px; }
      .kicker { fill: ${C.amber}; font: 600 12px 'Space Mono', ui-monospace, monospace; letter-spacing: 1.8px; }
      .label { fill: ${C.text}; font: 600 17px 'Space Grotesk', Inter, Arial, sans-serif; }
      .body { fill: ${C.text}; font: 400 15px 'Space Grotesk', Inter, Arial, sans-serif; }
      .small { fill: ${C.dim}; font: 400 12px 'Space Grotesk', Inter, Arial, sans-serif; }
      .mono { fill: ${C.text}; font: 400 13px 'Space Mono', ui-monospace, monospace; }
      .mono-dim { fill: ${C.dim}; font: 400 12px 'Space Mono', ui-monospace, monospace; }
      .mono-amber { fill: ${C.amber}; font: 600 13px 'Space Mono', ui-monospace, monospace; }
      .mono-green { fill: ${C.green}; font: 600 13px 'Space Mono', ui-monospace, monospace; }
      .mono-red { fill: ${C.red}; font: 600 13px 'Space Mono', ui-monospace, monospace; }
      .line { stroke: ${C.rule}; stroke-width: 1.5; }
      .amber-line { stroke: ${C.amber}; stroke-width: 2; fill: none; marker-end: url(#arrow); }
      .dash { stroke: ${C.dim}; stroke-width: 1.5; stroke-dasharray: 5 6; fill: none; }
      .watermark { fill: ${C.dim}; font: 500 11px 'Space Mono', ui-monospace, monospace; letter-spacing: 1px; }
    </style>
  </defs>
  <rect width="1200" height="675" class="bg"/>
  ${text(50, 45, kicker.toUpperCase(), 'kicker')}
  ${text(50, 88, title, 'title')}
  ${text(1150, 48, 'STELA / PROVENANCE', 'watermark', 'end')}
  ${line(50, 108, 1150, 108)}
  ${body}
</svg>
`;
}

function chunkMap() {
  const body = `
    ${box(50, 137, 552, 480)}
    ${text(75, 169, 'README.md', 'label')}
    ${text(75, 193, 'source bytes', 'mono-dim')}
    ${line(126, 215, 126, 580, 'line')}
    ${text(111, 224, '0', 'mono-dim', 'end')}
    ${text(111, 276, '7', 'mono-dim', 'end')}
    ${text(111, 313, '9', 'mono-dim', 'end')}
    ${text(111, 416, '101', 'mono-dim', 'end')}
    ${text(111, 457, '103', 'mono-dim', 'end')}
    ${text(111, 510, '117', 'mono-dim', 'end')}
    <rect x="139" y="218" width="430" height="56" rx="4" fill="#251b0d" stroke="${C.amber}"/>
    ${text(158, 250, '# stela', 'mono')}
    <rect x="139" y="306" width="430" height="108" rx="4" fill="#17202a" stroke="${C.blue}"/>
    ${text(158, 337, 'Git blame for AI answers.', 'mono')}
    ${text(158, 363, 'Chunk UTF-8 text with exact source-byte', 'mono')}
    ${text(158, 389, 'ranges and SHA-256 hashes.', 'mono')}
    <rect x="139" y="450" width="430" height="58" rx="4" fill="#122014" stroke="${C.green}"/>
    ${text(158, 484, '## Quick start', 'mono')}
    ${text(75, 576, 'Half-open ranges omit the separators between chunks.', 'small')}

    ${text(682, 169, 'VERIFIED CHUNKS', 'kicker')}
    ${box(682, 190, 468, 112, 'amber-box')}
    ${text(706, 220, '01  # stela', 'mono')}
    ${text(706, 250, '[0, 7)', 'mono-amber')}
    ${text(828, 250, 'sha256 668a2530…', 'mono-dim')}
    ${text(1092, 280, 'SLICE = TEXT  ✓', 'mono-green', 'end')}

    ${box(682, 322, 468, 132, 'raised')}
    ${text(706, 352, '02  Git blame for AI answers…', 'mono')}
    ${text(706, 382, '[9, 101)', 'mono-amber')}
    ${text(828, 382, 'sha256 4a9d3224…', 'mono-dim')}
    ${text(1092, 424, 'SLICE = TEXT  ✓', 'mono-green', 'end')}

    ${box(682, 474, 468, 112, 'green-box')}
    ${text(706, 504, '03  ## Quick start', 'mono')}
    ${text(706, 534, '[103, 117)', 'mono-amber')}
    ${text(842, 534, 'sha256 9535b10b…', 'mono-dim')}
    ${text(1092, 564, 'SLICE = TEXT  ✓', 'mono-green', 'end')}

    <path d="M 569 246 C 625 246, 625 246, 674 246" class="amber-line"/>
    <path d="M 569 360 C 625 360, 625 388, 674 388" class="dash"/>
    <path d="M 569 479 C 625 479, 625 530, 674 530" class="amber-line"/>
  `;
  return frame({
    kicker: '01 / exact source map',
    title: 'Every chunk points back to exact bytes.',
    description: 'Three chunks from the stela README connect to exact half-open byte ranges and truncated SHA-256 hashes.',
    body,
  });
}

function coordinateSystems() {
  const body = `
    ${box(50, 140, 526, 452)}
    ${text(78, 177, 'POSITION FOUND AFTER SPLITTING', 'kicker')}
    ${text(78, 211, 'Decoded string', 'label')}
    ${text(78, 242, '… caractères, données, résumé …', 'mono')}
    ${line(78, 265, 548, 265)}
    ${text(78, 300, 'start_index', 'mono-dim')}
    ${text(250, 300, '236 characters', 'mono')}
    ${text(78, 331, 'same location in UTF-8', 'mono-dim')}
    ${text(250, 331, 'byte 249', 'mono-amber')}
    ${text(78, 362, 'coordinate drift', 'mono-dim')}
    ${text(250, 362, '+13 bytes', 'mono-red')}
    ${box(78, 395, 470, 92, 'red-box')}
    ${text(102, 426, 'fileBytes.slice(236, …)', 'mono')}
    ${text(102, 458, 'WRONG TEXT  ×', 'mono-red')}
    ${text(78, 532, 'The character index is valid for the decoded string.', 'small')}
    ${text(78, 553, 'It fails only when reused as a file-byte offset.', 'small')}

    ${box(624, 140, 526, 452)}
    ${text(652, 177, 'BYTE POSITION TRACKED DURING SPLIT', 'kicker')}
    ${text(652, 211, 'Source bytes', 'label')}
    ${text(652, 242, '… c3 a9 … f0 9f …', 'mono')}
    ${line(652, 265, 1122, 265)}
    ${text(652, 300, 'byteStart', 'mono-dim')}
    ${text(824, 300, '249', 'mono-amber')}
    ${text(652, 331, 'byteEnd', 'mono-dim')}
    ${text(824, 331, '425', 'mono-amber')}
    ${text(652, 362, 'contentHash', 'mono-dim')}
    ${text(824, 362, 'sha256 …', 'mono')}
    ${box(652, 395, 470, 92, 'green-box')}
    ${text(676, 426, 'fileBytes.slice(249, 425)', 'mono')}
    ${text(676, 458, 'EXACT TEXT + HASH  ✓', 'mono-green')}
    ${text(652, 532, 'The file coordinate is known when the boundary is made.', 'small')}
    ${text(652, 553, 'stela verifies the slice before returning the chunk.', 'small')}

    ${text(600, 620, '236 CHARACTERS  ≠  249 BYTES', 'mono-amber', 'middle')}
  `;
  return frame({
    kicker: '02 / coordinate systems',
    title: 'A character position is not a file-byte position.',
    description: 'A verified French fixture shows character index 236 maps to UTF-8 byte 249, while stela tracks and verifies byte range 249 to 425.',
    body,
  });
}

function verificationRoundTrip() {
  const body = `
    ${box(50, 176, 292, 320)}
    ${text(76, 210, '1  SOURCE', 'kicker')}
    ${text(76, 246, 'example-source.md', 'label')}
    ${text(76, 292, '0', 'mono-dim')}
    ${line(102, 288, 306, 288)}
    ${text(76, 337, '9', 'mono-amber')}
    <rect x="102" y="309" width="204" height="82" rx="4" fill="#251b0d" stroke="${C.amber}"/>
    ${text(117, 338, 'First paragraph has', 'mono')}
    ${text(117, 362, 'café text…', 'mono')}
    ${text(76, 416, '62', 'mono-amber')}
    ${line(102, 412, 306, 412)}
    ${text(76, 466, '109', 'mono-dim')}

    ${box(454, 176, 292, 320, 'amber-box')}
    ${text(480, 210, '2  CHUNK', 'kicker')}
    ${text(480, 248, 'First paragraph has café', 'mono')}
    ${text(480, 272, 'text. It has two sentences.', 'mono')}
    ${line(480, 295, 720, 295)}
    ${text(480, 329, 'byte range', 'mono-dim')}
    ${text(598, 329, '[9, 62)', 'mono-amber')}
    ${text(480, 365, 'stored hash', 'mono-dim')}
    ${text(480, 389, '3c8be60d3ed3537d…', 'mono')}
    ${text(480, 438, 'No stela runtime is needed', 'small')}
    ${text(480, 459, 'to check this metadata.', 'small')}

    ${box(858, 176, 292, 320, 'green-box')}
    ${text(884, 210, '3  INDEPENDENT CHECK', 'kicker')}
    ${text(884, 253, 'slice = bytes[9:62]', 'mono')}
    ${text(884, 291, 'hash = sha256(slice)', 'mono')}
    ${line(884, 318, 1124, 318)}
    ${text(884, 355, 'stored', 'mono-dim')}
    ${text(1124, 355, '3c8be60d…', 'mono', 'end')}
    ${text(884, 387, 'computed', 'mono-dim')}
    ${text(1124, 387, '3c8be60d…', 'mono', 'end')}
    ${box(884, 417, 240, 48, 'green-box')}
    ${text(1004, 447, 'MATCH  ✓', 'mono-green', 'middle')}

    <path d="M 342 336 C 390 336, 401 336, 444 336" class="amber-line"/>
    <path d="M 746 336 C 794 336, 805 336, 848 336" class="amber-line"/>
    <path d="M 1004 510 C 1004 575, 196 575, 196 506" class="dash" marker-end="url(#arrow)"/>
    ${text(600, 612, 'THE METADATA SURVIVES AN INDEPENDENT ROUND TRIP', 'mono-amber', 'middle')}
  `;
  return frame({
    kicker: '03 / verification round trip',
    title: 'Anyone with the source can verify a chunk.',
    description: 'A source byte slice from 9 to 62 is hashed independently and matches the stored chunk hash.',
    body,
  });
}

function pipeline() {
  const stages = [
    ['INPUT', 'UTF-8 bytes', '01'],
    ['VALIDATE', 'reject malformed', '02'],
    ['DECODE', 'text + bytes', '03'],
    ['SPLIT', 'chunks + ranges', '04'],
    ['VERIFY', 'slice + SHA-256', '05'],
    ['ASSESS', 'quality heuristic', '06'],
    ['OUTPUT', 'Chunk[] + stats', '07'],
  ];
  const xs = [50, 210, 370, 530, 690, 850, 1010];
  const boxes = stages.map(([name, note, number], index) => {
    const x = xs[index];
    const klass = name === 'VERIFY' ? 'amber-box' : name === 'OUTPUT' ? 'green-box' : 'box';
    return `
      ${box(x, 238, 140, 180, klass)}
      ${text(x + 18, 268, number, 'mono-dim')}
      ${text(x + 18, 309, name, 'label')}
      ${text(x + 18, 342, note, 'small')}
      ${name === 'VALIDATE' ? text(x + 18, 387, 'FAIL CLOSED ×', 'mono-red') : ''}
      ${name === 'VERIFY' ? text(x + 18, 387, 'MATCH ✓', 'mono-green') : ''}
    `;
  }).join('');
  const arrows = xs.slice(0, -1).map((x) => `<path d="M ${x + 140} 328 L ${x + 153} 328" class="amber-line"/>`).join('');
  const body = `
    ${text(50, 158, 'A BAD BYTE RANGE NEVER REACHES OUTPUT', 'kicker')}
    ${text(50, 193, 'Verification is a gate, not an annotation added later.', 'body')}
    ${boxes}
    ${arrows}
    ${box(690, 454, 140, 44, 'amber-box')}
    ${text(760, 482, 'PROVENANCE GATE', 'mono-amber', 'middle')}
    ${line(760, 418, 760, 454, 'line')}
    ${text(600, 568, 'INPUT BYTES', 'mono-dim', 'middle')}
    <path d="M 117 532 L 1080 532" stroke="${C.rule}" stroke-width="6"/>
    <path d="M 117 532 L 1080 532" stroke="${C.amber}" stroke-width="2" stroke-dasharray="4 12"/>
    ${text(600, 608, 'Seven stages. One checked coordinate system.', 'body', 'middle')}
  `;
  return frame({
    kicker: '04 / pipeline',
    title: 'Provenance is verified before output.',
    description: 'Seven pipeline stages move from UTF-8 input through validation, decoding, splitting, verification, assessment, and output.',
    body,
  });
}

function strategyComparison() {
  const columns = [
    {
      x: 50,
      name: 'PARAGRAPH',
      subtitle: 'blank lines',
      ranges: ['P1  [0, 7)', 'P2  [9, 62)', 'P3  [64, 71)', 'P4  [73, 109)'],
    },
    {
      x: 330,
      name: 'HEADING',
      subtitle: '# sections',
      ranges: ['H1  [0, 62)', 'H2  [64, 109)'],
    },
    {
      x: 610,
      name: 'SENTENCE',
      subtitle: 'sentence boundaries',
      ranges: ['S1  [0, 7)', 'S2  [9, 40)', 'S3  [41, 62)', 'S4  [64, 71)', 'S5  [73, 109)'],
    },
    {
      x: 890,
      name: 'WORD · 6',
      subtitle: 'word-count groups',
      ranges: ['W1  [0, 34)', 'W2  [35, 66)', 'W3  [67, 109)'],
    },
  ];
  const cards = columns.map(({ x, name, subtitle, ranges }) => `
    ${box(x, 246, 260, 310, name === 'WORD · 6' ? 'amber-box' : 'box')}
    ${text(x + 22, 280, name, 'kicker')}
    ${text(x + 22, 307, subtitle, 'small')}
    ${ranges.map((range, index) => {
      const y = 345 + index * 42;
      return `${box(x + 22, y - 23, 216, 31, index % 2 === 0 ? 'raised' : 'box', 3)}${text(x + 34, y - 2, range, 'mono')}`;
    }).join('')}
    ${text(x + 238, 534, 'VERIFIED ✓', 'mono-green', 'end')}
  `).join('');
  const body = `
    ${box(50, 137, 1100, 76, 'raised')}
    ${text(72, 166, 'SAME 109-BYTE SOURCE', 'kicker')}
    ${text(72, 194, '# Alpha  ·  First paragraph has café text. It has two sentences.  ·  ## Beta  ·  Second paragraph…', 'mono')}
    ${cards}
    ${text(600, 602, 'BOUNDARIES CHANGE. BYTE PROVENANCE DOES NOT.', 'mono-amber', 'middle')}
  `;
  return frame({
    kicker: '05 / strategy comparison',
    title: 'Choose boundaries without giving up provenance.',
    description: 'The same 109-byte fixture is split by paragraph, heading, sentence, and six-word strategies, each with verified ranges.',
    body,
  });
}

const illustrations = {
  'chunk-map.svg': chunkMap(),
  'coordinate-systems.svg': coordinateSystems(),
  'verification-round-trip.svg': verificationRoundTrip(),
  'pipeline.svg': pipeline(),
  'strategy-comparison.svg': strategyComparison(),
};

for (const [filename, svg] of Object.entries(illustrations)) {
  writeFileSync(join(outputDir, filename), svg, 'utf8');
}

console.log(`Generated ${Object.keys(illustrations).length} SVG illustrations in ${outputDir}`);
