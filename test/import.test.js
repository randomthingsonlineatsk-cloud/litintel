// Offline tests for file import, using small files shaped like real exports.
const assert = require('node:assert/strict');
const C = require('../core.js');
let passed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL ' + name + '\n       ' + e.stack); process.exitCode = 1; } }

const scopusRis = `TY  - JOUR
AU  - Kumar, A.
AU  - Joshi, R.
TI  - Microplastic detection in coastal sediments
     using Raman spectroscopy
T2  - Marine Pollution Bulletin
J2  - Mar. Pollut. Bull.
VL  - 190
SP  - 114812
PY  - 2023
DO  - 10.1016/j.marpolbul.2023.114812
UR  - https://www.scopus.com/inward/record.uri?eid=2-s2.0-1
AB  - We sampled 40 sites along the Mumbai coast.
KW  - Microplastics
KW  - Raman
LA  - English
DB  - Scopus
ER  -

TY  - CONF
AU  - Silva, M.
TI  - Polymer degradation by marine bacteria
PY  - 2022
ER  -
`;

const nbib = `PMID- 37000001
OWN - NLM
DP  - 2024 Mar
TI  - Liposomal amphotericin B in cryptococcal meningitis: a randomized
      controlled trial.
PG  - 210-219
LID - 10.1056/EXAMPLE.2024.1 [doi]
AB  - BACKGROUND: Mortality remains high. METHODS: We randomized 844 adults
      with HIV-associated cryptococcal meningitis.
FAU - Okello, Joseph
AU  - Okello J
AU  - Mensah K
LA  - eng
PT  - Journal Article
PT  - Randomized Controlled Trial
TA  - N Engl J Med
JT  - The New England journal of medicine
MH  - *Amphotericin B/therapeutic use
MH  - Humans
OT  - liposomes

PMID- 37000002
DP  - 2019
TI  - A withdrawn study.
PT  - Retracted Publication
AU  - Doe J
`;

const bib = `@comment{exported by Zotero}
@article{rao_nanoparticle_2021,
  title = {Nanoparticle {Toxicity} in {Zebrafish}: 50\\% mortality},
  author = {Rao, Priya and Mehta, Ankit and {World Health Organization}},
  journal = {Journal of Nanobiotechnology},
  volume = {19},
  number = {2},
  pages = {101--112},
  year = 2021,
  doi = {10.1186/s12951-021-00001-x},
  abstract = {We exposed zebrafish embryos to silver nanoparticles.},
  keywords = {nanotoxicology, zebrafish}
}
@inproceedings{lee2020, title="Deep learning for screening", author="Lee, K. and Park, J.", booktitle="Proc. AMIA", year="2020"}
`;

const scopusCsv = '﻿"Authors","Author full names","Title","Year","Source title","Volume","Issue","Page start","Page end","DOI","Link","Abstract","Author Keywords","Index Keywords","Document Type","PubMed ID"\n' +
  '"Shah N.; Iyer P.","Shah, Neha; Iyer, Pooja","Biodegradable polymers for packaging, a review","2025","Polymers","17","3","401","420","10.3390/polym17030401","https://www.scopus.com/x","Packaging waste is rising.\nThis review covers PLA and PHA.","PLA; PHA","Biodegradation","Review",""\n' +
  '"Ali Z.","Ali, Zara","Ocean plastics","2024","Science","","","","","","","[No abstract available]","","","Note","38000001"\n';

const wosTab = 'PT\tAU\tTI\tSO\tPY\tDI\tAB\tDE\n' +
  'J\tKhan, S; Das, R\tPlastic-degrading bacteria from mangroves\tEnvironmental Microbiology\t2022\t10.1111/1462-2920.0001\tWe isolated 12 strains.\tIdeonella; PET\n';

