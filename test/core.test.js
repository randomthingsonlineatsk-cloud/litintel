// Offline tests for core.js using recorded-shape mock API responses.
// Run: npm test
const assert = require('node:assert/strict');
const { DOMParser } = require('@xmldom/xmldom');
globalThis.DOMParser = DOMParser;
const C = require('../core.js');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.stack); process.exitCode = 1; }
}

const pubmedXml = `<?xml version="1.0"?><PubmedArticleSet>
<PubmedArticle><MedlineCitation><PMID Version="1">39000001</PMID><Article>
<Journal><JournalIssue><Volume>12</Volume><Issue>3</Issue><PubDate><Year>2024</Year></PubDate></JournalIssue><Title>Journal of Nanomedicine</Title></Journal>
<ArticleTitle>Liposomal doxorubicin versus conventional doxorubicin in women with metastatic breast cancer: a randomized controlled trial.</ArticleTitle>
<Pagination><MedlinePgn>101-110</MedlinePgn></Pagination>
<ELocationID EIdType="doi">10.1000/jnm.2024.001</ELocationID>
<Abstract><AbstractText Label="BACKGROUND">Cardiotoxicity limits doxorubicin use.</AbstractText>
<AbstractText Label="METHODS">In this randomized controlled trial, 240 women with metastatic breast cancer were randomized to liposomal doxorubicin or conventional doxorubicin. The primary outcome was cardiac event-free survival.</AbstractText>
<AbstractText Label="RESULTS">Liposomal doxorubicin significantly reduced cardiotoxicity (HR 0.45).</AbstractText>
<AbstractText Label="CONCLUSIONS">Liposomal doxorubicin is an effective and safer option. Larger studies are warranted.</AbstractText></Abstract>
<AuthorList><Author><LastName>Sharma</LastName><Initials>AK</Initials></Author><Author><LastName>Rao</LastName><Initials>P</Initials></Author></AuthorList>
<Language>eng</Language><PublicationTypeList><PublicationType>Journal Article</PublicationType><PublicationType>Randomized Controlled Trial</PublicationType></PublicationTypeList>
</Article><MeshHeadingList><MeshHeading><DescriptorName>Doxorubicin</DescriptorName></MeshHeading><MeshHeading><DescriptorName>Liposomes</DescriptorName></MeshHeading><MeshHeading><DescriptorName>Breast Neoplasms</DescriptorName></MeshHeading></MeshHeadingList></MedlineCitation>
<PubmedData><ArticleIdList><ArticleId IdType="pubmed">39000001</ArticleId><ArticleId IdType="doi">10.1000/jnm.2024.001</ArticleId></ArticleIdList></PubmedData></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID Version="1">39000002</PMID><Article>
<Journal><JournalIssue><PubDate><MedlineDate>2019 Jan-Feb</MedlineDate></PubDate></JournalIssue><Title>Lancet Oncology</Title></Journal>
<ArticleTitle>Nanoparticles in oncology: an editorial view.</ArticleTitle>
<AuthorList><Author><CollectiveName>Nano Oncology Group</CollectiveName></Author></AuthorList>
<PublicationTypeList><PublicationType>Editorial</PublicationType></PublicationTypeList>
</Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">39000002</ArticleId></ArticleIdList></PubmedData></PubmedArticle>
</PubmedArticleSet>`;

const epmcJson = {
  hitCount: 2, nextCursorMark: 'AoE=', resultList: { result: [
    { id: '39000001', source: 'MED', pmid: '39000001', doi: '10.1000/JNM.2024.001', title: 'Liposomal doxorubicin versus conventional doxorubicin in women with metastatic breast cancer: a randomized controlled trial.',
      authorString: 'Sharma AK, Rao P.', pubYear: '2024', journalInfo: { journal: { title: 'Journal of Nanomedicine' } }, abstractText: 'Short.', pubTypeList: { pubType: ['research-article'] }, isOpenAccess: 'Y' },
    { id: 'PPR9', source: 'PPR', doi: '10.1101/2025.01.01.000001', title: 'Polymeric nanoparticles for tumour targeting in mice', authorList: { author: [{ fullName: 'Khan S' }] },
      pubYear: '2025', abstractText: '<h4>Aim</h4> We evaluated polymeric nanoparticles in mice bearing xenograft tumours. Tumour accumulation did not differ significantly from free drug. Further studies are needed.', pubTypeList: { pubType: ['Preprint'] }, keywordList: { keyword: ['Nanoparticles', 'Doxorubicin', 'Liposomes'] } },
  ] },
};

