const en: Record<string, string> = {
  'app.name': 'Colloca',
  'corpus.none': 'No corpus yet',
  'corpus.working': 'Working…',
  'corpus.selectFirst': 'Create or select a corpus first.',
  'scope.all': 'All documents',
  'scope.summary': '{docs} of {total} documents',
  'scope.clear': 'Clear filters',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.export': 'Export CSV',
  'common.noResults': 'No results',
  'nav.sources': 'Sources',
  'nav.base': 'Base corpus',
  'nav.concordance': 'Concordance',
  'nav.collocations': 'Collocations',
  'nav.ngrams': 'N-grams',
  'nav.frequency': 'Frequency',
  'nav.keyness': 'Keyness',
  'nav.cloud': 'Word cloud',
  'nav.equivalents': 'Equivalents',
  'nav.termbase': 'Termbase',
  'nav.job': 'Job analysis',
};

/** Look up a UI string; `{name}` placeholders are filled from vars. Unknown keys return the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const s = en[key];
  if (s === undefined) return key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
