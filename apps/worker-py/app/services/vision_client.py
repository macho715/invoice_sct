"""Google Vision API client for async PDF/TIFF OCR on Google Cloud Storage."""
from __future__ import annotations
import json
import os
from typing import Any, Optional


def _bool_env(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _parse_gcs_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("gs://"):
        raise ValueError("GCS_URI_REQUIRED")
    path = uri[5:]
    bucket, sep, prefix = path.partition("/")
    if not bucket or not sep:
        raise ValueError("GCS_URI_REQUIRED")
    return bucket, prefix

class VisionClient:
    """Google Vision async document text detection client."""
    
    def __init__(self, project_id: Optional[str] = None):
        self.project_id = project_id or os.environ.get('GOOGLE_CLOUD_PROJECT', '')
        self.enabled = _bool_env("VISION_ENABLED", False)
        self.feature_type = 'DOCUMENT_TEXT_DETECTION'  # fixed: PDF/TIFF OCR only
        self.batch_size = _int_env("VISION_BATCH_SIZE", 1)
        self.mime_type = os.environ.get("VISION_MIME_TYPE", "application/pdf")
        self.api_endpoint = os.environ.get("VISION_API_ENDPOINT")
        self._client = None
        self._storage_client = None
        self._import_error: Optional[str] = None
        if not self.enabled:
            return
        try:
            from google.cloud import vision
            from google.cloud import storage

            client_options = {"api_endpoint": self.api_endpoint} if self.api_endpoint else None
            self._vision = vision
            self._client = vision.ImageAnnotatorClient(client_options=client_options)
            self._storage_client = storage.Client(project=self.project_id or None)
        except ImportError as e:
            self._import_error = str(e)
        except Exception as e:
            self._import_error = type(e).__name__
    
    @property
    def available(self) -> bool:
        return self.enabled and self._client is not None and self._storage_client is not None

    @property
    def unavailable_reason(self) -> str:
        if not self.enabled:
            return "VISION_FEATURE_FLAG_OFF"
        if self._import_error:
            return "GOOGLE_CLOUD_VISION_NOT_INSTALLED"
        return "GOOGLE_CLOUD_VISION_UNAVAILABLE"
    
    def start_async_text_detection(self, source_gcs_uri: str, output_gcs_prefix: str) -> dict:
        """Start async PDF text detection. Returns operation metadata."""
        if not self.available:
            return {"status": "VISION_DISABLED", "error_code": self.unavailable_reason}
        try:
            _parse_gcs_uri(source_gcs_uri)
            _parse_gcs_uri(output_gcs_prefix)

            gcs_source = self._vision.GcsSource(uri=source_gcs_uri)
            input_config = self._vision.InputConfig(gcs_source=gcs_source, mime_type=self.mime_type)
            feature = self._vision.Feature(type_=getattr(self._vision.Feature.Type, self.feature_type))
            gcs_destination = self._vision.GcsDestination(uri=output_gcs_prefix)
            output_config = self._vision.OutputConfig(
                gcs_destination=gcs_destination,
                batch_size=self.batch_size,
            )
            request = self._vision.AsyncAnnotateFileRequest(
                features=[feature],
                input_config=input_config,
                output_config=output_config,
            )
            operation = self._client.async_batch_annotate_files(requests=[request])
            operation_name = self._operation_name(operation)
            return {
                "status": "STARTED",
                "operation_name": operation_name,
                "output_gcs_prefix": output_gcs_prefix,
            }
        except ValueError as e:
            return {"status": "VISION_DISABLED", "error_code": str(e)}
        except Exception as e:
            return {"status": "VISION_DISABLED", "error_code": type(e).__name__}
    
    def get_operation_status(self, operation_name: str) -> dict:
        """Poll async operation status."""
        if not self.available:
            return {"status": "VISION_DISABLED", "error_code": self.unavailable_reason}
        try:
            operations_client = self._client.transport.operations_client
            operation = operations_client.get_operation(operation_name)
            output_gcs_prefix = self._output_prefix_from_operation(operation)
            return {
                "status": "DONE" if getattr(operation, "done", False) else "RUNNING",
                "operation_name": operation_name,
                "output_gcs_prefix": output_gcs_prefix,
            }
        except Exception as e:
            return {"status": "VISION_DISABLED", "error_code": type(e).__name__}
    
    def collect_result(self, output_gcs_prefix: str) -> dict:
        """Collect OCR results from GCS output."""
        if not self.available:
            return {"status": "VISION_DISABLED", "error_code": self.unavailable_reason}
        try:
            bucket_name, prefix = _parse_gcs_uri(output_gcs_prefix)
            bucket = self._storage_client.bucket(bucket_name)
            blobs = sorted(
                bucket.list_blobs(prefix=prefix),
                key=lambda b: b.name,
            )
            json_blobs = [b for b in blobs if b.name.endswith(".json")]
            if not json_blobs:
                return {"status": "VISION_OUTPUT_NOT_FOUND", "output_gcs_prefix": output_gcs_prefix}

            responses: list[dict[str, Any]] = []
            output_uris: list[str] = []
            for blob in json_blobs:
                payload = json.loads(blob.download_as_text(encoding="utf-8"))
                output_uris.append(f"gs://{bucket_name}/{blob.name}")
                responses.extend(payload.get("responses", []))

            confidence = self._average_confidence(responses)
            return {
                "status": "COLLECTED",
                "ocr_json_gcs_uri": output_uris[0],
                "ocr_json_gcs_uris": output_uris,
                "page_count": len(responses),
                "confidence": confidence,
                "responses": responses,
            }
        except ValueError as e:
            return {"status": "VISION_DISABLED", "error_code": str(e)}
        except Exception as e:
            return {"status": "VISION_DISABLED", "error_code": type(e).__name__}

    @staticmethod
    def _operation_name(operation: Any) -> Optional[str]:
        nested = getattr(operation, "operation", None)
        if nested is not None and getattr(nested, "name", None):
            return nested.name
        return getattr(operation, "name", None)

    @staticmethod
    def _output_prefix_from_operation(operation: Any) -> Optional[str]:
        try:
            from google.protobuf.json_format import MessageToDict

            op_dict = MessageToDict(operation)
            responses = op_dict.get("response", {}).get("responses", [])
            for item in responses:
                uri = item.get("outputConfig", {}).get("gcsDestination", {}).get("uri")
                if uri:
                    return uri
        except Exception:
            pass

        response = getattr(operation, "response", None)
        if response is None:
            return None
        responses = getattr(response, "responses", None) or []
        for item in responses:
            output_config = getattr(item, "output_config", None)
            destination = getattr(output_config, "gcs_destination", None) if output_config else None
            uri = getattr(destination, "uri", None) if destination else None
            if uri:
                return uri
        return None

    @staticmethod
    def _average_confidence(responses: list[dict[str, Any]]) -> float:
        confidences: list[float] = []
        for response in responses:
            pages = response.get("fullTextAnnotation", {}).get("pages", [])
            for page in pages:
                if isinstance(page.get("confidence"), (int, float)):
                    confidences.append(float(page["confidence"]))
                for block in page.get("blocks", []):
                    for paragraph in block.get("paragraphs", []):
                        for word in paragraph.get("words", []):
                            if isinstance(word.get("confidence"), (int, float)):
                                confidences.append(float(word["confidence"]))
        if not confidences:
            return 0.0
        return sum(confidences) / len(confidences)
