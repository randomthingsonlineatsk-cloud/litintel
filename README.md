# LitIntel

LitIntel searches PubMed, Europe PMC and OpenAlex, removes duplicate records, screens titles and abstracts against your eligibility rules, extracts study details, and checks every included record against its Crossref registry entry. Each decision keeps its reason, and each extracted value keeps the sentence it came from, so the whole review can be audited and repeated.

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
| 5. Gaps | Counts by study design, year and keyword, plus pairs of studies whose findings point in opposite directions. | Leads to follow up, not conclusions |
| 6. Watch | Re-runs the searches for records added since the last check, in the app or weekly on GitHub. | A dated digest of new records |
| 7. Export & log | Evidence table (CSV), citations (RIS, BibTeX), a Markdown report with the search log and flow counts, the project file (JSON), and the error log (JSONL). | Everything needed to write the methods section |

### The verifier

A record passes when it has a DOI or PMID, its DOI resolves at Crossref with a matching title and year, it is not flagged as retracted, it has a recorded screening reason, and every extracted value has a source passage or was entered by a reviewer. Any failed check marks the record **fail**; warnings (for example a correction notice, or a value found by a weak heuristic) mark it **warning**.

### The error log

Every time you overrule a screening decision or correct an extracted value, LitIntel saves the input, what the rules produced, your correction, and an error category. Export it from **Export & log** as JSONL. It shows where the rules go wrong and can later serve as training or evaluation data.

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

## Deploy on Cloudflare Pages (free)

1. Push this folder to a new public GitHub repository, for example `randomthingsonlineatsk-cloud/litintel`.
2. In the Cloudflare dashboard go to **Workers & Pages → Create → Pages → Connect to Git** and pick the repository.
3. Set **Framework preset** to *None*, leave **Build command** empty and set **Build output directory** to `/`.
4. Deploy. Every push to `main` redeploys the site.

Netlify and GitHub Pages work the same way, since the app is plain HTML, CSS and JavaScript.

## Weekly watch on GitHub Actions

1. Edit `watch/searches.json`. Copy the ready-made version from the app's **Watch** stage, or write it by hand:

   ```json
   {
     "project": "Nanocarriers in cancer",
     "email": "you@example.org",
     "searches": [
       { "source": "pubmed", "query": "(liposom*[tiab] OR nanoparticle*[tiab]) AND neoplasms[mh]" },
       { "source": "europepmc", "query": "(liposom* OR nanoparticle*) AND (cancer OR tumour)" }
     ]
   }
   ```

2. Optional: add an `NCBI_API_KEY` secret under **Settings → Secrets and variables → Actions**.
3. Under **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**.
4. The job in `.github/workflows/weekly-watch.yml` runs every Monday at 09:00 IST. Start it by hand from the **Actions** tab to test it.

Each run writes `reports/YYYY-MM-DD.md`, remembers what it has reported in `watch/state.json`, and opens a GitHub issue when there are new records, so GitHub emails you.

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
