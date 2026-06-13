# apps/worker-py/tests/test_md_parser.py
from app.parsers.md import parse_md_bytes

def test_extracts_evidence_candidate_with_reference():
    md = "# BL-12345\nSome note about shipment HVDC-AGI-001 delivered on 2026-04-01.\n"
    ni = parse_md_bytes(md.encode(), file_id='f1', file_name='note.md', parser_version='parser-0.1.0')
    assert ni.invoice_lines == []
    assert len(ni.evidence_candidates) >= 1
    assert any('HVDC-AGI-001' in (e.matched_reference or '') for e in ni.evidence_candidates)
    assert ni.evidence_candidates[0].confidence > 0.5

def test_low_confidence_when_no_reference_found():
    md = "Just a random note with no shipment ref."
    ni = parse_md_bytes(md.encode(), file_id='f1', file_name='note.md', parser_version='parser-0.1.0')
    assert all(e.confidence < 0.5 for e in ni.evidence_candidates)
