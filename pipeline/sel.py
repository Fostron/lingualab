"""Selectors that find grammar-relevant gaps in spaCy-annotated sentences.

A selector is f(toks, ctx) -> list of (i, n, hint, options|None)
  toks: [(text, lemma, upos, morph, ws)], ctx: {"conj": {...}, "lang": "es"}
All verb selectors verify the surface form against the conjugation table,
so a gap is only produced when we are sure what the right answer is.
"""


def _forms(ctx, lemma, tense):
    t = ctx["conj"].get(lemma, {}).get(tense)
    if not t:
        return []
    return [[f.lower() for f in slot.split("/") if f] for slot in t]


def _morph_slot(morph):
    """Person/Number from spaCy morphology -> conjugation slot index (0..5), or None."""
    if not morph:
        return None
    feats = dict(f.split("=", 1) for f in morph.split("|") if "=" in f)
    person, number = feats.get("Person"), feats.get("Number")
    if person not in ("1", "2", "3") or number not in ("Sing", "Plur"):
        return None
    return int(person) - 1 + (3 if number == "Plur" else 0)


def _person_of(ctx, lemma, tense, text, morph=None):
    forms = _forms(ctx, lemma, tense)
    pref = _morph_slot(morph)
    if pref is not None and pref < len(forms) and text.lower() in forms[pref]:
        return pref
    for p, slot in enumerate(forms):
        if text.lower() in slot:
            return p
    return None


def V(tenses, lemmas=None, hint="lemma", pos=("VERB", "AUX"), morph_req=()):
    """Single-token verb form in one of `tenses` (verified against the conjugation table).
    morph_req: spaCy features the token must also have (e.g. "Mood=Imp")."""

    def f(toks, ctx):
        out = []
        for i, (w, lem, up, morph, ws) in enumerate(toks):
            if up not in pos:
                continue
            if morph_req and not all(m in morph.split("|") for m in morph_req):
                continue
            lem = lem.lower()
            if lemmas and lem not in lemmas:
                continue
            for t in tenses:
                if _person_of(ctx, lem, t, w) is not None:
                    out.append((i, 1, lem if hint == "lemma" else hint, None))
                    break
        return out

    return f


def VC(tense_a, tense_b, lemmas=None, pos=("VERB", "AUX"), only_a=False):
    """Choice between the same person in two tenses (e.g. preterite vs imperfect).
    only_a: blank only tokens that really are in tense_a (e.g. the subjunctive verb, not the main verb)."""

    def f(toks, ctx):
        out = []
        for i, (w, lem, up, morph, ws) in enumerate(toks):
            if up not in pos:
                continue
            lem = lem.lower()
            if lemmas and lem not in lemmas:
                continue
            pairs = ((tense_a, tense_b),) if only_a else ((tense_a, tense_b), (tense_b, tense_a))
            for ta, tb in pairs:
                p = _person_of(ctx, lem, ta, w, morph)
                if p is None:
                    continue
                fa, fb = _forms(ctx, lem, ta)[p], _forms(ctx, lem, tb)[p]
                if not fa or not fb or w.lower() in fb:
                    break
                opts = [w if w[0].islower() else w, fb[0]]
                out.append((i, 1, lem, opts))
                break
        return out

    return f


def VL(lemma_a, lemma_b, tenses):
    """Choice between two verbs at the same tense/person (ser vs estar, savoir vs connaître)."""

    def f(toks, ctx):
        out = []
        for i, (w, lem, up, morph, ws) in enumerate(toks):
            lem = lem.lower()
            if lem not in (lemma_a, lemma_b) or up not in ("VERB", "AUX"):
                continue
            other = lemma_b if lem == lemma_a else lemma_a
            for t in tenses:
                p = _person_of(ctx, lem, t, w, morph)
                if p is None:
                    continue
                fo = _forms(ctx, other, t)[p] if _forms(ctx, other, t) else []
                if fo and w.lower() not in fo:
                    out.append((i, 1, f"{lemma_a} / {lemma_b}", [w, fo[0]]))
                break
        return out

    return f


def COMP(tense, aux=("haber",)):
    """Two-token compound tense: auxiliary + participle (he comido, suis allé)."""

    def f(toks, ctx):
        out = []
        for i in range(len(toks) - 1):
            w, lem, up, morph, ws = toks[i]
            w2, lem2, up2, morph2, ws2 = toks[i + 1]
            if lem.lower() not in aux or up2 not in ("VERB", "AUX"):
                continue
            joined = f"{w} {w2}".lower()
            if _person_of(ctx, lem2.lower(), tense, joined) is not None:
                out.append((i, 2, lem2.lower(), None))
        return out

    return f


