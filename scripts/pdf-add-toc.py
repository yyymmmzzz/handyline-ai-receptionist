#!/usr/bin/env python3
"""
add-toc.py — give a REFORMAT-generated HTML a visible, clickable TOC.

The default reformat template does not emit a TOC when the source markdown
has none, which leaves multi-page PDFs with zero link annotations. The PDF
skill's delivery contract requires clickable index navigation on any
multi-page output, so this post-processes the HTML:

  1. assigns a stable id to every body <h2>
  2. inserts a Contents block of <a href="#id"> rows after the cover

Only content headings are touched — the cover <h1 class="cover-title"> and
anything inside <head>/<style> are left alone.

Usage: python3 add-toc.py page.html
"""

import re
import sys
import html as htmllib
from pathlib import Path


def slug(text: str, used: set) -> str:
    s = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", text.lower()).strip("-")
    s = s or "sec"
    base, n = s, 2
    while s in used:
        s = f"{base}-{n}"
        n += 1
    used.add(s)
    return s


def main(path: str) -> None:
    p = Path(path)
    doc = p.read_text(encoding="utf-8")

    if "data-generated-toc" in doc:
        print(f"  = TOC already present, skipping {path}")
        return

    # Body starts after the cover section closes.
    cover_end = doc.find("</section>", doc.find('<section class="cover"'))
    if cover_end < 0:
        print(f"  ! No cover section found in {path}")
        return
    body_start = cover_end + len("</section>")

    head, body = doc[:body_start], doc[body_start:]

    # Collect body <h2> headings (level 2 only — the document's main sections).
    used: set = set()
    entries: list = []

    def repl(m: re.Match) -> str:
        tag, attrs, inner = m.group(1), m.group(2), m.group(3)
        if "id=" in attrs:  # already anchored
            return m.group(0)
        text = re.sub(r"<[^>]+>", "", inner).strip()
        sid = slug(text, used)
        entries.append((sid, text))
        return f"<{tag}{attrs} id=\"{sid}\">{inner}</{tag}>"

    body_new = re.sub(r"(<h2)([^>]*)>(.*?)</h2>", repl, body, flags=re.S)

    if not entries:
        print(f"  ! No <h2> sections found in {path} — nothing to index")
        return

    rows = "\n".join(
        f'    <li><a href="#{sid}">{htmllib.escape(t)}</a></li>' for sid, t in entries
    )
    toc = (
        '\n<section class="toc" data-generated-toc="true">\n'
        "  <h2>Contents</h2>\n"
        f"  <ul>\n{rows}\n  </ul>\n"
        "</section>\n"
    )

    p.write_text(head + toc + body_new, encoding="utf-8")
    print(f"  OK {path} — {len(entries)} sections indexed")


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        main(arg)
