from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app.schemas import InvoiceLine


REPO_ROOT = Path(__file__).resolve().parents[3]
TS_CONTRACT = REPO_ROOT / "packages" / "contracts" / "invoice.schema.ts"
WORKER_FIXTURE = REPO_ROOT / "packages" / "contracts" / "fixtures" / "invoice-line.worker.json"


def _extract_zod_object_body(source: str, export_name: str) -> str:
    marker = f"export const {export_name} = z.object({{"
    start = source.index(marker) + len(marker)
    depth = 1
    i = start
    while i < len(source):
        char = source[i]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start:i]
        i += 1
    raise AssertionError(f"Could not find complete z.object body for {export_name}")


def _extract_top_level_properties(zod_body: str) -> dict[str, str]:
    properties: dict[str, str] = {}
    for line in zod_body.splitlines():
        match = re.match(r"\s{2}([A-Za-z_][A-Za-z0-9_]*):\s*(.+?)(?:,)?\s*$", line)
        if match:
            properties[match.group(1)] = match.group(2)
    return properties


def _extract_enum_values(source: str, export_name: str) -> list[str]:
    match = re.search(
        rf"export const {re.escape(export_name)} = z\.enum\(\[([^\]]+)\]\)",
        source,
        flags=re.MULTILINE,
    )
    if not match:
        raise AssertionError(f"Could not find z.enum for {export_name}")
    return re.findall(r"'([^']+)'", match.group(1))


def _json_schema_enum(schema_fragment: dict[str, Any]) -> list[str]:
    if "enum" in schema_fragment:
        return schema_fragment["enum"]
    for item in schema_fragment.get("anyOf", []):
        if "enum" in item:
            return item["enum"]
    raise AssertionError(f"No enum found in schema fragment: {schema_fragment}")


def test_worker_invoice_line_fields_are_accepted_by_ts_contract() -> None:
    """Worker output must remain parseable by the TS web/contracts schema."""
    py_schema = InvoiceLine.model_json_schema()
    ts_source = TS_CONTRACT.read_text(encoding="utf-8")
    ts_properties = _extract_top_level_properties(
        _extract_zod_object_body(ts_source, "InvoiceLineSchema")
    )

    missing = sorted(set(py_schema["properties"]) - set(ts_properties))

    assert py_schema["additionalProperties"] is False
    assert missing == []


def test_worker_invoice_line_required_fields_stay_required_in_ts_contract() -> None:
    py_required = set(InvoiceLine.model_json_schema()["required"])
    ts_source = TS_CONTRACT.read_text(encoding="utf-8")
    ts_properties = _extract_top_level_properties(
        _extract_zod_object_body(ts_source, "InvoiceLineSchema")
    )

    loosened = sorted(
        field
        for field in py_required
        if ".nullish()" in ts_properties[field] or ".optional()" in ts_properties[field]
    )

    assert py_required == {"line_id", "description", "currency", "amount"}
    assert loosened == []


def test_worker_invoice_line_enums_match_ts_contract() -> None:
    py_properties = InvoiceLine.model_json_schema()["properties"]
    ts_source = TS_CONTRACT.read_text(encoding="utf-8")

    assert _json_schema_enum(py_properties["currency"]) == _extract_enum_values(
        ts_source, "CurrencySchema"
    )
    assert _json_schema_enum(py_properties["rate_basis"]) == _extract_enum_values(
        ts_source, "RateBasisSchema"
    )

    inline_enum_expectations = {
        "numeric_integrity_status": ["PASS", "AMBER"],
        "rate_source_candidate": ["CONTRACT", "AT_COST", "DSV_HANDLING", "UNKNOWN"],
    }
    for field, expected in inline_enum_expectations.items():
        assert _json_schema_enum(py_properties[field]) == expected
        for value in expected:
            assert value in ts_source


def test_shared_worker_invoice_line_fixture_matches_python_contract() -> None:
    fixture = WORKER_FIXTURE.read_text(encoding="utf-8")
    line = InvoiceLine.model_validate_json(fixture)

    assert set(line.model_dump().keys()) == set(InvoiceLine.model_json_schema()["properties"])
    assert line.line_id == "l1"
    assert line.currency == "AED"
