# apps/worker-py/tests/test_txt_parser.py
from app.parsers.txt import parse_txt_bytes

def test_extracts_evidence_candidate_with_bl_ref():
    txt = "DO released for BL-AUH-002. Container MSCU1234567."
    ni = parse_txt_bytes(txt.encode(), file_id='f1', file_name='do.txt', parser_version='parser-0.1.0')
    assert any('BL-AUH-002' in (e.matched_reference or '') for e in ni.evidence_candidates)

def test_empty_txt_returns_empty_evidence():
    ni = parse_txt_bytes(b'   \n\n', file_id='f1', file_name='empty.txt', parser_version='parser-0.1.0')
    assert ni.invoice_lines == []
    assert ni.evidence_candidates == []
