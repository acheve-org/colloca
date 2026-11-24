import importlib

import pytest

from colloca import langcatalog
from colloca.langcatalog import CATALOG


@pytest.mark.parametrize("code", sorted(CATALOG))
def test_every_entry_has_stop_words(code):
    # the generic language check relies on spacy.lang.<code>.stop_words, which needs no model
    assert importlib.import_module(f"spacy.lang.{code}.stop_words").STOP_WORDS


def test_package_and_urls():
    assert langcatalog.package("es", "md") == "es_core_news_md"
    assert langcatalog.package("en", "sm") == "en_core_web_sm"
    assert langcatalog.wheel_url("es", "sm") == (
        "https://github.com/explosion/spacy-models/releases/download/es_core_news_sm-3.8.0/"
        "es_core_news_sm-3.8.0-py3-none-any.whl")
    assert langcatalog.tessdata_url("spa") == "https://github.com/tesseract-ocr/tessdata_fast/raw/main/spa.traineddata"


def test_unknown_code_or_size_rejected():
    with pytest.raises(ValueError):
        langcatalog.package("zz", "sm")
    with pytest.raises(ValueError):
        langcatalog.package("es", "trf")
    with pytest.raises(ValueError):
        langcatalog.wheel_url("../x", "sm")


def test_seed_languages_are_in_catalog():
    assert {"es", "it"} <= set(CATALOG)
    assert CATALOG["es"].tesseract == "spa" and CATALOG["it"].tesseract == "ita"


def test_no_unsupported_scripts_or_extra_dependency_languages():
    assert not {"ja", "ko", "zh", "xx", "ru", "uk"} & set(CATALOG)


def test_tessdata_url_only_for_catalog_codes():
    with pytest.raises(ValueError):
        langcatalog.tessdata_url("../../evil")
