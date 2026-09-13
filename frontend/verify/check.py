#!/usr/bin/env python3
"""Static analyser for the SatQuery frontend.

Stands in for `tsc --noEmit` + `eslint` in an offline sandbox. It cannot type-check,
but it catches the classes of error that actually break a Next.js build:
unresolved/unused imports, missing exports, `any`, missing "use client",
prop-contract mismatches, unbalanced brackets/JSX and undefined CSS variables.
"""
import io, json, os, re, sys
from collections import defaultdict

ROOT = "/sessions/serene-eager-allen/work/merged"
SRC = os.path.join(ROOT, "src")
EXTS = (".ts", ".tsx")

problems = []


def add(sev, path, msg, line=None):
    rel = os.path.relpath(path, ROOT)
    problems.append((sev, rel, line or 0, msg))


def err(path, msg, line=None):
    add("ERROR", path, msg, line)


def warn(path, msg, line=None):
    add("WARN", path, msg, line)


def lineno(src, idx):
    return src.count("\n", 0, idx) + 1


# ── lexer: blank out comments, string bodies and regex literals ──────────────
REGEX_PREV = set("(,=:[!&|?{};+-*%~^<>\n\t ")
KEYWORD_BEFORE_REGEX = ("return", "typeof", "case", "in", "of", "delete", "void", "await", "yield")


def blank(src):
    """Return src with comment bodies, string bodies and regex bodies replaced by
    spaces (length and newlines preserved) so that offsets stay comparable."""
    out = list(src)
    i, n = 0, len(src)
    tpl_depth = []  # stack of brace depths for ${ } inside template literals

    def space(a, b):
        for k in range(a, b):
            if out[k] != "\n":
                out[k] = " "

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            j = src.find("\n", i)
            j = n if j < 0 else j
            space(i, j)
            i = j
            continue
        if c == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            space(i, j)
            i = j
            continue
        if c in "'\"":
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == c or src[j] == "\n":
                    break
                j += 1
            space(i + 1, min(j, n))
            i = min(j, n) + 1
            continue
        if c == "`":
            # template literal: blank the literal chunks, keep ${ } expressions
            j = i + 1
            start = j
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "`":
                    space(start, j)
                    j += 1
                    break
                if src[j] == "$" and j + 1 < n and src[j + 1] == "{":
                    space(start, j)
                    depth = 1
                    j += 2
                    while j < n and depth:
                        if src[j] == "{":
                            depth += 1
                        elif src[j] == "}":
                            depth -= 1
                        elif src[j] in "'\"`":
                            q = src[j]
                            k = j + 1
                            while k < n:
                                if src[k] == "\\":
                                    k += 2
                                    continue
                                if src[k] == q:
                                    break
                                k += 1
                            space(j + 1, min(k, n))
                            j = min(k, n)
                        j += 1
                    start = j
                    continue
                j += 1
            i = j
            continue
        if c == "/":
            # `/>` closes a JSX tag and `</` opens a closing tag — neither is a regex
            if nxt == ">":
                i += 1
                continue
            k = i - 1
            while k >= 0 and src[k] in " \t":
                k -= 1
            prev = src[k] if k >= 0 else "\n"
            word = re.search(r"([A-Za-z_$][\w$]*)\s*$", src[:i])
            is_regex = prev != "<" and (prev in REGEX_PREV or (word and word.group(1) in KEYWORD_BEFORE_REGEX))
            if is_regex:
                j = i + 1
                in_class = False
                ok = False
                while j < n:
                    ch = src[j]
                    if ch == "\\":
                        j += 2
                        continue
                    if ch == "\n":
                        break
                    if ch == "[":
                        in_class = True
                    elif ch == "]":
                        in_class = False
                    elif ch == "/" and not in_class:
                        ok = True
                        break
                    j += 1
                if ok:
                    space(i + 1, j)
                    i = j + 1
                    continue
        i += 1
    return "".join(out)


