# LitIntel

LitIntel searches seven free databases (PubMed, Europe PMC, Crossref, Semantic Scholar, DOAJ, ClinicalTrials.gov and OpenAlex), removes duplicate records, screens titles and abstracts against your eligibility rules, extracts study details, and checks every included record against its Crossref registry entry. Each decision keeps its reason, and each extracted value keeps the sentence it came from, so the whole review can be audited and repeated.

It runs entirely in the browser. There is no server, no account and no paid API. A weekly GitHub Actions job watches your searches for new papers and opens an issue when something appears.

## Free to use, for everyone

Nobody pays anything to run LitIntel, neither the person hosting it nor the people using it.

| Part | Cost | Why |
|---|---|---|
| Hosting | Free | It is a static site; Cloudflare Pages, Netlify and GitHub Pages host these at no charge. |
| PubMed, Europe PMC, Crossref | Free, no key | Public APIs. Each user's browser calls them directly, so the limits apply to each user separately, never to the host. |
| OpenAlex | Free key per user | Optional and off by default. Each user adds their own free key, which comes with a daily allowance. |
| Screening and extraction | Free | Transparent rules that run in the browser. No AI service and no per-use bill. |
| Storage | Free | Projects stay in the user's own browser (IndexedDB). Nothing is uploaded anywhere. |
| Weekly watch | Free | GitHub Actions is free for public repositories. |

Because there is no server, the app has no shared quota to run out: a thousand users means a thousand separate browsers, each well inside the free limits.

