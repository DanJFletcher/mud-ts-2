#!/usr/bin/env python3
"""Read-only validator for simple Markdown wiki content.

Usage:
    python path/to/validate_wiki.py docs/wiki

Default when no argument is given: ../examples/wiki relative to this script.
This checks only structural hygiene. It does not know actual MUDD canon or access controls.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

REQUIRED_FIELDS = ("id", "title", "category", "canon_status", "visibility", "aliases", "era", "source_refs")
CATEGORIES = {"place", "person", "faction", "culture", "history", "belief", "object", "species", "index"}
CANON = {"draft", "approved", "deprecated"}
VISIBILITY = {"public", "restricted", "private"}
LINK_RE = re.compile(r"(?<!!)\[[^\]\n]+\]\((?:<([^>]+)>|([^\)]+))\)")
BAD_HEADINGS_RE = re.compile(
    r"^#{1,6}\s+(?:quest(?:\s|s\b)|objectives?\b|quest\s+rewards?\b|"
    r"combat(?:\s|\b)|gameplay\b|mechanics?\b|stat\s*blocks?\b|"
    r"encounters?\b|game\s+master\s+notes\b)", re.IGNORECASE | re.MULTILINE
)
BAD_PROSE = [
    (re.compile(r"\b(?:players? must|gain \d+ xp|quest rewards?|hit points?)\b", re.I),
     "possible gameplay/quest instructions"),
    (re.compile(r"\b(?:DC|CR)\s*\d+\b|\b\d+d(?:4|6|8|10|12|20)\b", re.I),
     "possible game rules/statistics"),
]


def parse_frontmatter(path: Path, body: str) -> tuple[dict[str, str], str, list[str]]:
    errors: list[str] = []
    lines = body.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, body, ["missing YAML-style frontmatter opener"]
    try:
        stop = next(i for i, line in enumerate(lines[1:], start=1) if line.strip() == "---")
    except StopIteration:
        return {}, body, ["frontmatter missing closing ---"]
    metadata: dict[str, str] = {}
    for number, line in enumerate(lines[1:stop], start=2):
        if not line.strip() or line.lstrip().startswith("#") or line[:1].isspace():
            continue  # allow list members; YAML details are not parsed
        match = re.match(r"^([a-z][a-z0-9_]*):(?:\s*(.*))?$", line)
        if not match:
            errors.append(f"frontmatter line {number} not a simple key: value")
            continue
        key, val = match.groups()
        if key in metadata:
            errors.append(f"duplicate frontmatter key {key}")
        metadata[key] = (val or "").strip().strip('"\'')
    return metadata, "\n".join(lines[stop + 1:]), errors


def validate(root: Path) -> tuple[int, int]:
    files = sorted(root.rglob("*.md"))
    if not files:
        print(f"ERROR: no .md articles found under {root}")
        return 0, 1
    failures: list[str] = []
    warnings: list[str] = []
    found_ids: dict[str, Path] = {}
    for path in files:
        relative = path.relative_to(root)
        content = path.read_text(encoding="utf-8")
        meta, prose, front_errors = parse_frontmatter(path, content)
        failures.extend(f"{relative}: {problem}" for problem in front_errors)
        for key in REQUIRED_FIELDS:
            if key not in meta:
                failures.append(f"{relative}: missing required field: {key}")
        if not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", meta.get("id", "")):
            failures.append(f"{relative}: id must be lowercase-kebab-case")
        if meta.get("category") and meta["category"] not in CATEGORIES:
            failures.append(f"{relative}: unknown category {meta['category']!r}")
        if meta.get("canon_status") and meta["canon_status"] not in CANON:
            failures.append(f"{relative}: canon_status is not draft/approved/deprecated")
        if meta.get("visibility") and meta["visibility"] not in VISIBILITY:
            failures.append(f"{relative}: visibility is not public/restricted/private")
        doc_id = meta.get("id")
        if doc_id:
            if doc_id in found_ids:
                failures.append(f"{relative}: duplicate id {doc_id!r} also in {found_ids[doc_id].relative_to(root)}")
            found_ids[doc_id] = path
        if meta.get("title") and f"# {meta['title']}" not in prose:
            warnings.append(f"{relative}: page H1 differs from title")
        if BAD_HEADINGS_RE.search(prose):
            failures.append(f"{relative}: quest/mechanics heading found")
        for pattern, message in BAD_PROSE:
            if pattern.search(prose):
                warnings.append(f"{relative}: {message} (manual review)")
        for match in LINK_RE.finditer(prose):
            target = (match.group(1) or match.group(2) or "").strip()
            if not target or target.startswith(("#", "mailto:", "tel:")):
                continue
            if target.startswith(("http://", "https://", "data:")):
                continue
            if " " in target and not match.group(1):
                target = target.split(" ", 1)[0]  # optional Markdown link title
            url = urlsplit(target)
            if url.scheme or url.netloc:
                continue
            local = unquote(url.path)
            if not local:
                continue
            if local.startswith("/"):
                warnings.append(f"{relative}: absolute link may not be portable: {target}")
                continue
            resolved = (path.parent / local).resolve()
            if not resolved.is_file():
                failures.append(f"{relative}: broken local link: {target}")
            elif not resolved.is_relative_to(root.resolve()):
                warnings.append(f"{relative}: link leaves wiki root: {target}")
        if meta.get("visibility") in {"restricted", "private"}:
            warnings.append(f"{relative}: visibility metadata alone does not enforce access control")
    for message in warnings:
        print("WARN:", message)
    for message in failures:
        print("ERROR:", message)
    print(f"Checked {len(files)} wiki article(s): {len(failures)} error(s), {len(warnings)} warning(s).")
    return len(files), len(failures)


if __name__ == "__main__":
    wiki_dir = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "examples" / "wiki"
    if not wiki_dir.is_dir():
        sys.exit(f"ERROR: not a directory: {wiki_dir}")
    _, error_count = validate(wiki_dir)
    sys.exit(1 if error_count else 0)