# ── file collection ──────────────────────────────────────────────────────────
FILES = []
for base, dirs, names in os.walk(SRC):
    dirs[:] = [d for d in dirs if d not in (".next", "node_modules")]
    for nm in sorted(names):
        if nm.endswith(EXTS):
            FILES.append(os.path.join(base, nm))

RAW = {f: io.open(f, encoding="utf-8").read() for f in FILES}
CODE = {f: blank(RAW[f]) for f in FILES}

PKG = json.load(io.open(os.path.join(ROOT, "package.json"), encoding="utf-8"))
DEPS = set(PKG.get("dependencies", {})) | set(PKG.get("devDependencies", {}))
BUILTINS = {"fs", "path", "os", "crypto", "url", "util", "stream", "buffer", "child_process",
            "http", "https", "zlib", "events", "assert", "net", "tls", "worker_threads"}


def resolve(spec, from_file):
    """Resolve a module specifier to a local file, or classify it."""
    if spec.startswith("@/"):
        cand = os.path.join(SRC, spec[2:])
    elif spec.startswith("."):
        cand = os.path.normpath(os.path.join(os.path.dirname(from_file), spec))
    else:
        pkg = spec.split("/")[0]
        if spec.startswith("node:"):
            return ("builtin", spec)
        if pkg.startswith("@"):
            pkg = "/".join(spec.split("/")[:2])
        if pkg in DEPS or pkg in BUILTINS:
            return ("package", pkg)
        return ("missing-package", pkg)
    for suffix in ("", ".ts", ".tsx", "/index.ts", "/index.tsx", ".css"):
        p = cand + suffix
        if os.path.isfile(p):
            return ("local", p)
    return ("missing-local", cand)


# ── import parsing ───────────────────────────────────────────────────────────
IMPORT_RE = re.compile(
    r'^[ \t]*import\s+(?:(type)\s+)?(?:([\w$]+)\s*,\s*)?'
    r'(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|([\w$]+))?\s*'
    r'(?:from\s*)?["\']([^"\']+)["\']\s*;?',
    re.M)
SIDE_EFFECT_RE = re.compile(r'^[ \t]*import\s+["\']([^"\']+)["\']\s*;?', re.M)


class Imp:
    __slots__ = ("local", "imported", "spec", "type_only", "span", "line")

    def __init__(self, local, imported, spec, type_only, span, line):
        self.local, self.imported, self.spec = local, imported, spec
        self.type_only, self.span, self.line = type_only, span, line


def spec_at(path, span):
    raw = RAW[path][span[0]:span[1]]
    m = re.search(r'["\']([^"\']+)["\']\s*;?\s*$', raw)
    return m.group(1) if m else ""


def parse_imports(path):
    code = CODE[path]
    imps = []
    spans = []
    for m in IMPORT_RE.finditer(code):
        type_kw, dflt, named, star, bare, _blank_spec = m.groups()
        span = m.span()
        spec = spec_at(path, span)
        spans.append(span)
        ln = lineno(code, m.start())
        if dflt:
            imps.append(Imp(dflt, "default", spec, bool(type_kw), span, ln))
        if bare:
            imps.append(Imp(bare, "default", spec, bool(type_kw), span, ln))
        if star:
            imps.append(Imp(star, "*", spec, bool(type_kw), span, ln))
        if named:
            for part in named.split(","):
                part = part.strip()
                if not part:
                    continue
                t_only = bool(type_kw)
                if part.startswith("type "):
                    part = part[5:].strip()
                    t_only = True
                if " as " in part:
                    orig, loc = [x.strip() for x in part.split(" as ")]
                else:
                    orig = loc = part
                imps.append(Imp(loc, orig, spec, t_only, span, ln))
    for m in SIDE_EFFECT_RE.finditer(code):
        if not any(a <= m.start() < b for a, b in spans):
            spans.append(m.span())
            imps.append(Imp(None, None, spec_at(path, m.span()), False, m.span(), lineno(code, m.start())))
    return imps, spans


