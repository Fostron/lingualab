"""Reference dictionary for look-ups beyond the course vocabulary (public/content/{course}/dict.json).

Entries: [word, pos, translation], most frequent first. Words already in the course lexicon are left out
(the app shows those with examples and audio). Translations: WikDict (bilingual) first, then the
English Wiktionary glosses from kaikki.org; for Russian, English glosses are marked "(англ.)".
usage: python pipeline/p07_refdict.py es-en fr-en fr-ru
"""
import importlib.util, json, pickle, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
OUT = ROOT / "public" / "content"

spec = importlib.util.spec_from_file_location("p03", Path(__file__).with_name("p03_lexicon.py"))
p03 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p03)

KEEP_POS = {"noun", "verb", "adj", "adv", "pron", "det", "prep", "conj", "num", "intj", "phrase"}
WORD_RE = re.compile(r"^[^\W\d_][\w'’\- ]{0,29}$")
STRESS = chr(0x301)  # Russian stress marks in WikDict translations


def form_freq(lang):
    freq = Counter()
    with open(RAW / f"{lang}_50k.txt", encoding="utf-8") as f:
        for line in f:
            form, cnt = line.rsplit(" ", 1)
            freq[form] = int(cnt)
    if lang == "fr":
        lex, _ = p03.fr_frequency()
        for (lemma, pos), v in lex.items():
            freq[(lemma, pos)] = v
    return freq


def gloss_of(lemma, pos, ents, wd, native):
    tr = wd.get(native)
    if tr:
        by_pos, simple = tr
        got = by_pos.get((lemma, pos)) or simple.get(lemma)
        if got:
            return "; ".join(got[:3])
    gl = []
    for e in ents:
        for g in e["gl"]:
            sg = p03.short_gloss(g)
            if sg and sg not in gl:
                gl.append(sg)
    if not gl:
        return ""
    text = "; ".join(gl[:3])
    return text if native == "en" else f"(англ.) {text}"


def main(course):
    lang, native = course.split("-")
    kaikki = pickle.load(open(WORK / f"{lang}_kaikki.pkl", "rb"))
    wd = {native: p03.load_wikdict(f"{lang}-{native}")}
    # lemmas taught in the course are shown from the lexicon (other parts of speech of e.g. "de", "la" are noise)
    have = {w["w"] for w in json.load(open(OUT / course / "lexicon.json", encoding="utf-8"))}
    freq = form_freq(lang)
    out = []
    for lemma, ents in kaikki["lemmas"].items():
        if not WORD_RE.match(lemma):
            continue
        by_pos = {}
        for e in ents:
            if e.get("alsoForm") or e["pos"] not in KEEP_POS or not e.get("gl"):
                continue
            by_pos.setdefault(e["pos"], []).append(e)
        for pos, es in by_pos.items():
            if lemma in have:
                continue
            g = gloss_of(lemma, pos, es, wd, native)
            if not g:
                continue
            rank = freq.get((lemma, pos)) or freq.get(lemma) or 0
            out.append((rank, lemma, pos, g.replace(STRESS, "")[:90]))
    out.sort(key=lambda x: (-x[0], x[1]))
    data = [[w, p, g] for _, w, p, g in out]
    path = OUT / course / "dict.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(course, "reference entries", len(data), f"{path.stat().st_size / 1e6:.1f}MB")


if __name__ == "__main__":
    for c in sys.argv[1:] or ["es-en", "fr-en", "fr-ru"]:
        main(c)
