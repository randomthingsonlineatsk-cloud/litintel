/*!
 * LitIntel app — interface and project state.
 * Copyright 2026 Khan Gulrez Shagufa Fazal Ahmed. Licensed under the Apache License 2.0.
 */
(function () {
  'use strict';
  const C = window.LitCore;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  // ------------------------------------------------------------ storage
  const KEY = 'litintel:v1';
  const store = { index: [], currentId: null, settings: { ncbiKey: '', email: '', openalexKey: '' }, view: 'search' };
  let P = null; // current project
  let storageOk = true;

  // Projects live in IndexedDB (hundreds of MB available); the small index and settings stay in localStorage.
  // If IndexedDB is unavailable, everything falls back to localStorage.
  const IDB = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
      const rq = indexedDB.open('litintel', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('projects', { keyPath: 'id' });
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
      rq.onblocked = () => rej(new Error('IndexedDB blocked'));
    }));
    const tx = (mode, fn) => open().then((db) => new Promise((res, rej) => {
      const t = db.transaction('projects', mode); const st = t.objectStore('projects');
      const r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    }));
    return {
      get: (id) => tx('readonly', (st) => st.get(id)),
      put: (p) => tx('readwrite', (st) => st.put(p)),
      del: (id) => tx('readwrite', (st) => st.delete(id)),
    };
  })();
  let useIdb = true;
  async function getProject(id) {
    if (useIdb) { try { const p = await IDB.get(id); if (p) return p; } catch (e) { useIdb = false; } }
    try { return JSON.parse(localStorage.getItem(KEY + ':p:' + id) || 'null'); } catch (e) { return null; }
  }
  let saveChain = Promise.resolve();
  function putProject(p) {
    const copy = JSON.parse(JSON.stringify(p));
    saveChain = saveChain.then(async () => {
      if (useIdb) {
        try { await IDB.put(copy); try { localStorage.removeItem(KEY + ':p:' + copy.id); } catch (e) { /* ignore */ } storageOk = true; return; }
        catch (e) { useIdb = false; }
      }
      localStorage.setItem(KEY + ':p:' + copy.id, JSON.stringify(copy)); storageOk = true;
    }).catch(() => { storageOk = false; toast('Could not save in this browser (storage full or blocked). Export the project file to keep your work.'); });
    return saveChain;
  }
  async function deleteProject(id) {
    try { await IDB.del(id); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(KEY + ':p:' + id); } catch (e) { /* ignore */ }
  }

  async function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(store, JSON.parse(raw)); } catch (e) { storageOk = false; }
    if (store.currentId) P = await getProject(store.currentId);
    for (let i = 0; !P && i < store.index.length; i++) P = await getProject(store.index[i].id);
    if (!P) P = newProject('My first review');
    store.currentId = P.id;
    // ask the browser not to clear this site's data under storage pressure
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
  }
  function save() {
    P.updated = new Date().toISOString();
    const entry = store.index.find((x) => x.id === P.id);
    if (entry) entry.name = P.name; else store.index.push({ id: P.id, name: P.name });
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { storageOk = false; }
    return putProject(P);
  }
  function newProject(name) {
    const p = {
      id: uid(), name, question: '', created: new Date().toISOString(), updated: null, tool: 'LitIntel ' + C.VERSION,
      criteria: { includeText: '', excludeText: '', yearFrom: '', yearTo: '', excludeTypes: C.DEFAULT_CRITERIA.excludeTypes.slice(), requireAbstract: true, excludeRetracted: true },
      lastQuery: '', lastSources: ['pubmed', 'europepmc'], lastMax: 100,
      searches: [], records: {}, order: [], decisions: {}, ruleDecisions: {}, extractions: {}, verifications: {}, crossref: {},
      corrections: [], activity: [], watch: { lastRun: null, runs: [] }, newIds: [],
    };
    store.index.push({ id: p.id, name: p.name });
    return p;
  }
  async function switchProject(id) {
    await save();
    const p = await getProject(id);
    if (!p) { toast('That project could not be loaded from this browser.'); return; }
    P = p; store.currentId = id; save(); render();
  }
  function log(kind, detail) { P.activity.unshift({ at: new Date().toISOString(), kind, detail }); if (P.activity.length > 500) P.activity.length = 500; }

  // ------------------------------------------------------------ criteria
  function criteria() {
    const c = P.criteria;
    return {
      includeGroups: String(c.includeText || '').split('\n').map(C.parseTerms).filter((g) => g.length),
      excludeTerms: C.parseTerms(c.excludeText),
      yearFrom: Number(c.yearFrom) || null, yearTo: Number(c.yearTo) || null,
      excludeTypes: c.excludeTypes || [], requireAbstract: !!c.requireAbstract, excludeRetracted: !!c.excludeRetracted,
    };
  }
  function allTerms() { const c = criteria(); return c.includeGroups.flat().concat(c.excludeTerms); }
  function highlight(text) {
    let html = esc(text);
    allTerms().forEach((t) => {
      const re = C.termRegex(t); if (!re) return;
      html = html.replace(new RegExp(re.source, 'gi'), (m, pre, word) => pre + '<mark>' + word + '</mark>');
    });
    return html;
  }

  // ------------------------------------------------------------ record merging
  function recordsList() { return P.order.map((id) => P.records[id]).filter(Boolean); }
  function mergeRecords(incoming) {
    const before = recordsList();
    const res = C.dedupe(before.concat(incoming));
    // keep decisions etc. attached when a record's key changes after merging (e.g. it gains a DOI)
    const keyed = new Map();
    res.records.forEach((r) => {
      if (r.doi) keyed.set('doi:' + r.doi, r.id);
      if (r.pmid) keyed.set('pmid:' + r.pmid, r.id);
      keyed.set('t:' + C.normTitle(r.title).slice(0, 150), r.id);
    });
    const remap = {};
    before.forEach((r) => {
      const nid = (r.doi && keyed.get('doi:' + r.doi)) || (r.pmid && keyed.get('pmid:' + r.pmid)) || keyed.get('t:' + C.normTitle(r.title).slice(0, 150));
      if (nid && nid !== r.id) remap[r.id] = nid;
    });
    ['decisions', 'ruleDecisions', 'extractions', 'verifications'].forEach((k) => {
      Object.keys(remap).forEach((old) => { if (P[k][old] && !P[k][remap[old]]) P[k][remap[old]] = P[k][old]; delete P[k][old]; });
    });
    P.newIds = P.newIds.map((id) => remap[id] || id);
    const oldIds = new Set(before.map((r) => remap[r.id] || r.id));
    P.records = {}; P.order = [];
    res.records.forEach((r) => { P.records[r.id] = r; P.order.push(r.id); });
    const added = res.records.filter((r) => !oldIds.has(r.id));
    return { added, duplicatesRemoved: before.length + incoming.length - res.records.length, merges: res.merges };
  }
  function autoScreen(ids) {
    const crit = criteria();
    let n = 0;
    ids.forEach((id) => {
      const r = P.records[id]; if (!r) return;
      const d = C.screen(r, crit); d.at = new Date().toISOString();
      P.ruleDecisions[id] = d;
      if (!P.decisions[id] || P.decisions[id].by !== 'human') { P.decisions[id] = d; n++; }
    });
    return n;
  }

  // ------------------------------------------------------------ searching
  const SOURCES = [
    ['pubmed', 'PubMed', 'NCBI E-utilities. No key needed; a free NCBI key raises the rate limit.'],
    ['europepmc', 'Europe PMC', 'Includes PubMed plus preprints and other sources. No key needed.'],
    ['crossref', 'Crossref', 'Metadata for nearly every DOI, all subjects. No key needed. Matches words by relevance; AND/OR/NOT are ignored.'],
    ['semanticscholar', 'Semantic Scholar', 'AI-indexed papers across all sciences. No key needed; a free key avoids slowdowns at busy times.'],
    ['doaj', 'DOAJ', 'Directory of Open Access Journals: open-access articles only. No key needed.'],
    ['clinicaltrials', 'ClinicalTrials.gov', 'Trial registrations, including unpublished and ongoing trials. No key needed.'],
    ['openalex', 'OpenAlex', 'Broad coverage across disciplines. Needs a free API key from openalex.org/settings/api.'],
  ];
  function adapterOpts(src, base) {
    const s = store.settings;
    const o = Object.assign({}, base);
    if (src === 'pubmed') { o.apiKey = s.ncbiKey; o.email = s.email; }
    if (src === 'openalex') o.apiKey = s.openalexKey;
    if (src === 'crossref') o.email = s.email;
    if (src === 'semanticscholar') o.apiKey = s.s2Key;
    return o;
  }
  function friendlyError(src, e) {
    const m = String(e && e.message || e);
    if (/Failed to fetch|NetworkError|Load failed|blocked|CSP|TypeError/i.test(m)) {
      return 'Could not reach ' + src + '. If you are viewing the hosted preview, live searching is switched off there; open your own deployed copy (see README) or try the example project.';
    }
    if (/HTTP 4(01|03|29)/.test(m) && src === 'OpenAlex') return 'OpenAlex refused the request (' + m.match(/HTTP \d+/)[0] + '). Add a free OpenAlex API key in Settings.';
    if (/HTTP 429/.test(m)) return src + ' is rate-limiting requests. Wait a minute or add an API key in Settings.';
    return src + ': ' + m;
  }
  async function runSearch(sources, query, opts, statusEl) {
    const lines = [];
    const say = (s) => { lines.push(s); if (statusEl) statusEl.textContent = lines.join('\n'); };
    let addedTotal = 0;
    for (const src of sources) {
      const name = SOURCES.find((x) => x[0] === src)[1];
      say(name + ': searching…');
      try {
        const res = await C.ADAPTERS[src](adapterOpts(src, Object.assign({ query }, opts)));
        const m = mergeRecords(res.records);
        const screened = autoScreen(m.added.map((r) => r.id));
        if (opts.since) P.newIds = Array.from(new Set(P.newIds.concat(m.added.map((r) => r.id))));
        P.searches.push({ id: uid(), at: new Date().toISOString(), kind: opts.since ? 'watch' : 'search', source: name, sourceKey: src, query,
          filters: { yearFrom: opts.yearFrom || null, yearTo: opts.yearTo || null, since: opts.since || null, max: opts.max },
          total: res.total, retrieved: res.retrieved, added: m.added.length, duplicatesRemoved: res.retrieved - m.added.length, url: res.url });
        log(opts.since ? 'watch' : 'search', name + ': ' + res.total.toLocaleString() + ' hits, ' + res.retrieved + ' retrieved, ' + m.added.length + ' new after de-duplication');
        lines[lines.length - 1] = name + ': ' + res.total.toLocaleString() + ' hits · ' + res.retrieved + ' retrieved · ' + m.added.length + ' new · ' + screened + ' screened by rules';
        addedTotal += m.added.length;
        save(); renderFlow();
      } catch (e) {
        const msg = friendlyError(name, e);
        lines[lines.length - 1] = msg;
        P.searches.push({ id: uid(), at: new Date().toISOString(), kind: opts.since ? 'watch' : 'search', source: name, sourceKey: src, query, filters: opts, total: 0, retrieved: 0, added: 0, error: msg });
        log('error', msg); save();
      }
      if (statusEl) statusEl.textContent = lines.join('\n');
    }
    return addedTotal;
  }

  // ------------------------------------------------------------ views
  const VIEWS = [
    ['search', 'Search'], ['screen', 'Screen'], ['extract', 'Extract'], ['verify', 'Verify'],
    ['gaps', 'Gaps'], ['watch', 'Watch'], ['export', 'Export & log'],
  ];
  function render() {
    $('#ver').textContent = 'v' + C.VERSION;
    const sel = $('#projSel');
    sel.innerHTML = store.index.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === P.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
    const counts = C.flowCounts(P);
    const nums = { search: P.order.length, screen: counts.review + counts.undecided, extract: counts.included, verify: Object.values(P.verifications).filter((v) => v.overall === 'fail').length || '', watch: P.newIds.length || '' };
    $('#stages').innerHTML = VIEWS.map(([k, label]) => '<li><button type="button" data-view="' + k + '"' + (store.view === k ? ' aria-current="page"' : '') + '>' + label +
      (nums[k] ? '<span class="n" title="' + (k === 'screen' ? 'Need a decision' : k === 'verify' ? 'Failed checks' : k === 'watch' ? 'New records' : 'Records') + '">' + nums[k] + '</span>' : '') + '</button></li>').join('');
    renderFlow();
    const pane = $('#pane');
    ({ search: viewSearch, screen: viewScreen, extract: viewExtract, verify: viewVerify, gaps: viewGaps, watch: viewWatch, export: viewExport }[store.view] || viewSearch)(pane);
  }
  function renderFlow() {
    const c = C.flowCounts(P);
    $('#flow').innerHTML = [
      ['Identified', c.identified], ['Duplicates removed', c.duplicatesRemoved], ['Screened', c.screened],
      ['Included', c.included, 'inc'], ['Needs review', c.review + c.undecided, 'rev'], ['Excluded', c.excluded, 'exc'],
    ].map(([l, n, cls]) => '<div class="' + (cls || '') + '"><b>' + n.toLocaleString() + '</b><span>' + l + '</span></div>').join('');
  }
  function go(view) { store.view = view; save(); render(); window.scrollTo(0, 0); }

  // ---- Search
  function viewSearch(el) {
    const s = store.settings;
    const hasRecords = P.order.length > 0;
    el.innerHTML = `
      <div class="head"><h2>Search the literature</h2>
        <p>Write your question, run one search string across the databases, and LitIntel merges duplicates and screens every new record against your criteria. Each run is logged with its exact query and date so the search can be reported and repeated.</p></div>
      ${!hasRecords ? `<div class="note">New here? <button class="btn sm" type="button" id="loadSample">Load the example project</button> to see a finished review using eight fictional records, or start your own search below.</div>` : ''}
      <section class="panel">
        <label class="field"><span>Review question</span>
          <textarea id="question" rows="2" placeholder="e.g. In adults with type 2 diabetes, does telemonitoring improve HbA1c compared with usual care?">${esc(P.question)}</textarea></label>
        <label class="field"><span>Search string</span>
          <textarea id="query" class="q" rows="3" placeholder='(telemonitoring OR telehealth) AND "type 2 diabetes" AND (HbA1c OR glycaemic)'>${esc(P.lastQuery)}</textarea>
          <small>Use AND, OR, NOT, brackets and "quoted phrases". The same string is sent to each database; PubMed also accepts field tags such as [tiab] and [mh].</small></label>
        <div class="grid2">
          <div class="field"><span>Databases</span><div class="checks">${SOURCES.map(([k, l, d]) => `<label title="${esc(d)}"><input type="checkbox" name="src" value="${k}" ${P.lastSources.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
            <small>All free. Hover a name for what it covers. ClinicalTrials.gov adds trial registrations, not papers.${!s.openalexKey ? ' OpenAlex needs a free key (Settings below).' : ''}</small></div>
          <div class="grid2" style="grid-template-columns:repeat(3,minmax(0,1fr))">
            <label class="field"><span>Max per database</span><input id="max" type="number" min="10" max="2000" step="10" value="${P.lastMax || 100}"></label>
            <label class="field"><span>Year from</span><input id="yf" type="number" min="1800" max="2100" value="${esc(P.criteria.yearFrom)}"></label>
            <label class="field"><span>Year to</span><input id="yt" type="number" min="1800" max="2100" value="${esc(P.criteria.yearTo)}"></label>
          </div>
        </div>
        <div class="bar"><button class="btn primary" type="button" id="run">Run search</button>
          <span class="muted">Records are added to this project; running again only adds what is new.</span></div>
        <div class="status" id="status" aria-live="polite"></div>
      </section>
      <section class="panel" id="dropZone">
        <h3>Import an export file</h3>
        <p style="margin:0" class="muted">Bring in records from Scopus, Web of Science, Embase, Google Scholar (through Zotero or Mendeley), EndNote or a PubMed download. They are de-duplicated against everything already in the project and screened by your rules.</p>
        <div class="bar"><label class="btn" for="impFile">Choose files</label><input id="impFile" type="file" multiple accept=".ris,.nbib,.txt,.bib,.bibtex,.csv,.tsv" hidden>
          <span class="muted">or drop them here · RIS, BibTeX, PubMed MEDLINE (.nbib), CSV or tab-delimited</span></div>
        <div class="status" id="impStatus" aria-live="polite"></div>
      </section>
      <details class="panel"><summary class="lbl" style="cursor:pointer">Settings and API keys</summary>
        <div class="grid2">
          <label class="field"><span>Your email (sent to NCBI as contact)</span><input id="email" type="email" value="${esc(s.email)}"></label>
          <label class="field"><span>NCBI API key (optional)</span><input id="ncbi" type="password" autocomplete="off" value="${esc(s.ncbiKey)}"></label>
          <label class="field"><span>OpenAlex API key</span><input id="oakey" type="password" autocomplete="off" value="${esc(s.openalexKey)}"></label>
          <label class="field"><span>Semantic Scholar API key (optional)</span><input id="s2key" type="password" autocomplete="off" value="${esc(s.s2Key || '')}"></label>
        </div>
        <div class="bar"><button class="btn" type="button" id="testConn">Test connections</button><span class="muted">Checks each database from this browser with a one-record search.</span></div>
        <div class="status" id="connStatus" aria-live="polite"></div>
        <small class="muted">Keys stay in this browser's storage and are sent only to the database they belong to. Search URLs in the log hide them.</small>
        <small class="muted" id="storageInfo"></small>
      </details>
      ${P.searches.length ? `<section class="panel"><h3>Search history</h3>${searchTable(P.searches.slice().reverse().slice(0, 12))}</section>` : ''}`;
    const sv = () => {
      P.question = $('#question').value; P.lastQuery = $('#query').value;
      P.criteria.yearFrom = $('#yf').value; P.criteria.yearTo = $('#yt').value; P.lastMax = Number($('#max').value) || 100;
      P.lastSources = Array.from(el.querySelectorAll('input[name=src]:checked')).map((x) => x.value);
      s.email = $('#email').value.trim(); s.ncbiKey = $('#ncbi').value.trim(); s.openalexKey = $('#oakey').value.trim(); s.s2Key = $('#s2key').value.trim();
      save();
    };
    el.querySelectorAll('input,textarea').forEach((i) => i.addEventListener('change', sv));
    const ls = $('#loadSample'); if (ls) ls.onclick = loadSample;
    const imp = $('#impFile'); imp.onchange = () => { importFiles(Array.from(imp.files)); imp.value = ''; };
    const dz = $('#dropZone');
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; });
    dz.addEventListener('dragleave', () => { dz.style.borderColor = ''; });
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.style.borderColor = ''; importFiles(Array.from(e.dataTransfer.files || [])); });
    showStorage();
    $('#testConn').onclick = async (ev) => {
      sv(); ev.target.disabled = true;
      const out = $('#connStatus');
      const lines = SOURCES.map(([, l]) => l + ': checking…'); out.textContent = lines.join('\n');
      await Promise.all(SOURCES.map(async ([k, l], i) => {
        if (k === 'openalex' && !store.settings.openalexKey) { lines[i] = l + ': skipped (add your free key first)'; out.textContent = lines.join('\n'); return; }
        const t0 = performance.now();
        try {
          const res = await C.ADAPTERS[k](adapterOpts(k, { query: 'aspirin', max: 1 }));
          lines[i] = '✓ ' + l + ': working (' + res.total.toLocaleString() + ' hits for "aspirin", ' + Math.round(performance.now() - t0) + ' ms)';
        } catch (e) { lines[i] = '✗ ' + l + ': ' + friendlyError(l, e); }
        out.textContent = lines.join('\n');
      }));
      ev.target.disabled = false;
    };
    $('#run').onclick = async (ev) => {
      sv();
      const q = P.lastQuery.trim();
      if (!q) { $('#status').textContent = 'Enter a search string first.'; return; }
      if (!P.lastSources.length) { $('#status').textContent = 'Tick at least one database.'; return; }
      ev.target.disabled = true;
      const n = await runSearch(P.lastSources, q, { max: P.lastMax, yearFrom: Number(P.criteria.yearFrom) || null, yearTo: Number(P.criteria.yearTo) || null }, $('#status'));
      ev.target.disabled = false;
      const report = $('#status').textContent;
      render();
      $('#status').textContent = report + (n ? '\n\nDone. ' + n + ' new records were added and screened by your rules. Go to Screen to check them.' : '\n\nNo new records were added.');
    };
  }
  async function importFiles(files, statusId) {
    statusId = statusId || 'impStatus';
    const st = document.getElementById(statusId); const lines = [];
    for (const f of files) {
      try {
        const text = await f.text();
        const { format, records } = C.importText(text, f.name);
        if (!records.length) throw new Error('no records with a title were found');
        const m = mergeRecords(records);
        const screened = autoScreen(m.added.map((r) => r.id));
        P.searches.push({ id: uid(), at: new Date().toISOString(), kind: 'import', source: 'File: ' + f.name, sourceKey: 'file', query: format.toUpperCase() + ' file',
          filters: {}, total: records.length, retrieved: records.length, added: m.added.length, duplicatesRemoved: records.length - m.added.length, url: '' });
        log('import', f.name + ': ' + records.length + ' records, ' + m.added.length + ' new after de-duplication');
        lines.push(f.name + ': ' + records.length + ' records read as ' + format.toUpperCase() + ' · ' + m.added.length + ' new · ' + screened + ' screened by rules');
      } catch (e) { lines.push(f.name + ': could not import (' + e.message + ')'); }
      if (st) st.textContent = lines.join('\n');
    }
    await save(); render();
    const st2 = document.getElementById(statusId); if (st2) st2.textContent = lines.join('\n');
  }
  async function showStorage() {
    const el = $('#storageInfo'); if (!el) return;
    try {
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
      const mb = (b) => (b / 1048576).toFixed(b < 1048576 * 10 ? 1 : 0) + ' MB';
      el.textContent = 'Projects are stored in this browser' + (useIdb ? ' (IndexedDB)' : ' (local storage, about 5 MB)') + (est ? ': ' + mb(est.usage || 0) + ' used of about ' + mb(est.quota || 0) + ' available' : '') + '. ' +
        (persisted ? 'The browser has agreed to keep this data.' : 'Export your projects regularly; the browser may clear site data when space runs low.');
    } catch (e) { /* ignore */ }
  }
  function searchTable(rows) {
    return `<div class="tablewrap"><table><thead><tr><th>When</th><th>Type</th><th>Database</th><th>Query and filters</th><th>Hits</th><th>Retrieved</th><th>New</th></tr></thead><tbody>${
      rows.map((s) => `<tr><td>${esc(fmtDate(s.at))}</td><td>${esc(s.kind)}</td><td>${esc(s.source)}</td><td><code>${esc(s.query)}</code>${s.filters && (s.filters.yearFrom || s.filters.yearTo) ? '<br><span class="muted">Years ' + esc(s.filters.yearFrom || '…') + '–' + esc(s.filters.yearTo || '…') + '</span>' : ''}${s.filters && s.filters.since ? '<br><span class="muted">Added since ' + esc(s.filters.since) + '</span>' : ''}${s.error ? '<br><span style="color:var(--exc)">' + esc(s.error) + '</span>' : ''}</td><td class="num">${(s.total || 0).toLocaleString()}</td><td class="num">${s.retrieved}</td><td class="num">${s.added}</td></tr>`).join('')
    }</tbody></table></div>`;
  }
  function loadSample() {
    const S = window.LitSample;
    P = newProject(S.name);
    P.question = S.question; P.lastQuery = S.query;
    P.criteria.includeText = S.includeText; P.criteria.excludeText = S.excludeText; P.criteria.yearFrom = '2020';
    const recs = S.records.map((r) => C.makeRecord(r));
    const m = mergeRecords(recs);
    P.searches.push({ id: uid(), at: new Date().toISOString(), kind: 'search', source: 'Example data', sourceKey: 'sample', query: S.query, filters: { yearFrom: 2020 }, total: recs.length, retrieved: recs.length, added: m.added.length, duplicatesRemoved: 0, url: '' });
    autoScreen(P.order);
    log('search', 'Loaded the example project (fictional records)');
    store.currentId = P.id; store.view = 'screen'; save(); render();
    toast('Example project loaded. All records in it are fictional.');
  }

  // ---- Screen
  let screenTab = 'review';
  let screenLimit = 300;
  function viewScreen(el) {
    const c = P.criteria;
    const list = recordsList();
    const groups = { all: list, include: [], review: [], exclude: [] };
    list.forEach((r) => { const d = P.decisions[r.id]; groups[d ? d.status : 'review'].push(r); });
    const shown = groups[screenTab] || list;
    el.innerHTML = `
      <div class="head"><h2>Screen titles and abstracts</h2>
        <p>Rules make a first pass and write down why. You confirm or overrule each one; every override is saved with your reason, so you can later see where the rules went wrong.</p></div>
      <details class="panel" ${!c.includeText ? 'open' : ''}><summary class="lbl" style="cursor:pointer">Eligibility criteria</summary>
        <div class="grid2">
          <label class="field"><span>Include: one criterion per line</span><textarea id="incl" class="q" rows="4" placeholder="telemonitoring, telehealth, remote monitoring&#10;type 2 diabetes, T2DM">${esc(c.includeText)}</textarea>
            <small>A record must match every line. Synonyms on a line are separated by commas; * matches word endings.</small></label>
          <label class="field"><span>Exclude if any of these appear</span><textarea id="excl" class="q" rows="4" placeholder="paediatric, children, protocol">${esc(c.excludeText)}</textarea>
            <small>Matched in the title and abstract.</small></label>
        </div>
        <div class="field"><span>Exclude publication types</span><div class="checks">${['editorial', 'comment', 'letter', 'erratum', 'retracted publication', 'case report', 'review', 'preprint', 'conference'].map((t) => `<label><input type="checkbox" name="xt" value="${t}" ${c.excludeTypes.includes(t) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
        <div class="checks"><label><input type="checkbox" id="reqAbs" ${c.requireAbstract ? 'checked' : ''}> Send records without an abstract to review</label>
          <label><input type="checkbox" id="exRet" ${c.excludeRetracted ? 'checked' : ''}> Exclude retracted records</label></div>
        <div class="bar"><button class="btn primary" type="button" id="rescreen">Re-apply rules</button><span class="muted">Your own decisions are kept.</span></div>
      </details>
      <div class="tabs" role="tablist">${[['review', 'Needs review'], ['include', 'Included'], ['exclude', 'Excluded'], ['all', 'All']].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${screenTab === k}">${l} <span class="muted">${groups[k].length}</span></button>`).join('')}</div>
      <div class="recs" id="recs">${shown.length ? shown.slice(0, screenLimit).map(recCard).join('') : '<p class="muted">Nothing here. ' + (list.length ? 'Pick another tab.' : 'Run a search first.') + '</p>'}${shown.length > screenLimit ? '<div class="bar"><button class="btn" type="button" id="more">Show ' + Math.min(300, shown.length - screenLimit) + ' more</button><span class="muted">Showing ' + screenLimit + ' of ' + shown.length.toLocaleString() + '</span></div>' : ''}</div>`;
    const saveCrit = () => {
      c.includeText = $('#incl').value; c.excludeText = $('#excl').value; c.requireAbstract = $('#reqAbs').checked; c.excludeRetracted = $('#exRet').checked;
      c.excludeTypes = Array.from(el.querySelectorAll('input[name=xt]:checked')).map((x) => x.value); save();
    };
    el.querySelectorAll('#incl,#excl,#reqAbs,#exRet,input[name=xt]').forEach((i) => i.addEventListener('change', saveCrit));
    $('#rescreen').onclick = () => { saveCrit(); const n = autoScreen(P.order); log('screen', 'Rules re-applied to ' + n + ' records'); save(); render(); toast('Rules re-applied to ' + n + ' records.'); };
    el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { screenTab = b.dataset.tab; screenLimit = 300; render(); });
    if ($('#more')) $('#more').onclick = () => { const y = window.scrollY; screenLimit += 300; render(); window.scrollTo(0, y); };
    $('#recs').onclick = (ev) => {
      const b = ev.target.closest('[data-decide]'); if (!b) return;
      const card = b.closest('.rec'); const id = card.dataset.id; const note = card.querySelector('.why').value.trim();
      decide(id, b.dataset.decide, note);
    };
  }
  function decide(id, status, note) {
    const rule = P.ruleDecisions[id];
    const prev = P.decisions[id];
    P.decisions[id] = { status, reasons: [note || (rule && rule.status === status ? 'Confirmed rule decision: ' + (rule.reasons[0] || '') : 'Set by reviewer')], by: 'human', at: new Date().toISOString() };
    if (rule && rule.status !== status) {
      P.corrections.push({ at: new Date().toISOString(), stage: 'screening', recordId: id, title: P.records[id].title, input: { title: P.records[id].title, abstract: P.records[id].abstract, criteria: criteria() },
        agentOutput: { status: rule.status, reasons: rule.reasons }, correctedOutput: { status }, errorCategory: rule.status === 'include' ? 'false include' : rule.status === 'exclude' ? 'false exclude' : 'resolved review', note });
    }
    log('screen', (prev ? prev.status : 'none') + ' → ' + status + ': ' + P.records[id].title.slice(0, 80));
    save(); render();
  }
  function recCard(r) {
    const d = P.decisions[r.id] || {};
    const isNew = P.newIds.includes(r.id);
    return `<article class="rec ${esc(d.status || '')}" data-id="${esc(r.id)}">
      <div class="meta"><span class="pill ${esc(d.status || '')}">${esc(d.status || 'undecided')}</span>${d.by ? '<span>by ' + esc(d.by) + '</span>' : ''}${isNew ? '<span class="pill new">new</span>' : ''}${r.retracted ? '<span class="pill exclude">retracted</span>' : ''}</div>
      <h3>${highlight(r.title)}</h3>
      <div class="meta"><span>${esc(r.authors.slice(0, 3).join(', '))}${r.authors.length > 3 ? ' et al.' : ''}</span><span>${esc(r.journal)}</span><span>${esc(r.year || 'n.d.')}</span>
        ${r.doi ? '<a class="mono" target="_blank" rel="noopener" href="https://doi.org/' + esc(r.doi) + '">doi:' + esc(r.doi) + '</a>' : ''}${r.pmid ? '<a class="mono" target="_blank" rel="noopener" href="https://pubmed.ncbi.nlm.nih.gov/' + esc(r.pmid) + '/">PMID ' + esc(r.pmid) + '</a>' : ''}
        <span class="muted">${esc(r.sources.join(' · '))}${r.pubTypes.length ? ' · ' + esc(r.pubTypes.slice(0, 3).join(', ')) : ''}</span></div>
      ${d.reasons ? '<ul class="reasons">' + d.reasons.map((x) => '<li>' + (/not found|None of the inclusion/.test(x) ? esc(x) : highlight(x)) + '</li>').join('') + '</ul>' : ''}
      ${r.abstract ? '<details class="abs"><summary>Abstract</summary><p>' + highlight(r.abstract) + '</p></details>' : '<span class="muted" style="font-size:.82rem">No abstract from the source.</span>'}
      <div class="actions"><button class="btn sm" type="button" data-decide="include">Include</button><button class="btn sm" type="button" data-decide="exclude">Exclude</button><button class="btn sm" type="button" data-decide="review">Unsure</button>
        <input class="why" type="text" id="why-${esc(r.id)}" placeholder="Reason (optional, saved with the decision)" aria-label="Reason for decision"></div>
    </article>`;
  }

  // ---- Extract
  function included() { return recordsList().filter((r) => P.decisions[r.id] && P.decisions[r.id].status === 'include'); }
  function viewExtract(el) {
    const inc = included();
    const done = inc.filter((r) => P.extractions[r.id]).length;
    el.innerHTML = `
      <div class="head"><h2>Extract study details</h2>
        <p>Pattern rules pull the study design, sample size, population, intervention, outcomes, key finding and limitations from each abstract. Every value shows the sentence it came from. Anything not found is marked as not reported rather than guessed. Click a cell to correct it.</p></div>
      <div class="bar"><button class="btn primary" type="button" id="exAll" ${inc.length ? '' : 'disabled'}>Extract ${done < inc.length ? 'the ' + (inc.length - done) + ' remaining' : 'again for all'} included records</button>
        <span class="muted">${done} of ${inc.length} included records extracted. Extraction uses abstracts only; check full texts before you publish.</span></div>
      ${inc.length ? `<div class="tablewrap"><table><thead><tr><th>Study</th>${C.EXTRACT_FIELDS.map(([, l]) => '<th>' + esc(l) + '</th>').join('')}</tr></thead><tbody>${inc.map(exRow).join('')}</tbody></table></div>`
        : '<p class="muted">No included records yet. Include some on the Screen stage.</p>'}`;
    $('#exAll').onclick = () => {
      const redo = done >= inc.length; let n = 0;
      inc.forEach((r) => {
        if (P.extractions[r.id] && !redo) return;
        const old = P.extractions[r.id];
        const fresh = C.extract(r);
        if (old) C.EXTRACT_FIELDS.forEach(([k]) => { if (old[k] && old[k].method === 'human') fresh[k] = old[k]; });
        P.extractions[r.id] = fresh; n++;
      });
      log('extract', 'Extracted ' + n + ' records'); save(); render(); toast('Extracted ' + n + ' records. Corrections you made earlier were kept.');
    };
    el.querySelector('tbody') && (el.querySelector('tbody').onclick = (ev) => {
      const td = ev.target.closest('td.cell'); if (!td) return;
      editCell(td.dataset.id, td.dataset.f);
    });
  }
  function exRow(r) {
    const e = P.extractions[r.id];
    return `<tr><td class="t">${esc(r.title)}<div class="meta"><span>${esc((r.authors[0] || '').split(' ')[0])} ${esc(r.year || '')}</span></div></td>${C.EXTRACT_FIELDS.map(([k, l]) => {
      if (!e) return '<td class="muted">—</td>';
      const f = e[k] || {};
      const cls = !f.value ? 'missing' : f.method === 'human' ? 'human' : '';
      return `<td class="cell ${cls}" data-id="${esc(r.id)}" data-f="${k}" title="Click to correct"><span class="v">${esc(f.value || C.NOT_REPORTED)}</span>${f.value && f.evidence && f.method !== 'human' ? '<span class="ev">“' + esc(f.evidence.slice(0, 140)) + (f.evidence.length > 140 ? '…' : '') + '” · ' + esc(f.method) + '</span>' : ''}${f.method === 'human' && f.evidence ? '<span class="ev">' + esc(f.evidence) + '</span>' : ''}</td>`;
    }).join('')}</tr>`;
  }
  function editCell(id, field) {
    const r = P.records[id]; const e = P.extractions[id]; const f = e[field] || {};
    const label = C.EXTRACT_FIELDS.find((x) => x[0] === field)[1];
    modal(`<h3>${esc(label)}</h3><p class="muted" style="margin:0">${esc(r.title)}</p>
      <label class="field"><span>Value</span><textarea id="mv" rows="3">${esc(f.value || '')}</textarea><small>Leave empty if the paper does not report it.</small></label>
      <label class="field"><span>Where it comes from</span><input id="me" type="text" value="${esc(f.method === 'human' ? f.evidence : '')}" placeholder="e.g. Full text, Table 2; or the abstract sentence"></label>
      <label class="field"><span>What was wrong (for the error log)</span><select id="mc"><option>wrong value</option><option>missed value</option><option>should be not reported</option><option>value from the wrong sentence</option><option>other</option></select></label>
      ${f.evidence && f.method !== 'human' ? '<div class="note">Rule found: “' + esc(f.evidence) + '”</div>' : ''}
      ${r.abstract ? '<details class="abs"><summary>Abstract</summary><p>' + esc(r.abstract) + '</p></details>' : ''}
      <div class="bar"><button class="btn primary" type="button" id="ms">Save correction</button><button class="btn" type="button" data-close>Cancel</button></div>`, (box, close) => {
      $('#ms', box).onclick = () => {
        const v = $('#mv', box).value.trim();
        P.corrections.push({ at: new Date().toISOString(), stage: 'extraction', recordId: id, field, title: r.title, input: { abstract: r.abstract },
          agentOutput: { value: f.value, evidence: f.evidence, method: f.method }, correctedOutput: { value: v || null, source: $('#me', box).value.trim() }, errorCategory: $('#mc', box).value });
        e[field] = v ? { value: v, evidence: $('#me', box).value.trim() || 'Entered by reviewer', method: 'human' } : { value: null, evidence: '', method: 'human', note: C.NOT_REPORTED };
        log('extract', 'Corrected ' + label + ' for ' + r.title.slice(0, 60)); save(); close(); render();
      };
    });
  }

  // ---- Verify
  function viewVerify(el) {
    const inc = included();
    const vs = inc.map((r) => P.verifications[r.id]).filter(Boolean);
    const cnt = { pass: 0, warn: 0, fail: 0 }; vs.forEach((v) => cnt[v.overall]++);
    el.innerHTML = `
      <div class="head"><h2>Verify included records</h2>
        <p>The verifier checks each included record against its registry entry at Crossref (title, year, first author, retractions and corrections) and against the project's own rules: it needs an identifier, a recorded screening reason, and a source passage for every extracted value.</p></div>
      <div class="bar"><button class="btn primary" type="button" id="vAll" ${inc.length ? '' : 'disabled'}>Run the verifier on ${inc.length} included records</button>
        <span class="pill pass">${cnt.pass} pass</span><span class="pill warn">${cnt.warn} warning</span><span class="pill fail">${cnt.fail} fail</span><span class="muted">${inc.length - vs.length} not run</span></div>
      <div class="status" id="vstatus" aria-live="polite"></div>
      <div class="recs">${inc.map((r) => {
        const v = P.verifications[r.id];
        return `<article class="rec ${v ? (v.overall === 'pass' ? 'include' : v.overall === 'fail' ? 'exclude' : 'review') : ''}"><div class="meta"><span class="pill ${v ? v.overall : ''}">${v ? v.overall : 'not run'}</span>${v ? '<span class="muted">' + esc(fmtDate(v.at)) + '</span>' : ''}</div>
          <h3>${esc(r.title)}</h3>${v ? '<ul class="checklist">' + v.checks.map((c) => `<li><span class="pill ${c.status}">${c.status}</span><span><b>${esc(c.check)}</b> <span class="d">${esc(c.detail)}</span></span></li>`).join('') + '</ul>' : ''}</article>`;
      }).join('') || '<p class="muted">Include records on the Screen stage first.</p>'}</div>`;
    $('#vAll').onclick = async (ev) => {
      ev.target.disabled = true;
      const st = $('#vstatus'); let i = 0, net = 0;
      for (const r of inc) {
        i++; st.textContent = 'Checking ' + i + ' of ' + inc.length + '…';
        let cr = P.crossref[r.doi] || null;
        if (r.doi && !cr && !/^10\.5555\//.test(r.doi)) {
          try { cr = await C.fetchCrossref(r.doi, null, store.settings.email); P.crossref[r.doi] = slimCrossref(cr); await new Promise((res) => setTimeout(res, 120)); }
          catch (e) { net++; cr = null; }
        }
        P.verifications[r.id] = C.verify(r, { crossref: cr, decision: P.decisions[r.id], extraction: P.extractions[r.id],
          crossrefSkip: /^10\.5555\//.test(r.doi) ? 'Example DOI with the 10.5555 test prefix; not looked up' : null });
      }
      log('verify', 'Verified ' + inc.length + ' records' + (net ? ' (' + net + ' could not reach Crossref)' : ''));
      save(); render();
      if (net) $('#vstatus').textContent = net + ' records could not reach Crossref, so their registry checks were skipped. In the hosted preview, outside connections are switched off.';
      if (inc.some((r) => /^10\.5555\//.test(r.doi))) toast('Example records use test DOIs, so the Crossref checks were skipped for them.');
    };
  }
  function slimCrossref(m) {
    if (!m || m.notFound) return m;
    return { title: m.title, issued: m.issued, published: m.published, author: (m.author || []).slice(0, 3), 'updated-by': m['updated-by'], 'update-to': m['update-to'] };
  }

  // ---- Gaps
  let gapScope = 'included';
  function viewGaps(el) {
    const inc = included();
    let set = gapScope === 'all' || !inc.length ? recordsList() : inc;
    const basis = set === inc ? 'included' : 'all';
    const ex = {}; set.forEach((r) => { ex[r.id] = P.extractions[r.id] || C.extract(r); });
    const g = C.gapAnalysis(set, ex, basis === 'all' ? 'project' : 'included');
    const designs = Object.entries(g.design).sort((a, b) => b[1] - a[1]);
    const maxD = Math.max(1, ...designs.map((d) => d[1]));
    const years = Object.keys(g.year).map(Number).sort((a, b) => a - b);
    const yrs = []; if (years.length) for (let y = years[0]; y <= years[years.length - 1]; y++) yrs.push(y);
    const maxY = Math.max(1, ...Object.values(g.year));
    const titleOf = (id) => P.records[id] ? P.records[id].title : id;
    el.innerHTML = `
      <div class="head"><h2>Map the evidence</h2>
        <p>Counts and patterns across ${basis === 'all' ? 'every record in the project' : 'the included records'} (${g.total.toLocaleString()}). These are leads for where evidence is thin or conflicting, not proven gaps. Check each one against the full texts.</p></div>
      <section class="panel">
        <div class="bar">
          <span class="lbl">Analyse</span>
          <div class="checks" role="radiogroup" aria-label="Records to analyse">
            <label><input type="radio" name="gscope" value="included" ${basis === 'included' ? 'checked' : ''} ${inc.length ? '' : 'disabled'}> Included only (${inc.length.toLocaleString()})</label>
            <label><input type="radio" name="gscope" value="all" ${basis === 'all' ? 'checked' : ''}> All records (${P.order.length.toLocaleString()})</label>
          </div>
          <span style="flex:1"></span>
          <label class="btn" for="gapFile">Import files</label><input id="gapFile" type="file" multiple accept=".ris,.nbib,.txt,.bib,.bibtex,.csv,.tsv" hidden>
        </div>
        <small class="muted">To map a set of papers without screening them, import your export file (RIS, BibTeX, PubMed, CSV) and choose All records. Imported papers join this project and appear on the other stages too.</small>
        <div class="status" id="gapImpStatus" aria-live="polite"></div>
      </section>
      ${g.total ? `
      <section class="panel"><h3>What stands out</h3><ul class="reasons" style="font-size:.92rem">${g.notes.map((n) => '<li>' + esc(n) + '</li>').join('') || '<li>Nothing unusual found.</li>'}</ul></section>
      <div class="grid2">
        <section class="panel"><h3>Study designs</h3><div class="bars">${designs.map(([k, n]) => `<div class="b"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(n / maxD * 100).toFixed(1)}%"></div></div><span class="c">${n}</span></div>`).join('')}</div></section>
        <section class="panel"><h3>Records by year</h3><div class="hist">${yrs.map((y) => `<div class="col" title="${y}: ${g.year[y] || 0}"><b>${g.year[y] || ''}</b><i style="height:${((g.year[y] || 0) / maxY * 80).toFixed(1)}%"></i><span>${y}</span></div>`).join('')}</div></section>
      </div>
      <section class="panel"><h3>Most frequent keywords</h3><div class="chips">${g.topKeywords.map(([k, n]) => `<span class="chip">${esc(k)}<b>${n}</b></span>`).join('') || '<span class="muted">The sources gave no keywords.</span>'}</div></section>
      <section class="panel"><h3>Possible contradictions</h3><p class="muted" style="margin:0">Pairs that share at least two keywords but whose key findings point in opposite directions.</p>
        ${g.contradictions.length ? '<div class="recs">' + g.contradictions.map((c) => `<div class="rec review"><div class="meta"><span>Shared: ${esc(c.shared.join(', '))}</span></div>
          <div><b>${esc(titleOf(c.a))}</b><br><span class="muted">${esc(c.aFinding)}</span></div><div><b>${esc(titleOf(c.b))}</b><br><span class="muted">${esc(c.bFinding)}</span></div></div>`).join('') + '</div>' : '<p class="muted">None found.</p>'}</section>` : '<p class="muted">No records yet. Run a search or import a file to see the evidence map.</p>'}`;
    el.querySelectorAll('input[name=gscope]').forEach((r) => r.onchange = () => { gapScope = r.value; render(); });
    const gf = $('#gapFile');
    gf.onchange = async () => { const files = Array.from(gf.files); gf.value = ''; if (!files.length) return; gapScope = 'all'; await importFiles(files, 'gapImpStatus'); };
  }

  // ---- Watch
  function viewWatch(el) {
    const runs = P.watch.runs || [];
    const searches = uniqueSearches();
    const since = P.watch.lastRun ? P.watch.lastRun.slice(0, 10) : (P.searches[0] ? P.searches[0].at.slice(0, 10) : today());
    const newRecs = P.newIds.map((id) => P.records[id]).filter(Boolean);
    const cfg = { project: P.name, email: store.settings.email || 'you@example.com', searches: searches.filter((s) => !['openalex', 'sample', 'file'].includes(s.sourceKey)).map((s) => ({ source: s.sourceKey, query: s.query })) };
    el.innerHTML = `
      <div class="head"><h2>Watch for new papers</h2>
        <p>Re-run this project's searches for records added since the last check. New records are de-duplicated, screened by your rules and tagged <span class="pill new">new</span> until you mark them seen.</p></div>
      <section class="panel">
        <div class="bar"><button class="btn primary" type="button" id="wRun" ${searches.length ? '' : 'disabled'}>Check for records added since ${esc(since)}</button>
          ${newRecs.length ? '<button class="btn" type="button" id="wSeen">Mark ' + newRecs.length + ' as seen</button>' : ''}</div>
        <div class="status" id="wstatus" aria-live="polite"></div>
        <div class="muted">${searches.length ? 'Searches watched: ' + searches.map((s) => esc(s.source) + ' · <code>' + esc(s.query.slice(0, 60)) + (s.query.length > 60 ? '…' : '') + '</code>').join('; ') : 'Run a search first.'}</div>
      </section>
      ${newRecs.length ? '<section class="panel"><h3>New since you last looked</h3><div class="recs">' + newRecs.map(recCard).join('') + '</div></section>' : ''}
      ${runs.length ? '<section class="panel"><h3>Previous checks</h3><div class="tablewrap"><table><thead><tr><th>When</th><th>Since</th><th>New records</th></tr></thead><tbody>' + runs.slice().reverse().map((r) => `<tr><td>${esc(fmtDate(r.at))}</td><td>${esc(r.since)}</td><td class="num">${r.found}</td></tr>`).join('') + '</tbody></table></div></section>' : ''}
      <section class="panel"><h3>Run it every week without opening the app</h3>
        <p style="margin:0">The repository includes a GitHub Actions job that runs every Monday at 09:00 IST, checks PubMed and Europe PMC for these searches and saves a Markdown digest. It stays switched off until you give it searches.</p>
        <div class="note warn"><b>Keep your topics private.</b> Anything in a public GitHub repository, including its reports and issues, can be read by anyone. Use a <b>private</b> copy of the repository, or paste this into a repository secret named <code>LITINTEL_SEARCHES</code> instead of into <code>watch/searches.json</code>. The Check button above is always private: it runs only in your browser.</div>
        <pre class="code" id="cfg">${esc(JSON.stringify(cfg, null, 2))}</pre>
        <div class="bar"><button class="btn sm" type="button" id="copyCfg">Copy</button></div></section>`;
    if ($('#wSeen')) $('#wSeen').onclick = () => { P.newIds = []; save(); render(); };
    $('#copyCfg').onclick = () => copyText($('#cfg').textContent, $('#cfg'));
    el.querySelector('.recs') && el.querySelector('.recs').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-decide]'); if (!b) return;
      const card = b.closest('.rec'); decide(card.dataset.id, b.dataset.decide, card.querySelector('.why').value.trim());
    });
    $('#wRun').onclick = async (ev) => {
      ev.target.disabled = true;
      let total = 0;
      for (const s of searches) {
        if (s.sourceKey === 'sample' || s.sourceKey === 'file' || !C.ADAPTERS[s.sourceKey]) continue;
        total += await runSearch([s.sourceKey], s.query, { since, max: 500 }, $('#wstatus'));
      }
      const failed = P.searches.slice(-searches.length).every((s) => s.error);
      if (!failed) { P.watch.lastRun = new Date().toISOString(); P.watch.runs.push({ at: P.watch.lastRun, since, found: total }); }
      save(); render();
      $('#wstatus').textContent = failed ? 'The check could not reach the databases, so the watch date was not moved.' : total + ' new records since ' + since + '.';
    };
  }
  function uniqueSearches() {
    const seen = new Map();
    P.searches.filter((s) => s.kind === 'search' && !s.error).forEach((s) => seen.set(s.sourceKey + '|' + s.query, s));
    return Array.from(seen.values());
  }

  // ---- Export & log
  function viewExport(el) {
    const inc = included();
    const errs = {}; P.corrections.forEach((c) => { const k = c.stage + ': ' + c.errorCategory; errs[k] = (errs[k] || 0) + 1; });
    const ruleTotal = Object.keys(P.ruleDecisions).length;
    const humanChecked = Object.values(P.decisions).filter((d) => d.by === 'human').length;
    const screenErr = P.corrections.filter((c) => c.stage === 'screening' && c.errorCategory !== 'resolved review').length;
    el.innerHTML = `
      <div class="head"><h2>Export and audit</h2>
        <p>Take the evidence table, citations and the full project file with you. The error log records every time you overruled the rules, in a form you can use to improve the rules or train a model later.</p></div>
      <section class="panel"><h3>Downloads</h3>
        <div class="bar">
          <button class="btn primary" type="button" data-x="csv">Evidence table (.csv)</button>
          <button class="btn" type="button" data-x="ris">Citations for included (.ris)</button>
          <button class="btn" type="button" data-x="bib">Citations for included (.bib)</button>
          <button class="btn" type="button" data-x="md">Review report (.md)</button>
          <button class="btn" type="button" data-x="jsonl">Error log (.jsonl)</button>
          <button class="btn" type="button" data-x="json">Whole project (.json)</button>
        </div>
        <small class="muted">The CSV opens in Excel and Google Sheets. RIS and BibTeX import into Zotero, Mendeley and EndNote. ${inc.length} included records.</small>
        <div class="bar"><label class="btn" for="imp">Import a project file</label><input id="imp" type="file" accept=".json,application/json" hidden></div>
      </section>
      <section class="panel"><h3>How the rules performed</h3>
        <div class="flow" style="position:static;border:0;padding:0">
          <div><b>${ruleTotal}</b><span>Rule decisions</span></div><div><b>${humanChecked}</b><span>Checked by you</span></div>
          <div class="exc"><b>${screenErr}</b><span>Screening overrules</span></div><div class="rev"><b>${P.corrections.filter((c) => c.stage === 'extraction').length}</b><span>Extraction fixes</span></div></div>
        ${Object.keys(errs).length ? '<div class="chips">' + Object.entries(errs).map(([k, n]) => `<span class="chip">${esc(k)}<b>${n}</b></span>`).join('') + '</div>' : '<p class="muted" style="margin:0">No corrections yet.</p>'}
      </section>
      <section class="panel"><h3>Activity</h3>${P.activity.length ? '<div class="tablewrap"><table><thead><tr><th>When</th><th>Stage</th><th>What happened</th></tr></thead><tbody>' + P.activity.slice(0, 80).map((a) => `<tr><td>${esc(fmtDate(a.at))}</td><td>${esc(a.kind)}</td><td>${esc(a.detail)}</td></tr>`).join('') + '</tbody></table></div>' : '<p class="muted">Nothing yet.</p>'}</section>
      ${P.searches.length ? '<section class="panel"><h3>Search log</h3>' + searchTable(P.searches.slice().reverse()) + '</section>' : ''}`;
    el.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => exportAs(b.dataset.x));
    $('#imp').onchange = (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const p = JSON.parse(rd.result);
          if (!p || !p.records || !p.order) throw new Error('This file is not a LitIntel project.');
          save(); p.id = uid(); p.name = p.name + ' (imported)'; P = p; store.index.push({ id: p.id, name: p.name }); store.currentId = p.id; save(); render(); toast('Imported ' + p.order.length + ' records.');
        } catch (e) { toast('Could not import: ' + e.message); }
      };
      rd.readAsText(f);
    };
  }
  function slug() { return P.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'review'; }
  function exportAs(kind) {
    const inc = included(); const all = recordsList(); const base = 'litintel-' + slug() + '-' + today();
    if (kind === 'csv') download(base + '-evidence.csv', C.toCSV(C.evidenceRows(all, P.decisions, P.extractions, P.verifications), C.evidenceHeaders()), 'text/csv');
    if (kind === 'ris') download(base + '-included.ris', C.toRIS(inc), 'application/x-research-info-systems');
    if (kind === 'bib') download(base + '-included.bib', C.toBibTeX(inc), 'application/x-bibtex');
    if (kind === 'jsonl') download(base + '-errors.jsonl', C.toJSONL(P.corrections), 'application/x-ndjson');
    if (kind === 'json') download(base + '-project.json', JSON.stringify(P, null, 1), 'application/json');
    if (kind === 'md') download(base + '-report.md', report(), 'text/markdown');
  }
  function report() {
    const c = C.flowCounts(P); const inc = included();
    const ex = {}; inc.forEach((r) => { ex[r.id] = P.extractions[r.id] || C.extract(r); });
    const g = C.gapAnalysis(inc, ex);
    const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const L = ['# ' + P.name, '', 'Generated ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC with LitIntel ' + C.VERSION + '. Extraction is from abstracts and needs full-text checking.', ''];
    if (P.question) L.push('**Question:** ' + P.question, '');
    L.push('## Searches', '', '| Date | Database | Query | Filters | Hits | Retrieved | New |', '|---|---|---|---|---|---|---|');
    P.searches.forEach((s) => L.push('| ' + [s.at.slice(0, 10), s.source, '`' + cell(s.query) + '`', cell([s.filters && s.filters.yearFrom && 'from ' + s.filters.yearFrom, s.filters && s.filters.yearTo && 'to ' + s.filters.yearTo, s.filters && s.filters.since && 'added since ' + s.filters.since, s.error && 'ERROR'].filter(Boolean).join(', ')), s.total, s.retrieved, s.added].join(' | ') + ' |'));
    L.push('', '## Flow', '', '| Stage | Records |', '|---|---|', '| Identified | ' + c.identified + ' |', '| Duplicates removed | ' + c.duplicatesRemoved + ' |', '| Screened | ' + c.screened + ' |', '| Excluded | ' + c.excluded + ' |', '| Still to review | ' + (c.review + c.undecided) + ' |', '| Included | ' + c.included + ' |', '');
    const crit = criteria();
    L.push('## Eligibility rules', '', crit.includeGroups.map((gr, i) => '- Include criterion ' + (i + 1) + ': ' + gr.join(' OR ')).join('\n') || '- None set', crit.excludeTerms.length ? '- Exclude terms: ' + crit.excludeTerms.join(', ') : '', '- Excluded publication types: ' + (crit.excludeTypes.join(', ') || 'none'), '');
    L.push('## Included studies', '', '| Study | Design | Sample | Key finding | Verification |', '|---|---|---|---|---|');
    inc.forEach((r) => { const e = ex[r.id]; const v = P.verifications[r.id];
      L.push('| ' + [cell((r.authors[0] || '').split(' ')[0] + ' ' + (r.year || '') + ', ' + r.title + (r.doi ? ' (doi:' + r.doi + ')' : '')), cell(e.studyDesign.value || C.NOT_REPORTED), cell(e.sampleSize.value || C.NOT_REPORTED), cell(e.keyFinding.value || C.NOT_REPORTED), v ? v.overall : 'not run'].join(' | ') + ' |'); });
    L.push('', '## Evidence map', '', g.notes.map((n) => '- ' + n).join('\n') || '- No notes.', '');
    if (g.contradictions.length) { L.push('### Possible contradictions', ''); g.contradictions.forEach((x) => L.push('- ' + P.records[x.a].title + ' vs ' + P.records[x.b].title + ' (shared: ' + x.shared.join(', ') + ')')); L.push(''); }
    L.push('## References', '');
    inc.forEach((r, i) => L.push((i + 1) + '. ' + r.authors.slice(0, 6).join(', ') + (r.authors.length > 6 ? ', et al' : '') + '. ' + r.title + '. ' + (r.journal ? '*' + r.journal + '*. ' : '') + (r.year || 'n.d.') + (r.volume ? ';' + r.volume : '') + (r.issue ? '(' + r.issue + ')' : '') + (r.pages ? ':' + r.pages : '') + '.' + (r.doi ? ' https://doi.org/' + r.doi : '')));
    return L.join('\n') + '\n';
  }

  // ------------------------------------------------------------ helpers
  function download(name, text, type) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Saved ' + name + '. If nothing downloaded, this preview blocks downloads; use your deployed copy.');
    } catch (e) { toast('Download failed: ' + e.message); }
  }
  function copyText(text, el) {
    const fallback = () => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Selected. Press Ctrl+C or ⌘C to copy.'); };
    try { navigator.clipboard.writeText(text).then(() => toast('Copied.'), fallback); } catch (e) { fallback(); }
  }
  let toastTimer;
  function toast(msg) {
    let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
  }
  function modal(html, wire) {
    const root = $('#modalRoot');
    root.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><div class="box">' + html + '</div></div>';
    const box = root.querySelector('.box');
    const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    root.querySelector('.modal').addEventListener('click', (e) => { if (e.target.classList.contains('modal') || e.target.closest('[data-close]')) close(); });
    wire(box, close);
    const first = box.querySelector('textarea,input,select,button'); if (first) first.focus();
  }

  // ------------------------------------------------------------ wiring
  $('#stages').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });
  $('#projSel').addEventListener('change', (e) => switchProject(e.target.value));
  $('#newProj').onclick = () => modal(`<h3>New review project</h3><label class="field"><span>Name</span><input id="pn" type="text" placeholder="e.g. Microplastic detection methods"></label>
    <div class="bar"><button class="btn primary" type="button" id="pc">Create</button><button class="btn" type="button" data-close>Cancel</button></div>`, (box, close) => {
    const make = () => { const n = $('#pn', box).value.trim(); if (!n) return; save(); P = newProject(n); store.currentId = P.id; store.view = 'search'; save(); close(); render(); };
    $('#pc', box).onclick = make; $('#pn', box).onkeydown = (e) => { if (e.key === 'Enter') make(); };
  });
  $('#renameProj').onclick = () => modal(`<h3>Rename project</h3><label class="field"><span>Name</span><input id="pn" type="text" value="${esc(P.name)}"></label>
    <div class="bar"><button class="btn primary" type="button" id="pc">Rename</button><button class="btn" type="button" data-close>Cancel</button></div>`, (box, close) => {
    $('#pc', box).onclick = () => { const n = $('#pn', box).value.trim(); if (n) { P.name = n; save(); close(); render(); } };
  });
  $('#delProj').onclick = () => modal(`<h3>Delete “${esc(P.name)}”?</h3><p style="margin:0">This removes its ${P.order.length} records and all decisions from this browser. Export the project file first if you may need it.</p>
    <div class="bar"><button class="btn primary" type="button" id="pd" style="background:var(--exc);border-color:var(--exc)">Delete project</button><button class="btn" type="button" data-close>Keep it</button></div>`, (box, close) => {
    $('#pd', box).onclick = async () => {
      await deleteProject(P.id);
      store.index = store.index.filter((x) => x.id !== P.id);
      P = null;
      for (let i = 0; !P && i < store.index.length; i++) P = await getProject(store.index[i].id);
      if (!P) P = newProject('My first review');
      store.currentId = P.id; save(); close(); render();
    };
  });

  // installable app + offline shell (only on https or localhost; ignored elsewhere)
  try {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* not available here */ });
    }
  } catch (e) { /* ignore */ }
  load().then(() => {
    render();
    if (!storageOk) setTimeout(() => toast('This browser is not saving data. Export your project before closing the tab.'), 600);
  });
})();
