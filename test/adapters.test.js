// Offline tests for the Crossref, Semantic Scholar, ClinicalTrials.gov and DOAJ adapters (response shapes from their public docs).
const assert = require('node:assert/strict');
const C = require('../core.js');
let passed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL ' + name + '\n       ' + e.stack); process.exitCode = 1; } }
const urls = [];
const ok = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
const fetch = async (url, init) => {
  urls.push({ url: decodeURIComponent(url), init });
  if (url.includes('api.crossref.org')) {
    const second = url.includes('cursor=AoJ');
    return ok({ status: 'ok', message: { 'total-results': 3, 'next-cursor': second ? null : 'AoJ1', items: second ? [
      { DOI: '10.1016/j.envpol.2024.3', title: ['Third'], type: 'journal-article', issued: { 'date-parts': [[2024]] } }] : [
      { DOI: '10.1016/J.MARPOLBUL.2023.114812', title: ['Microplastic detection in coastal sediments using Raman spectroscopy'], author: [{ given: 'A.', family: 'Kumar' }, { name: 'Ocean Group' }],
        issued: { 'date-parts': [[2023, 5]] }, 'container-title': ['Marine Pollution Bulletin'], volume: '190', page: '114812', type: 'journal-article',
        abstract: '<jats:title>Abstract</jats:title><jats:p>We sampled 40 sites.</jats:p>', subject: ['Pollution'], URL: 'http://dx.doi.org/10.1016/j.marpolbul.2023.114812' },
      { DOI: '10.1/retracted', title: ['Bad paper'], type: 'journal-article', issued: { 'date-parts': [[2020]] }, 'update-to': [{ type: 'retraction', DOI: '10.1/r' }] }] } });
  }
  if (url.includes('semanticscholar')) {
    const second = url.includes('token=T2');
    return ok({ total: 3, token: second ? null : 'T2', data: second ? [{ paperId: 'c', title: 'Third S2' }] : [
      { paperId: 'abc', title: 'Plastic-degrading bacteria from mangroves', abstract: 'We isolated 12 strains.', year: 2022, venue: 'Env Microbiol',
        authors: [{ authorId: '1', name: 'S. Khan' }], externalIds: { DOI: '10.1111/1462-2920.0001', PubMed: '35000001', PubMedCentral: '9000001' },
        publicationTypes: ['JournalArticle'], isOpenAccess: true, publicationDate: '2022-03-01', journal: { name: 'Environmental Microbiology', volume: '24', pages: ' 1 - 12' }, fieldsOfStudy: ['Biology'] },
      { paperId: 'def', title: 'No ids here', year: 2021 }] });
  }
  if (url.includes('clinicaltrials.gov')) {
    return ok({ totalCount: 1, studies: [{ protocolSection: {
      identificationModule: { nctId: 'NCT05000001', briefTitle: 'Liposomal B in meningitis', officialTitle: 'A Randomized Trial of Liposomal Amphotericin B in Cryptococcal Meningitis' },
      statusModule: { overallStatus: 'ACTIVE_NOT_RECRUITING', startDateStruct: { date: '2023-02' }, studyFirstPostDateStruct: { date: '2022-12-01' } },
      descriptionModule: { briefSummary: 'This trial compares single-dose liposomal amphotericin B with standard care.' },
      designModule: { studyType: 'INTERVENTIONAL', phases: ['PHASE3'], designInfo: { allocation: 'RANDOMIZED' }, enrollmentInfo: { count: 844, type: 'ESTIMATED' } },
      conditionsModule: { conditions: ['Cryptococcal Meningitis'], keywords: ['HIV'] },
      armsInterventionsModule: { interventions: [{ type: 'DRUG', name: 'Liposomal amphotericin B' }] },
      sponsorCollaboratorsModule: { leadSponsor: { name: 'Example University' } } } }] });
  }
  if (url.includes('doaj.org')) {
    return ok({ total: 1, page: 1, pageSize: 100, results: [{ id: 'd1', bibjson: { title: 'Biodegradable polymers review', abstract: 'This review covers PLA.', year: '2025',
      journal: { title: 'Polymers', volume: '17', number: '3', language: ['EN'] }, author: [{ name: 'Neha Shah' }], identifier: [{ type: 'doi', id: '10.3390/polym17030401' }, { type: 'eissn', id: 'x' }],
      keywords: ['PLA'], start_page: '401', end_page: '420', link: [{ type: 'fulltext', url: 'https://www.mdpi.com/x' }] } }] });
  }
  throw new Error('unexpected ' + url);
};
(async () => {
  console.log('Adapter tests');
  await t('query translation', () => {
    const q = '(microplastic*[tiab] OR nanoplastic*[tiab]) AND marine[mh] NOT review';
    assert.equal(C.stripFieldTags(q), '(microplastic* OR nanoplastic*) AND marine NOT review');
    assert.equal(C.toPlainQuery(q), 'microplastic nanoplastic marine');
    assert.equal(C.toS2Query(q), '(microplastic* | nanoplastic*) + marine -review');
    assert.equal(C.toDoajQuery(q), '(microplastic OR nanoplastic) AND marine NOT review');
  });
  await t('Crossref: paging, JATS abstract, authors, retraction, year filter', async () => {
    const r = await C.searchCrossref({ query: 'microplastic* AND raman', max: 10, yearFrom: 2020, email: 'a@b.org', fetch });
    assert.equal(r.records.length, 3); assert.equal(r.total, 3);
    const a = r.records[0];
    assert.equal(a.doi, '10.1016/j.marpolbul.2023.114812'); assert.equal(a.abstract, 'We sampled 40 sites.');
    assert.deepEqual(a.authors, ['Kumar A.', 'Ocean Group']); assert.equal(a.year, 2023); assert.deepEqual(a.pubTypes, ['journal article']);
    assert.equal(r.records[1].retracted, true);
    const u = urls.find((x) => x.url.includes('crossref')).url;
    assert.match(u, /query=microplastic raman&/); assert.match(u, /filter=from-pub-date:2020/); assert.match(u, /mailto=a@b.org/);
  });
  await t('Semantic Scholar: bulk paging by token, ids, key header, since filter', async () => {
    urls.length = 0;
    const r = await C.searchSemanticScholar({ query: 'plastic AND bacteria', max: 10, since: '2026-10-01', apiKey: 'K', fetch });
    assert.equal(r.records.length, 3);
    const a = r.records[0];
    assert.equal(a.doi, '10.1111/1462-2920.0001'); assert.equal(a.pmid, '35000001'); assert.equal(a.pmcid, 'PMC9000001'); assert.equal(a.pages, '1-12');
    assert.equal(a.journal, 'Environmental Microbiology'); assert.equal(a.isOA, true);
    assert.match(urls[0].url, /query=plastic \+ bacteria/); assert.match(urls[0].url, /publicationDateOrYear=2026-10-01:/);
    assert.equal(urls[0].init.headers['x-api-key'], 'K');
  });
  await t('ClinicalTrials.gov: registration becomes a screenable record with NCT id', async () => {
    urls.length = 0;
    const r = await C.searchClinicalTrials({ query: 'liposomal[tiab] AND meningitis', max: 10, yearFrom: 2020, fetch });
    const a = r.records[0];
    assert.equal(a.registryId, 'NCT05000001'); assert.equal(a.id, 'reg:NCT05000001'); assert.equal(a.year, 2023);
    assert.equal(C.recordUrl(a), 'https://clinicaltrials.gov/study/NCT05000001');
    assert.match(a.abstract, /Interventional study, randomized, Phase 3, status active not recruiting/);
    assert.match(a.abstract, /Enrollment: 844 participants \(estimated\)/);
    assert.match(urls[0].url, /query.term=liposomal AND meningitis/); assert.match(urls[0].url, /AREA\[StartDate\]RANGE\[2020-01-01,MAX\]/);
    const e = C.extract(a);
    assert.equal(e.studyDesign.value, 'Randomised controlled trial (registered, Phase 3)'); assert.equal(e.sampleSize.value, '844 participants');
    const v = C.verify(a, { decision: { status: 'include', reasons: ['x'], by: 'rules' } });
    assert.equal(v.checks[0].status, 'pass');
  });
  await t('trial registration never merges with a paper of the same title', () => {
    const reg = C.makeRecord({ title: 'A Randomized Trial of Liposomal Amphotericin B in Cryptococcal Meningitis', year: 2023, registryId: 'NCT05000001', sources: ['ClinicalTrials.gov'] });
    const paper = C.makeRecord({ title: 'A randomized trial of liposomal amphotericin B in cryptococcal meningitis', year: 2023, pmid: '1', sources: ['PubMed'] });
    assert.equal(C.dedupe([reg, paper]).records.length, 2);
    assert.equal(C.dedupe([reg, C.makeRecord({ title: 'x', registryId: 'nct05000001', sources: ['Imported'] })]).records.length, 1);
  });
  await t('DOAJ: DOI from identifiers, pages, open access, wildcard removed', async () => {
    urls.length = 0;
    const r = await C.searchDOAJ({ query: 'biodegrad* AND polymer', max: 10, yearFrom: 2024, fetch });
    const a = r.records[0];
    assert.equal(a.doi, '10.3390/polym17030401'); assert.equal(a.pages, '401-420'); assert.equal(a.isOA, true); assert.equal(a.year, 2025);
    assert.match(urls[0].url, /articles\/\(biodegrad AND polymer\) AND bibjson.year:\[2024 TO \*\]\?page=1&pageSize=10/);
  });
  await t('all seven sources registered', () => {
    assert.deepEqual(Object.keys(C.ADAPTERS).sort(), ['clinicaltrials', 'crossref', 'doaj', 'europepmc', 'openalex', 'pubmed', 'semanticscholar']);
  });
  console.log(passed + ' adapter tests passed' + (process.exitCode ? ', with failures' : ''));
})();