const openalexJson = {
  meta: { count: 1, next_cursor: null }, results: [{
    id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1000/jnm.2024.001', display_name: 'Liposomal doxorubicin versus conventional doxorubicin in women with metastatic breast cancer: a randomized controlled trial',
    publication_year: 2024, authorships: [{ author: { display_name: 'A. K. Sharma' } }], primary_location: { source: { display_name: 'Journal of Nanomedicine' } },
    abstract_inverted_index: { Cardiotoxicity: [0], limits: [1], doxorubicin: [2] }, type: 'article', is_retracted: false, open_access: { is_oa: true },
    ids: { pmid: 'https://pubmed.ncbi.nlm.nih.gov/39000001' }, keywords: [{ display_name: 'Liposomes' }],
  }],
};

function mockFetch(routes) {
  return async (url) => {
    const r = routes.find(([re]) => re.test(url));
    if (!r) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    const body = typeof r[1] === 'function' ? r[1](url) : r[1];
    return { ok: true, status: 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
}
const fetch = mockFetch([
  [/esearch\.fcgi/, { esearchresult: { count: '2', idlist: ['39000001', '39000002'] } }],
  [/efetch\.fcgi/, pubmedXml],
  [/europepmc/, epmcJson],
  [/openalex/, openalexJson],
]);

(async () => {
  console.log('LitIntel core tests');
  let pm, ep, oa;
  await t('PubMed adapter parses XML, structured abstract, MedlineDate, collective author', async () => {
    pm = await C.searchPubMed({ query: 'liposom*', max: 10, fetch });
    assert.equal(pm.total, 2); assert.equal(pm.records.length, 2);
    const a = pm.records[0];
    assert.equal(a.doi, '10.1000/jnm.2024.001'); assert.equal(a.year, 2024); assert.equal(a.pages, '101-110');
    assert.match(a.abstract, /CONCLUSIONS: Liposomal/);
    assert.ok(a.keywords.includes('Liposomes'));
    assert.equal(pm.records[1].year, 2019); assert.deepEqual(pm.records[1].authors, ['Nano Oncology Group']);
  });
  await t('Europe PMC adapter normalises DOI case and strips HTML', async () => {
    ep = await C.searchEuropePMC({ query: 'x', max: 2, fetch });
    assert.equal(ep.records[0].doi, '10.1000/jnm.2024.001');
    assert.ok(!/<h4>/.test(ep.records[1].abstract));
    assert.equal(ep.records[0].isOA, true);
  });
  await t('OpenAlex adapter rebuilds abstract from inverted index', async () => {
    oa = await C.searchOpenAlex({ query: 'x', max: 5, fetch });
    assert.equal(oa.records[0].abstract, 'Cardiotoxicity limits doxorubicin');
    assert.equal(oa.records[0].pmid, '39000001'); assert.equal(oa.records[0].retracted, false);
  });
  let deduped;
  await t('Dedupe merges the same paper from three sources and keeps the longest abstract', async () => {
    deduped = C.dedupe([...pm.records, ...ep.records, ...oa.records]);
    assert.equal(deduped.records.length, 3);
    assert.equal(deduped.duplicatesRemoved, 2);
    const trial = deduped.records.find((r) => r.doi === '10.1000/jnm.2024.001');
    assert.deepEqual(trial.sources.sort(), ['Europe PMC', 'OpenAlex', 'PubMed']);
    assert.match(trial.abstract, /randomized controlled trial/);
  });
  await t('Dedupe never merges two different DOIs with the same title', async () => {
    const a = C.makeRecord({ title: 'A very long identical title about nanoparticles', year: 2020, doi: '10.1/a', sources: ['X'] });
    const b = C.makeRecord({ title: 'A very long identical title about nanoparticles', year: 2020, doi: '10.1/b', sources: ['Y'] });
    assert.equal(C.dedupe([a, b]).records.length, 2);
  });
  const criteria = { includeGroups: [['liposom*', 'nanoparticle*'], ['cancer', 'tumour', 'tumor', 'oncology']], excludeTerms: ['veterinary'], yearFrom: 2015 };
  await t('Screening: include with reasons, editorial excluded by type, preprint in mice goes to include', async () => {
    const [trial, editorial, preprint] = ['10.1000/jnm.2024.001', null, '10.1101/2025.01.01.000001'].map((d, i) => d ? deduped.records.find((r) => r.doi === d) : deduped.records.find((r) => r.pmid === '39000002'));
    const d1 = C.screen(trial, criteria);
    assert.equal(d1.status, 'include'); assert.equal(d1.reasons.length, 2); assert.match(d1.reasons[0], /Liposomal/i);
    const d2 = C.screen(editorial, criteria);
    assert.equal(d2.status, 'exclude'); assert.match(d2.reasons[0], /Editorial/);
    const d3 = C.screen(preprint, criteria);
    assert.equal(d3.status, 'include');
  });
  await t('Screening: year, exclusion term, missing abstract, partial match, retracted', async () => {
    const base = { title: 'Liposomal delivery', abstract: 'Liposomal delivery in cancer.', year: 2020, sources: [] };
    assert.equal(C.screen(C.makeRecord({ ...base, year: 2010 }), criteria).status, 'exclude');
    assert.match(C.screen(C.makeRecord({ ...base, abstract: 'Liposomes in cancer for veterinary use.' }), criteria).reasons[0], /veterinary/);
    assert.equal(C.screen(C.makeRecord({ ...base, abstract: '' }), criteria).status, 'review');
    assert.equal(C.screen(C.makeRecord({ ...base, abstract: 'Liposomal delivery to the skin.', title: 'Skin' }), criteria).status, 'review');
    assert.equal(C.screen(C.makeRecord({ ...base, retracted: true }), criteria).status, 'exclude');
    assert.equal(C.screen(C.makeRecord(base), { includeGroups: [] }).status, 'review');
  });
  await t('Term matching: wildcard, phrase, word boundary, hyphen/space', () => {
    assert.ok(C.findTerm('liposom*', 'Liposomal drugs'));
    assert.ok(!C.findTerm('cancer', 'anticancerous'));
    assert.ok(C.findTerm('"breast cancer"', 'metastatic breast-cancer'));
    assert.deepEqual(C.parseTerms('a, "b, c"; d\ne'), ['a', '"b, c"', 'd', 'e']);
  });
  let ex;
  await t('Extraction finds design, sample size, population, intervention, outcome, conclusion with evidence', () => {
    const trial = deduped.records.find((r) => r.doi === '10.1000/jnm.2024.001');
    ex = C.extract(trial);
    assert.equal(ex.studyDesign.value, 'Randomised controlled trial');
    assert.equal(ex.sampleSize.value, '240 women');
    assert.match(ex.population.value, /women with metastatic breast cancer/);
    assert.match(ex.intervention.value, /randomized to liposomal doxorubicin/);
    assert.match(ex.outcomes.value, /primary outcome/);
    assert.match(ex.keyFinding.value, /effective and safer/);
    assert.match(ex.limitations.value, /Larger studies are warranted|warranted/);
    C.EXTRACT_FIELDS.forEach(([k]) => { if (ex[k].value) assert.ok(ex[k].evidence, k + ' has evidence'); });
  });
  await t('Extraction marks missing fields instead of inventing them', () => {
    const r = C.makeRecord({ title: 'Something', abstract: 'Nanoparticles are interesting.', sources: [] });
    const e = C.extract(r);
    assert.equal(e.sampleSize.value, null); assert.equal(e.sampleSize.note, C.NOT_REPORTED);
  });
  await t('Extraction ignores years as sample sizes and detects animal study', () => {
    const r = C.makeRecord({ title: 'x', abstract: 'Between 2018 and 2020 cases rose. We studied 36 mice exposed to particles.', sources: [] });
    const e = C.extract(r);
    assert.equal(e.sampleSize.value, '36 mice'); assert.equal(e.studyDesign.value, 'Animal study');
  });
  await t('Verification: pass, title mismatch, retraction from registry, missing decision', () => {
    const trial = deduped.records.find((r) => r.doi === '10.1000/jnm.2024.001');
    const decision = C.screen(trial, criteria);
    const good = C.verify(trial, { decision, extraction: ex, crossref: { title: [trial.title], issued: { 'date-parts': [[2024, 3]] }, author: [{ family: 'Sharma' }] } });
    assert.equal(good.overall, 'pass', JSON.stringify(good.checks.filter((c) => c.status !== 'pass')));
    const bad = C.verify(JSON.parse(JSON.stringify(trial)), { decision, crossref: { title: ['Completely unrelated paper on soil bacteria'], issued: { 'date-parts': [[2011]] }, 'updated-by': [{ type: 'retraction', DOI: '10.1000/r' }] } });
    assert.equal(bad.overall, 'fail');
    assert.ok(bad.checks.find((c) => c.check === 'Not retracted' && c.status === 'fail'));
    assert.ok(bad.checks.find((c) => c.check === 'Year matches registry' && c.status === 'fail'));
    const none = C.verify(C.makeRecord({ title: 't', sources: [] }), {});
    assert.equal(none.overall, 'fail');
  });
  await t('Gap analysis counts designs and finds contradiction candidates', () => {
    const recs = deduped.records;
    const exs = {}; recs.forEach((r) => { exs[r.id] = C.extract(r); });
    const g = C.gapAnalysis(recs, exs);
    assert.equal(g.total, 3);
    assert.ok(g.design['Randomised controlled trial'] >= 1);
    assert.equal(g.contradictions.length, 1, JSON.stringify(g.contradictions));
  });
  await t('Exports: CSV quoting, RIS, BibTeX keys unique and escaped, JSONL', () => {
    const recs = deduped.records;
    const csv = C.toCSV([{ a: 'x,"y"', b: 'line\nbreak' }], ['a', 'b']);
    assert.equal(csv, '﻿a,b\r\n"x,""y""","line\nbreak"');
    const ris = C.toRIS(recs);
    assert.equal((ris.match(/^TY  - /gm) || []).length, 3); assert.match(ris, /DO  - 10\.1000\/jnm\.2024\.001/); assert.match(ris, /SP  - 101\r\nEP  - 110/);
    const dup = recs.concat(recs);
    const bib = C.toBibTeX(dup);
    const keys = bib.match(/@article\{([^,]+),/g);
    assert.equal(new Set(keys).size, keys.length);
    assert.match(bib, /Sharma, A\. K\./);
    const rows = C.evidenceRows(recs, {}, {}, {});
    assert.equal(Object.keys(rows[0]).length, C.evidenceHeaders().length);
    assert.equal(C.toJSONL([{ a: 1 }, { b: 2 }]), '{"a":1}\n{"b":2}\n');
  });
  await t('Surveillance diff finds only unseen records', () => {
    const seen = deduped.records.slice(0, 2).map((r) => r.id);
    assert.equal(C.newRecordsSince(deduped.records, seen).length, 1);
  });
  await t('Flow counts', () => {
    const p = { searches: [{ source: 'PubMed', retrieved: 2, duplicatesRemoved: 0 }, { source: 'Europe PMC', retrieved: 2, duplicatesRemoved: 2 }],
      records: Object.fromEntries(deduped.records.map((r) => [r.id, r])), decisions: { [deduped.records[0].id]: { status: 'include' } } };
    const c = C.flowCounts(p);
    assert.equal(c.identified, 4); assert.equal(c.included, 1); assert.equal(c.undecided, 2);
  });
  console.log(passed + ' tests passed' + (process.exitCode ? ', with failures' : ''));
})();
