import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import fetch_model_wheels  # noqa: E402


def test_wheel_urls_for_the_given_languages():
    urls = fetch_model_wheels.wheel_urls("sm", ["es", "it"])
    assert urls == [
        "https://github.com/explosion/spacy-models/releases/download/es_core_news_sm-3.8.0/es_core_news_sm-3.8.0-py3-none-any.whl",
        "https://github.com/explosion/spacy-models/releases/download/it_core_news_sm-3.8.0/it_core_news_sm-3.8.0-py3-none-any.whl",
    ]


def test_dry_run_downloads_nothing(tmp_path, capsys):
    target = tmp_path / "w"
    assert fetch_model_wheels.main([str(target), "--size", "lg", "--langs", "es", "--dry-run"]) == 0
    assert "es_core_news_lg-3.8.0" in capsys.readouterr().out
    assert not target.exists()


def test_langs_option_limits_urls(capsys):
    assert fetch_model_wheels.main(["w", "--size", "sm", "--langs", "fr", "--dry-run"]) == 0
    out = capsys.readouterr().out.split()
    assert out == ["https://github.com/explosion/spacy-models/releases/download/fr_core_news_sm-3.8.0/"
                   "fr_core_news_sm-3.8.0-py3-none-any.whl"]


def test_langs_option_is_required():
    with pytest.raises(SystemExit):
        fetch_model_wheels.main(["w", "--dry-run"])


def test_langs_option_rejects_languages_outside_the_catalog():
    with pytest.raises(SystemExit):
        fetch_model_wheels.main(["w", "--langs", "zz", "--dry-run"])
