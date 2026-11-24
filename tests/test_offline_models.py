import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import fetch_model_wheels  # noqa: E402


def test_wheel_urls_for_both_languages():
    urls = fetch_model_wheels.wheel_urls("sm")
    assert urls == [
        "https://github.com/explosion/spacy-models/releases/download/es_core_news_sm-3.8.0/es_core_news_sm-3.8.0-py3-none-any.whl",
        "https://github.com/explosion/spacy-models/releases/download/it_core_news_sm-3.8.0/it_core_news_sm-3.8.0-py3-none-any.whl",
    ]


def test_dry_run_downloads_nothing(tmp_path, capsys):
    target = tmp_path / "w"
    assert fetch_model_wheels.main([str(target), "--size", "lg", "--dry-run"]) == 0
    assert "es_core_news_lg-3.8.0" in capsys.readouterr().out
    assert not target.exists()