def W(words, options=None, hint=None, pos=None, prev_pos=None, not_after=()):
    """Token(s) whose text is in `words` (multi-word entries allowed).
    prev_pos: UPOS the preceding token must have (e.g. a relative pronoun needs an antecedent);
    not_after: preceding words that rule the match out ("au cas où")."""
    seqs = [tuple(x.lower().split()) for x in words]

    def f(toks, ctx):
        out = []
        low = [t[0].lower() for t in toks]
        for i in range(len(toks)):
            if prev_pos is not None and (i == 0 or toks[i - 1][2] not in prev_pos):
                continue
            if i and low[i - 1] in not_after:
                continue
            for s in seqs:
                n = len(s)
                if tuple(low[i:i + n]) == s and (pos is None or toks[i][2] in pos):
                    out.append((i, n, hint, list(options) if options else None))
                    break
        return out

    return f


def M(upos, morph_has, hint="lemma"):
    """Token with given UPOS whose morphology contains all `morph_has` features."""

    def f(toks, ctx):
        out = []
        for i, (w, lem, up, morph, ws) in enumerate(toks):
            if up in upos and all(m in morph.split("|") for m in morph_has):
                out.append((i, 1, lem.lower() if hint == "lemma" else hint, None))
        return out

    return f


def ANY(*sels):
    def f(toks, ctx):
        out = []
        seen = set()
        for s in sels:
            for r in s(toks, ctx):
                if r[0] not in seen:
                    seen.add(r[0])
                    out.append(r)
        return out

    return f


def NEED(sel, words):
    """Run `sel` only on sentences that contain one of `words` (e.g. a trigger like 'quiero que')."""
    trig = [w.lower() for w in words]

    def f(toks, ctx):
        text = " " + " ".join(t[0].lower() for t in toks) + " "
        if not any(f" {w} " in text for w in trig):
            return []
        return sel(toks, ctx)

    return f


def VCOMP(simple, compound, aux):
    """Choice between a simple tense (1 token, e.g. imparfait) and a compound one (aux + participle, e.g. passé composé)."""

    def f(toks, ctx):
        out = []
        for i, (w, lem, up, morph, ws) in enumerate(toks):
            # compound form at i, i+1
            if lem.lower() in aux and i + 1 < len(toks) and toks[i + 1][2] in ("VERB", "AUX"):
                lem2 = toks[i + 1][1].lower()
                joined = f"{w} {toks[i + 1][0]}".lower()
                p = _person_of(ctx, lem2, compound, joined)
                if p is not None:
                    alt = _forms(ctx, lem2, simple)
                    if alt and alt[p]:
                        out.append((i, 2, lem2, [f"{w} {toks[i + 1][0]}", alt[p][0]]))
                        continue
            if up in ("VERB", "AUX"):
                p = _person_of(ctx, lem.lower(), simple, w)
                if p is not None:
                    alt = _forms(ctx, lem.lower(), compound)
                    if alt and alt[p]:
                        out.append((i, 1, lem.lower(), [w, alt[p][0]]))
        return out

    return f


def RX(pattern, pos=None, hint=None):
    """Token whose text matches a regex."""
    import re as _re
    rx = _re.compile(pattern, _re.I)

    def f(toks, ctx):
        return [(i, 1, hint, None) for i, t in enumerate(toks) if rx.fullmatch(t[0]) and (pos is None or t[2] in pos)]

    return f


def PARTITIVE(forms=("du", "de la", "de l'", "des", "de", "d'"), options=("du", "de la", "des", "de")):
    """Partitive / quantity article between a verb (or a negation / quantity word) and a noun."""
    seqs = [tuple(x.split()) for x in forms]
    quant = {"pas", "beaucoup", "peu", "trop", "assez", "plus", "moins", "combien", "jamais"}

    def f(toks, ctx):
        out = []
        low = [t[0].lower() for t in toks]
        for i in range(1, len(toks)):
            for sq in seqs:
                n = len(sq)
                if tuple(low[i:i + n]) != sq or i + n >= len(toks):
                    continue
                prev_ok = toks[i - 1][2] in ("VERB", "AUX") or low[i - 1] in quant
                if prev_ok and toks[i + n][2] == "NOUN":
                    out.append((i, n, None, list(options)))
                break
        return out

    return f


def NOQ(sel):
    """Skip questions (useful for relative pronouns, which look like question words)."""

    def f(toks, ctx):
        if any(t[0] in ("?", "¿") for t in toks):
            return []
        return sel(toks, ctx)

    return f


def NEGIMP(tenses=("imp_neg",)):
    """Negative command: 'no' (+ clitics) + subjunctive-form verb, sentence starting with the negation."""
    clitics = {"me", "te", "se", "lo", "la", "le", "los", "las", "les", "nos", "os", "se lo"}

    def f(toks, ctx):
        low = [t[0].lower() for t in toks]
        start = 1 if low and low[0] in ("¡", "¿") else 0
        if len(low) <= start or low[start] != "no":
            return []
        j = start + 1
        while j < len(toks) and low[j] in clitics:
            j += 1
        if j >= len(toks):
            return []
        w, lem, up, morph, ws = toks[j]
        if up not in ("VERB", "AUX"):
            return []
        for t in tenses:
            p = _person_of(ctx, lem.lower(), t, w, morph)
            if p is not None and p in (1, 2, 4, 5):
                return [(j, 1, lem.lower(), None)]
        return []

    return f
