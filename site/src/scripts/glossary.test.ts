// Unit tests of the variable summaries and their sources. Run: npm run test:unit
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CITED_REFS, GLOSSARY, REF_IDS, REFERENCES, SUMMARY_MAX, SUMMARY_MIN, charCount, citeShort } from './glossary.ts';
import { VARIABLES } from './state.ts';

test('each variable has one glossary entry and there are no other entries', () => {
  assert.deepEqual(Object.keys(GLOSSARY).sort(), [...VARIABLES].sort());
});

test(`each summary has ${SUMMARY_MIN} to ${SUMMARY_MAX} characters`, () => {
  for (const [v, e] of Object.entries(GLOSSARY)) {
    const n = charCount(e.summary);
    assert.ok(n >= SUMMARY_MIN && n <= SUMMARY_MAX, `${v}: ${n} characters`);
  }
});

test('each summary is plain text without space at the start or end', () => {
  for (const [v, e] of Object.entries(GLOSSARY)) {
    assert.equal(e.summary, e.summary.trim(), `${v}: space at the start or end`);
    assert.doesNotMatch(e.summary, /<[a-z/!][^>]*>|&[a-z#0-9]+;/i, `${v}: HTML in the summary`);
    assert.ok(e.term.length > 0, `${v}: no term`);
  }
});

test('each source is a known reference and each cited reference is used', () => {
  const used = new Set<string>();
  for (const [v, e] of Object.entries(GLOSSARY)) {
    for (const id of e.sources) {
      assert.ok(id in REFERENCES, `${v}: unknown source ${id}`);
      used.add(id);
    }
  }
  for (const id of CITED_REFS) assert.ok(used.has(id), `${id} is in CITED_REFS, but no entry uses it`);
});

test('REF_IDS are the keys of REFERENCES', () => {
  assert.deepEqual([...REF_IDS].sort(), Object.keys(REFERENCES).sort());
});

test('each reference has a DOI and a file in data/articles/', () => {
  for (const [id, r] of Object.entries(REFERENCES)) {
    assert.ok(r.doi.startsWith('10.'), `${id}: DOI ${r.doi}`);
    const path = fileURLToPath(new URL(`../../../data/articles/${r.file}`, import.meta.url));
    assert.ok(existsSync(path), `${id}: file not found: ${path}`);
  }
});

test('citeShort makes the short citation', () => {
  assert.equal(citeShort([]), '');
  assert.equal(citeShort(['heimsch2021', 'shurpali2025']), '(Heimsch et al. 2021; Shurpali et al. 2025)');
});