t('detects formats', () => {
  assert.equal(C.detectFormat(scopusRis, 'scopus.ris'), 'ris');
  assert.equal(C.detectFormat(nbib, 'pubmed-set.txt'), 'medline');
  assert.equal(C.detectFormat(bib, 'library.bib'), 'bibtex');
  assert.equal(C.detectFormat(scopusCsv, 'scopus.csv'), 'csv');
  assert.equal(C.detectFormat(wosTab, 'savedrecs.txt'), 'csv');
  assert.equal(C.detectFormat('hello world', 'x.doc'), null);
});
t('RIS from Scopus: continuation lines, pages, DOI, keywords', () => {
  const r = C.parseRIS(scopusRis);
  assert.equal(r.length, 2);
  assert.equal(r[0].title, 'Microplastic detection in coastal sediments using Raman spectroscopy');
  assert.equal(r[0].journal, 'Marine Pollution Bulletin'); assert.equal(r[0].year, 2023);
  assert.equal(r[0].doi, '10.1016/j.marpolbul.2023.114812'); assert.deepEqual(r[0].keywords, ['Microplastics', 'Raman']);
  assert.deepEqual(r[1].pubTypes, ['Conference Paper']);
});
t('PubMed MEDLINE: wrapped title and abstract, DOI from LID, MeSH, retraction', () => {
  const r = C.parseMedline(nbib);
  assert.equal(r.length, 2);
  assert.equal(r[0].title, 'Liposomal amphotericin B in cryptococcal meningitis: a randomized controlled trial');
  assert.equal(r[0].doi, '10.1056/example.2024.1'); assert.equal(r[0].pmid, '37000001'); assert.equal(r[0].year, 2024);
  assert.match(r[0].abstract, /844 adults with HIV/); assert.ok(r[0].keywords.includes('Amphotericin B'));
  assert.equal(r[1].retracted, true);
  const e = C.extract(r[0]); assert.equal(e.sampleSize.value, '844 adults');
});
t('BibTeX from Zotero: nested braces, escaped %, -- pages, bare year, quoted fields', () => {
  const r = C.parseBibTeX(bib);
  assert.equal(r.length, 2);
  assert.equal(r[0].title, 'Nanoparticle Toxicity in Zebrafish: 50% mortality');
  assert.deepEqual(r[0].authors, ['Rao, Priya', 'Mehta, Ankit', 'World Health Organization']);
  assert.equal(r[0].pages, '101-112'); assert.equal(r[0].year, 2021); assert.equal(r[0].doi, '10.1186/s12951-021-00001-x');
  assert.equal(r[1].journal, 'Proc. AMIA'); assert.deepEqual(r[1].pubTypes, ['Conference Paper']);
});
t('Scopus CSV: quoted newlines, pages, no-abstract marker, PubMed ID', () => {
  const r = C.parseDelimited(scopusCsv);
  assert.equal(r.length, 2);
  assert.equal(r[0].title, 'Biodegradable polymers for packaging, a review');
  assert.deepEqual(r[0].authors, ['Shah N.', 'Iyer P.']); assert.equal(r[0].pages, '401-420');
  assert.match(r[0].abstract, /PLA and PHA/); assert.deepEqual(r[0].keywords, ['PLA', 'PHA', 'Biodegradation']);
  assert.equal(r[1].abstract, ''); assert.equal(r[1].pmid, '38000001');
});
t('Web of Science tab-delimited', () => {
  const r = C.parseDelimited(wosTab);
  assert.equal(r.length, 1); assert.equal(r[0].journal, 'Environmental Microbiology'); assert.equal(r[0].doi, '10.1111/1462-2920.0001');
  assert.deepEqual(r[0].authors, ['Khan, S', 'Das, R']);
});
t('importText labels the source and imported records de-duplicate with database records', () => {
  const { format, records } = C.importText(nbib, 'pubmed-set.nbib');
  assert.equal(format, 'medline'); assert.deepEqual(records[0].sources, ['Imported: pubmed-set.nbib']);
  const db = C.makeRecord({ title: 'Liposomal amphotericin B in cryptococcal meningitis: a randomized controlled trial', doi: '10.1056/EXAMPLE.2024.1', sources: ['Europe PMC'] });
  assert.equal(C.dedupe(records.concat([db])).records.length, 2);
  assert.throws(() => C.importText('nothing', 'a.pdf'), /Unrecognised file/);
  assert.throws(() => C.parseDelimited('a,b\n1,2\n'), /No title column/);
});
console.log(passed + ' import tests passed' + (process.exitCode ? ', with failures' : ''));
