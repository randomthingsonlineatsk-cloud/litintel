// Offline test for watch/run.mjs with mocked PubMed and Europe PMC responses.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
import { main } from '../watch/run.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'litwatch-'));
await mkdir(path.join(dir, 'watch'));
await writeFile(path.join(dir, 'watch/searches.json'), JSON.stringify({ project: 'Test watch', email: 'you@example.com', searches: [{ source: 'pubmed', query: 'a' }, { source: 'europepmc', query: 'b' }] }));
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const urls = [];
const fetchFn = async (url) => {
  urls.push(decodeURIComponent(url));
  if (url.includes('esearch')) return ok({ esearchresult: { count: '2', idlist: ['1', '2'] } });
  if (url.includes('esummary')) return ok({ result: { uids: ['1', '2'], 1: { title: 'Paper one', authors: [{ name: 'Rao A' }], pubdate: '2026 Oct', fulljournalname: 'J One', articleids: [{ idtype: 'doi', value: '10.1/one' }], pubtype: ['Journal Article'] }, 2: { title: 'Paper two', authors: [], pubdate: '2026', source: 'J Two', articleids: [] } } });
  if (url.includes('europepmc')) return ok({ hitCount: 2, resultList: { result: [{ id: 'x', source: 'MED', doi: '10.1/ONE', title: 'Paper one', pubYear: '2026' }, { id: 'y', source: 'PPR', doi: '10.1/three', title: 'Paper three', pubYear: '2026' }] } });
  throw new Error('unexpected ' + url);
};
const s1 = await main({ fetchFn, root: dir, now: new Date('2026-10-22T03:30:00Z') });
assert.equal(s1.newCount, 3);
assert.ok(urls.some((u) => u.includes('mindate=2026/10/15'))); assert.ok(urls.some((u) => u.includes('FIRST_IDATE:[2026-10-15 TO')));
const rep = await readFile(path.join(dir, 'reports/2026-10-22.md'), 'utf8');
assert.match(rep, /3 new records/); assert.match(rep, /https:\/\/doi.org\/10.1\/one/);
// second run a week later: same records must not be reported again
const s2 = await main({ fetchFn, root: dir, now: new Date('2026-10-29T03:30:00Z') });
assert.equal(s2.newCount, 0); assert.equal(s2.since, '2026-10-22'); assert.equal(s2.errors, 0);
// empty config: nothing searched, nothing written
const dir2 = await mkdtemp(path.join(os.tmpdir(), 'litwatch-'));
await mkdir(path.join(dir2, 'watch'));
await writeFile(path.join(dir2, 'watch/searches.json'), JSON.stringify({ project: '', email: '', searches: [] }));
let called = false;
const s3 = await main({ fetchFn: async () => { called = true; }, root: dir2, now: new Date('2026-10-22T03:30:00Z') });
assert.equal(s3.skipped, true); assert.equal(called, false);
const { existsSync } = await import('node:fs');
assert.equal(existsSync(path.join(dir2, 'reports')), false);
// searches from the secret override the empty file
process.env.LITINTEL_SEARCHES = JSON.stringify({ project: 'Secret', searches: [{ source: 'europepmc', query: 'b' }] });
const s4 = await main({ fetchFn, root: dir2, now: new Date('2026-10-22T03:30:00Z') });
delete process.env.LITINTEL_SEARCHES;
assert.equal(s4.newCount, 2);
console.log('watch tests passed');
