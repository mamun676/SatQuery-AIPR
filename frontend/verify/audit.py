#!/usr/bin/env python3
"""Refinement audit: accessibility, motion coverage and UI consistency.

Complements tools/check.py (which looks for build-breaking defects). Everything
here is a quality finding, not a compile error.
"""
import io, os, re, sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(os.path.dirname(TOOLS), "merged")
SRC = os.path.join(ROOT, "src")

# reuse the lexer from the static checker (its head is import-safe on its own)
_ns = {}
exec(io.open(os.path.join(TOOLS, "check.py"), encoding="utf-8").read().split("# ── file collection")[0], _ns)
blank = _ns["blank"]

findings = []


def note(path, line, msg):
    findings.append((os.path.relpath(path, ROOT), line, msg))


FILES = []
for base, dirs, names in os.walk(SRC):
    dirs[:] = [d for d in dirs if d not in (".next", "node_modules")]
    for nm in sorted(names):
        if nm.endswith(".tsx"):
            FILES.append(os.path.join(base, nm))

RAW = {f: io.open(f, encoding="utf-8").read() for f in FILES}
CODE = {f: blank(RAW[f]) for f in FILES}


def lineno(src, i):
    return src.count("\n", 0, i) + 1


def tag_span(code, start):
    """Return (attrs_text, end_index, self_closing) for the opening tag at start."""
    i = code.index(">", start) if ">" in code[start:] else len(code)
    depth = 0
    j = start
    while j < len(code):
        ch = code[j]
        if ch in "{(":
            depth += 1
        elif ch in "})":
            depth -= 1
        elif depth == 0 and ch == ">":
            return code[start:j], j, code[j - 1] == "/"
        j += 1
    return code[start:i], i, False


def element_body(code, open_end, name):
    """Text between an opening tag and its matching close, with nesting."""
    depth = 1
    i = open_end
    open_re = re.compile(r"<" + name + r"[\s/>]")
    close_re = re.compile(r"</" + name + r"\s*>")
    while i < len(code) and depth:
        o = open_re.search(code, i)
        c = close_re.search(code, i)
        if not c:
            return code[open_end:], len(code)
        if o and o.start() < c.start():
            depth += 1
            i = o.end()
        else:
            depth -= 1
            i = c.end()
            if depth == 0:
                return code[open_end:c.start()], c.end()
    return code[open_end:], i


# ── 1. buttons: type, and an accessible name ─────────────────────────────────
TEXT_RE = re.compile(r">[^<>{}]*[A-Za-z0-9][^<>{}]*<")
for f in FILES:
    code = CODE[f]
    raw = RAW[f]
    for m in re.finditer(r"<button\b", code):
        attrs, end, self_closing = tag_span(code, m.end())
        raw_attrs = raw[m.end():end]
        if "type=" not in attrs:
            note(f, lineno(code, m.start()), "<button> without an explicit type= (defaults to submit)")
        body, _ = element_body(code, end + 1, "button")
        raw_body = raw[end + 1:end + 1 + len(body)]
        # "1:1" and "×" are perfectly good visible labels, so accept any glyph
        stripped = re.sub(r"<[^>]*>", "", raw_body)
        # a {expression} child renders text, so it counts as a visible label
        has_text = bool(re.search(r"[^\s]", stripped))
        has_label = "aria-label" in raw_attrs or "title=" in raw_attrs or "aria-labelledby" in raw_attrs
        if not has_text and not has_label:
            note(f, lineno(code, m.start()), "icon-only <button> with no aria-label/title")