Created by **Khan Gulrez Shagufa Fazal Ahmed** ([ORCID 0009-0009-6195-0329](https://orcid.org/0009-0009-6195-0329)).

## What it does

| Stage | What happens | What you can check |
|---|---|---|
| 1. Search | One search string is sent to each database you tick, or you import export files from Scopus, Web of Science, Embase, Zotero, Mendeley, EndNote or PubMed. Records are merged when they share a DOI, a PMID, or the same title and year. | The exact query or file, date, filters, hits and records added for every run |
| 2. Screen | Rules mark each record include, exclude or review, and write down why (the matched term and the passage it was found in). You confirm or overrule. | The rule's reason and your own, side by side |
| 3. Extract | Pattern rules pull study design, sample size, population, intervention, outcomes, key finding and limitations from the abstract. Anything not found is marked "Not reported in abstract". | The source sentence for every value; click to correct |
| 4. Verify | Each included record is checked against Crossref (title, year, first author, retractions, corrections) and against the project's rules. | Pass, warning or fail per check |
| 5. Gaps | Counts by study design, year and keyword, plus pairs of studies whose findings point in opposite directions. Analyse the included records or every record; import files here to map a set of papers without screening them. | Leads to follow up, not conclusions |
| 6. Watch | Re-runs the searches for records added since the last check, in the app or weekly on GitHub. | A dated digest of new records |
| 7. Export & log | Evidence table (CSV), citations (RIS, BibTeX), a Markdown report with the search log and flow counts, the project file (JSON), and the error log (JSONL). | Everything needed to write the methods section |

### The verifier

A record passes when it has a DOI or PMID, its DOI resolves at Crossref with a matching title and year, it is not flagged as retracted, it has a recorded screening reason, and every extracted value has a source passage or was entered by a reviewer. Any failed check marks the record **fail**; warnings (for example a correction notice, or a value found by a weak heuristic) mark it **warning**.

### The error log

Every time you overrule a screening decision or correct an extracted value, LitIntel saves the input, what the rules produced, your correction, and an error category. Export it from **Export & log** as JSONL. It shows where the rules go wrong and can later serve as training or evaluation data.

## Databases

| Database | What it covers | Key | Search syntax |
|---|---|---|---|
| PubMed | Biomedical literature (MEDLINE) | None; optional free NCBI key | Full Boolean, field tags such as `[tiab]`, `[mh]` |
| Europe PMC | PubMed plus preprints (bioRxiv, medRxiv), patents, agricultural and other sources | None | Boolean |
| Crossref | Metadata for nearly every DOI, all subjects | None | Relevance on words; AND/OR/NOT are ignored |
| Semantic Scholar | Papers across all sciences, with AI-extracted metadata | None; optional free key | Boolean (translated automatically) |
| DOAJ | Open-access journal articles only | None | Boolean; `*` wildcards are removed |
| ClinicalTrials.gov | Trial registrations, including unpublished and ongoing trials | None | Boolean |
| OpenAlex | Broad catalogue across disciplines | Free key per user | Relevance |

PubMed field tags are removed automatically before a search goes to the other databases, so one search string works everywhere. ClinicalTrials.gov returns registrations, not papers: each one keeps its NCT number, is screened and extracted like a paper (enrollment, phase, design), and is never merged with a publication of the same title. **Search → Settings → Test connections** checks every database from your own browser.

## Importing from other databases

Scopus, Web of Science and Embase have no free API, but all of them export files. Export your results and drop the files onto **Search → Import an export file**.

| Format | Where it comes from |
|---|---|
| RIS (`.ris`) | Scopus, Web of Science, Embase, Zotero, Mendeley, EndNote, most publishers |
| BibTeX (`.bib`) | Zotero, Mendeley, JabRef, Google Scholar (one record at a time) |
| PubMed MEDLINE (`.nbib` or `.txt`) | PubMed → Save → Format: PubMed |
| CSV or tab-delimited | Scopus CSV export, Web of Science tab-delimited, Zotero CSV. Needs a Title column. |

Imported records are de-duplicated against everything already in the project, screened by your rules, and listed in the search log with the file name.

## Install it and work offline

On the deployed site, Chrome and Edge show an **Install** icon in the address bar; on Android choose **Add to Home screen**, and on iPhone use **Share → Add to Home Screen**. The installed app opens without internet, so you can screen and extract offline. Searching, verifying and the watch need a connection.

## Limits you should know about

- Screening and extraction use **titles and abstracts only**. Check full texts before you report results.
- The rules are keyword and pattern based. They are fast and transparent, but they will miss things a reader would catch. That is why every rule decision can be overruled and every overrule is logged.
- OpenAlex has required a free API key since February 2026. Get one at [openalex.org/settings/api](https://openalex.org/settings/api) and paste it into **Search → Settings**.
- Projects are saved in your browser (IndexedDB, typically hundreds of MB). The app asks the browser to keep this data, but clearing site data still deletes it, so export the project file regularly. To work on another computer or share with a co-reviewer, export the project file and import it there.
- PubMed allows 3 requests per second without a key. Add a free NCBI key in Settings for larger searches.

## Run it

Open `index.html` through any static web server:

```bash
npx serve .          # or: python3 -m http.server 8000
```

Then open the address it prints. Click **Load the example project** to see a finished review built on eight fictional records (their DOIs use the reserved 10.5555 test prefix).

## Deploy on Cloudflare (free)

1. Push this folder to a new public GitHub repository, for example `randomthingsonlineatsk-cloud/litintel`.
2. In the Cloudflare dashboard go to **Workers & Pages → Create** and import the repository.
3. Leave **Build command** empty. The deploy command `npx wrangler deploy` is fine as it is.
4. Deploy. Every push to `main` redeploys the site.

`wrangler.jsonc` tells Cloudflare the site is plain static files, and `.assetsignore` keeps everything that is not part of the website (tests, the watch script, `node_modules`) from being uploaded. Keep both files in the repository; without `.assetsignore` the deploy fails with "Asset too large".

Netlify and GitHub Pages work the same way, since the app is plain HTML, CSS and JavaScript.

## Weekly watch on GitHub Actions (optional)

The job in `.github/workflows/weekly-watch.yml` runs every Monday at 09:00 IST. **It does nothing until you give it searches**, and `watch/searches.json` ships empty.

**Privacy first.** In a public repository, everything the job saves (the search file, the reports in `reports/` and the issues it opens) can be read by anyone. If your topics are confidential, do one of these:

- **Private repository (simplest):** create a separate private repository, upload this project to it, and set up the watch there. GitHub Actions on private repositories is free up to 2,000 minutes a month; one weekly run takes about one minute.
- **Secret in the public repository:** leave `watch/searches.json` empty and put your searches in a repository secret named `LITINTEL_SEARCHES` (**Settings → Secrets and variables → Actions → New repository secret**). The secret itself stays hidden, but the reports and issues the job creates are still public, so this hides your queries, not your results.

The format, in the file or the secret:

```json
{
  "project": "My watch",
  "email": "",
  "searches": [
    { "source": "pubmed", "query": "your PubMed search" },
    { "source": "europepmc", "query": "your Europe PMC search" }
  ]
}
```

`source` can be `pubmed`, `europepmc`, `crossref`, `semanticscholar`, `doaj`, `clinicaltrials` or `openalex` (OpenAlex needs an `OPENALEX_API_KEY` secret).

The app's **Watch** stage builds this for you from a project's searches. Then:

1. Optional: add an `NCBI_API_KEY` secret for higher PubMed rate limits.
2. Under **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**.
3. Start it by hand from the **Actions** tab to test it.

Each run writes `reports/YYYY-MM-DD.md`, remembers what it has reported in `watch/state.json`, and opens a GitHub issue when there are new records, so GitHub emails you.

**The in-app Watch is always private.** The **Check for records added since…** button in the app runs only in your browser and saves nothing outside it.

## Develop

```bash
npm install          # only installs the XML parser used by the tests
npm test             # offline tests for the core logic, file import and the weekly watch
```

| File | Purpose |
|---|---|
| `core.js` | Database adapters, de-duplication, screening, extraction, verification, gap analysis, exports. No dependencies; runs in the browser and in Node. |
| `app.js` | The interface and project storage |
| `index.html` | Page and styles |
| `sample.js` | The fictional example project |
| `sw.js`, `manifest.webmanifest`, `icons/` | Install and offline support |
| `watch/run.mjs` | The weekly watch script |
| `test/` | Offline tests with mocked API responses |

## Data sources

PubMed via [NCBI E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/), [Europe PMC REST API](https://europepmc.org/RestfulWebService), [OpenAlex](https://docs.openalex.org/) and the [Crossref REST API](https://api.crossref.org/). Please follow each provider's usage policy.

## License

Copyright 2026 Khan Gulrez Shagufa Fazal Ahmed. Licensed under the [Apache License 2.0](LICENSE). If you reuse or adapt this code, keep the [NOTICE](NOTICE) file so the original author stays credited.
