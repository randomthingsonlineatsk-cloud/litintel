/*!
 * LitIntel example project. Every record below is FICTIONAL, made up to show how the app works.
 * DOIs use the 10.5555 test prefix, which is reserved for examples and never resolves to a real paper.
 */
(function (root) {
  const R = (o) => Object.assign({ sources: ['Example data'], sourceUrls: {}, keywords: [], pubTypes: ['Journal Article'] }, o);
  const records = [
    R({ title: 'Liposomal paclitaxel versus solvent-based paclitaxel in women with advanced ovarian cancer: a randomised controlled trial', authors: ['Iyer RK', 'Menon S', 'Dutta P'], year: 2025, journal: 'Example Journal of Nano-Oncology', doi: '10.5555/example.0001',
      abstract: 'BACKGROUND: Solvent-based paclitaxel causes hypersensitivity reactions. METHODS: In this randomised controlled trial, 312 women with advanced ovarian cancer were randomised to liposomal paclitaxel or solvent-based paclitaxel. The primary outcome was progression-free survival; secondary outcomes included infusion reactions. RESULTS: Liposomal paclitaxel significantly reduced infusion reactions (4% vs 17%) with similar progression-free survival. CONCLUSIONS: Liposomal paclitaxel is an effective and better tolerated option. Longer follow-up is warranted.',
      keywords: ['liposomes', 'paclitaxel', 'ovarian neoplasms', 'drug delivery'], pubTypes: ['Journal Article', 'Randomized Controlled Trial'] }),
    R({ title: 'Polymeric nanoparticle delivery of doxorubicin in a murine breast tumour model', authors: ['Fernandes L', 'Okafor C'], year: 2024, journal: 'Example Nanomedicine Letters', doi: '10.5555/example.0002',
      abstract: 'We evaluated PLGA nanoparticles loaded with doxorubicin in 48 mice bearing orthotopic breast tumours. Mice were treated with nanoparticle or free doxorubicin for 21 days. Tumour accumulation measured by fluorescence did not differ significantly between groups. Cardiac toxicity was lower in the nanoparticle group. Further studies are needed to confirm these findings in larger models.',
      keywords: ['nanoparticles', 'doxorubicin', 'breast neoplasms', 'drug delivery'] }),
    R({ title: 'Real-world use of liposomal doxorubicin in breast cancer: a retrospective cohort study from three Indian centres', authors: ['Kulkarni A', 'Shah N', 'Bose T', 'Pillai V'], year: 2023, journal: 'Example Asian Oncology Reports', doi: '10.5555/example.0003',
      abstract: 'We conducted a retrospective cohort study of 1,204 patients with metastatic breast cancer treated between 2016 and 2021. Patients receiving liposomal doxorubicin were compared with those receiving conventional anthracyclines. The main outcome was symptomatic heart failure. Liposomal doxorubicin was associated with a lower incidence of heart failure (HR 0.52). Our findings support wider use in patients with cardiac risk factors, although residual confounding remains a limitation.',
      keywords: ['liposomes', 'doxorubicin', 'breast neoplasms', 'cardiotoxicity'] }),
    R({ title: 'Nanocarrier drug delivery in solid tumours: a systematic review and meta-analysis of tumour accumulation', authors: ['Lindqvist E', 'Moreau J'], year: 2025, journal: 'Example Reviews in Drug Delivery', doi: '10.5555/example.0004',
      abstract: 'We systematically searched four databases and included 87 studies reporting tumour accumulation of nanocarriers. Median delivery efficiency was 0.8% of the injected dose. Heterogeneity was high. Overall, nanocarrier accumulation in solid tumours remains low, and reporting standards vary widely between studies.',
      keywords: ['nanoparticles', 'drug delivery', 'neoplasms', 'meta-analysis'], pubTypes: ['Journal Article', 'Systematic Review', 'Meta-Analysis'] }),
    R({ title: 'Gold nanoparticles for photothermal therapy of skin lesions in dogs', authors: ['Harris M'], year: 2022, journal: 'Example Veterinary Nanoscience', doi: '10.5555/example.0005',
      abstract: 'Twelve dogs with cutaneous tumours received gold nanoparticle photothermal therapy in this veterinary pilot study. Complete response was seen in five lesions.',
      keywords: ['gold', 'nanoparticles', 'veterinary'] }),
    R({ title: 'The future of cancer nanomedicine', authors: ['Ortega P'], year: 2024, journal: 'Example Nano Perspectives', doi: '10.5555/example.0006',
      abstract: 'In this editorial we reflect on two decades of cancer nanomedicine.', pubTypes: ['Editorial'], keywords: ['nanomedicine'] }),
    R({ title: 'Lipid nanoparticle formulation stability under tropical storage conditions', authors: ['Rao D', 'Singh H'], year: 2025, journal: 'Example Pharmaceutical Technology', doi: '10.5555/example.0007',
      abstract: 'We measured particle size and encapsulation efficiency of lipid nanoparticle formulations stored at 30 °C and 75% relative humidity for six months. Particle size increased by 18%. These results inform shelf-life specifications for hot climates.',
      keywords: ['lipid nanoparticles', 'drug stability', 'drug storage'] }),
    R({ title: 'Albumin-bound nanoparticle chemotherapy in pancreatic cancer: an exploratory single-arm trial', authors: ['Watanabe K', 'Ali Z', 'Nair R'], year: 2021, journal: 'Example Gastrointestinal Oncology', doi: '10.5555/example.0008',
      abstract: '', keywords: ['albumins', 'nanoparticles', 'pancreatic neoplasms'] }),
  ];
  root.LitSample = {
    name: 'Example: nanocarriers in cancer (fictional data)',
    question: 'In people with solid cancers, do nanocarrier formulations of chemotherapy reduce toxicity compared with conventional formulations?',
    query: '(liposom* OR nanoparticle* OR nanocarrier*) AND (cancer OR tumour OR tumor OR neoplasm)',
    includeText: 'liposom*, nanoparticle*, nanocarrier*\ncancer, tumour*, tumor*, neoplasm*, oncology',
    excludeText: 'veterinary, dogs',
    records,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
