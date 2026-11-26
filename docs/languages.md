# Languages

**Settings** > **Languages** is a list and a panel, like *Projects*. The list names each language you work with (a new install has none) with its code and three status dots: **Model**, **OCR** and **Base corpus**. Each dot has its label beside it and a shape per state, so colour is never the only signal: a filled disc when it is installed (or the base corpus exists), a half disc while installing, a disc with a cross when an install failed, an empty ring when it is missing. *+ Add language* opens the catalog; the language you add becomes the chosen one. The first language is chosen when you open the screen.

The panel shows the chosen language: its name, its code, *Used by N corpora*, *Edit* (model size, OCR code) and a *⋯* menu (*Language actions*) with *Remove*. While corpora use the language *Remove* is shown but unavailable, and a line under the header says why. Below come three sections:

- **Language model**: the spaCy model in use (name, version, size) with *Install*, *Change size* and *Uninstall* (uninstalling asks first and warns when corpora use the language). Models are downloaded from the official spaCy releases (or from `SPACY_WHEELS` offline) into `COLLOCA_MODELS_DIR` (Docker: `/models`) while you keep working; a failed download leaves nothing half-installed.
- **OCR data**: whether the Tesseract program is present (it needs `--build-arg WITH_OCR=1` in Docker) and whether the data for the language is installed. *Install data* downloads `<code>.traineddata` from Tesseract's `tessdata_fast` set (or copies it from the folder in `TESSDATA_FILES`) into the same volume, so no root or `apt` is needed.
- **Base corpus**: create, fill and delete the language's general-language corpus ([base-corpora.md](base-corpora.md)). *Import even if the language looks wrong* sits at the end of this section; it skips the language check for the files you upload to the base corpus ([importing.md](importing.md#checks-on-import)).

Below 900 px the list shows first; choosing a language shows its panel in its place with a *Back* button, which returns to the list with focus on that language.

*Add language* offers spaCy's official pipelines (model size `lg` by default): Catalan, Croatian, Danish, Dutch, English, Finnish, French, German, Greek, Italian, Lithuanian, Macedonian, Norwegian Bokmål, Polish, Portuguese, Romanian, Slovenian, Spanish and Swedish. Languages written without spaces (Chinese, Japanese, Korean), Russian and Ukrainian are not offered yet.

## Rules

| Topic | Detail |
|---|---|
| Removing | Refused while any corpus of that language exists (the Trash counts). The model stays installed unless you tick *Also uninstall the model*. |
| Model size | Per language; empty = the default `SPACY_SIZE`. Changing it installs the new size. |
| Translations | Termbase entries, aligned texts and *Check text* need two languages. With more than two set up, you choose the language of the translation. |
| Backups | A backup with a corpus in a language you have not set up rejects only that corpus, naming the language. |
| Language check | Uses the stop words of the languages you set up, so it only helps with at least two ([importing.md](importing.md#checks-on-import)). |