# ── export parsing ───────────────────────────────────────────────────────────
def parse_exports(path):
    code = CODE[path]
    names = set()
    for m in re.finditer(
            r'^\s*export\s+(?:declare\s+)?(?:async\s+)?'
            r'(?:function|const|let|var|class|interface|enum|abstract\s+class)\s+([\w$]+)', code, re.M):
        names.add(m.group(1))
    for m in re.finditer(r'^\s*export\s+type\s+([\w$]+)', code, re.M):
        names.add(m.group(1))
    for m in re.finditer(r'^\s*export\s+(?:type\s+)?\{([^}]*)\}', code, re.M):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            if part.startswith("type "):
                part = part[5:].strip()
            names.add(part.split(" as ")[-1].strip())
    if re.search(r'^\s*export\s+default\b', code, re.M):
        names.add("default")
    # destructured exports: export const { a, b } = ...
    for m in re.finditer(r'^\s*export\s+const\s*\{([^}]*)\}', code, re.M):
        for part in m.group(1).split(","):
            nm = part.strip().split(":")[-1].strip()
            if nm:
                names.add(nm)
    return names


EXPORTS = {f: parse_exports(f) for f in FILES}
IMPORTS = {}
SPANS = {}
for f in FILES:
    IMPORTS[f], SPANS[f] = parse_imports(f)


# ── check 1: import resolution + named export existence ──────────────────────
for f in FILES:
    for imp in IMPORTS[f]:
        kind, target = resolve(imp.spec, f)
        if kind == "missing-local":
            err(f, f'unresolved import "{imp.spec}" (looked for {os.path.relpath(target, ROOT)}[.ts|.tsx|/index.ts])', imp.line)
        elif kind == "missing-package":
            err(f, f'import "{imp.spec}" is not in package.json dependencies', imp.line)
        elif kind == "local" and imp.imported and imp.imported not in ("*",):
            if target.endswith(EXTS) and imp.imported not in EXPORTS[target]:
                err(f, f'"{imp.imported}" is not exported by {os.path.relpath(target, SRC)}', imp.line)


# ── check 2: unused imports ──────────────────────────────────────────────────
for f in FILES:
    code = CODE[f]
    body = list(code)
    for a, b in SPANS[f]:
        for k in range(a, b):
            if body[k] != "\n":
                body[k] = " "
    body = "".join(body)
    for imp in IMPORTS[f]:
        if not imp.local:
            continue
        if not re.search(r'\b' + re.escape(imp.local) + r'\b', body):
            err(f, f'unused import "{imp.local}"', imp.line)


# ── check 3: `any` ───────────────────────────────────────────────────────────
ANY_PATTERNS = [
    (re.compile(r':\s*any\b'), "type annotation `: any`"),
    (re.compile(r'\bas\s+any\b'), "`as any`"),
    (re.compile(r'\bany\[\]'), "`any[]`"),
    (re.compile(r'<\s*any\s*[,>]'), "`any` type argument"),
]
for f in FILES:
    for rx, label in ANY_PATTERNS:
        for m in rx.finditer(CODE[f]):
            err(f, f'{label} — brief forbids `any`', lineno(CODE[f], m.start()))


# ── check 4: "use client" correctness ────────────────────────────────────────
CLIENT_MARKERS = re.compile(
    r'\buse(?:State|Effect|Memo|Callback|Ref|Reducer|LayoutEffect|Id|SyncExternalStore|Transition)\s*\('
    r'|\bon(?:Click|Change|Input|Submit|KeyDown|KeyUp|PointerDown|PointerMove|PointerUp|Drop|DragOver|DragLeave|Scroll|Load|Error|MouseEnter|MouseLeave|Focus|Blur)\s*=')
