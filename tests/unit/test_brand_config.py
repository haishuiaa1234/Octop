import json

import pytest

from octop.config import load_config


@pytest.mark.parametrize(
    "brand, expected",
    [(None, "default"), ("", "default"), ("other", "default"), ("dinfectome", "dinfectome")],
)
def test_brand_from_config(tmp_path, monkeypatch, brand, expected):
    monkeypatch.delenv("OCTOP_BRAND", raising=False)
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"brand": brand}), encoding="utf-8")
    assert load_config(path).brand == expected


def test_brand_environment_overrides_config(tmp_path, monkeypatch):
    path = tmp_path / "config.json"
    path.write_text('{"brand": "default"}', encoding="utf-8")
    monkeypatch.setenv("OCTOP_BRAND", "dinfectome")
    assert load_config(path).brand == "dinfectome"


def test_fresh_config_preserves_current_brand(tmp_path, monkeypatch):
    monkeypatch.delenv("OCTOP_BRAND", raising=False)
    path = tmp_path / "config.json"
    assert load_config(path).brand == "default"
    assert json.loads(path.read_text(encoding="utf-8"))["brand"] == "default"
