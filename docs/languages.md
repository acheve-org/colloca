# Languages

The **Languages** screen lists the languages you work with (Spanish and Italian at first) and lets you add, edit and remove them. Each language card shows:

- **Model**: the spaCy model in use (name, version, size) with *Install*, *Change size* and *Uninstall* (uninstalling asks first and warns when corpora use the language). Models are downloaded from the official spaCy releases (or from `SPACY_WHEELS` offline) into `COLLOCA_MODELS_DIR` (Docker: `/models`) while you keep working; a failed download leaves nothing half-installed.
- **OCR**: whether the Tesseract program is present (it needs `--build-arg WITH_OCR=1` in Docker) and whether the data for the language is installed. *Install data* downloads `<code>.traineddata` from Tesseract's `tessdata_fast` set (or copies it from the folder in `TESSDATA_FILES`) into the same volume, so no root or `apt` is needed.
- **Base corpus**: create, fill and delete the language's general-language corpus ([base-corpora.md](base-corpora.md)).

*Add language* offers spaCy's official pipelines: Catalan, Croatian, Danish, Dutch, English, Finnish, French, German, Greek, Italian, Lithuanian, Macedonian, Norwegian Bokmål, Polish, Portuguese, Romanian, Slovenian, Spanish and Swedish. Languages written without spaces (Chinese, Japanese, Korean), Russian and Ukrainian are not offered yet.

## Rules

| Topic | Detail |
|---|---|
| Removing | Refused while any corpus of that language exists (the Trash counts). The model stays installed unless you tick *Also uninstall the model*. |
| Model size | Per language; empty = the default `SPACY_SIZE`. Changing it installs the new size. |
| Translations | Termbase entries, aligned texts and *Check text* need two languages. With more than two set up, you choose the language of the translation. |
| Backups | A backup with a corpus in a language you have not set up rejects only that corpus, naming the language. |
| Language check | Uses the stop words of the languages you set up, so it only helps with at least two ([importing.md](importing.md#checks-on-import)). |
