EXTRACTION_PROMPT = """Extract the invoice or DSV waybill fields from this Markdown source.
Return JSON only. Do not include prose, markdown fences, comments, or explanations.
Do not invent values. Use null when a value is not present.
For every non-null field, include an evidence quote from the source text.

Required JSON shape:
{
  "doc_kind": "DSV_WAYBILL|INVOICE|UNKNOWN",
  "fields": {
    "invoice_no": null,
    "waybill_no": null,
    "do_no": null,
    "order_no": null,
    "job_no": null,
    "po_no": null,
    "bol_no": null,
    "trip_no": null,
    "loading_address": null,
    "destination": null,
    "origin_norm": null,
    "destination_norm": null,
    "amount": null,
    "currency": null
  },
  "lane": {
    "origin_raw": null,
    "destination_raw": null
  },
  "amounts": [],
  "shipment_ids": [],
  "document_numbers": [],
  "confidence": 0.0,
  "flags": [],
  "evidence": [
    {
      "field": null,
      "value": null,
      "quote": null
    }
  ]
}"""
