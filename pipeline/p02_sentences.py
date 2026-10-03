"""Select Tatoeba sentences with translations and annotate them with spaCy.

Output: data/work/{lang}_sents.pkl  list of dicts:
  {id, text, native, audio, toks:[(text, lemma, pos, morph, ws)], tr:{en:[...], ru:[...]}}
"""
import csv, pickle, re, sys, time
from collections import defaultdict
from pathlib import Path

import spacy

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"

CFG = {
    "es": {"t3": "spa", "model": "es_core_news_md", "natives": [("eng", "en")]},
    "fr": {"t3": "fra", "model": "fr_core_news_md", "natives": [("eng", "en"), ("rus", "ru")]},
}
csv.field_size_limit(10_000_000)
GOOD_CHARS = re.compile(r"^[\w\s¿¡?!.,;:'’«»\"()\-–—…%€$°/]+$")


def read_tsv(path):
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            yield row


def main(lang):
    cfg = CFG[lang]
    t3 = cfg["t3"]
    natives_users = set()
    for row in read_tsv(RAW / "user_languages.csv"):
        if len(row) >= 3 and row[0] == t3 and row[1] == "5":
            natives_users.add(row[2])
    print(lang, "native users:", len(natives_users))

    audio = {}
    for row in read_tsv(RAW / "sentences_with_audio.csv"):
        if len(row) >= 4:
            audio.setdefault(row[1], (row[0], row[2], row[3]))

    sents = {}
    for row in read_tsv(RAW / f"{t3}_sentences_detailed.tsv"):
        if len(row) < 4:
            continue
        sid, _, text, owner = row[0], row[1], row[2].strip(), row[3]
        if not (3 <= len(text) <= 140) or not GOOD_CHARS.match(text):
            continue
        sents[sid] = {"id": int(sid), "text": text, "native": owner in natives_users,
                      "owner": owner, "tr": defaultdict(list)}
    print(lang, "candidate sentences:", len(sents))

    for n3, n2 in cfg["natives"]:
        texts = {}
        for row in read_tsv(RAW / f"{n3}_sentences.tsv"):
            if len(row) >= 3:
                texts[row[0]] = row[2].strip()
        cnt = 0
        for row in read_tsv(RAW / f"{t3}-{n3}_links.tsv"):
            if len(row) >= 2 and row[0] in sents and row[1] in texts:
                tr = sents[row[0]]["tr"][n2]
                if len(tr) < 4:
                    tr.append(texts[row[1]])
                    cnt += 1
        print(lang, n2, "links:", cnt)

    keep = [s for s in sents.values() if s["tr"]]
    print(lang, "with translations:", len(keep))

    nlp = spacy.load(cfg["model"], disable=["parser", "ner"])
    t0 = time.time()
    texts = [s["text"] for s in keep]
    for i, doc in enumerate(nlp.pipe(texts, batch_size=1000)):
        s = keep[i]
        s["toks"] = [(t.text, t.lemma_, t.pos_, str(t.morph), t.whitespace_) for t in doc]
        s["tr"] = dict(s["tr"])
        a = audio.get(str(s["id"]))
        s["audio"] = {"aid": a[0], "by": a[1], "lic": a[2]} if a else None
        if i % 50000 == 0:
            print(lang, i, f"{time.time() - t0:.0f}s", flush=True)
    keep = [s for s in keep if 2 <= sum(1 for t in s["toks"] if t[2] != "PUNCT") <= 22]
    with open(WORK / f"{lang}_sents.pkl", "wb") as fo:
        pickle.dump(keep, fo)
    print(lang, "saved", len(keep), f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    for lang in sys.argv[1:] or ["es", "fr"]:
        main(lang)