for f in FILES:
    raw = RAW[f]
    first = None
    for ln in raw.splitlines():
        s = ln.strip()
        if not s or s.startswith("//") or s.startswith("/*") or s.startswith("*"):
            continue
        first = s
        break
    has_directive = first in ('"use client";', "'use client';", '"use client"', "'use client'")
    needs = bool(CLIENT_MARKERS.search(CODE[f]))
    is_route = "/api/" in f.replace(os.sep, "/") or f.endswith("route.ts")
    if needs and not has_directive and not is_route:
        err(f, 'uses client-only React features but has no "use client" directive as its first statement')
    if has_directive and is_route:
        err(f, 'route handler must not be a client component')


# ── check 5: bracket balance ─────────────────────────────────────────────────
PAIR = {")": "(", "]": "[", "}": "{"}
for f in FILES:
    stack = []
    bad = False
    for i, ch in enumerate(CODE[f]):
        if ch in "([{":
            stack.append((ch, i))
        elif ch in ")]}":
            if not stack or stack[-1][0] != PAIR[ch]:
                err(f, f'unbalanced "{ch}"', lineno(CODE[f], i))
                bad = True
                break
            stack.pop()
    if not bad and stack:
        ch, i = stack[0]
        err(f, f'unclosed "{ch}"', lineno(CODE[f], i))


# ── check 6: JSX tag balance ─────────────────────────────────────────────────
TAG_OPEN = re.compile(r'<([A-Za-z][\w.]*)')
# A "<" begins a tag unless the preceding non-space character makes it a generic
# argument list (`useState<`, `Record<`) or an unspaced comparison (`a<b`).
# JSX text can end in anything — "focus · <kbd>" — so a whitelist is wrong here.
NOT_TAG_PREV = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$.")


HTML_TAGS = set("""a abbr address area article aside audio b base bdi bdo blockquote body br
button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt
em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i
iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object
ol optgroup option output p param picture pre progress q rp rt ruby s samp script section select
slot small source span strong style sub summary sup table tbody td template textarea tfoot th
thead time title tr track u ul var video wbr svg path circle ellipse rect line polyline polygon
g defs text tspan use marker linearGradient radialGradient stop clipPath mask filter
feGaussianBlur feOffset feMerge feMergeNode animate animateTransform foreignObject""".split())


def opens_tag(code, i, name=None):
    """JSX text can end in a word — "Workflow <span>" — while a generic argument
    list is also preceded by an identifier — "useState<Rec>". Disambiguate: after
    an identifier only a lowercase HTML element name counts as a tag."""
    k = i - 1
    while k >= 0 and code[k] in " \t":
        k -= 1
    prev = code[k] if k >= 0 else "\n"
    if prev not in NOT_TAG_PREV:
        return True
    return name is not None and name in HTML_TAGS
for f in FILES:
    if not f.endswith(".tsx"):
        continue
    code = CODE[f]
    stack = []
    i, n = 0, len(code)
    broke = False
    while i < n and not broke:
        c = code[i]
        if c != "<":
            i += 1
            continue
        if not code.startswith("</", i):
            probe = TAG_OPEN.match(code, i)
            if not code.startswith("<>", i) and not opens_tag(code, i, probe.group(1) if probe else None):
                i += 1
                continue
        if code.startswith("</", i):
            m = re.match(r'</\s*([A-Za-z][\w.]*)?\s*>', code[i:])
            if not m:
                i += 1
                continue
            name = m.group(1) or ""
            if not stack:
                err(f, f'closing tag </{name}> with no open tag', lineno(code, i))
                broke = True
                break
            top, top_i = stack.pop()
            if top != name:
                err(f, f'</{name}> closes <{top}> opened at line {lineno(code, top_i)}', lineno(code, i))
                broke = True
                break
            i += m.end()
            continue
        if code.startswith("<>", i):
            stack.append(("", i))
            i += 2
            continue
        m = TAG_OPEN.match(code, i)
        if not m:
            i += 1
            continue
        name = m.group(1)
        # walk to the end of the opening tag, tracking nesting of {...} and (...)
        j = m.end()
        depth = 0
        self_closing = False
        while j < n:
            ch = code[j]
            if ch in "{(":
                depth += 1
            elif ch in "})":
                depth -= 1
            elif depth == 0 and ch == ">":
                self_closing = code[j - 1] == "/"
                break
            j += 1
        if j >= n:
            err(f, f'opening tag <{name}> is never terminated', lineno(code, i))
            break
        if not self_closing:
            stack.append((name, i))
        i = j + 1
    else:
        if stack:
            name, idx = stack[-1]
            err(f, f'unclosed JSX tag <{name or ">"}>', lineno(code, idx))


