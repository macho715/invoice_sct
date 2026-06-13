"""Compatibility module for release-gate startup imports.

The parser dispatch endpoint lives in app.routes.parse.  The release gate
imports app.parsers.parse as a smoke test, so this module keeps that import
stable without moving the route implementation.
"""

from app.routes.parse import parse

__all__ = ["parse"]
