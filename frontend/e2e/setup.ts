// A fresh install sets up no language; the browser tests work in Spanish and Italian, so set those up first.
// Models are not downloaded: the small ones come with `uv sync` and SPACY_SIZE is 'sm' (playwright.config.ts).
export default async function globalSetup(): Promise<void> {
  const base = `http://127.0.0.1:${process.env.E2E_PORT}`;
  for (const code of ['es', 'it']) {
    const r = await fetch(`${base}/api/languages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, install_model: false, install_ocr: false }),
    });
    if (!r.ok && r.status !== 409) throw new Error(`Could not set up ${code}: ${r.status} ${await r.text()}`);
  }
}
