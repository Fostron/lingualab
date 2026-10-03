"""Build ranked lexicon (lemma frequency + dictionary data + glosses) per target language.

Output: data/work/{lang}_lex.json  list ordered by frequency rank:
  {w, pos, g?, ipa?, pl?, fem?, freq, gl:{en:[...], ru:[...]}}
"""
import json, pickle, re, sqlite3, sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"

UPOS = {"NOUN": "noun", "VERB": "verb", "AUX": "verb", "ADJ": "adj", "ADV": "adv", "PRON": "pron",
        "DET": "det", "ADP": "prep", "CCONJ": "conj", "SCONJ": "conj", "NUM": "num", "INTJ": "intj"}
LEXIQUE_POS = {"NOM": "noun", "VER": "verb", "AUX": "verb", "ADJ": "adj", "ADV": "adv", "PRE": "prep",
               "CON": "conj", "ONO": "intj", "ADJ:num": "num", "ART:def": "det", "ART:ind": "det",
               "ADJ:pos": "det", "ADJ:dem": "det", "ADJ:ind": "det", "ADJ:int": "det"}
# WikDict lexentry POS fragments -> our POS
WD_POS = [("verbe", "verb"), ("verbo", "verb"), ("nom", "noun"), ("sustantivo", "noun"),
          ("adjectif", "adj"), ("adj", "adj"), ("adverbe", "adv"), ("adverbio", "adv"), ("adv", "adv"),
          ("pronom", "pron"), ("pronombre", "pron"), ("préposition", "prep"), ("preposición", "prep"),
          ("conjonction", "conj"), ("conjunción", "conj"), ("article", "det"), ("artículo", "det"),
          ("numéral", "num"), ("numeral", "num"), ("interjection", "intj"), ("interjección", "intj")]


def wd_pos(lexentry):
    frag = lexentry.split("/", 1)[-1].split("__")[1] if lexentry and "__" in lexentry else ""
    for k, v in WD_POS:
        if frag.startswith(k):
            return v
    return None


def load_wikdict(pair):
    """{(word,pos): [translations ordered]} and {word: [translations]} (pos-agnostic)."""
    db = sqlite3.connect(RAW / f"{pair}.sqlite3")
    by_pos = defaultdict(Counter)
    for lexentry, sense_num, written, trans_list, score, importance in db.execute(
            "select lexentry, sense_num, written_rep, trans_list, score, importance from translation"):
        p = wd_pos(lexentry)
        rank_bonus = 1.0 / (int(sense_num) if sense_num and str(sense_num).isdigit() else 3)
        for i, t in enumerate((trans_list or "").split(" | ")):
            t = t.strip()
            if t:
                by_pos[(written, p)][t] += (score or 1) * rank_bonus / (1 + 0.3 * i)
    simple = {}
    for written, trans_list in db.execute("select written_rep, trans_list from simple_translation"):
        simple[written] = [t.strip() for t in trans_list.split(" | ") if t.strip()]
    return {k: [t for t, _ in c.most_common(6)] for k, c in by_pos.items()}, simple


def short_gloss(g):
    """kaikki gloss -> short learner gloss."""
    g = re.sub(r"\([^)]*\)", "", g)
    g = re.sub(r"\s+", " ", g).strip(" ;,.")
    parts = [p.strip() for p in re.split(r"[;]", g) if p.strip()]
    return parts[0] if parts else ""


def es_frequency(kaikki):
    sents = pickle.load(open(WORK / "es_sents.pkl", "rb"))
    form_lemma = defaultdict(Counter)
    for s in sents:
        for text, lemma, upos, morph, ws in s["toks"]:
            pos = UPOS.get(upos)
            if pos:
                form_lemma[text.lower()][(lemma.lower(), pos)] += 1
    freq = Counter()
    with open(RAW / "es_50k.txt", encoding="utf-8") as f:
        for line in f:
            form, cnt = line.rsplit(" ", 1)
            cnt = int(cnt)
            c = form_lemma.get(form)
            if c and sum(c.values()) >= 3:
                tot = sum(c.values())
                for k, v in c.items():
                    freq[k] += cnt * v / tot
            else:
                ents = kaikki["lemmas"].get(form)
                if ents and not all(e.get("alsoForm") for e in ents):
                    freq[(form, ents[0]["pos"])] += cnt
                elif form in kaikki["forms"]:
                    cands = {(l, p) for l, p, _ in kaikki["forms"][form]}
                    for k in cands:
                        freq[k] += cnt / len(cands)
    return freq


def fr_frequency():
    freq = Counter()
    extra = {}
    with open(RAW / "Lexique383.tsv", encoding="utf-8") as f:
        header = f.readline().rstrip("\n").split("\t")
        ix = {h: i for i, h in enumerate(header)}
        seen = set()
        for line in f:
            r = line.rstrip("\n").split("\t")
            lemma, cg = r[ix["lemme"]], r[ix["cgram"]]
            pos = LEXIQUE_POS.get(cg) or ("pron" if cg.startswith("PRO") else None)
            if not pos:
                continue
            key = (lemma, pos)
            if key in seen:
                continue
            seen.add(key)
            try:
                fl = float(r[ix["freqlemfilms2"]] or 0) + 0.3 * float(r[ix["freqlemlivres"]] or 0)
            except ValueError:
                continue
            freq[key] += fl
            if pos == "noun" and r[ix["genre"]]:
                extra.setdefault(key, {})["g"] = r[ix["genre"]]
    return freq, extra


def main(lang):
    kaikki = pickle.load(open(WORK / f"{lang}_kaikki.pkl", "rb"))
    if lang == "es":
        freq = es_frequency(kaikki)
        lex_extra = {}
        wd = {"en": load_wikdict("es-en")}
    else:
        freq, lex_extra = fr_frequency()
        wd = {"en": load_wikdict("fr-en"), "ru": load_wikdict("fr-ru")}

    out = []
    for (lemma, pos), fq in freq.most_common():
        if len(out) >= 12000:
            break
        if not lemma or not re.match(r"^[\w'’\- ]+$", lemma) or lemma.isdigit():
            continue
        ents = [e for e in kaikki["lemmas"].get(lemma, []) if e["pos"] == pos]
        if not ents and pos in ("det", "pron"):
            ents = [e for e in kaikki["lemmas"].get(lemma, []) if e["pos"] in ("det", "pron")]
        if not ents:
            continue
        e0 = ents[0]
        item = {"w": lemma, "pos": pos, "freq": round(fq, 2)}
        for k in ("g", "ipa", "pl", "fem"):
            if e0.get(k):
                item[k] = e0[k]
        if lex_extra.get((lemma, pos), {}).get("g") and "g" not in item:
            item["g"] = lex_extra[(lemma, pos)]["g"]
        gl = {"en_kaikki": [], "en": [], "ru": []}
        for e in ents:
            for g in e["gl"]:
                sg = short_gloss(g)
                if sg and sg not in gl["en_kaikki"]:
                    gl["en_kaikki"].append(sg)
        gl["en_kaikki"] = gl["en_kaikki"][:5]
        for nl, (by_pos, simple) in wd.items():
            tr = by_pos.get((lemma, pos)) or simple.get(lemma) or []
            gl[nl] = tr[:5]
        item["gl"] = gl
        out.append(item)
    # de-duplicate same lemma+pos and drop obvious junk
    with open(WORK / f"{lang}_lex.json", "w", encoding="utf-8") as fo:
        json.dump(out, fo, ensure_ascii=False, indent=0)
    print(lang, "lexicon", len(out))


if __name__ == "__main__":
    for lang in sys.argv[1:] or ["es", "fr"]:
        main(lang)
