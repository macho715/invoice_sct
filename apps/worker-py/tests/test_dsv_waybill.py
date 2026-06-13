from pathlib import Path
import pytest
from app.parsers.dsv_waybill import is_dsv_waybill_text, parse_dsv_waybill_from_text
from app.parsers.dsv_waybill import _lane_norm, _is_valid_location, _norm_text

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"

@pytest.fixture
def dsv_waybill_text():
    p = FIXTURE_DIR / "dsv-waybill-001.txt"
    return p.read_text(encoding="utf-8")


class TestIsDsvWaybillText:
    def test_returns_true_for_dsv_fixture(self, dsv_waybill_text):
        assert is_dsv_waybill_text(dsv_waybill_text) is True

    def test_returns_false_for_plain_text(self):
        assert is_dsv_waybill_text("This is a regular invoice") is False


class TestLaneNorm:
    def test_normalizes_mosb(self):
        assert _lane_norm("mosb") == "MOSB_YARD"

    def test_normalizes_mirfa_site(self):
        assert _lane_norm("mirfa site") == "MIRFA_SITE"

    def test_normalizes_shuweihat(self):
        assert _lane_norm("shuweihat") == "SHUWEIHAT_SITE"

    def test_normalizes_khalifa_port(self):
        assert _lane_norm("khalifa port") == "KHALIFA_PORT"

    def test_normalizes_mina_zayed(self):
        assert _lane_norm("mina zayed") == "MINA_ZAYED_PORT"

    def test_normalizes_jebel_ali(self):
        assert _lane_norm("jebel ali") == "JEBEL_ALI_PORT"

    def test_passes_through_unknown(self):
        assert _lane_norm("unknown place") == "unknown place"


class TestIsValidLocation:
    @pytest.mark.parametrize("loc", [
        "DSV Mussafah Yard",
        "Mirfa Site UAE",
        "M44 Warehouse",
    ])
    def test_returns_true_for_valid_locations(self, loc):
        assert _is_valid_location(loc) is True

    @pytest.mark.parametrize("loc", [
        "Head Plate ABC",
        "Customer Name & Address",
        "Terms and Conditions",
    ])
    def test_returns_false_for_invalid_strings(self, loc):
        assert _is_valid_location(loc) is False


class TestParseDsvWaybillFromText:
    @pytest.fixture
    def result(self, dsv_waybill_text):
        return parse_dsv_waybill_from_text(dsv_waybill_text)

    def test_doc_kind_is_dsv_waybill(self, result):
        assert result.doc_kind == "DSV_WAYBILL"

    def test_extracts_waybill_no(self, result):
        assert result.waybill_no == "0126-04466AUH"

    def test_extracts_trip_no(self, result):
        assert result.trip_no == "TRIP-2026-0445"

    def test_extracts_order_no(self, result):
        assert result.order_no == "0126-04466AUH"

    def test_extracts_job_no(self, result):
        assert result.job_no == "HVDC-DSV-HE-MOSB-335"

    def test_extracts_po_no(self, result):
        assert result.po_no == "PO-2026-001234"

    def test_origin_norm_matches_expected(self, result):
        actual = result.origin_norm.upper()
        assert "DSV MUSSAFAH YARD" in actual or "MOSB_YARD" in actual

    def test_destination_norm_contains_mirfa(self, result):
        assert "mirfa" in result.destination_norm.lower()

    def test_timeline_loading_finish_dt_not_none(self, result):
        assert result.loading_finish_dt is not None

    def test_confidence_above_threshold(self, result):
        assert result.confidence > 0.5


class TestNormText:
    def test_collapses_whitespace(self):
        assert _norm_text("  hello    world  ") == "hello world"

    def test_lowercases(self):
        assert _norm_text("DSV SOLUTIONS") == "dsv solutions"

    def test_handles_newlines_and_tabs(self):
        assert _norm_text("\tONE\n\tTWO  \n") == "one two"
