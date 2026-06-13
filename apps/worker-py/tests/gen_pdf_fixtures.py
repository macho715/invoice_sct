"""Generate 5 text-based invoice PDF fixtures for P3A (plan §4).

Run: python -m tests.gen_pdf_fixtures  (or python tests/gen_pdf_fixtures.py)
Uses fpdf2 (installed on demand for generation only; not added to pyproject).
Produces tests/fixtures/text-pdf-00N.pdf with invoice text, tables, refs, amounts.
One low-text sample for SCANNED / low-conf AMBER path.
"""
from __future__ import annotations
import os
import subprocess
import sys
from pathlib import Path

def ensure_fpdf2():
    try:
        import fpdf  # fpdf2 provides fpdf
        return
    except Exception:
        pass
    print("Installing fpdf2 (ephemeral, for fixture generation only)...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "fpdf2", "--quiet", "--disable-pip-version-check"])
    print("fpdf2 ready.")

def main():
    ensure_fpdf2()
    from fpdf import FPDF

    outdir = Path(__file__).parent / "fixtures"
    outdir.mkdir(parents=True, exist_ok=True)

    samples = [
        ("text-pdf-001.pdf", "INV-2026-001", "Acme Logistics", "2026-06-09",
         [("Trucking to site", 2, 1200.0, 2400.0, "AED"), ("Handling", 1, 350.0, 350.0, "AED")],
         "Total due: 2750.00 AED  Ref: HVDC-LOG-991"),
        ("text-pdf-002.pdf", "INV-2026-002", "Port Services Ltd", "2026-06-08",
         [("THC", 4, 75.5, 302.0, "AED"), ("Storage 3 days", 3, 50.0, 150.0, "USD")],
         "Invoice total 452.00  BL-99821"),
        ("text-pdf-003.pdf", "INV-2026-003", "Marine Supply Co", "2026-06-10",
         [("Lashing materials", 10, 18.5, 185.0, "AED")],
         "AMOUNT 185.00  PO-4401"),
        ("text-pdf-004.pdf", "INV-2026-004", "Heavy Haul Co", "2026-06-07",
         [("Oversize transport", 1, 4500.0, 4500.0, "AED"), ("Pilot car", 1, 800.0, 800.0, "AED")],
         "Grand total 5300.00"),
        ("text-pdf-005.pdf", "INV-2026-005", "Scan Sample Corp", "2026-06-11",
         [],  # low text -> SCANNED_PAGE_DETECTED / low conf
         "This page contains minimal selectable text (image heavy). DO-551"),
    ]

    for fname, inv, vendor, dt, lines, footer in samples:
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Helvetica", size=14)
        pdf.cell(0, 10, f"INVOICE {inv}", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", size=11)
        pdf.cell(0, 8, f"Vendor: {vendor}", new_x="LMARGIN", new_y="NEXT")
        pdf.cell(0, 8, f"Date: {dt}", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(4)
        if lines:
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(80, 7, "Description", border=1)
            pdf.cell(20, 7, "Qty", border=1)
            pdf.cell(30, 7, "Rate", border=1)
            pdf.cell(30, 7, "Amount", border=1, new_x="LMARGIN", new_y="NEXT")
            pdf.set_font("Helvetica", size=10)
            for desc, q, r, a, c in lines:
                pdf.cell(80, 7, desc, border=1)
                pdf.cell(20, 7, str(q), border=1)
                pdf.cell(30, 7, f"{r:.2f}", border=1)
                pdf.cell(30, 7, f"{a:.2f}", border=1, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(6)
        pdf.set_font("Helvetica", size=11)
        pdf.multi_cell(0, 6, footer)
        if "Scan Sample" in vendor:
            pdf.ln(18)
            pdf.set_font("Helvetica", size=9)
            pdf.cell(0, 6, "(scanned image area - minimal selectable text for AMBER test)", new_x="LMARGIN", new_y="NEXT")
        pdf.output(str(outdir / fname))
        print("created", fname)

    print("All 5 P3A fixtures ready in", outdir)

if __name__ == "__main__":
    main()
