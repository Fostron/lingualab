"""Collect native-speaker word recordings (Wikimedia Commons / Lingua Libre) from kaikki dumps.

Output: data/work/{lang}_wordaudio.json  {word: "a/ab/File_name.ext"}  (Commons hash path)
The app builds https://upload.wikimedia.org/wikipedia/commons/transcoded/<path>/<file>.mp3
(or the original URL for files that already are mp3).
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
FILES = {"es": "kaikki.org-dictionary-Spanish.jsonl", "fr": "kaikki.org-dictionary-French.jsonl"}
PREFERRED_TAGS = {"es": ["Spain", "Madrid", "Castilian"], "fr": ["France", "Paris"]}
RX = re.compile(r"https://upload\.wikimedia\.org/wikipedia/commons/(?:transcoded/)?([0-9a-f]/[0-9a-f]{2}/[^/]+)")


def score(sound, lang):
    s = 0
    audio = sound.get("audio", "")
    if audio.startswith("LL-"):
        s += 3  # Lingua Libre: clean, single-word recordings
    tags = " ".join(sound.get("tags", []))
    if any(t in tags for t in PREFERRED_TAGS[lang]):
        s += 2
    return s


def main(lang):
    lex = json.load(open(WORK / f"{lang}_lex.json", encoding="utf-8"))
    wanted = {x["w"] for x in lex[:12000]}
    best = {}
    with open(RAW / FILES[lang], encoding="utf-8") as f:
        for line in f:
            if '"mp3_url"' not in line:
                continue
            d = json.loads(line)
            w = d.get("word")
            if w not in wanted:
                continue
            for snd in d.get("sounds") or []:
                url = snd.get("mp3_url") or snd.get("ogg_url")
                if not url:
                    continue
                mm = RX.match(url)
                if not mm:
                    continue
                path = mm.group(1)
                sc = score(snd, lang)
                if w not in best or sc > best[w][0]:
                    best[w] = (sc, path)
    out = {w: p for w, (s, p) in best.items()}
    json.dump(out, open(WORK / f"{lang}_wordaudio.json", "w", encoding="utf-8"), ensure_ascii=False)
    top = [x["w"] for x in lex[:3000]]
    print(lang, "words with audio:", len(out), f"top-3000 coverage: {sum(1 for w in top if w in out) / len(top):.0%}")


if __name__ == "__main__":
    for lang in sys.argv[1:] or ["es", "fr"]:
        main(lang)