# ── check 7: prop contracts ──────────────────────────────────────────────────
def members_of(block):
    """Depth-1 member names of an object type body, with optionality."""
    req, opt = set(), set()
    depth = 0
    i = 0
    n = len(block)
    line_start = 0
    while i < n:
        ch = block[i]
        if ch in "{([":
            depth += 1
        elif ch in "})]":
            depth -= 1
        elif depth == 0 and ch in ";\n,":
            seg = block[line_start:i]
            m = re.match(r'\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(\?)?\s*:', seg)
            if m:
                (opt if m.group(2) else req).add(m.group(1))
            line_start = i + 1
        i += 1
    seg = block[line_start:]
    m = re.match(r'\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(\?)?\s*:', seg)
    if m:
        (opt if m.group(2) else req).add(m.group(1))
    return req, opt


def brace_block(code, open_idx):
    depth = 0
    for j in range(open_idx, len(code)):
        if code[j] == "{":
            depth += 1
        elif code[j] == "}":
            depth -= 1
            if depth == 0:
                return code[open_idx + 1:j], j
    return None, None


TYPES = {}        # (file, TypeName) -> (required, optional, allows_extra)
for f in FILES:
    code = CODE[f]
    for m in re.finditer(r'^\s*(?:export\s+)?(?:type\s+([\w$]+)\s*=\s*|interface\s+([\w$]+)\s*(extends\s+[^{]+)?)\{', code, re.M):
        name = m.group(1) or m.group(2)
        block, end = brace_block(code, code.index("{", m.start()))
        if block is None:
            continue
        req, opt = members_of(block)
        extra = bool(m.group(3)) or "[key" in block or "..." in block
        TYPES[(f, name)] = (req, opt, extra)

COMPONENTS = {}   # ComponentName -> (required, allowed, allows_extra, file)
COMP_DEF = re.compile(
    r'(?:export\s+(?:default\s+)?function\s+([A-Z][\w$]*)\s*\(|'
    r'(?:export\s+)?const\s+([A-Z][\w$]*)\s*(?::\s*[^=]+)?=\s*\()')
for f in FILES:
    if not f.endswith(".tsx"):
        continue
    code = CODE[f]
    for m in COMP_DEF.finditer(code):
        name = m.group(1) or m.group(2)
        open_paren = code.index("(", m.start() if m.group(1) else m.end() - 1)
        # capture the parameter list
        depth = 0
        j = open_paren
        while j < len(code):
            if code[j] == "(":
                depth += 1
            elif code[j] == ")":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        params = code[open_paren + 1:j]
        if not params.strip():
            COMPONENTS[name] = (set(), set(), False, f)
            continue
        tm = re.search(r':\s*([\w$]+)\s*$', params.strip())
        if tm:
            tname = tm.group(1)
            key = (f, tname)
            if key in TYPES:
                req, opt, extra = TYPES[key]
                COMPONENTS[name] = (req, req | opt, extra, f)
            else:
                # imported type — resolve through this file's imports
                found = None
                for imp in IMPORTS[f]:
                    if imp.local == tname:
                        kind, target = resolve(imp.spec, f)
                        if kind == "local" and (target, imp.imported) in TYPES:
                            found = TYPES[(target, imp.imported)]
                if found:
                    COMPONENTS[name] = (found[0], found[0] | found[1], found[2], f)
                else:
                    COMPONENTS[name] = (set(), set(), True, f)  # unknown: don't police
            continue
        im = re.search(r':\s*\{', params)
        if im:
            block, _ = brace_block(params, params.index("{", im.start()))
            if block is not None:
                req, opt = members_of(block)
                COMPONENTS[name] = (req, req | opt, "[key" in block, f)
                continue
        COMPONENTS[name] = (set(), set(), True, f)

