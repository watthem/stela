import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  run, splitByParagraph, splitBySentence, splitByHeading, splitByWord, splitByToken,
  buildCharToByteMap, assess, validate, createProvenance,
} from '../dist/index.js';

const options = { file: 'fixture.txt', strategy: 'paragraph' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function verify(input, result) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let last = 0;
  for (const c of result.chunks) {
    const { byteStart, byteEnd, contentHash } = c.source;
    assert.ok(Number.isSafeInteger(byteStart) && Number.isSafeInteger(byteEnd));
    assert.ok(byteStart >= last && byteEnd > byteStart && byteEnd <= bytes.length);
    const slice = bytes.subarray(byteStart, byteEnd);
    assert.deepEqual(slice, Buffer.from(c.text));
    assert.equal(sha256(slice), contentHash);
    assert.equal(c.assessment.confidence.hashVerified, true);
    last = byteEnd;
  }
}
const dir = mkdtempSync(join(tmpdir(), 'stela-regression-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const cli = resolve('dist/cli.js');
function invoke(bytes, args = [], name = 'input.txt') {
  const file = join(dir, name);
  writeFileSync(file, bytes);
  return spawnSync(process.execPath, [cli, file, ...args], { encoding: 'utf8', timeout: 10000 });
}

test('reject malformed UTF-8 rather than emitting false provenance', () => {
  const bytes = Buffer.from([0x41, 0xff, 0x2e, 0x0a, 0x0a, ...Buffer.from('Second paragraph.')]);
  for (const validation of [true, false]) assert.throws(() => run(bytes, { ...options, validate: validation }), /valid UTF-8/);
  const r = invoke(bytes, ['--json']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /valid UTF-8/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('reject UTF-16, NUL-containing input, PDF and ZIP containers', () => {
  for (const input of [Buffer.from([0xff, 0xfe, 0x41, 0]), Buffer.from('A\0B.'), Buffer.from('%PDF-1.7\nASCII PDF.'), Buffer.from([0x50, 0x4b, 0x03, 0x04])]) {
    assert.throws(() => run(input, options), /UTF-8|binary/);
  }
  const r = invoke('ASCII content.', ['--json'], 'report.PDF');
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /unsupported document format/);
});

test('raw byte oracle: BOM, accents, combining marks, emoji, repeated text and CRLF', () => {
  const bytes = Buffer.from('\ufeff# Résumé\r\n\r\nCafé e\u0301 😀. Same text.\r\n\r\nSame text. 𐐷中文。');
  for (const strategy of ['heading', 'paragraph', 'sentence', 'word', 'token']) verify(bytes, run(bytes, { ...options, strategy }));
});

test('Windows and whitespace-only blank lines split, single line endings do not', () => {
  for (const sep of ['\n\n', '\r\n\r\n', '\n  \n', '\r\n\t\r\n', '\r\r']) {
    const source = `First paragraph.${sep}Second paragraph.`;
    assert.deepEqual(splitByParagraph(source), ['First paragraph.', 'Second paragraph.']);
    verify(source, run(source, options));
  }
  for (const sep of ['\n', '\r\n', '\r']) {
    const source = `First line.${sep}Second line.`;
    assert.deepEqual(splitByParagraph(source), [source]);
  }
});

test('sentence boundaries handle titles, decimals, closing quotes and CJK', () => {
  assert.deepEqual(splitBySentence('Dr. Smith administered 2.5 mg. No adverse events occurred.'), ['Dr. Smith administered 2.5 mg.', 'No adverse events occurred.']);
  assert.deepEqual(splitBySentence('He said "Done." Next sentence follows.'), ['He said "Done."', 'Next sentence follows.']);
  assert.deepEqual(splitBySentence('第一句话。第二句话！第三句话？'), ['第一句话。', '第二句话！', '第三句话？']);
  assert.deepEqual(splitBySentence('Mr. Jones met Dr. Smith. Next.'), ['Mr. Jones met Dr. Smith.', 'Next.']);
});

test('headings inside backtick or tilde fences do not split the block', () => {
  for (const fence of ['```', '~~~~']) {
    const first = `# Real heading\r\n\r\n${fence}python\r\n# comment\r\nprint(1)\r\n${fence}\r\n\r\nMore content.`;
    const input = `${first}\r\n\r\n## Next\r\n\r\nFinal.`;
    assert.deepEqual(splitByHeading(input), [first, '## Next\r\n\r\nFinal.']);
    verify(input, run(input, { ...options, strategy: 'heading' }));
  }
  assert.deepEqual(splitByHeading('# A\n\n````\n```\n# Still code\n````\n# B'), ['# A\n\n````\n```\n# Still code\n````', '# B']);
});

test('legal section headings split like ATX headings with correct metadata', () => {
  const doc = [
    'Preamble text.',
    '',
    'ARTICLE I DEFINITIONS',
    'The following terms apply.',
    '',
    'Section 1.1 Defined Terms',
    'Each term below has the stated meaning.',
    '',
    'Section 1.2 Interpretation',
    'References to sections include subsections.',
    '',
    'ARTICLE II SERVICES',
    'Provider shall deliver the services.',
    '',
    'Exhibit A Service Description',
    'Details of the engagement.',
    '',
    'Schedule 1 Fee Table',
    'Fees are listed below.',
    '',
    'RECITALS',
    'The parties have agreed as follows.',
    '',
    'WHEREAS the Company desires to engage.',
  ].join('\n');

  const chunks = splitByHeading(doc);
  assert.equal(chunks.length, 8);
  assert.match(chunks[0], /^Preamble text/);
  assert.match(chunks[1], /^ARTICLE I/);
  assert.match(chunks[2], /^Section 1\.1/);
  assert.match(chunks[3], /^Section 1\.2/);
  assert.match(chunks[4], /^ARTICLE II/);
  assert.match(chunks[5], /^Exhibit A/);
  assert.match(chunks[6], /^Schedule 1/);
  assert.match(chunks[7], /^RECITALS/);

  const result = run(doc, { file: 'contract.txt', strategy: 'heading' });
  verify(doc, result);
  assert.equal(result.chunks.length, 8);

  const art1 = result.chunks[1];
  assert.equal(art1.source.heading, 'DEFINITIONS');
  assert.equal(art1.source.headingLevel, 1);

  const sec11 = result.chunks[2];
  assert.equal(sec11.source.heading, 'Defined Terms');
  assert.equal(sec11.source.headingLevel, 2);

  const exhibit = result.chunks[5];
  assert.equal(exhibit.source.heading, 'A Service Description');
  assert.equal(exhibit.source.headingLevel, 1);

  const schedule = result.chunks[6];
  assert.equal(schedule.source.heading, '1 Fee Table');
  assert.equal(schedule.source.headingLevel, 1);

  const recitals = result.chunks[7];
  assert.equal(recitals.source.headingLevel, 1);
});

test('legal headings inside fenced code blocks do not split', () => {
  const doc = '# Overview\n\n```\nARTICLE I DEFINITIONS\nSection 1.1 Terms\n```\n\nAfter the fence.';
  const chunks = splitByHeading(doc);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /^# Overview/);
  verify(doc, run(doc, { file: 'test.txt', strategy: 'heading' }));
});

test('roman numeral and mixed-case legal headings are recognized', () => {
  const doc = 'Article III Governance\nBoard composition.\n\nArticle IV Officers\nOfficer duties.';
  const chunks = splitByHeading(doc);
  assert.equal(chunks.length, 2);
  assert.match(chunks[0], /^Article III/);
  assert.match(chunks[1], /^Article IV/);
  verify(doc, run(doc, { file: 'test.txt', strategy: 'heading' }));
});

test('skipped quality has null scores and does not count as passed', () => {
  const result = run('The incomplete assertion (', { ...options, validate: false });
  const c = result.chunks[0];
  assert.deepEqual(c.validation, { status: 'skipped', boundaryClean: null, complete: null, warnings: [] });
  assert.equal(c.assessment.verdict, 'skipped');
  assert.equal(c.assessment.confidence.score, null);
  assert.equal(c.assessment.confidence.hashVerified, true);
  assert.equal(result.stats.skipped, 1);
  assert.equal(result.stats.passed, 0);
  assert.equal(result.stats.meanConfidence, null);
  verify('The incomplete assertion (', result);
  const cliResult = JSON.parse(invoke('Unfinished (', ['--json', '--no-validate']).stdout);
  assert.equal(cliResult[0].assessment.verdict, 'skipped');
});

test('consumer mutation does not cross chunk or run boundaries', () => {
  const a = run('First paragraph.\n\nSecond paragraph.', { ...options, validate: false });
  a.chunks[0].validation.warnings.push('consumer annotation');
  a.chunks[0].assessment.confidence.hashVerified = false;
  a.chunks[0].assessment.reasons.push('hash_mismatch');
  const b = run('Other document.', { ...options, validate: false });
  for (const c of [a.chunks[1], b.chunks[0]]) {
    assert.deepEqual(c.validation.warnings, []);
    assert.equal(c.assessment.confidence.hashVerified, true);
    assert.deepEqual(c.assessment.reasons, ['validation_skipped']);
  }
});

test('ill-formed JS strings are rejected and public map does not skip adjacent characters', () => {
  for (const source of ['\ud800', '\ud800\n\nNext paragraph.', '\ud800A.', '\udc00.']) {
    assert.throws(() => run(source, options), /unpaired UTF-16 surrogate/);
    const map = buildCharToByteMap(source);
    for (let i = 0; i <= source.length; i++) assert.equal(map[i], Buffer.byteLength(source.slice(0, i)));
  }
  verify('😀.\n\nNext paragraph.', run('😀.\n\nNext paragraph.', options));
});

test('bracket matching checks type/order and failed hashes always reject', () => {
  for (const text of ['The evidence (] is mismatched.', 'The evidence ][ is out of order.', 'The evidence ([)] is crossed.']) {
    assert.equal(validate(text).complete, false);
    assert.equal(assess(text, true).verdict, 'flag');
    assert.equal(run(text, options).chunks[0].assessment.verdict, 'flag');
  }
  assert.equal(validate('The evidence ([valid]) is balanced.').complete, true);
  assert.equal(assess('This otherwise complete sentence must not pass.', false).verdict, 'reject');
  for (const text of ['这是完整的一句话。', 'He said "Done."']) assert.equal(validate(text).boundaryClean, true);
  assert.throws(() => createProvenance('x.txt', 'absent', 'other', 'paragraph', 0), /not present/);
});

test('word limits are explicit and old token names are deprecated aliases', () => {
  assert.deepEqual(splitByWord('One two three.', 2), ['One two', 'three.']);
  assert.deepEqual(splitByToken('One two three.', 2), splitByWord('One two three.', 2));
  const r = invoke('One two three.', ['--strategy', 'token', '--max-tokens', '2', '--json']);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /count words, not model tokens/);
  assert.equal(JSON.parse(r.stdout).length, 2);
  const longWord = 'x'.repeat(10000) + '.';
  assert.deepEqual(splitByWord(longWord, 1), [longWord]); // Explicitly a word cap, never a model budget.
});

test('invalid CLI arguments fail concisely before output', () => {
  for (const args of [
    ['--strategy', 'banana'], ['--oops'], ['--stratgey', 'sentence'], ['--strategy'],
    ['--strategy', 'word', '--max-words', '0'], ['--strategy', 'word', '--max-words=-1'],
    ['--strategy', 'word', '--max-words', 'nope'], ['--strategy', 'word', '--max-words', '1.5'],
    ['--strategy', 'word', '--max-words', '2x'], ['--strategy', 'word', '--max-words', '9007199254740992'],
    ['--strategy', 'word', '--max-words', '2', '--max-tokens', '2'], ['--max-words', '2'], ['second.txt'],
  ]) {
    const r = invoke('One two three.', [...args, '--json']);
    assert.equal(r.status, 1, JSON.stringify(args));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^stela:/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
  assert.equal(spawnSync(process.execPath, [cli, '--help']).status, 0);
});

test('invalid library options fail even on empty input', () => {
  for (const maxWords of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => run('', { ...options, strategy: 'word', maxWords }), /positive safe integer/);
    assert.throws(() => splitByWord('', maxWords), /positive safe integer/);
  }
  assert.throws(() => run('', { ...options, strategy: 'banana' }), /unknown strategy/);
  assert.throws(() => run('', { ...options, maxWords: 1 }), /requires/);
  assert.throws(() => run('', { ...options, strategy: 'word', maxWords: 1, maxTokens: 1 }), /not both/);
  assert.equal(run('', options).stats.meanConfidence, null);
  assert.deepEqual(run('', options).chunks, []);
});

test('seeded valid-Unicode corpus retains exact provenance for every strategy', () => {
  let seed = 20260917;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const atoms = ['a', 'Z', 'é', 'e\u0301', '😀', '𐐷', '中', '\ufeff', '\u00a0', '\u2003', '\r\n', '\n\n', '\n \n', ' ', '\t', '.', '!', '?', '# H\n', 'repeat. ', '[x]'];
  for (let n = 0; n < 600; n++) {
    let source = '';
    for (let i = 0; i < 5 + rand() % 150; i++) source += atoms[rand() % atoms.length];
    for (const strategy of ['heading', 'paragraph', 'sentence', 'word', 'token']) {
      const maxWords = strategy === 'word' || strategy === 'token' ? 1 + rand() % 9 : undefined;
      verify(source, run(Buffer.from(source), { ...options, strategy, maxWords }));
    }
  }
});

test('README library example executes against the exported package API', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const block = /<!-- executable-library-example -->\s*```javascript\n([\s\S]*?)```/.exec(readme);
  assert.ok(block, 'missing executable README example');
  const script = block[1].replace("'@watthem/stela'", JSON.stringify(new URL('../dist/index.js', import.meta.url).href));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /First paragraph/);
});
