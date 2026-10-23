/*!
 * LitIntel core — search, deduplication, screening, extraction, verification and exports.
 * Copyright 2026 Khan Gulrez Shagufa Fazal Ahmed. Licensed under the Apache License 2.0.
 *
 * Works in the browser (attaches window.LitCore) and in Node 18+ (module.exports).
 * No dependencies. PubMed XML parsing uses the global DOMParser.
 */
(function (root) {
  'use strict';

  const VERSION = '0.3.0';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- text utils
  function stripTags(s) {
    return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  }
  function normDoi(doi) {
    if (!doi) return '';
    return String(doi).trim().toLowerCase()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');
  }
  function normTitle(t) {
    return String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function tokens(t) { return normTitle(t).split(' ').filter((w) => w.length > 2); }
  function titleSimilarity(a, b) {
    const A = new Set(tokens(a)), B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    let inter = 0; A.forEach((w) => { if (B.has(w)) inter++; });
    return inter / (A.size + B.size - inter);
  }
  function sentences(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    // split on sentence end followed by space + capital/digit, keep e.g. "et al." mostly intact
    return t.split(/(?<=[.!?])\s+(?=[A-Z0-9(])/).map((s) => s.trim()).filter(Boolean);
  }
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /** Build a matcher for a user term. Supports trailing * wildcard and "quoted phrases". */
  function termRegex(term) {
    let t = String(term).trim().replace(/^"|"$/g, '');
    if (!t) return null;
    const wild = t.endsWith('*');
    if (wild) t = t.slice(0, -1);
    const body = escapeRegex(t).replace(/\s+/g, '[\\s-]+');
    return new RegExp('(^|[^a-z0-9])(' + body + (wild ? '[a-z0-9-]*' : '') + ')(?![a-z0-9])', 'i');
  }
  function findTerm(term, text) {
    const re = termRegex(term);
    if (!re || !text) return null;
    const m = re.exec(text);
    if (!m) return null;
    const start = m.index + m[1].length;
    return { term, match: m[2], snippet: snippetAround(text, start, m[2].length) };
  }
  function snippetAround(text, start, len, pad = 70) {
    const a = Math.max(0, start - pad), b = Math.min(text.length, start + len + pad);
    return (a > 0 ? '…' : '') + text.slice(a, b).trim() + (b < text.length ? '…' : '');
  }
  function parseTerms(str) {
    // comma or newline separated; keeps "quoted, phrases" together
    const out = []; let cur = '', q = false;
    for (const ch of String(str || '')) {
      if (ch === '"') { q = !q; cur += ch; continue; }
      if ((ch === ',' || ch === ';' || ch === '\n') && !q) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  // ---------------------------------------------------------------- record model
  function makeRecord(o) {
    const r = {
      title: stripTags(o.title || '').replace(/\.$/, ''),
      authors: (o.authors || []).filter(Boolean),
      year: o.year ? Number(o.year) : null,
      date: o.date || null,
      journal: o.journal || '',
      volume: o.volume || '', issue: o.issue || '', pages: o.pages || '',
      doi: normDoi(o.doi),
      pmid: o.pmid ? String(o.pmid).replace(/\D/g, '') : '',
      pmcid: o.pmcid || '',
      openalexId: o.openalexId || '',
      registryId: o.registryId ? String(o.registryId).toUpperCase() : '',
      abstract: stripTags(o.abstract || ''),
      pubTypes: (o.pubTypes || []).filter(Boolean),
      keywords: (o.keywords || []).filter(Boolean),
      language: o.language || '',
      isOA: o.isOA == null ? null : !!o.isOA,
      retracted: o.retracted == null ? null : !!o.retracted,
      sources: o.sources || [],
      sourceUrls: o.sourceUrls || {},
    };
    r.id = recordKey(r);
    return r;
  }
  function recordKey(r) {
    if (r.doi) return 'doi:' + r.doi;
    if (r.pmid) return 'pmid:' + r.pmid;
    if (r.registryId) return 'reg:' + r.registryId;
    return 'title:' + normTitle(r.title).slice(0, 120) + '|' + (r.year || '');
  }
  function recordUrl(r) {
    if (r.doi) return 'https://doi.org/' + r.doi;
    if (r.pmid) return 'https://pubmed.ncbi.nlm.nih.gov/' + r.pmid + '/';
    if (/^NCT\d{8}$/.test(r.registryId)) return 'https://clinicaltrials.gov/study/' + r.registryId;
    const any = Object.values(r.sourceUrls || {})[0];
    return any || '';
  }

  // ---------------------------------------------------------------- adapters
  async function getJson(fetchFn, url) {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url.split('?')[0]);
    return res.json();
  }
  async function getText(fetchFn, url) {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url.split('?')[0]);
    return res.text();
  }

  /** PubMed via NCBI E-utilities. opts: {query, max, yearFrom, yearTo, since(YYYY-MM-DD), apiKey, email, fetch} */
  async function searchPubMed(opts) {
    const f = opts.fetch || root.fetch.bind(root);
    const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
    const common = '&tool=litintel' + (opts.email ? '&email=' + encodeURIComponent(opts.email) : '') +
      (opts.apiKey ? '&api_key=' + encodeURIComponent(opts.apiKey) : '');
    const delay = opts.apiKey ? 120 : 380;
    let q = '&term=' + encodeURIComponent(opts.query);
    if (opts.since) q += '&datetype=edat&mindate=' + opts.since.replace(/-/g, '/') + '&maxdate=3000';
    else if (opts.yearFrom || opts.yearTo) q += '&datetype=pdat&mindate=' + (opts.yearFrom || 1800) + '&maxdate=' + (opts.yearTo || 3000);
    const max = Math.min(opts.max || 100, 2000);
    const esUrl = base + 'esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=' + max + q + common;
    const es = await getJson(f, esUrl);
    const ids = (es.esearchresult && es.esearchresult.idlist) || [];
    const total = Number((es.esearchresult && es.esearchresult.count) || 0);
    const records = [];
    for (let i = 0; i < ids.length; i += 200) {
      await sleep(delay);
      const xml = await getText(f, base + 'efetch.fcgi?db=pubmed&retmode=xml&id=' + ids.slice(i, i + 200).join(',') + common);
      records.push(...parsePubMedXml(xml));
    }
    return { source: 'PubMed', total, retrieved: records.length, url: esUrl.replace(/&api_key=[^&]+/, '&api_key=…'), records };
  }

  function parsePubMedXml(xml) {
    const P = root.DOMParser;
    if (!P) throw new Error('DOMParser is not available in this environment');
    const doc = new P().parseFromString(xml, 'text/xml');
    const txt = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
    const q = (el, sel) => { const n = el.getElementsByTagName(sel); return n && n.length ? n[0] : null; };
    const qa = (el, sel) => Array.from(el.getElementsByTagName(sel) || []);
    return qa(doc, 'PubmedArticle').map((art) => {
      const pmid = txt(q(art, 'PMID'));
      const title = txt(q(art, 'ArticleTitle'));
      const absParts = qa(art, 'AbstractText').map((n) => {
        const label = n.getAttribute && n.getAttribute('Label');
        return (label ? label.toUpperCase() + ': ' : '') + txt(n);
      });
      const authors = qa(art, 'Author').map((a) => {
        const last = txt(q(a, 'LastName')), ini = txt(q(a, 'Initials')), coll = txt(q(a, 'CollectiveName'));
        return coll || (last ? last + (ini ? ' ' + ini : '') : '');
      }).filter(Boolean);
      let doi = '', pmcid = '';
      qa(art, 'ArticleId').forEach((n) => {
        const t = n.getAttribute('IdType');
        if (t === 'doi' && !doi) doi = txt(n);
        if (t === 'pmc' && !pmcid) pmcid = txt(n);
      });
      if (!doi) qa(art, 'ELocationID').forEach((n) => { if (n.getAttribute('EIdType') === 'doi' && !doi) doi = txt(n); });
      const ji = q(art, 'JournalIssue');
      const pd = ji ? q(ji, 'PubDate') : null;
      let year = pd ? txt(q(pd, 'Year')) : '';
      if (!year && pd) { const m = txt(q(pd, 'MedlineDate')).match(/\d{4}/); year = m ? m[0] : ''; }
      const pubTypes = qa(art, 'PublicationType').map(txt);
      const keywords = qa(art, 'Keyword').map(txt).concat(qa(art, 'DescriptorName').map(txt));
      return makeRecord({
        title, authors, year, journal: txt(q(art, 'Title')), volume: ji ? txt(q(ji, 'Volume')) : '',
        issue: ji ? txt(q(ji, 'Issue')) : '', pages: txt(q(art, 'MedlinePgn')), doi, pmid, pmcid,
        abstract: absParts.join(' '), pubTypes, keywords, language: txt(q(art, 'Language')),
        retracted: pubTypes.some((t) => /retracted publication/i.test(t)) ? true : null,
        sources: ['PubMed'], sourceUrls: { PubMed: 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/' },
      });
    });
  }

  /** Europe PMC REST API. opts: {query, max, yearFrom, yearTo, since, fetch} */
  async function searchEuropePMC(opts) {
    const f = opts.fetch || root.fetch.bind(root);
    let query = '(' + stripFieldTags(opts.query) + ')';
    if (opts.since) query += ' AND FIRST_IDATE:[' + opts.since + ' TO 3000-12-31]';
    else if (opts.yearFrom || opts.yearTo) query += ' AND PUB_YEAR:[' + (opts.yearFrom || 1800) + ' TO ' + (opts.yearTo || 3000) + ']';
    const max = Math.min(opts.max || 100, 2000);
    let cursor = '*', total = 0, firstUrl = '';
    const records = [];
    while (records.length < max) {
      const size = Math.min(1000, max - records.length);
      const url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=' + size +
        '&cursorMark=' + encodeURIComponent(cursor) + '&query=' + encodeURIComponent(query);
      if (!firstUrl) firstUrl = url;
      const js = await getJson(f, url);
      total = Number(js.hitCount || 0);
      const list = (js.resultList && js.resultList.result) || [];
      list.forEach((r) => records.push(fromEuropePMC(r)));
      if (!list.length || records.length >= total || !js.nextCursorMark || js.nextCursorMark === cursor) break;
      cursor = js.nextCursorMark;
      await sleep(150);
    }
    return { source: 'Europe PMC', total, retrieved: records.length, url: firstUrl, records };
  }
  function fromEuropePMC(r) {
    const authors = (r.authorList && r.authorList.author || []).map((a) => a.fullName || a.collectiveName).filter(Boolean);
    const pubTypes = (r.pubTypeList && r.pubTypeList.pubType) || [];
    const ji = r.journalInfo || {};
    return makeRecord({
      title: r.title, authors: authors.length ? authors : String(r.authorString || '').split(/,\s*/),
      year: r.pubYear, date: r.firstPublicationDate || null,
      journal: (ji.journal && ji.journal.title) || r.journalTitle || r.bookOrReportDetails && r.bookOrReportDetails.publisher || '',
      volume: ji.volume || '', issue: ji.issue || '', pages: r.pageInfo || '',
      doi: r.doi, pmid: r.pmid, pmcid: r.pmcid, abstract: r.abstractText, pubTypes,
      keywords: (r.keywordList && r.keywordList.keyword) || [], language: r.language || '',
      isOA: r.isOpenAccess === 'Y',
      retracted: pubTypes.some((t) => /retracted publication/i.test(t)) ? true : null,
      sources: ['Europe PMC'],
      sourceUrls: { 'Europe PMC': 'https://europepmc.org/article/' + (r.source || 'MED') + '/' + r.id },
    });
  }

  /** OpenAlex works search. A free API key is required for regular use (since Feb 2026). */
  async function searchOpenAlex(opts) {
    const f = opts.fetch || root.fetch.bind(root);
    const filters = [];
    if (opts.since) filters.push('from_created_date:' + opts.since);
    else {
      if (opts.yearFrom) filters.push('from_publication_date:' + opts.yearFrom + '-01-01');
      if (opts.yearTo) filters.push('to_publication_date:' + opts.yearTo + '-12-31');
    }
    const max = Math.min(opts.max || 100, 2000);
    let cursor = '*', total = 0, firstUrl = '';
    const records = [];
    while (records.length < max) {
      const per = Math.min(200, max - records.length);
      const url = 'https://api.openalex.org/works?search=' + encodeURIComponent(stripFieldTags(opts.query)) + '&per_page=' + per +
        '&cursor=' + encodeURIComponent(cursor) + (filters.length ? '&filter=' + filters.join(',') : '') +
        (opts.apiKey ? '&api_key=' + encodeURIComponent(opts.apiKey) : '');
      if (!firstUrl) firstUrl = url.replace(/&api_key=[^&]+/, '&api_key=…');
      const js = await getJson(f, url);
      total = Number((js.meta && js.meta.count) || 0);
      const list = js.results || [];
      list.forEach((w) => records.push(fromOpenAlex(w)));
      const next = js.meta && js.meta.next_cursor;
      if (!list.length || records.length >= total || !next) break;
      cursor = next;
      await sleep(150);
    }
    return { source: 'OpenAlex', total, retrieved: records.length, url: firstUrl, records };
  }
  function invertedToText(inv) {
    if (!inv) return '';
    const words = [];
    Object.keys(inv).forEach((w) => inv[w].forEach((pos) => { words[pos] = w; }));
    return words.filter((w) => w !== undefined).join(' ');
  }
  function fromOpenAlex(w) {
    const pl = w.primary_location || {};
    const pmid = w.ids && w.ids.pmid ? String(w.ids.pmid).replace(/\D/g, '') : '';
    const b = w.biblio || {};
    return makeRecord({
      title: w.display_name || w.title, authors: (w.authorships || []).map((a) => a.author && a.author.display_name),
      year: w.publication_year, date: w.publication_date, journal: (pl.source && pl.source.display_name) || '',
      volume: b.volume || '', issue: b.issue || '', pages: b.first_page ? b.first_page + (b.last_page ? '-' + b.last_page : '') : '',
      doi: w.doi, pmid, openalexId: String(w.id || '').replace('https://openalex.org/', ''),
      abstract: invertedToText(w.abstract_inverted_index), pubTypes: w.type ? [w.type] : [],
      keywords: (w.keywords || []).map((k) => k.display_name), language: w.language || '',
      isOA: w.open_access ? !!w.open_access.is_oa : null, retracted: w.is_retracted === true ? true : (w.is_retracted === false ? false : null),
      sources: ['OpenAlex'], sourceUrls: { OpenAlex: w.id || '' },
    });
  }


  // ---------------------------------------------------------------- query translation
  /** Remove PubMed-only field tags such as [tiab], [mh], [MeSH Terms]. */
  function stripFieldTags(q) { return String(q || '').replace(/\[[A-Za-z :]+\]/g, '').replace(/\s+/g, ' ').trim(); }
  /** Plain keywords for services without Boolean search (Crossref). NOT terms are dropped. */
  function toPlainQuery(q) {
    return stripFieldTags(q).replace(/\bNOT\s+(\([^)]*\)|"[^"]*"|\S+)/g, ' ').replace(/\b(AND|OR)\b/g, ' ')
      .replace(/[()"*]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /** Semantic Scholar bulk syntax: + AND, | OR, - NOT, "phrase", prefix*. */
  function toS2Query(q) {
    return stripFieldTags(q).replace(/\bNOT\s+/g, ' -').replace(/\bAND\b/g, ' + ').replace(/\bOR\b/g, ' | ').replace(/\s+/g, ' ').trim();
  }
  /** DOAJ (Elasticsearch query string, wildcards disabled). */
  function toDoajQuery(q) { return stripFieldTags(q).replace(/\*/g, '').replace(/\s+/g, ' ').trim(); }

  // ---------------------------------------------------------------- Crossref
  /** Crossref works search. Free, no key. No Boolean operators: words are matched by relevance. */
  async function searchCrossref(opts) {
    const f = opts.fetch || root.fetch.bind(root);
    const filters = [];
    if (opts.since) filters.push('from-index-date:' + opts.since);
    else { if (opts.yearFrom) filters.push('from-pub-date:' + opts.yearFrom); if (opts.yearTo) filters.push('until-pub-date:' + opts.yearTo + '-12-31'); }
    const max = Math.min(opts.max || 100, 2000);
    const query = toPlainQuery(opts.query);
    let cursor = '*', total = 0, firstUrl = ''; const records = [];
    while (records.length < max) {
      const rows = Math.min(500, max - records.length);
      const url = 'https://api.crossref.org/works?query=' + encodeURIComponent(query) + '&rows=' + rows + '&cursor=' + encodeURIComponent(cursor) +
        (filters.length ? '&filter=' + filters.join(',') : '') + (opts.email ? '&mailto=' + encodeURIComponent(opts.email) : '') +
        '&select=DOI,title,author,issued,container-title,volume,issue,page,abstract,type,subject,language,URL,update-to';
      if (!firstUrl) firstUrl = url;
      const js = await getJson(f, url);
      const m = js.message || {};
      total = Number(m['total-results'] || 0);
      const items = m.items || [];
      items.forEach((w) => records.push(fromCrossref(w)));
      if (!items.length || records.length >= total || !m['next-cursor']) break;
      cursor = m['next-cursor'];
      await sleep(200);
    }
    return { source: 'Crossref', total, retrieved: records.length, url: firstUrl, records };
  }
  function fromCrossref(w) {
    const dp = (w.issued && w.issued['date-parts'] && w.issued['date-parts'][0]) || [];
    const type = String(w.type || '').replace(/-/g, ' ');
    return makeRecord({
      title: (w.title || [])[0] || '', authors: (w.author || []).map((a) => a.family ? a.family + (a.given ? ' ' + a.given : '') : a.name),
      year: dp[0] || null, journal: (w['container-title'] || [])[0] || '', volume: w.volume, issue: w.issue, pages: w.page,
      doi: w.DOI, abstract: String(w.abstract || '').replace(/<jats:title>[^<]*<\/jats:title>/g, ' '), pubTypes: type ? [type] : [],
      keywords: w.subject || [], language: w.language || '',
      retracted: (w['update-to'] || []).some((u) => /retract/i.test(u.type || '')) ? true : null,
      sources: ['Crossref'], sourceUrls: { Crossref: w.URL || '' },
    });
  }

  // ---------------------------------------------------------------- Semantic Scholar
  /** Semantic Scholar bulk paper search. Free; an optional free key gives a dedicated rate limit. */
  async function searchSemanticScholar(opts) {
    const f = opts.fetch || root.fetch.bind(root);
    const max = Math.min(opts.max || 100, 2000);
    const fields = 'title,abstract,year,venue,authors,externalIds,publicationTypes,isOpenAccess,publicationDate,journal,fieldsOfStudy';
    let date = '';
    if (opts.since) date = '&publicationDateOrYear=' + opts.since + ':';
    else if (opts.yearFrom || opts.yearTo) date = '&year=' + (opts.yearFrom || '') + '-' + (opts.yearTo || '');
    const headers = opts.apiKey ? { 'x-api-key': opts.apiKey } : undefined;
    let token = null, total = 0, firstUrl = ''; const records = [];
    do {
      const url = 'https://api.semanticscholar.org/graph/v1/paper/search/bulk?query=' + encodeURIComponent(toS2Query(opts.query)) +
        '&fields=' + fields + date + (token ? '&token=' + encodeURIComponent(token) : '');
      if (!firstUrl) firstUrl = url;
      const res = await f(url, headers ? { headers } : undefined);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url.split('?')[0]);
      const js = await res.json();
      total = Number(js.total || 0);
      (js.data || []).forEach((p) => { if (records.length < max) records.push(fromSemanticScholar(p)); });
      token = js.token || null;
      if (token && records.length < max) await sleep(opts.apiKey ? 1100 : 1500);
    } while (token && records.length < max);
    return { source: 'Semantic Scholar', total, retrieved: records.length, url: firstUrl, records };
  }
  function fromSemanticScholar(p) {
    const ids = p.externalIds || {}; const j = p.journal || {};
    return makeRecord({
      title: p.title, authors: (p.authors || []).map((a) => a.name), year: p.year, date: p.publicationDate || null,
      journal: j.name || p.venue || '', volume: j.volume || '', pages: String(j.pages || '').replace(/\s/g, ''),
      doi: ids.DOI, pmid: ids.PubMed, pmcid: ids.PubMedCentral ? 'PMC' + String(ids.PubMedCentral).replace(/^PMC/i, '') : '',
      abstract: p.abstract || '', pubTypes: p.publicationTypes || [], keywords: p.fieldsOfStudy || [], isOA: p.isOpenAccess,
      sources: ['Semantic Scholar'], sourceUrls: { 'Semantic Scholar': p.paperId ? 'https://www.semanticscholar.org/paper/' + p.paperId : '' },
    });
  }

  // ---------------------------------------------------------------- ClinicalTrials.gov
  /** ClinicalTrials.gov API v2. Free, no key. Returns trial registrations, not papers. */
  async function searchClinicalTrials(opts) {
    const f = opts.fetch || root.fetch.bind(root);
    const max = Math.min(opts.max || 100, 2000);
    let adv = '';
    if (opts.since) adv = 'AREA[StudyFirstPostDate]RANGE[' + opts.since + ',MAX]';
    else if (opts.yearFrom || opts.yearTo) adv = 'AREA[StartDate]RANGE[' + (opts.yearFrom ? opts.yearFrom + '-01-01' : 'MIN') + ',' + (opts.yearTo ? opts.yearTo + '-12-31' : 'MAX') + ']';
    let token = null, total = 0, firstUrl = ''; const records = [];
    do {
      const url = 'https://clinicaltrials.gov/api/v2/studies?format=json&countTotal=true&pageSize=' + Math.min(200, max - records.length) +
        '&query.term=' + encodeURIComponent(stripFieldTags(opts.query)) + (adv ? '&filter.advanced=' + encodeURIComponent(adv) : '') +
        (token ? '&pageToken=' + encodeURIComponent(token) : '');
      if (!firstUrl) firstUrl = url;
      const js = await getJson(f, url);
      if (js.totalCount != null) total = Number(js.totalCount);
      (js.studies || []).forEach((st) => records.push(fromClinicalTrial(st)));
      token = js.nextPageToken || null;
      if (token) await sleep(1300); // about 50 requests per minute
    } while (token && records.length < max);
    return { source: 'ClinicalTrials.gov', total: total || records.length, retrieved: records.length, url: firstUrl, records };
  }
  function fromClinicalTrial(st) {
    const ps = st.protocolSection || {};
    const id = ps.identificationModule || {}, sm = ps.statusModule || {}, dm = ps.designModule || {}, de = ps.descriptionModule || {};
    const cm = ps.conditionsModule || {}, am = ps.armsInterventionsModule || {}, sp = ps.sponsorCollaboratorsModule || {};
    const phases = (dm.phases || []).filter((x) => x && x !== 'NA').map((x) => x.replace('PHASE', 'Phase ').replace('EARLY_Phase ', 'Early phase '));
    const studyType = dm.studyType === 'INTERVENTIONAL' ? 'Interventional' : dm.studyType === 'OBSERVATIONAL' ? 'Observational' : (dm.studyType || '');
    const design = dm.designInfo || {};
    const randomised = /RANDOMIZED/.test(design.allocation || '') && !/NON_RANDOMIZED/.test(design.allocation || '');
    const interventions = (am.interventions || []).map((i) => (i.type ? i.type.charAt(0) + i.type.slice(1).toLowerCase().replace(/_/g, ' ') + ': ' : '') + i.name);
    const n = dm.enrollmentInfo && dm.enrollmentInfo.count;
    const start = (sm.startDateStruct && sm.startDateStruct.date) || '';
    const posted = (sm.studyFirstPostDateStruct && sm.studyFirstPostDateStruct.date) || '';
    // a readable summary in abstract form, so screening and extraction work the same way as for papers
    const parts = [];
    parts.push('REGISTRY RECORD: ' + [studyType && studyType + ' study', randomised && 'randomized', phases.join('/'), sm.overallStatus && 'status ' + sm.overallStatus.toLowerCase().replace(/_/g, ' ')].filter(Boolean).join(', ') + '.');
    if (cm.conditions && cm.conditions.length) parts.push('Conditions: ' + cm.conditions.join('; ') + '.');
    if (interventions.length) parts.push('Interventions: ' + interventions.join('; ') + '.');
    if (n) parts.push('Enrollment: ' + n + ' participants' + (dm.enrollmentInfo.type ? ' (' + dm.enrollmentInfo.type.toLowerCase() + ')' : '') + '.');
    if (de.briefSummary) parts.push('SUMMARY: ' + de.briefSummary);
    if (sp.leadSponsor && sp.leadSponsor.name) parts.push('Sponsor: ' + sp.leadSponsor.name + '.');
    const types = ['Clinical trial registration', studyType, randomised ? 'Randomized' : ''].concat(phases).filter(Boolean);
    return makeRecord({
      title: id.officialTitle || id.briefTitle, authors: sp.leadSponsor && sp.leadSponsor.name ? [sp.leadSponsor.name] : [],
      year: (start || posted).slice(0, 4) || null, date: posted || null, journal: 'ClinicalTrials.gov', registryId: id.nctId,
      abstract: parts.join(' '), pubTypes: types, keywords: (cm.conditions || []).concat(cm.keywords || []),
      sources: ['ClinicalTrials.gov'], sourceUrls: { 'ClinicalTrials.gov': id.nctId ? 'https://clinicaltrials.gov/study/' + id.nctId : '' },
    });
  }

  // ---------------------------------------------------------------- DOAJ
  /** Directory of Open Access Journals article search. Free, no key; about 2 requests a second. */
  async function searchDOAJ(opts) {
    const f = opts.fetch || root.fetch.bind(root);
    const max = Math.min(opts.max || 100, 1000);
    let q = toDoajQuery(opts.query);
    if (opts.since) q = '(' + q + ') AND created_date:[' + opts.since + ' TO *]';
    else if (opts.yearFrom || opts.yearTo) q = '(' + q + ') AND bibjson.year:[' + (opts.yearFrom || '*') + ' TO ' + (opts.yearTo || '*') + ']';
    let page = 1, total = 0, firstUrl = ''; const records = [];
    while (records.length < max) {
      const size = Math.min(100, max - records.length);
      const url = 'https://doaj.org/api/search/articles/' + encodeURIComponent(q) + '?page=' + page + '&pageSize=' + size;
      if (!firstUrl) firstUrl = url;
      const js = await getJson(f, url);
      total = Number(js.total || 0);
      const list = js.results || [];
      list.forEach((a) => records.push(fromDOAJ(a)));
      if (!list.length || records.length >= total || list.length < size) break;
      page++; await sleep(600);
    }
    return { source: 'DOAJ', total, retrieved: records.length, url: firstUrl, records };
  }
  function fromDOAJ(a) {
    const b = a.bibjson || {}; const j = b.journal || {};
    const doi = ((b.identifier || []).find((i) => String(i.type).toLowerCase() === 'doi') || {}).id || '';
    const link = ((b.link || []).find((l) => l.type === 'fulltext') || (b.link || [])[0] || {}).url || '';
    return makeRecord({
      title: b.title, authors: (b.author || []).map((x) => x.name), year: b.year, journal: j.title || '', volume: j.volume || '', issue: j.number || '',
      pages: b.start_page ? b.start_page + (b.end_page ? '-' + b.end_page : '') : '', doi, abstract: b.abstract || '',
      pubTypes: ['Journal Article'], keywords: b.keywords || [], language: (j.language || [])[0] || '', isOA: true,
      sources: ['DOAJ'], sourceUrls: { DOAJ: a.id ? 'https://doaj.org/article/' + a.id : link },
    });
  }

  const ADAPTERS = { pubmed: searchPubMed, europepmc: searchEuropePMC, openalex: searchOpenAlex,
    crossref: searchCrossref, semanticscholar: searchSemanticScholar, clinicaltrials: searchClinicalTrials, doaj: searchDOAJ };

  // ---------------------------------------------------------------- deduplication
  /** Merge records that share a DOI, a PMID, or the same normalised title and year (±1). */
  function dedupe(records) {
    const kept = [], merges = [];
    const byDoi = new Map(), byPmid = new Map(), byReg = new Map(), byTitle = new Map();
    const tkey = (r) => normTitle(r.title).slice(0, 150);
    for (const r of records) {
      let hit = null, on = '';
      if (r.doi && byDoi.has(r.doi)) { hit = byDoi.get(r.doi); on = 'DOI'; }
      else if (r.pmid && byPmid.has(r.pmid)) { hit = byPmid.get(r.pmid); on = 'PMID'; }
      else if (r.registryId && byReg.has(r.registryId)) { hit = byReg.get(r.registryId); on = 'trial registration'; }
      else if (tkey(r).length > 20 && byTitle.has(tkey(r))) {
        const cand = byTitle.get(tkey(r));
        if (!r.year || !cand.year || Math.abs(r.year - cand.year) <= 1) {
          // never merge two records that carry different DOIs
          // nor a trial registration with a paper, nor two different registrations
          if (!(r.doi && cand.doi && r.doi !== cand.doi) && !!r.registryId === !!cand.registryId && r.registryId === cand.registryId) { hit = cand; on = 'title + year'; }
        }
      }
      if (hit) {
        mergeInto(hit, r);
        merges.push({ kept: hit.id, merged: r.sources.join('/') + ' ' + (r.doi || r.pmid || r.title.slice(0, 40)), matchedOn: on });
      } else {
        const c = JSON.parse(JSON.stringify(r));
        kept.push(c);
      }
      const target = hit || kept[kept.length - 1];
      if (target.doi) byDoi.set(target.doi, target);
      if (target.pmid) byPmid.set(target.pmid, target);
      if (target.registryId) byReg.set(target.registryId, target);
      if (tkey(target).length > 20) byTitle.set(tkey(target), target);
    }
    kept.forEach((r) => { r.id = recordKey(r); });
    return { records: kept, duplicatesRemoved: records.length - kept.length, merges };
  }
  function mergeInto(a, b) {
    ['doi', 'pmid', 'pmcid', 'openalexId', 'registryId', 'journal', 'volume', 'issue', 'pages', 'date', 'language', 'year'].forEach((k) => { if (!a[k] && b[k]) a[k] = b[k]; });
    if ((b.abstract || '').length > (a.abstract || '').length) a.abstract = b.abstract;
    if (b.authors.length > a.authors.length) a.authors = b.authors.slice();
    a.pubTypes = Array.from(new Set(a.pubTypes.concat(b.pubTypes)));
    a.keywords = Array.from(new Set(a.keywords.concat(b.keywords)));
    a.sources = Array.from(new Set(a.sources.concat(b.sources)));
    a.sourceUrls = Object.assign({}, b.sourceUrls, a.sourceUrls);
    if (b.retracted === true) a.retracted = true; else if (a.retracted == null && b.retracted != null) a.retracted = b.retracted;
    if (a.isOA == null) a.isOA = b.isOA; else if (b.isOA) a.isOA = true;
  }

  // ---------------------------------------------------------------- screening
  const DEFAULT_CRITERIA = {
    includeGroups: [],          // array of arrays: every group needs at least one term in title/abstract
    excludeTerms: [],           // any term in title/abstract -> exclude
    yearFrom: null, yearTo: null,
    excludeTypes: ['editorial', 'comment', 'letter', 'erratum', 'retracted publication'],
    requireAbstract: true,
    excludeRetracted: true,
  };
  const TYPE_ALIASES = {
    'review': /\b(review|systematic review|meta-analysis)\b/i,
    'systematic review': /systematic review/i,
    'meta-analysis': /meta-analysis/i,
    'editorial': /editorial/i, 'comment': /\bcomment/i, 'letter': /\bletter\b/i,
    'erratum': /errat|correction/i, 'case report': /case report/i, 'preprint': /preprint|posted-content/i,
    'retracted publication': /retracted publication|retraction/i, 'conference': /congress|conference|proceedings/i,
  };

  function screen(record, criteria) {
    const c = Object.assign({}, DEFAULT_CRITERIA, criteria || {});
    const text = (record.title || '') + '. ' + (record.abstract || '');
    const reasons = [];
    const ex = (msg) => ({ status: 'exclude', reasons: [msg], by: 'rules' });

    if (c.excludeRetracted && record.retracted === true) return ex('Flagged as retracted by the source database');
    if (c.yearFrom && record.year && record.year < c.yearFrom) return ex('Published ' + record.year + ', before ' + c.yearFrom);
    if (c.yearTo && record.year && record.year > c.yearTo) return ex('Published ' + record.year + ', after ' + c.yearTo);
    for (const t of c.excludeTypes || []) {
      const re = TYPE_ALIASES[t.toLowerCase()] || termRegex(t);
      const hitType = (record.pubTypes || []).find((pt) => re && re.test(pt));
      if (hitType) return ex('Publication type "' + hitType + '" is on the exclusion list');
    }
    for (const t of c.excludeTerms || []) {
      const h = findTerm(t, text);
      if (h) return ex('Exclusion term "' + t + '" found: ' + h.snippet);
    }
    if (c.requireAbstract && !(record.abstract || '').trim()) {
      return { status: 'review', reasons: ['No abstract available from the source; screen on full text'], by: 'rules' };
    }
    const groups = (c.includeGroups || []).filter((g) => g && g.length);
    if (!groups.length) return { status: 'review', reasons: ['No inclusion criteria set; needs a human decision'], by: 'rules' };
    let met = 0;
    groups.forEach((g, i) => {
      const hit = g.map((t) => findTerm(t, text)).find(Boolean);
      if (hit) { met++; reasons.push('Criterion ' + (i + 1) + ' met by "' + hit.match + '": ' + hit.snippet); }
      else reasons.push('Criterion ' + (i + 1) + ' not found (' + g.join(' / ') + ')');
    });
    if (met === groups.length) return { status: 'include', reasons, by: 'rules' };
    if (met === 0) return { status: 'exclude', reasons: ['None of the inclusion criteria appear in the title or abstract'].concat(reasons), by: 'rules' };
    return { status: 'review', reasons: ['Only ' + met + ' of ' + groups.length + ' inclusion criteria found'].concat(reasons), by: 'rules' };
  }

  // result polarity cues (used by extraction and contradiction finding)
  const POS = /\b(significant(ly)?\s+(improv|increas|reduc|decreas|lower|higher|better|associat)\w*|effective|beneficial|superior|protective|was associated with)/i;
  const NEG = /\b(no significant|not significant(ly)?|did not|failed to|no (difference|association|effect|benefit)|not associated|ineffective|no evidence)/i;

  // ---------------------------------------------------------------- extraction
  const DESIGNS = [
    ['Meta-analysis', /\bmeta-?analys[ie]s\b/i],
    ['Systematic review', /\bsystematic(ally)? review/i],
    ['Umbrella / scoping review', /\b(scoping|umbrella) review/i],
    ['Randomised controlled trial', /\brandomi[sz]ed\b[^.]{0,60}\b(controlled|trial|clinical)\b|\bRCTs?\b|\bdouble[- ]blind/i],
    ['Non-randomised trial', /\b(non-?randomi[sz]ed|single[- ]arm|open[- ]label|phase (i|ii|1|2)\b)[^.]{0,40}\b(trial|study)\b/i],
    ['Prospective cohort', /\bprospective\b[^.]{0,40}\b(cohort|longitudinal|follow-up)\b/i],
    ['Retrospective cohort', /\bretrospective\b[^.]{0,40}\b(cohort|study|analysis|review)\b/i],
    ['Cohort study', /\bcohort study\b|\blongitudinal study\b/i],
    ['Case-control study', /\bcase[- ]control\b/i],
    ['Cross-sectional study', /\bcross[- ]sectional\b|\bsurvey\b/i],
    ['Case report / series', /\bcase (report|series)\b|\bwe (report|describe|present) (a|an|two|three) (case|patient)/i],
    ['Qualitative study', /\bqualitative\b|\bfocus groups?\b|\bsemi-structured interviews?\b|\bthematic analysis\b/i],
    ['Animal study', /\b(mice|mouse|murine|rats?|rodents?|zebrafish|rabbits?|in vivo)\b/i],
    ['In vitro study', /\bin vitro\b|\bcell lines?\b|\bcultured cells\b/i],
    ['Computational / in silico', /\bin silico\b|\bmolecular docking\b|\bmachine learning\b|\bdeep learning\b|\bsimulations?\b|\bmodel(l)?ing study\b/i],
    ['Narrative review', /\b(this|we) review\b|\breview (of|summari[sz]es|discusses)\b|\boverview of\b/i],
    ['Field / environmental sampling', /\bsamples? (were )?(collected|taken)\b|\bsampling (sites?|stations?|campaign)\b/i],
  ];
  const NOT_REPORTED = 'Not reported in abstract';

  function extract(record) {
    const abs = record.abstract || '';
    const sents = sentences(abs);
    const out = {};
    const pick = (field, value, sentence, how) => { out[field] = { value, evidence: sentence || '', method: how }; };
    const missing = (field) => { out[field] = { value: null, evidence: '', method: 'none', note: NOT_REPORTED }; };

    // study design: publication types first, then text
    const pt = (record.pubTypes || []).join(' | ');
    const ptDesign = /meta-analysis/i.test(pt) ? 'Meta-analysis' : /systematic review/i.test(pt) ? 'Systematic review'
      : /randomized controlled trial/i.test(pt) ? 'Randomised controlled trial' : /case reports?/i.test(pt) ? 'Case report / series' : null;
    const isReg = /clinical trial registration/i.test(pt);
    if (isReg) {
      const ph = (record.pubTypes || []).filter((t) => /phase/i.test(t)).join('/');
      const kind = /randomized/i.test(pt) ? 'Randomised controlled trial' : /interventional/i.test(pt) ? 'Non-randomised trial' : /observational/i.test(pt) ? 'Observational study' : 'Clinical study';
      pick('studyDesign', kind + ' (registered' + (ph ? ', ' + ph : '') + ')', 'Registry record: ' + pt, 'trial registry fields');
    } else if (ptDesign) pick('studyDesign', ptDesign, 'Publication type: ' + pt, 'publication type');
    else {
      let done = false;
      for (const [name, re] of DESIGNS) {
        const s = sents.find((x) => re.test(x)) || (re.test(record.title || '') ? 'Title: ' + record.title : null);
        if (s) { pick('studyDesign', name, s, 'keyword pattern'); done = true; break; }
      }
      if (!done) missing('studyDesign');
    }

    // sample size
    const nUnits = '(patients|participants|subjects|adults|children|adolescents|infants|women|men|individuals|cases|controls|respondents|volunteers|people|persons|residents|students|samples|specimens|mice|rats|animals|studies|trials|articles|eyes|hospitals|sites)';
    const nRe1 = /\b[nN]\s*=\s*(\d{1,3}(?:[ ,]\d{3})+|\d+)/;
    const nRe2 = new RegExp('\\b(\\d{1,3}(?:,\\d{3})+|\\d{2,7})\\s+(?:[a-z-]+\\s+){0,3}' + nUnits + '\\b', 'i');
    let nDone = false;
    for (const s of sents) {
      const m2 = nRe2.exec(s);
      if (m2 && !/\b(19|20)\d{2}\b/.test(m2[1])) { pick('sampleSize', m2[1].replace(/[ ,]/g, '') + ' ' + m2[2].toLowerCase(), s, 'number + unit pattern'); nDone = true; break; }
      const m1 = nRe1.exec(s);
      if (m1) { pick('sampleSize', 'n = ' + m1[1].replace(/[ ,]/g, ''), s, 'n = pattern'); nDone = true; break; }
    }
    if (!nDone) missing('sampleSize');

    // population
    const popRe = /\b(?:patients|adults|children|adolescents|women|men|participants|individuals|people|subjects|infants|survivors|residents)\s+(?:with|aged|who|undergoing|receiving|diagnosed with|living with|from|in)\s+[^.;:]{3,90}/i;
    const popS = sents.find((s) => popRe.test(s));
    if (popS) pick('population', popS.match(popRe)[0].trim(), popS, 'population pattern'); else missing('population');

    // intervention / exposure
    const intRe = /\b(?:treated with|received|randomi[sz]ed to|assigned to|administration of|administered|exposed to|exposure to|supplementation with|treatment with|intervention(?: consisted of| was|:)?)\s+[^.;:]{3,90}/i;
    const intS = sents.find((s) => intRe.test(s));
    if (intS) pick('intervention', intS.match(intRe)[0].trim(), intS, 'intervention pattern'); else missing('intervention');

    // outcomes
    const outRe = /\b(primary|secondary|main)\s+(outcomes?|end ?points?)\b|\boutcomes? (was|were|included|measured)\b|\bwe (measured|assessed|quantified)\b[^.]{0,60}\b(at|after|over|during|using)\b/i;
    const outS = sents.find((s) => outRe.test(s));
    if (outS) pick('outcomes', outS.replace(/^[A-Z ]+:\s*/, ''), outS, 'outcome pattern'); else missing('outcomes');

    // key finding: structured CONCLUSION section, else conclusion-like sentence
    const concIdx = abs.search(/\b(CONCLUSIONS?|INTERPRETATION|SIGNIFICANCE|IMPLICATIONS)\s*:/);
    if (concIdx >= 0) {
      const seg = abs.slice(concIdx).replace(/^[A-Z ]+:\s*/, '');
      const first = sentences(seg).slice(0, 2).join(' ');
      pick('keyFinding', first, abs.slice(concIdx, concIdx + 300), 'structured abstract conclusion');
    } else {
      const cRe = /^(in conclusion|in summary|overall|taken together|these (findings|results|data)|our (findings|results|data)|this study (shows|demonstrates|suggests|indicates)|we conclude)/i;
      const cs = sents.find((s) => cRe.test(s));
      const rs = sents.slice().reverse().find((s) => POS.test(s) || NEG.test(s));
      if (cs) pick('keyFinding', cs, cs, 'conclusion phrase');
      else if (rs) pick('keyFinding', rs, rs, 'result sentence');
      else if (sents.length >= 3) pick('keyFinding', sents[sents.length - 1], sents[sents.length - 1], 'last sentence (weak heuristic, check it)');
      else missing('keyFinding');
    }

    // limitations
    const limRe = /\blimitations?\b|\blimited by\b|\bsmall sample\b|\b(further|larger|additional|more|future|well-designed)\s+(research|studies|trials|work|investigations?|evidence)\b[^.]{0,40}\b(needed|required|warranted|necessary)\b|\bshould be interpreted with caution\b|\bremains? unclear\b/i;
    const limS = sents.find((s) => limRe.test(s));
    if (limS) pick('limitations', limS.replace(/^[A-Z ]+:\s*/, ''), limS, 'limitation pattern'); else missing('limitations');

    out._meta = { basis: abs ? 'abstract only' : 'no abstract', at: new Date().toISOString() };
    return out;
  }
  const EXTRACT_FIELDS = [
    ['studyDesign', 'Study design'], ['sampleSize', 'Sample size'], ['population', 'Population'],
    ['intervention', 'Intervention / exposure'], ['outcomes', 'Outcomes'], ['keyFinding', 'Key finding'], ['limitations', 'Limitations'],
  ];

  // ---------------------------------------------------------------- verification
  async function fetchCrossref(doi, fetchFn, mailto) {
    const f = fetchFn || root.fetch.bind(root);
    const url = 'https://api.crossref.org/works/' + encodeURIComponent(doi) + (mailto ? '?mailto=' + encodeURIComponent(mailto) : '');
    const res = await f(url);
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error('Crossref HTTP ' + res.status);
    const js = await res.json();
    return js.message || {};
  }
  /** Run the verifier on one record. crossref = Crossref message, {notFound:true}, or null (not checked). */
  function verify(record, ctx) {
    ctx = ctx || {};
    const checks = [];
    const add = (check, status, detail) => checks.push({ check, status, detail });
    const cr = ctx.crossref;

    if (record.doi || record.pmid || record.registryId) add('Has a persistent identifier', 'pass', [record.doi && 'DOI ' + record.doi, record.pmid && 'PMID ' + record.pmid, record.registryId && 'Registry ' + record.registryId].filter(Boolean).join(' · '));
    else add('Has a persistent identifier', 'fail', 'No DOI, PMID or trial registration; the record cannot be traced reliably');

    if (!record.doi) add('DOI registered at Crossref', 'skip', 'No DOI');
    else if (ctx.crossrefSkip) add('DOI registered at Crossref', 'skip', ctx.crossrefSkip);
    else if (!cr) add('DOI registered at Crossref', 'skip', 'Not checked yet (Crossref could not be reached)');
    else if (cr.notFound) add('DOI registered at Crossref', 'warn', 'Crossref has no record (the DOI may be registered with DataCite or another agency)');
    else {
      add('DOI registered at Crossref', 'pass', 'Found');
      const crTitle = (cr.title && cr.title[0]) || '';
      const sim = titleSimilarity(record.title, crTitle);
      add('Title matches registry', sim >= 0.75 ? 'pass' : sim >= 0.45 ? 'warn' : 'fail', 'Similarity ' + sim.toFixed(2) + ' vs "' + stripTags(crTitle).slice(0, 120) + '"');
      const dp = (cr.issued && cr.issued['date-parts'] && cr.issued['date-parts'][0]) || (cr.published && cr.published['date-parts'] && cr.published['date-parts'][0]);
      const crYear = dp && dp[0];
      if (crYear && record.year) add('Year matches registry', Math.abs(crYear - record.year) <= 1 ? 'pass' : 'fail', 'Record ' + record.year + ', registry ' + crYear);
      const fam = cr.author && cr.author[0] && cr.author[0].family;
      if (fam && record.authors.length) {
        const ok = normTitle(record.authors[0]).includes(normTitle(fam)) || record.authors.some((a) => normTitle(a).includes(normTitle(fam)));
        add('First author matches registry', ok ? 'pass' : 'warn', 'Registry first author: ' + fam);
      }
      const upd = (cr['updated-by'] || []).concat(cr['update-to'] || []);
      const retr = upd.find((u) => /retract|withdraw/i.test(u.type || ''));
      if (retr) { record.retracted = true; add('Not retracted', 'fail', 'Registry lists a ' + retr.type + (retr.DOI ? ' (' + retr.DOI + ')' : '')); }
      const corr = upd.find((u) => /correct|erratum|expression/i.test(u.type || ''));
      if (corr) add('No corrections or expressions of concern', 'warn', 'Registry lists a ' + corr.type + (corr.DOI ? ' (' + corr.DOI + ')' : ''));
    }
    if (record.retracted === true && !checks.some((c) => c.check === 'Not retracted')) add('Not retracted', 'fail', 'Source database flags this record as retracted');
    else if (record.retracted === false && !checks.some((c) => c.check === 'Not retracted')) add('Not retracted', 'pass', 'Source reports not retracted');

    add('Abstract available', record.abstract ? 'pass' : 'warn', record.abstract ? record.abstract.length + ' characters' : 'Screening and extraction need the full text');

    const d = ctx.decision;
    if (!d) add('Screening decision recorded', 'fail', 'No decision');
    else add('Screening decision recorded', d.reasons && d.reasons.length ? 'pass' : 'fail', d.status + ' by ' + d.by + (d.reasons && d.reasons[0] ? ': ' + d.reasons[0].slice(0, 90) : ' (no reason given)'));

    const ex = ctx.extraction;
    if (ex) {
      const filled = EXTRACT_FIELDS.filter(([k]) => ex[k] && ex[k].value);
      const untraced = filled.filter(([k]) => !ex[k].evidence && ex[k].method !== 'human');
      add('Extracted values are traceable', untraced.length ? 'fail' : 'pass', untraced.length ? 'No source passage for: ' + untraced.map((x) => x[1]).join(', ') : filled.length + ' values, each with a source passage or human entry');
      const weak = filled.filter(([k]) => /weak heuristic/.test(ex[k].method || ''));
      if (weak.length) add('Extraction confidence', 'warn', 'Weak heuristic used for: ' + weak.map((x) => x[1]).join(', '));
    }
    const overall = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
    return { overall, checks, at: new Date().toISOString() };
  }

  // ---------------------------------------------------------------- gap analysis
  function gapAnalysis(records, extractions, label) {
    const L = label || 'included';
    const by = (fn) => { const m = {}; records.forEach((r) => { const k = fn(r); if (k != null) m[k] = (m[k] || 0) + 1; }); return m; };
    const design = by((r) => (extractions[r.id] && extractions[r.id].studyDesign && extractions[r.id].studyDesign.value) || 'Not determined');
    const year = by((r) => r.year || null);
    const kw = {};
    records.forEach((r) => Array.from(new Set((r.keywords || []).map((k) => k.toLowerCase()))).forEach((k) => { kw[k] = (kw[k] || 0) + 1; }));
    const topKeywords = Object.entries(kw).sort((a, b) => b[1] - a[1]).slice(0, 25);
    const notes = [];
    const n = records.length;
    if (n) {
      const strong = (design['Randomised controlled trial'] || 0) + (design['Systematic review'] || 0) + (design['Meta-analysis'] || 0);
      if (strong === 0) notes.push('No randomised trials or systematic reviews among the ' + L + ' records. The evidence base may rely on weaker designs.');
      const reviewsOnly = (design['Narrative review'] || 0) + (design['Systematic review'] || 0) + (design['Meta-analysis'] || 0);
      if (reviewsOnly / n > 0.5) notes.push('More than half the ' + L + ' records are reviews; primary studies may be scarce.');
      const und = design['Not determined'] || 0;
      if (und / n > 0.3) notes.push(und + ' records have no study design detected; check them manually before drawing conclusions.');
      const years = Object.keys(year).map(Number).sort();
      if (years.length) {
        const recent = records.filter((r) => r.year && r.year >= new Date().getFullYear() - 3).length;
        notes.push(recent + ' of ' + n + ' ' + L + ' records are from the last three years (range ' + years[0] + '–' + years[years.length - 1] + ').');
      }
      const rare = topKeywords.length ? Object.entries(kw).filter(([, c]) => c === 1).length : 0;
      if (rare) notes.push(rare + ' keywords appear in only one record; these may mark under-studied sub-topics worth a targeted search.');
    }
    // contradiction candidates: positive vs negative key findings sharing a keyword
    const contra = [];
    const pol = records.map((r) => {
      const kf = extractions[r.id] && extractions[r.id].keyFinding && extractions[r.id].keyFinding.value || '';
      return { r, kf, p: NEG.test(kf) ? -1 : POS.test(kf) ? 1 : 0, kws: new Set((r.keywords || []).map((k) => k.toLowerCase())) };
    });
    for (let i = 0; i < pol.length && contra.length < 15; i++) for (let j = i + 1; j < pol.length && contra.length < 15; j++) {
      const a = pol[i], b = pol[j];
      if (a.p && b.p && a.p !== b.p) {
        const shared = Array.from(a.kws).filter((k) => b.kws.has(k));
        if (shared.length >= 2) contra.push({ a: a.r.id, b: b.r.id, shared: shared.slice(0, 4), aFinding: a.kf, bFinding: b.kf });
      }
    }
    return { total: n, design, year, topKeywords, notes, contradictions: contra };
  }

  // ---------------------------------------------------------------- exports
  function csvCell(v) { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function toCSV(rows, headers) {
    return '﻿' + [headers.map(csvCell).join(',')].concat(rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))).join('\r\n');
  }
  function evidenceRows(records, decisions, extractions, verifications) {
    return records.map((r) => {
      const d = decisions[r.id] || {}, e = extractions[r.id] || {}, v = verifications[r.id] || {};
      const row = {
        'Record ID': r.id, 'Title': r.title, 'Authors': r.authors.slice(0, 6).join('; ') + (r.authors.length > 6 ? '; et al.' : ''),
        'Year': r.year || '', 'Journal': r.journal, 'DOI': r.doi, 'PMID': r.pmid, 'Registry ID': r.registryId || '', 'URL': recordUrl(r), 'Sources': r.sources.join('; '),
        'Decision': d.status || '', 'Decided by': d.by || '', 'Decision reason': (d.reasons || []).join(' | '),
      };
      EXTRACT_FIELDS.forEach(([k, label]) => {
        row[label] = e[k] && e[k].value ? e[k].value : (e[k] ? NOT_REPORTED : '');
        row[label + ' — source passage'] = e[k] && e[k].evidence || '';
      });
      row['Verification'] = v.overall || 'not run';
      row['Retracted'] = r.retracted === true ? 'yes' : r.retracted === false ? 'no' : 'unknown';
      return row;
    });
  }
  function evidenceHeaders() {
    const h = ['Record ID', 'Title', 'Authors', 'Year', 'Journal', 'DOI', 'PMID', 'Registry ID', 'URL', 'Sources', 'Decision', 'Decided by', 'Decision reason'];
    EXTRACT_FIELDS.forEach(([, label]) => h.push(label, label + ' — source passage'));
    return h.concat(['Verification', 'Retracted']);
  }
  function risType(r) {
    const t = r.pubTypes.join(' ').toLowerCase();
    if (/book-chapter|chapter/.test(t)) return 'CHAP';
    if (/book/.test(t)) return 'BOOK';
    if (/conference|proceedings/.test(t)) return 'CONF';
    if (/preprint|posted-content/.test(t)) return 'UNPB';
    return 'JOUR';
  }
  function toRIS(records) {
    return records.map((r) => {
      const L = ['TY  - ' + risType(r), 'TI  - ' + r.title];
      r.authors.forEach((a) => L.push('AU  - ' + a));
      if (r.year) L.push('PY  - ' + r.year);
      if (r.journal) L.push('JO  - ' + r.journal);
      if (r.volume) L.push('VL  - ' + r.volume);
      if (r.issue) L.push('IS  - ' + r.issue);
      if (r.pages) { const [sp, ep] = String(r.pages).split(/[-–]/); L.push('SP  - ' + sp); if (ep) L.push('EP  - ' + ep); }
      if (r.doi) L.push('DO  - ' + r.doi);
      if (r.pmid) L.push('AN  - PMID:' + r.pmid);
      if (r.registryId) L.push('AN  - ' + r.registryId);
      if (r.abstract) L.push('AB  - ' + r.abstract);
      r.keywords.slice(0, 15).forEach((k) => L.push('KW  - ' + k));
      const u = recordUrl(r); if (u) L.push('UR  - ' + u);
      L.push('ER  - ');
      return L.join('\r\n');
    }).join('\r\n\r\n') + '\r\n';
  }
  function bibKey(r, used) {
    const first = (r.authors[0] || 'anon').split(/[ ,]/)[0].toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '') || 'anon';
    const word = tokens(r.title).find((w) => !['the', 'and', 'for', 'with', 'from', 'study', 'effect', 'effects'].includes(w)) || 'paper';
    let k = first + (r.year || 'nd') + word, i = 0, out = k;
    while (used.has(out)) out = k + String.fromCharCode(97 + (i++));
    used.add(out); return out;
  }
  function bibEsc(s) { return String(s || '').replace(/([{}%&$#_])/g, '\\$1'); }
  function toBibTeX(records) {
    const used = new Set();
    return records.map((r) => {
      const f = [['title', '{' + bibEsc(r.title) + '}'], ['author', r.authors.map((a) => {
        const m = a.match(/^(.+?)\s+([A-Z]{1,3})$/); // PubMed "Smith JA"
        return bibEsc(m ? m[1] + ', ' + m[2].split('').join('. ') + '.' : a);
      }).join(' and ')], ['journal', bibEsc(r.journal)], ['year', r.year || ''], ['volume', r.volume], ['number', r.issue],
      ['pages', String(r.pages || '').replace(/[-–]/, '--')], ['doi', r.doi], ['pmid', r.pmid], ['url', recordUrl(r)]].filter(([, v]) => v);
      return '@article{' + bibKey(r, used) + ',\n' + f.map(([k, v]) => '  ' + k + ' = {' + v + '}').join(',\n') + '\n}';
    }).join('\n\n') + '\n';
  }
  function toJSONL(items) { return items.map((x) => JSON.stringify(x)).join('\n') + (items.length ? '\n' : ''); }

  /** PRISMA-style counts from a project. */
  function flowCounts(project) {
    const ids = Object.keys(project.records || {});
    const dec = project.decisions || {};
    const c = { identified: 0, bySource: {}, duplicatesRemoved: 0, screened: ids.length, included: 0, excluded: 0, review: 0, undecided: 0 };
    (project.searches || []).forEach((s) => { c.identified += s.retrieved; c.bySource[s.source] = (c.bySource[s.source] || 0) + s.retrieved; c.duplicatesRemoved += s.duplicatesRemoved || 0; });
    ids.forEach((id) => { const s = dec[id] && dec[id].status; if (s === 'include') c.included++; else if (s === 'exclude') c.excluded++; else if (s === 'review') c.review++; else c.undecided++; });
    return c;
  }

  function newRecordsSince(records, seenKeys) {
    const seen = new Set(seenKeys || []);
    return records.filter((r) => !seen.has(r.id) && !(r.doi && seen.has('doi:' + r.doi)) && !(r.pmid && seen.has('pmid:' + r.pmid)));
  }


  // ---------------------------------------------------------------- file import
  // Exports from Scopus, Web of Science, Zotero, EndNote, Mendeley, Google Scholar (via a reference manager) and PubMed.
  const RIS_TYPES = { JOUR: 'Journal Article', JFULL: 'Journal Article', EJOUR: 'Journal Article', CONF: 'Conference Paper', CPAPER: 'Conference Paper',
    BOOK: 'Book', CHAP: 'Book Chapter', UNPB: 'Preprint', RPRT: 'Report', THES: 'Thesis', GEN: 'Generic', ELEC: 'Web Page' };
  function splitAuthors(s) {
    s = String(s || '').trim(); if (!s) return [];
    if (s.includes(';')) return s.split(/\s*;\s*/).filter(Boolean);
    if (/ and /i.test(s)) return s.split(/\s+and\s+/i).filter(Boolean);
    return [s];
  }
  function yearOf(s) { const m = String(s || '').match(/\b(1[89]\d\d|20\d\d|21\d\d)\b/); return m ? Number(m[1]) : null; }
  function doiOf(s) { const m = String(s || '').match(/10\.\d{4,9}\/[^\s"<>]+/); return m ? m[0].replace(/[.,;)\]]+$/, '') : ''; }
  function pmidOf(s) { const m = String(s || '').match(/(?:PMID[:\s]*|pubmed\.ncbi\.nlm\.nih\.gov\/|pubmed\/)(\d{4,9})/i); return m ? m[1] : ''; }

  function tagged(text, re) {
    // generic "TAG  - value" parser with continuation lines; returns array of {tag: [values]}
    const recs = []; let cur = null, last = null;
    String(text).replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
      const m = re.exec(line);
      if (m) {
        const tag = m[1].trim(), val = m[2] == null ? '' : m[2].trim();
        if (!cur) cur = {};
        (cur[tag] = cur[tag] || []).push(val); last = [tag, cur[tag].length - 1];
        return;
      }
      if (cur && last && /^\s+\S/.test(line)) { cur[last[0]][last[1]] += ' ' + line.trim(); return; }
      if (!line.trim() && cur && re === MEDLINE_RE && cur.PMID) { recs.push(cur); cur = null; last = null; }
    });
    if (cur) recs.push(cur);
    return recs;
  }
  const MEDLINE_RE = /^([A-Z]{2,4})\s*-\s(.*)$/;

  function parseRIS(text) {
    const out = []; let cur = null, last = null;
    String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
      const m = /^([A-Z][A-Z0-9])  -( (.*))?$/.exec(line);
      if (m) {
        const tag = m[1], val = (m[3] || '').trim();
        if (tag === 'TY') { cur = { TY: [val] }; last = null; return; }
        if (tag === 'ER') { if (cur) out.push(cur); cur = null; last = null; return; }
        if (!cur) return;
        (cur[tag] = cur[tag] || []).push(val); last = [tag, cur[tag].length - 1];
      } else if (cur && last && line.trim()) cur[last[0]][last[1]] += ' ' + line.trim();
    });
    if (cur) out.push(cur);
    return out.map((r) => {
      const g = (...tags) => { for (const t of tags) if (r[t] && r[t][0]) return r[t][0]; return ''; };
      const all = (...tags) => tags.reduce((a, t) => a.concat(r[t] || []), []);
      const sp = g('SP'), ep = g('EP');
      const anyText = all('DO', 'UR', 'L1', 'L2', 'AN', 'M1', 'N1').join(' ');
      return makeRecord({
        title: g('TI', 'T1', 'CT', 'BT'), authors: all('AU', 'A1', 'A2').length ? all('AU', 'A1') : all('A2'),
        year: yearOf(g('PY', 'Y1', 'DA', 'Y2')), journal: g('T2', 'JO', 'JF', 'JA', 'J2', 'SO', 'BT'), volume: g('VL'), issue: g('IS'),
        pages: sp ? sp + (ep && ep !== sp ? '-' + ep : '') : '', doi: doiOf(g('DO')) || doiOf(anyText), pmid: pmidOf(anyText),
        abstract: g('AB', 'N2'), keywords: all('KW'), language: g('LA'), pubTypes: [RIS_TYPES[g('TY')] || g('TY')].filter(Boolean),
        sources: ['Imported'],
      });
    }).filter((r) => r.title);
  }

  function parseMedline(text) {
    return tagged(String(text).replace(/^﻿/, ''), MEDLINE_RE).filter((r) => r.PMID || r.TI).map((r) => {
      const g = (t) => (r[t] && r[t][0]) || '';
      const ids = (r.LID || []).concat(r.AID || []);
      const doiLine = ids.find((x) => /\[doi\]/.test(x));
      const pmc = (r.PMC || [])[0] || '';
      return makeRecord({
        title: g('TI') || g('BTI'), authors: (r.AU || r.FAU || []), year: yearOf(g('DP')), journal: g('JT') || g('TA'), volume: g('VI'), issue: g('IP'),
        pages: g('PG'), doi: doiLine ? doiOf(doiLine) : '', pmid: g('PMID'), pmcid: pmc, abstract: g('AB'),
        pubTypes: r.PT || [], keywords: (r.OT || []).concat((r.MH || []).map((h) => h.split('/')[0].replace(/^\*/, ''))), language: g('LA'),
        retracted: (r.PT || []).some((t) => /retracted publication/i.test(t)) ? true : null, sources: ['Imported'],
      });
    });
  }

  function parseBibTeX(text) {
    const s = String(text).replace(/^﻿/, '');
    const out = []; let i = 0;
    while ((i = s.indexOf('@', i)) !== -1) {
      const m = /^@(\w+)\s*([{(])/.exec(s.slice(i));
      if (!m) { i++; continue; }
      const type = m[1].toLowerCase(); const open = m[2], close = open === '{' ? '}' : ')';
      let j = i + m[0].length, depth = 1;
      const bodyStart = j;
      while (j < s.length && depth) { const c = s[j]; if (c === open) depth++; else if (c === close) depth--; j++; }
      const body = s.slice(bodyStart, j - 1);
      i = j;
      if (['comment', 'string', 'preamble'].includes(type)) continue;
      const fields = {}; let k = body.indexOf(',') + 1;
      if (k <= 0) continue;
      while (k < body.length) {
        const fm = /^\s*([\w-]+)\s*=\s*/.exec(body.slice(k));
        if (!fm) break;
        const name = fm[1].toLowerCase(); k += fm[0].length;
        let val = '';
        if (body[k] === '{') { let d = 1, x = k + 1; while (x < body.length && d) { if (body[x] === '{') d++; else if (body[x] === '}') d--; x++; } val = body.slice(k + 1, x - 1); k = x; }
        else if (body[k] === '"') { let x = k + 1; while (x < body.length && !(body[x] === '"' && body[x - 1] !== '\\')) x++; val = body.slice(k + 1, x); k = x + 1; }
        else { const vm = /^[^,]*/.exec(body.slice(k)); val = vm[0].trim(); k += vm[0].length; }
        fields[name] = val.replace(/[{}]/g, '').replace(/\\([&%$#_])/g, '$1').replace(/\s+/g, ' ').trim();
        const cm = /^\s*,/.exec(body.slice(k)); if (cm) k += cm[0].length;
      }
      const pubType = { article: 'Journal Article', inproceedings: 'Conference Paper', conference: 'Conference Paper', book: 'Book', incollection: 'Book Chapter', inbook: 'Book Chapter', phdthesis: 'Thesis', mastersthesis: 'Thesis', techreport: 'Report', unpublished: 'Preprint', misc: 'Generic' }[type] || type;
      out.push(makeRecord({
        title: fields.title, authors: splitAuthors(fields.author).map((a) => a.trim()),
        year: yearOf(fields.year || fields.date), journal: fields.journal || fields.journaltitle || fields.booktitle || fields.publisher || '',
        volume: fields.volume, issue: fields.number || fields.issue, pages: (fields.pages || '').replace(/--/, '-'),
        doi: doiOf(fields.doi || fields.url || ''), pmid: fields.pmid || pmidOf(fields.url || fields.note || ''), abstract: fields.abstract,
        keywords: (fields.keywords || fields.mesh || '').split(/[;,]\s*/).filter(Boolean), language: fields.language || '', pubTypes: [pubType], sources: ['Imported'],
      }));
    }
    return out.filter((r) => r.title);
  }

  function parseDelimited(text) {
    const t = String(text).replace(/^﻿/, '');
    const firstLine = t.slice(0, t.indexOf('\n') > 0 ? t.indexOf('\n') : t.length);
    const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"' && cell === '') { q = true; continue; }
      if (c === delim) { row.push(cell); cell = ''; continue; }
      if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; continue; }
      cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const nonEmpty = rows.filter((r) => r.some((x) => x.trim()));
    if (nonEmpty.length < 2) return [];
    const head = nonEmpty[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => { for (const n of names) { const k = head.indexOf(n); if (k >= 0) return k; } return -1; };
    const C_ = {
      title: col('title', 'article title', 'document title', 'ti', 'item title'), authors: col('authors', 'author', 'author full names', 'au', 'af', 'creators'),
      year: col('year', 'publication year', 'py', 'pubyear', 'publication date', 'date'), journal: col('source title', 'journal', 'journal/book', 'publication title', 'so', 'source', 'publication'),
      doi: col('doi', 'di'), abstract: col('abstract', 'ab'), kw: col('author keywords', 'keywords', 'de', 'manual tags'), ikw: col('index keywords', 'id', 'mesh terms', 'automatic tags'),
      pmid: col('pubmed id', 'pmid', 'pm'), type: col('document type', 'dt', 'type', 'item type', 'publication type'), vol: col('volume', 'vl'), iss: col('issue', 'is'),
      ps: col('page start', 'bp'), pe: col('page end', 'ep'), pages: col('pages', 'page'), lang: col('language of original document', 'language', 'la'), url: col('link', 'url'),
    };
    if (C_.title < 0) throw new Error('No title column found. Expected a column named "Title", "Article Title" or "TI".');
    const get = (r, k) => (k >= 0 && r[k] != null ? String(r[k]).trim() : '');
    return nonEmpty.slice(1).map((r) => {
      const ps = get(r, C_.ps), pe = get(r, C_.pe);
      return makeRecord({
        title: get(r, C_.title), authors: splitAuthors(get(r, C_.authors)), year: yearOf(get(r, C_.year)), journal: get(r, C_.journal),
        volume: get(r, C_.vol), issue: get(r, C_.iss), pages: get(r, C_.pages) || (ps ? ps + (pe ? '-' + pe : '') : ''),
        doi: doiOf(get(r, C_.doi)) || doiOf(get(r, C_.url)), pmid: get(r, C_.pmid).replace(/\D/g, '') || pmidOf(get(r, C_.url)),
        abstract: /^\[no abstract available\]$/i.test(get(r, C_.abstract)) ? '' : get(r, C_.abstract),
        keywords: get(r, C_.kw).split(/\s*;\s*/).concat(get(r, C_.ikw).split(/\s*;\s*/)).filter(Boolean),
        pubTypes: get(r, C_.type) ? [get(r, C_.type)] : [], language: get(r, C_.lang), sources: ['Imported'],
      });
    }).filter((r) => r.title);
  }

  function detectFormat(text, filename) {
    const name = String(filename || '').toLowerCase();
    const head = String(text).replace(/^﻿/, '').slice(0, 4000);
    if (/\.(nbib|medline)$/.test(name) || /^PMID-\s*\d+/m.test(head)) return 'medline';
    if (/\.ris$/.test(name) || /^TY  - /m.test(head)) return 'ris';
    if (/\.bib(tex)?$/.test(name) || /^\s*@\w+\s*[{(]/m.test(head)) return 'bibtex';
    if (/\.(csv|tsv|txt)$/.test(name) || /(^|[,\t])"?(title|article title|ti)"?([,\t]|$)/im.test(head.split('\n')[0])) return 'csv';
    return null;
  }
  function importText(text, filename) {
    const format = detectFormat(text, filename);
    if (!format) throw new Error('Unrecognised file. Use RIS (.ris), BibTeX (.bib), PubMed MEDLINE (.nbib or .txt) or CSV with a Title column.');
    const records = format === 'ris' ? parseRIS(text) : format === 'medline' ? parseMedline(text) : format === 'bibtex' ? parseBibTeX(text) : parseDelimited(text);
    const label = 'Imported: ' + (filename || format.toUpperCase());
    records.forEach((r) => { r.sources = [label]; });
    return { format, records };
  }

  const api = {
    VERSION, normDoi, normTitle, titleSimilarity, sentences, termRegex, findTerm, parseTerms, stripTags,
    makeRecord, recordKey, recordUrl, searchPubMed, searchEuropePMC, searchOpenAlex, parsePubMedXml,
    fromEuropePMC, fromOpenAlex, invertedToText, ADAPTERS, searchCrossref, searchSemanticScholar, searchClinicalTrials, searchDOAJ,
    fromCrossref, fromSemanticScholar, fromClinicalTrial, fromDOAJ, stripFieldTags, toPlainQuery, toS2Query, toDoajQuery, dedupe, DEFAULT_CRITERIA, screen, extract, EXTRACT_FIELDS,
    NOT_REPORTED, fetchCrossref, verify, gapAnalysis, toCSV, evidenceRows, evidenceHeaders, toRIS, toBibTeX, toJSONL,
    flowCounts, newRecordsSince, parseRIS, parseMedline, parseBibTeX, parseDelimited, detectFormat, importText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LitCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
