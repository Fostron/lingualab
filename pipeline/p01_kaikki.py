"""Extract a compact lexicon from kaikki.org (English Wiktionary) dumps.

Output: data/work/{lang}_kaikki.pkl with
  lemmas: {word: [ {pos, ipa, g, pl, fem, gl:[...]} ]}
  forms:  {form: [(lemma, pos, tags)]}
"""
import json, pickle, re, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
WORK.mkdir(parents=True, exist_ok=True)

FILES = {"es": "kaikki.org-dictionary-Spanish.jsonl", "fr": "kaikki.org-dictionary-French.jsonl"}

POS_MAP = {
    "noun": "noun", "verb": "verb", "adj": "adj", "adv": "adv", "pron": "pron",
    "det": "det", "article": "det", "prep": "prep", "conj": "conj", "num": "num",
    "intj": "intj", "name": "propn", "phrase": "phrase", "prep_phrase": "phrase",
    "contraction": "contr", "particle": "part",
}
SKIP_SENSE_TAGS = {"obsolete", "archaic", "dated", "rare", "historical", "nonstandard",
                   "misspelling", "Internet", "dialectal"}
BAD_GLOSS = re.compile(r"^(plural of|feminine of|masculine of|alternative (form|spelling) of|"
                       r"obsolete|archaic|misspelling of|abbreviation of|initialism of)", re.I)


def gender_of(d):
    for ht in d.get("head_templates") or []:
        name = ht.get("name", "")
        if name in ("es-noun", "fr-noun", "es-proper noun", "fr-proper noun"):
            g = (ht.get("args") or {}).get("1", "")
            g = g.replace("-p", "").replace("-s", "")
            if g in ("m", "f", "mf", "mfbysense", "m-f", "mfequiv"):
                return {"mfbysense": "mf", "m-f": "mf", "mfequiv": "mf"}.get(g, g)
    tags = set()
    for s in d.get("senses") or []:
        tags.update(s.get("tags") or [])
    if "masculine" in tags and "feminine" in tags:
        return "mf"
    if "masculine" in tags:
        return "m"
    if "feminine" in tags:
        return "f"
    return None


def ipa_of(d):
    for s in d.get("sounds") or []:
        ipa = s.get("ipa")
        if ipa and ipa.startswith("/"):
            return ipa
    for s in d.get("sounds") or []:
        if s.get("ipa"):
            return s["ipa"]
    return None


def form_with(d, want, avoid=()):
    for f in d.get("forms") or []:
        tags = set(f.get("tags") or [])
        form = f.get("form", "")
        if want <= tags and not (tags & set(avoid)) and " " not in form.strip() and form not in ("-", "—"):
            return form
    return None


def clean_gloss(g):
    g = re.sub(r"\s+", " ", g).strip()
    return g


def main(lang):
    lemmas = defaultdict(list)
    forms = defaultdict(list)
    path = RAW / FILES[lang]
    n = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            n += 1
            d = json.loads(line)
            word = d.get("word")
            pos = POS_MAP.get(d.get("pos"))
            if not word or not pos:
                continue
            glosses = []
            is_form = False
            for s in d.get("senses") or []:
                tags = set(s.get("tags") or [])
                fo = s.get("form_of") or s.get("alt_of")
                if fo:
                    for x in fo:
                        if x.get("word"):
                            forms[word].append((x["word"], pos, tuple(sorted(tags - {"form-of", "alt-of"}))))
                    is_form = True
                    continue
                if tags & SKIP_SENSE_TAGS:
                    continue
                for g in s.get("glosses") or []:
                    if BAD_GLOSS.match(g):
                        continue
                    g = clean_gloss(g)
                    if g and g not in glosses:
                        glosses.append(g)
            if not glosses:
                continue
            entry = {"pos": pos, "gl": glosses[:6]}
            ipa = ipa_of(d)
            if ipa:
                entry["ipa"] = ipa
            if pos in ("noun", "propn"):
                g = gender_of(d)
                if g:
                    entry["g"] = g
                pl = form_with(d, {"plural"}, avoid=("feminine",))
                if pl:
                    entry["pl"] = pl
                fem = form_with(d, {"feminine"}, avoid=("plural",))
                if fem:
                    entry["fem"] = fem
            elif pos == "adj":
                fem = form_with(d, {"feminine"}, avoid=("plural",))
                if fem:
                    entry["fem"] = fem
                pl = form_with(d, {"plural"}, avoid=("feminine",))
                if pl:
                    entry["pl"] = pl
            if is_form:
                entry["alsoForm"] = True
            lemmas[word].append(entry)
            if n % 200000 == 0:
                print(lang, n, len(lemmas), len(forms), flush=True)
    out = {"lemmas": dict(lemmas), "forms": dict(forms)}
    with open(WORK / f"{lang}_kaikki.pkl", "wb") as fo:
        pickle.dump(out, fo)
    print(lang, "done", n, "lines;", len(lemmas), "lemmas;", len(forms), "forms")


if __name__ == "__main__":
    for lang in sys.argv[1:] or ["es", "fr"]:
        main(lang)