HTML_TAG = re.compile(r'^[a-z]')
for f in FILES:
    if not f.endswith(".tsx"):
        continue
    code = CODE[f]
    for m in re.finditer(r'<([A-Z][\w$]*)', code):
        if not opens_tag(code, m.start()):
            continue
        name = m.group(1)
        if name not in COMPONENTS:
            continue
        req, allowed, extra, deffile = COMPONENTS[name]
        if extra:
            continue
        j = m.end()
        depth = 0
        while j < len(code):
            ch = code[j]
            if ch in "{(":
                depth += 1
            elif ch in "})":
                depth -= 1
            elif depth == 0 and ch == ">":
                break
            j += 1
        tag = code[m.end():j]
        self_closing = code[j - 1] == "/" if j < len(code) else False
        # attributes at depth 0 only
        attrs = set()
        spread = False
        d = 0
        k = 0
        while k < len(tag):
            ch = tag[k]
            if ch in "{(":
                if ch == "{" and d == 0 and tag[k + 1:k + 4].strip().startswith("..."):
                    spread = True
                d += 1
            elif ch in "})":
                d -= 1
            elif d == 0:
                am = re.match(r'([A-Za-z_$][\w$]*)', tag[k:])
                if am and (k == 0 or tag[k - 1] in " \t\n"):
                    attrs.add(am.group(1))
                    k += am.end()
                    continue
            k += 1
        unknown = {a for a in attrs if a not in allowed and a not in ("key", "ref")}
        if unknown:
            err(f, f'<{name}> receives unknown prop(s) {sorted(unknown)} — '
                   f'{os.path.relpath(deffile, SRC)} accepts {sorted(allowed)}', lineno(code, m.start()))
        if not spread:
            missing = req - attrs - {"children"}
            if missing:
                err(f, f'<{name}> is missing required prop(s) {sorted(missing)}', lineno(code, m.start()))
        if not self_closing and "children" not in allowed:
            err(f, f'<{name}> is given children but its props type has no `children`', lineno(code, m.start()))
        if self_closing and "children" in req:
            err(f, f'<{name}> has no children but `children` is required', lineno(code, m.start()))


# ── check 8: CSS custom properties ───────────────────────────────────────────
css_path = os.path.join(SRC, "app", "globals.css")
css = io.open(css_path, encoding="utf-8").read()
defined = set(re.findall(r'(--[\w-]+)\s*:', css))
for f in FILES:
    for m in re.findall(r'["\'\s{](--[\w-]+)\s*["\']?\s*:', RAW[f]):
        defined.add(m)
    for m in re.findall(r'setProperty\(\s*["\'](--[\w-]+)', RAW[f]):
        defined.add(m)
    # computed keys: { ["--d" as string]: "120ms" }
    for m in re.findall(r'\[\s*["\'](--[\w-]+)["\']\s*(?:as\s+[\w.]+\s*)?\]\s*:', RAW[f]):
        defined.add(m)
for m in re.findall(r'["\'](--[\w-]+)["\']\s*(?:as\s+\w+\s*)?\]?\s*:', css):
    defined.add(m)
DYNAMIC = []
for f in FILES:
    for m in re.finditer(r'var\((--[\w-]+)(\$?)', RAW[f]):
        if m.group(2) == "$":
            DYNAMIC.append((f, lineno(RAW[f], m.start()), m.group(1)))
            continue
        if m.group(1) not in defined:
            err(f, f'CSS variable {m.group(1)} is not defined in globals.css', lineno(RAW[f], m.start()))
