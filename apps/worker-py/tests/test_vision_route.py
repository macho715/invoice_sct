from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from app.routes import vision as vision_route


class _FakeVisionRouteClient:
    available = True
    unavailable_reason = ""

    def start_async_text_detection(self, source_gcs_uri: str, output_gcs_prefix: str) -> dict:
        return {
            "status": "STARTED",
            "operation_name": "operations/test-op",
            "output_gcs_prefix": output_gcs_prefix,
        }

    def get_operation_status(self, operation_name: str) -> dict:
        return {
            "status": "DONE",
            "operation_name": operation_name,
            "output_gcs_prefix": "gs://ocr-bucket/out/job/file/",
        }

    def collect_result(self, output_gcs_prefix: str) -> dict:
        return {
            "status": "COLLECTED",
            "ocr_json_gcs_uri": "gs://ocr-bucket/out/job/file/output-1-to-1.json",
            "ocr_json_gcs_uris": ["gs://ocr-bucket/out/job/file/output-1-to-1.json"],
            "page_count": 1,
            "confidence": 0.91,
            "responses": [
                {
                    "fullTextAnnotation": {
                        "text": (
                            "DELIVERY ORDER\n"
                            "D.O. NUMBER DOCHP12345678\n"
                            "Shipment HVDC-ADOPT-SCT-0124\n"
                            "Valid Date 2026-06-15"
                        ),
                        "pages": [
                            {
                                "blocks": [
                                    {
                                        "paragraphs": [
                                            {
                                                "words": [
                                                    {"confidence": 0.91},
                                                    {"confidence": 0.89},
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ],
                    }
                }
            ],
        }


class _DisabledVisionRouteClient:
    available = False
    unavailable_reason = "VISION_FEATURE_FLAG_OFF"


def test_vision_start_route_returns_operation(monkeypatch):
    monkeypatch.setattr(vision_route, "vision_client", _FakeVisionRouteClient())
    client = TestClient(create_app())

    response = client.post(
        "/v1/vision/start",
        json={
            "job_id": "job_vision",
            "file_id": "file_vision",
            "source_gcs_uri": "gs://source-bucket/invoice.pdf",
            "output_gcs_prefix": "gs://ocr-bucket/out/job/file/",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "STARTED"
    assert body["operation_name"] == "operations/test-op"
    assert body["output_gcs_prefix"] == "gs://ocr-bucket/out/job/file/"


def test_vision_collect_route_returns_dsv_parse_summary(monkeypatch):
    monkeypatch.setattr(vision_route, "vision_client", _FakeVisionRouteClient())
    client = TestClient(create_app())

    response = client.post(
        "/v1/vision/collect",
        json={
            "job_id": "job_vision",
            "file_id": "HVDC-ADOPT-SCT-0124_DO.pdf",
            "operation_name": "operations/test-op",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "COLLECTED"
    assert body["page_count"] == 1
    assert body["confidence"] == 0.91
    assert body["ocr_json_gcs_uris"] == ["gs://ocr-bucket/out/job/file/output-1-to-1.json"]
    assert body["evidence_candidate_count"] > 0
    assert body["dsv_parse_result"]["doc_type"] == "DELIVERY_ORDER"
    assert body["dsv_parse_result"]["parser_verdict"] == "PASS"
    assert body["dsv_parse_result"]["type_b"] == "DO"


def test_vision_start_route_respects_feature_flag_off(monkeypatch):
    monkeypatch.setattr(vision_route, "vision_client", _DisabledVisionRouteClient())
    client = TestClient(create_app())

    response = client.post(
        "/v1/vision/start",
        json={
            "job_id": "job_vision",
            "file_id": "file_vision",
            "source_gcs_uri": "gs://source-bucket/invoice.pdf",
            "output_gcs_prefix": "gs://ocr-bucket/out/job/file/",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "VISION_DISABLED"
    assert body["error_code"] == "VISION_FEATURE_FLAG_OFF"
