import pytest
from app.notebooklm.extractor import strip_notebooklm_markers, extract_json, parse_extraction


class TestStripNotebookLmMarkers:
    def test_strips_code_fences(self):
        raw = "```json\n{\"doc_kind\": \"INVOICE\"}\n```"
        assert "```" not in strip_notebooklm_markers(raw)
    
    def test_strips_ai_generated_prefix(self):
        raw = "[AI-GENERATED] Some text here"
        result = strip_notebooklm_markers(raw)
        assert "[AI-GENERATED]" not in result
    
    def test_preserves_plain_json(self):
        raw = '{"doc_kind": "INVOICE"}'
        assert strip_notebooklm_markers(raw) == raw
    
    def test_strips_prose_around_json(self):
        raw = "Here is the JSON: {\"doc_kind\": \"INVOICE\"} Hope that helps!"
        result = strip_notebooklm_markers(raw)
        # Should still be extractable
        assert extract_json(result) is not None


class TestExtractJson:
    def test_parses_pure_json(self):
        assert extract_json('{"doc_kind": "INVOICE"}') == {"doc_kind": "INVOICE"}
    
    def test_parses_json_with_surrounding_text(self):
        raw = 'Some prose {\"doc_kind\": \"INVOICE\", \"amount\": 100} more text'
        result = extract_json(raw)
        assert result is not None
        assert result["doc_kind"] == "INVOICE"
    
    def test_returns_none_for_invalid(self):
        assert extract_json("not json at all") is None
        assert extract_json("") is None


class TestParseExtraction:
    def test_fenced_json(self):
        raw = "```json\n{\"doc_kind\": \"INVOICE\", \"fields\": {\"invoice_no\": \"INV-1\"}, \"confidence\": 0.9}\n```"
        result = parse_extraction(raw)
        assert result["doc_kind"] == "INVOICE"
        assert result["confidence"] == 0.9
        assert "JSON_PARSE_FAILED" not in result.get("flags", [])
    
    def test_ai_generated_prefix(self):
        raw = "[AI-GENERATED] {\"doc_kind\": \"DSV_WAYBILL\", \"confidence\": 0.85}"
        result = parse_extraction(raw)
        assert result["doc_kind"] == "DSV_WAYBILL"
    
    def test_prose_wrapped_json(self):
        raw = "Here is the extraction result: {\"doc_kind\": \"INVOICE\", \"confidence\": 0.7} That should be it."
        result = parse_extraction(raw)
        assert result["doc_kind"] == "INVOICE"
    
    def test_invalid_text_returns_low_confidence_stub(self):
        raw = "This is not JSON at all, just prose without any structured data"
        result = parse_extraction(raw)
        assert result["doc_kind"] == "UNKNOWN"
        assert result["confidence"] == 0.0
        assert "JSON_PARSE_FAILED" in result.get("flags", [])
    
    def test_empty_string_returns_stub(self):
        result = parse_extraction("")
        assert result["doc_kind"] == "UNKNOWN"
        assert "JSON_PARSE_FAILED" in result.get("flags", [])
    
    def test_stub_has_all_required_fields(self):
        result = parse_extraction("not json")
        assert "fields" in result
        assert "lane" in result
        assert "amounts" in result
        assert "shipment_ids" in result
        assert "document_numbers" in result
        assert "evidence" in result