for m in re.finditer(r'var\((--[\w-]+)\s*(,?)', css):
    if m.group(1) not in defined:
        if m.group(2) == ",":
            warn(css_path, f'{m.group(1)} is only ever supplied by inline styles (has a fallback)', lineno(css, m.start()))
        else:
            err(css_path, f'CSS variable {m.group(1)} used with no definition and no fallback', lineno(css, m.start()))


# ── check 9: React hooks must be imported ────────────────────────────────────
HOOKS = ["useState", "useEffect", "useMemo", "useCallback", "useRef", "useReducer",
         "useLayoutEffect", "useId", "useSyncExternalStore", "useTransition"]
for f in FILES:
    code = CODE[f]
    local_defs = set(re.findall(r'(?:function|const)\s+(use[A-Z][\w$]*)', code))
    imported = {i.local for i in IMPORTS[f]}
    for h in HOOKS:
        if re.search(r'\b' + h + r'\s*\(', code) and h not in imported and h not in local_defs:
            if not re.search(r'\bReact\.' + h, code):
                err(f, f'{h}() called but not imported from "react"')


# ── check 10: dynamic(..., { ssr: false }) requires a client component ───────
for f in FILES:
    code = CODE[f]
    for m in re.finditer(r'dynamic\(', code):
        tail = code[m.start():m.start() + 400]
        if re.search(r'ssr\s*:\s*false', tail):
            raw_head = RAW[f].lstrip()
            if not raw_head.startswith('"use client"') and not raw_head.startswith("'use client'"):
                err(f, 'dynamic(..., { ssr: false }) is only valid inside a client component',
                    lineno(code, m.start()))


# ── check 11: every /api/... path the client calls has a route handler ───────
API_DIR = os.path.join(SRC, "app", "api")
route_groups = set()
if os.path.isdir(API_DIR):
    for base, dirs, names in os.walk(API_DIR):
        if "route.ts" in names:
            rel = os.path.relpath(base, API_DIR).replace(os.sep, "/")
            route_groups.add(rel.split("/")[0])
for f in FILES:
    if "/lib/" not in f.replace(os.sep, "/"):
        continue
    for m in re.finditer(r'/api/([a-zA-Z0-9_-]+)', RAW[f]):
        if m.group(1) not in route_groups:
            err(f, f'calls /api/{m.group(1)} but no route handler exists for it',
                lineno(RAW[f], m.start()))


# ── check 12: prop-contract coverage (what this pass could and could not police)
if "--coverage" in sys.argv:
    policed = sorted(n for n, (r, a, extra_ok, _) in COMPONENTS.items() if not extra_ok)
    skipped = sorted(n for n, (r, a, extra_ok, _) in COMPONENTS.items() if extra_ok)
    print(f"prop contracts policed ({len(policed)}): {', '.join(policed)}")
    print(f"props not resolvable, so not policed ({len(skipped)}): {', '.join(skipped)}")
    print()


# ── report ───────────────────────────────────────────────────────────────────
order = {"ERROR": 0, "WARN": 1}
problems.sort(key=lambda p: (order[p[0]], p[1], p[2]))
for sev, rel, ln, msg in problems:
    where = f"{rel}:{ln}" if ln else rel
    print(f"{sev:5} {where}: {msg}")
if DYNAMIC and "-v" in sys.argv:
    print("\ninterpolated CSS variables (verify each branch resolves):")
    for f, ln, prefix in DYNAMIC:
        print(f"      {os.path.relpath(f, ROOT)}:{ln}: var({prefix}$" + "{...})")
errors = sum(1 for p in problems if p[0] == "ERROR")
warns = len(problems) - errors
print(f"\n{len(FILES)} ts/tsx files · {errors} errors · {warns} warnings")
sys.exit(1 if errors else 0)
