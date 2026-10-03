"""Add native word recordings listed in Wikimedia Commons categories (Lingua Libre etc.).

usage: python pipeline/p06b_commons_audio.py es
Merges into data/work/{lang}_wordaudio.json (existing entries win).
"""
import hashlib, json, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "data" / "work"
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "LinguaLab/0.1 (personal language-learning app; contact via GitHub Fostron)"}
CATS = {
    "es": ["Category:Lingua Libre pronunciation-spa", "Category:Spanish pronunciation"],
    "fr": ["Category:Lingua Libre pronunciation-fra"],
}


def members(cat):
    cont = None
    while True:
        q = {"action": "query", "list": "categorymembers", "cmtitle": cat, "cmlimit": "500", "cmtype": "file", "format": "json"}
        if cont:
            q["cmcontinue"] = cont
        req = urllib.request.Request(API + "?" + urllib.parse.urlencode(q), headers=UA)
        for attempt in range(8):
            try:
                data = json.load(urllib.request.urlopen(req, timeout=60))
                break
            except urllib.error.HTTPError as e:
                if e.code != 429:
                    raise
                wait = int(e.headers.get("Retry-After") or 0) or 5 * (attempt + 1)
                print("  rate limited, waiting", wait, "s", flush=True)
                time.sleep(wait)
        else:
            raise RuntimeError("Commons API keeps rate-limiting")
        for m in data["query"]["categorymembers"]:
            yield m["title"][5:]  # strip "File:"
        cont = data.get("continue", {}).get("cmcontinue")
        if not cont:
            break
        time.sleep(1.5)


def hashed(fname):
    f = fname.replace(" ", "_")
    h = hashlib.md5(f.encode("utf-8")).hexdigest()
    return f"{h[0]}/{h[:2]}/{urllib.parse.quote(f)}"


def word_of(fname, lang):
    base = re.sub(r"\.(wav|ogg|flac|mp3|oga)$", "", fname, flags=re.I)
    m = re.match(r"LL-Q\d+ \([a-z]{3}\)-[^-]+-(.+)$", base)
    if m:
        w = re.sub(r"^\([^)]*\)\s*", "", m.group(1))
        return w.strip(), 3
    m = re.match(r"(?:ES|Es|es|FR|Fr|fr)-(.+)$", base)
    if m:
        w = re.sub(r"\s*\(.*\)$", "", m.group(1)).replace("_", " ")
        return w.strip(), 1
    return None, 0


def main(lang):
    out_path = WORK / f"{lang}_wordaudio.json"
    current = json.load(open(out_path, encoding="utf-8")) if out_path.exists() else {}
    lex = json.load(open(WORK / f"{lang}_lex.json", encoding="utf-8"))
    wanted = {x["w"] for x in lex[:12000]}
    found = {}
    n = 0
    for cat in CATS[lang]:
        for fname in members(cat):
            n += 1
            w, sc = word_of(fname, lang)
            if not w:
                continue
            for cand in {w, w.lower()}:
                if cand in wanted and (cand not in found or sc > found[cand][0]):
                    found[cand] = (sc, hashed(fname))
        print(lang, cat, "files so far", n, "matched", len(found), flush=True)
    added = 0
    for w, (sc, p) in found.items():
        if w not in current:
            current[w] = p
            added += 1
    json.dump(current, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
    top = [x["w"] for x in lex[:3000]]
    print(lang, "added", added, "total", len(current), f"top-3000 coverage: {sum(1 for w in top if w in current) / len(top):.0%}")


if __name__ == "__main__":
    for lang in sys.argv[1:] or ["es"]:
        main(lang)
