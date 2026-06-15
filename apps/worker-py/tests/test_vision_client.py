from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.vision_client import VisionClient


class _FakeVisionModule:
    class Feature:
        class Type:
            DOCUMENT_TEXT_DETECTION = "DOCUMENT_TEXT_DETECTION"

        def __init__(self, type_):
            self.type_ = type_

    class GcsSource:
        def __init__(self, uri):
            self.uri = uri

    class InputConfig:
        def __init__(self, gcs_source, mime_type):
            self.gcs_source = gcs_source
            self.mime_type = mime_type

    class GcsDestination:
        def __init__(self, uri):
            self.uri = uri

    class OutputConfig:
        def __init__(self, gcs_destination, batch_size):
            self.gcs_destination = gcs_destination
            self.batch_size = batch_size

    class AsyncAnnotateFileRequest:
        def __init__(self, features, input_config, output_config):
            self.features = features
            self.input_config = input_config
            self.output_config = output_config


class _FakeVisionApiClient:
    def __init__(self):
        self.requests = None
        self.transport = SimpleNamespace(
            operations_client=SimpleNamespace(get_operation=self.get_operation)
        )

    def async_batch_annotate_files(self, requests):
        self.requests = requests
        return SimpleNamespace(operation=SimpleNamespace(name="operations/op-123"))

    def get_operation(self, operation_name):
        destination = SimpleNamespace(uri="gs://ocr-bucket/out/job/file/")
        output_config = SimpleNamespace(gcs_destination=destination)
        response_item = SimpleNamespace(output_config=output_config)
        response = SimpleNamespace(responses=[response_item])
        return SimpleNamespace(name=operation_name, done=True, response=response)


class _FakeBlob:
    def __init__(self, name, payload):
        self.name = name
        self.payload = payload

    def download_as_text(self, encoding="utf-8"):
        assert encoding == "utf-8"
        return self.payload


class _FakeBucket:
    def list_blobs(self, prefix):
        assert prefix == "out/job/file/"
        return [
            _FakeBlob(
                "out/job/file/output-1-to-1.json",
                """
                {
                  "responses": [
                    {
                      "fullTextAnnotation": {
                        "pages": [
                          {
                            "blocks": [
                              {
                                "paragraphs": [
                                  {
                                    "words": [
                                      {"confidence": 0.9},
                                      {"confidence": 0.7}
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    }
                  ]
                }
                """,
            )
        ]


class _FakeStorageClient:
    def bucket(self, bucket_name):
        assert bucket_name == "ocr-bucket"
        return _FakeBucket()


def _connected_client() -> tuple[VisionClient, _FakeVisionApiClient]:
    client = VisionClient.__new__(VisionClient)
    client.project_id = "project"
    client.enabled = True
    client.feature_type = "DOCUMENT_TEXT_DETECTION"
    client.batch_size = 1
    client.mime_type = "application/pdf"
    client.api_endpoint = None
    client._vision = _FakeVisionModule
    client._client = _FakeVisionApiClient()
    client._storage_client = _FakeStorageClient()
    client._import_error = None
    return client, client._client


def test_start_async_text_detection_builds_vision_request():
    client, fake_api = _connected_client()

    result = client.start_async_text_detection(
        "gs://source-bucket/invoice.pdf",
        "gs://ocr-bucket/out/job/file/",
    )

    assert result == {
        "status": "STARTED",
        "operation_name": "operations/op-123",
        "output_gcs_prefix": "gs://ocr-bucket/out/job/file/",
    }
    request = fake_api.requests[0]
    assert request.input_config.gcs_source.uri == "gs://source-bucket/invoice.pdf"
    assert request.input_config.mime_type == "application/pdf"
    assert request.output_config.gcs_destination.uri == "gs://ocr-bucket/out/job/file/"
    assert request.output_config.batch_size == 1


def test_start_async_text_detection_requires_gcs_uri():
    client, _ = _connected_client()

    result = client.start_async_text_detection(
        "https://example.com/invoice.pdf",
        "gs://ocr-bucket/out/job/file/",
    )

    assert result["status"] == "VISION_DISABLED"
    assert result["error_code"] == "GCS_URI_REQUIRED"


def test_get_operation_status_returns_output_prefix_when_done():
    client, _ = _connected_client()

    result = client.get_operation_status("operations/op-123")

    assert result["status"] == "DONE"
    assert result["operation_name"] == "operations/op-123"
    assert result["output_gcs_prefix"] == "gs://ocr-bucket/out/job/file/"


def test_collect_result_downloads_output_json_and_averages_confidence():
    client, _ = _connected_client()

    result = client.collect_result("gs://ocr-bucket/out/job/file/")

    assert result["status"] == "COLLECTED"
    assert result["ocr_json_gcs_uri"] == "gs://ocr-bucket/out/job/file/output-1-to-1.json"
    assert result["ocr_json_gcs_uris"] == ["gs://ocr-bucket/out/job/file/output-1-to-1.json"]
    assert result["page_count"] == 1
    assert result["confidence"] == pytest.approx(0.8)

