#!/usr/bin/env python3
"""Generate unified diff for the 2026-06-13 TYPE-B fix.
Uses difflib to produce a real patch (not a hand-crafted git-format)."""
import difflib
from pathlib import Path

root = Path('.')

# (label, bak_path, cur_path, context_lines)
files = [
    ('scripts/golden_case_runner.py',
     'scripts/golden_case_runner.py.bak',
     'scripts/golden_case_runner.py'),
    ('scripts/package_self_check.py',
     'scripts/package_self_check.py.bak',
     'scripts/package_self_check.py'),
    ('tests/golden_cases/core_cases.jsonl',
     'tests/golden_cases/core_cases.jsonl.bak',
     'tests/golden_cases/core_cases.jsonl'),
]

header = """# Auto-generated patch — applied 2026-06-13
# Fix: TYPE-B classifier 11 missing keywords + 14 broken-path golden cases
#      + package_self_check __pycache__ rglob fix
# Apply (after 'cd shpiment'):
#   git init && git add . && git commit -m "baseline"
#   git apply PATCHES/20260613_TYPEB_FIX.patch
#   git add -A && git commit -m "fix(shpiment): TYPE-B classifier 11 keywords + 14 broken-path golden cases"
# Or (non-git):
#   patch -p1 < PATCHES/20260613_TYPEB_FIX.patch
# Backups retained at: scripts/*.bak, tests/golden_cases/*.bak
"""

parts = [header, '']
for label, bak_rel, cur_rel in files:
    bak_text = (root / bak_rel).read_text(encoding='utf-8').splitlines(keepends=True)
    cur_text = (root / cur_rel).read_text(encoding='utf-8').splitlines(keepends=True)
    diff = list(difflib.unified_diff(
        bak_text, cur_text,
        fromfile=f'a/{label}', tofile=f'b/{label}', n=3
    ))
    if not diff:
        continue
    # Prepend git-format header (diff --git a/... b/...) for git apply compatibility
    parts.append(f'diff --git a/{label} b/{label}')
    parts.extend(diff)
    parts.append('')

patch_path = root / 'PATCHES' / '20260613_TYPEB_FIX.patch'
patch_path.write_text('\n'.join(parts), encoding='utf-8')

# Stats
total_added = sum(1 for ln in '\n'.join(parts).splitlines() if ln.startswith('+') and not ln.startswith('+++'))
total_removed = sum(1 for ln in '\n'.join(parts).splitlines() if ln.startswith('-') and not ln.startswith('---'))
print(f'Patch: {patch_path}  ({patch_path.stat().st_size} bytes)')
print(f'Stats: +{total_added} -{total_removed} lines across {len(files)} files')
