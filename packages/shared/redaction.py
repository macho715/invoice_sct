"""P2 / DLP redaction utilities for HVDC Invoice Audit Platform.

Implements the ``**[REDACTED-{TYPE}]**`` masking format specified in CLAUDE.md.
All P2 (sensitive) values — raw contract rates, TRN, BOE, BL numbers, container
numbers, PII, API keys, etc. — must be replaced with this token before being
sent to LLM prompts, logs, or any public output channel.

Format: literal double-asterisks at both ends, with the type label uppercased,
e.g. ``raw rate 123.45`` -> ``**[REDACTED-RATE]**.

Public API:
    - ``REDACTION_FORMAT``: canonical format string template.
    - ``REDACTED_PREFIX`` / ``REDACTED_SUFFIX``: literal markers.
    - ``P2_FIELDS``: frozenset of field names recognised as P2 data.
    - ``redact(value, type)``: replace a value with the redaction token.
    - ``mask_p2_value(value, p2_type)``: alias matching the DLP docs.
    - ``redact_dict(d, keys_to_redact, type_label)``: immutable dict redaction.
    - ``is_p2_field(name)``: check if a field name indicates P2 data.
    - ``is_redacted(value)``: check if a string is a redaction token.
"""

from __future__ import annotations

from typing import Final, Iterable, Mapping

__all__ = [
    "REDACTION_FORMAT",
    "REDACTED_PREFIX",
    "REDACTED_SUFFIX",
    "P2_FIELDS",
    "redact",
    "mask_p2_value",
    "redact_dict",
    "is_p2_field",
    "is_redacted",
]


REDACTED_PREFIX: Final[str] = "**"
REDACTED_SUFFIX: Final[str] = "**"

# Canonical redaction token. Used in logging / audit messages verbatim.
REDACTION_FORMAT: Final[str] = f"{REDACTED_PREFIX}[REDACTED-{{type}}]{REDACTED_SUFFIX}"


# Field names that identify P2 (sensitive) data. Compared case-insensitively.
P2_FIELDS: Final[frozenset[str]] = frozenset(
    {
        # Contract / financial
        "rate",
        "rate_usd",
        "rate_aed",
        "amount",
        "internal_amount",
        "raw_rate",
        "unit_rate",
        # Tax / customs
        "trn",
        "boe",
        "vat",
        # Shipment identifiers
        "bl_no",
        "container_no",
        "shipment_no",
        # Contact / PII
        "email",
        "phone",
        "vendor_email",
        "vendor_phone",
        "name",
        "national_id",
        "ssn",
        "pii",
        # Credentials
        "api_key",
        "token",
        "password",
        "credential",
        "secret",
    }
)


def redact(value: str, type: str) -> str:
    """Replace ``value`` with the ``**[REDACTED-{TYPE}]**`` token.

    The ``value`` argument is intentionally ignored to avoid accidental leaks
    in stack traces or logging. The ``type`` is uppercased to keep the
    canonical format consistent.

    Args:
        value: Original sensitive value (discarded).
        type: P2 category label (e.g. ``"RATE"``, ``"TRN"``, ``"BL"``).

    Returns:
        The redaction token string, e.g. ``"**[REDACTED-RATE]**"``.
    """
    del value  # never echo the raw value back
    return f"{REDACTED_PREFIX}[REDACTED-{type.upper()}]{REDACTED_SUFFIX}"


def mask_p2_value(value: str, p2_type: str) -> str:
    """Mask a P2 value using the ``**[REDACTED-{TYPE}]**`` format.

    This is the canonical entry point described in the project's DLP docs.
    Equivalent to :func:`redact` — provided as a separate name so call sites
    read clearly at the DLP boundary.

    Args:
        value: Original sensitive value (discarded).
        p2_type: P2 category label.

    Returns:
        The redaction token string.
    """
    return redact(value, p2_type)


def redact_dict(
    d: Mapping[str, str],
    keys_to_redact: Iterable[str],
    type_label: str = "FIELD",
) -> dict:
    """Return a new dict with selected keys replaced by redaction tokens.

    The input mapping is **not mutated** (immutability rule). Keys not in
    ``keys_to_redact`` are passed through unchanged. Non-string values for
    redacted keys are coerced via ``str()`` before masking.

    Args:
        d: Source mapping (not modified).
        keys_to_redact: Keys whose values must be masked.
        type_label: P2 label applied to every redacted value.

    Returns:
        A new ``dict`` with redactions applied.
    """
    targets = set(keys_to_redact)
    out: dict = {}
    for key, value in d.items():
        if key in targets:
            raw = value if isinstance(value, str) else str(value)
            out[key] = mask_p2_value(raw, type_label)
        else:
            out[key] = value
    return out


def is_p2_field(name: str) -> bool:
    """Return ``True`` if ``name`` matches a known P2 (sensitive) field.

    The comparison is case-insensitive and trims surrounding whitespace so
    that headers like ``" Rate "`` or ``"RATE_USD"`` are still detected.

    Args:
        name: Field name to test.

    Returns:
        ``True`` when the name is in :data:`P2_FIELDS`.
    """
    return name.strip().lower() in P2_FIELDS


def is_redacted(value: str) -> bool:
    """Return ``True`` if ``value`` is a redaction token of the canonical form.

    Useful for asserting that a downstream consumer did not un-mask data
    accidentally.

    Args:
        value: String to test.

    Returns:
        ``True`` if it matches ``**[REDACTED-TYPE]**`` with TYPE uppercased.
    """
    import re

    return bool(re.fullmatch(r"\*\*\[REDACTED-[A-Z0-9_]+\]\*\*", value or ""))
