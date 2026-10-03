"""Download the open datasets the pipeline reads into data/raw (skips files that are already there).
usage: python pipeline/p00_download.py
About 3 GB on disk, mostly the two kaikki.org dumps.
"""
import bz2, shutil, sys, tarfile, urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
TATOEBA = "https://downloads.tatoeba.org/exports"
FILES = [
    # Tatoeba (CC BY 2.0 FR): sentences, translation links, native speakers, audio
    f"{TATOEBA}/per_language/spa/spa_sentences.tsv.bz2",
    f"{TATOEBA}/per_language/spa/spa_sentences_detailed.tsv.bz2",
    f"{TATOEBA}/per_language/spa/spa-eng_links.tsv.bz2",
    f"{TATOEBA}/per_language/fra/fra_sentences.tsv.bz2",
    f"{TATOEBA}/per_language/fra/fra_sentences_detailed.tsv.bz2",
    f"{TATOEBA}/per_language/fra/fra-eng_links.tsv.bz2",
    f"{TATOEBA}/per_language/fra/fra-rus_links.tsv.bz2",
    f"{TATOEBA}/per_language/eng/eng_sentences.tsv.bz2",
    f"{TATOEBA}/per_language/rus/rus_sentences.tsv.bz2",
    f"{TATOEBA}/sentences_with_audio.tar.bz2",
    f"{TATOEBA}/user_languages.tar.bz2",
    # Wiktionary extracts by kaikki.org (CC BY-SA)
    "https://kaikki.org/dictionary/Spanish/kaikki.org-dictionary-Spanish.jsonl",
    "https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl",
    # WikDict bilingual dictionaries (CC BY-SA)
    "https://download.wikdict.com/dictionaries/sqlite/2/es-en.sqlite3",
    "https://download.wikdict.com/dictionaries/sqlite/2/fr-en.sqlite3",
    "https://download.wikdict.com/dictionaries/sqlite/2/fr-ru.sqlite3",
    # word frequencies from subtitles (MIT / CC BY-SA)
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/es/es_50k.txt",
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/fr/fr_50k.txt",
    # French lexical database (CC BY-SA)
    "http://www.lexique.org/databases/Lexique383/Lexique383.tsv",
]


def fetch(url):
    dest = RAW / url.rsplit("/", 1)[1]
    if dest.exists():
        return dest
    print("downloading", url, flush=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "LinguaLab-pipeline"})
    with urllib.request.urlopen(req) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    tmp.rename(dest)
    return dest


def unpack(path):
    if path.name.endswith(".tar.bz2"):
        with tarfile.open(path) as t:
            for m in t.getmembers():
                if m.isfile() and not (RAW / Path(m.name).name).exists():
                    print("extracting", m.name, flush=True)
                    with t.extractfile(m) as src, open(RAW / Path(m.name).name, "wb") as out:
                        shutil.copyfileobj(src, out, 1 << 20)
    elif path.suffix == ".bz2":
        out = path.with_suffix("")
        if not out.exists():
            print("extracting", path.name, flush=True)
            with bz2.open(path) as src, open(out, "wb") as f:
                shutil.copyfileobj(src, f, 1 << 20)


if __name__ == "__main__":
    RAW.mkdir(parents=True, exist_ok=True)
    for url in FILES:
        try:
            unpack(fetch(url))
        except Exception as e:  # keep going; rerun to retry what failed
            print("  failed:", url, e, file=sys.stderr)