# ── 2. form controls need a label or an accessible name ──────────────────────
for f in FILES:
    code, raw = CODE[f], RAW[f]
    labelled_ids = set(re.findall(r'htmlFor="([^"]+)"', raw))
    for tag in ("input", "textarea", "select"):
        for m in re.finditer(r"<" + tag + r"\b", code):
            attrs, end, _ = tag_span(code, m.end())
            raw_attrs = raw[m.end():end]
            idm = re.search(r'id="([^"]+)"', raw_attrs)
            named = ("aria-label" in raw_attrs or "aria-labelledby" in raw_attrs
                     or (idm and idm.group(1) in labelled_ids))
            hidden = 'type="file"' in raw_attrs and "sr-only" in raw_attrs
            # a wrapping <label> is an accessible name too
            before = raw[:m.start()]
            wrapped = before.rfind("<label") > before.rfind("</label>")
            if not named and not hidden and not wrapped:
                note(f, lineno(code, m.start()), f"<{tag}> has no label, aria-label or aria-labelledby")

# ── 3. images need alt text ──────────────────────────────────────────────────
for f in FILES:
    code, raw = CODE[f], RAW[f]
    for m in re.finditer(r"<img\b", code):
        attrs, end, _ = tag_span(code, m.end())
        if "alt=" not in raw[m.end():end]:
            note(f, lineno(code, m.start()), "<img> without alt")

# ── 4. click handlers on non-interactive elements ────────────────────────────
for f in FILES:
    code, raw = CODE[f], RAW[f]
    for m in re.finditer(r"<(div|span|li|section|p)\b", code):
        attrs, end, _ = tag_span(code, m.end())
        raw_attrs = raw[m.end():end]
        if "onClick" in raw_attrs and "role=" not in raw_attrs and "onKeyDown" not in raw_attrs:
            note(f, lineno(code, m.start()),
                 f"<{m.group(1)} onClick> with no role= and no keyboard handler")

# ── 5. duplicate DOM ids ─────────────────────────────────────────────────────
seen_ids = {}
for f in FILES:
    for m in re.finditer(r'\bid="([^"{]+)"', RAW[f]):
        seen_ids.setdefault(m.group(1), []).append((f, lineno(RAW[f], m.start())))
for the_id, places in seen_ids.items():
    if len(places) > 1:
        for f, ln in places:
            note(f, ln, f'DOM id "{the_id}" is emitted in {len(places)} places')

# ── 6. reduced-motion coverage for every animating class ─────────────────────
css = io.open(os.path.join(SRC, "app", "globals.css"), encoding="utf-8").read()
rm = re.search(r"@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{", css)
rm_block = ""
if rm:
    depth = 1
    i = rm.end()
    while i < len(css) and depth:
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
        i += 1
    rm_block = css[rm.end():i]
animating = set()
for m in re.finditer(r"(\.[a-zA-Z0-9_-]+)([^{}]*)\{([^{}]*)\}", css):
    if re.search(r"\banimation(?:-name)?\s*:", m.group(3)):
        animating.add(m.group(1))
covered = set(re.findall(r"(\.[a-zA-Z0-9_-]+)", rm_block))
wildcard = bool(re.search(r"\*\s*,|\*\s*\{|\*,\s*\*", rm_block))
css_path = os.path.join(SRC, "app", "globals.css")
for cls in sorted(animating - covered):
    if not wildcard:
        note(css_path, 0, f"{cls} animates but is not neutralised under prefers-reduced-motion")

# ── 7. AnalysisRail section ids must match its SectionId union ───────────────
rail = os.path.join(SRC, "app", "components", "AnalysisRail.tsx")
if os.path.isfile(rail):
    raw = RAW.get(rail, io.open(rail, encoding="utf-8").read())
    union = re.search(r'type\s+SectionId\s*=\s*([^;]+);', raw)
    if union:
        ids = set(re.findall(r'"([\w-]+)"', union.group(1)))
        listed = set(re.findall(r'id:\s*"([\w-]+)"', raw))
        if ids - listed:
            note(rail, 0, f"SectionId values with no section entry: {sorted(ids - listed)}")
        if listed - ids:
            note(rail, 0, f"section entries outside SectionId: {sorted(listed - ids)}")

findings.sort(key=lambda x: (x[0], x[1]))
for rel, ln, msg in findings:
    print(f"{rel}:{ln}: {msg}" if ln else f"{rel}: {msg}")
print(f"\n{len(FILES)} tsx files audited · {len(findings)} findings")
