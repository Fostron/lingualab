"""Assemble a course pack (public/content/{course}/*.json) from data + authored content.

usage: python pipeline/p05_build.py es-en fr-en fr-ru
"""
import csv, importlib.util, json, pickle, re, sys, time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "data" / "work"
CONTENT = ROOT / "content"
OUT = ROOT / "public" / "content"
sys.path.insert(0, str(ROOT / "pipeline"))

UPOS = {"NOUN": "noun", "VERB": "verb", "AUX": "verb", "ADJ": "adj", "ADV": "adv", "PRON": "pron",
        "DET": "det", "ADP": "prep", "CCONJ": "conj", "SCONJ": "conj", "NUM": "num", "INTJ": "intj"}
CLOSED = {"PRON", "DET", "ADP", "CCONJ", "SCONJ", "ADV"}
WORDS_PER_UNIT = {"A1": 22, "A2": 28, "B1": 34, "B2": 40, "C1": 45}
PACK_SIZE = 50
LEXICON_SIZE = 10000

TENSE_NAMES = {
    "es": {
        "en": {"pres": "Present", "pret": "Preterite", "impf": "Imperfect", "fut": "Future", "cond": "Conditional",
               "perf": "Present perfect", "plup": "Pluperfect", "fut_perf": "Future perfect", "cond_perf": "Conditional perfect",
               "subj": "Present subjunctive", "subj_impf": "Imperfect subjunctive", "subj_perf": "Perfect subjunctive",
               "subj_plup": "Pluperfect subjunctive", "imp": "Imperative", "imp_neg": "Negative imperative (no …)",
               "ger": "Gerund", "part": "Past participle"},
    },
    "fr": {
        "en": {"pres": "Présent", "pc": "Passé composé", "impf": "Imparfait", "pqp": "Plus-que-parfait",
               "fut": "Futur simple", "futant": "Futur antérieur", "cond": "Conditionnel présent",
               "condp": "Conditionnel passé", "subj": "Subjonctif présent", "subjp": "Subjonctif passé",
               "ps": "Passé simple", "imp": "Impératif", "ppres": "Participe présent", "pp": "Participe passé"},
        "ru": {"pres": "Présent (настоящее)", "pc": "Passé composé (прошедшее)", "impf": "Imparfait (имперфект)",
               "pqp": "Plus-que-parfait (предпрошедшее)", "fut": "Futur simple (будущее)",
               "futant": "Futur antérieur (предбудущее)", "cond": "Conditionnel présent (условное)",
               "condp": "Conditionnel passé (условное прошедшее)", "subj": "Subjonctif présent (сослагательное)",
               "subjp": "Subjonctif passé", "ps": "Passé simple (простое прошедшее)", "imp": "Impératif (повелительное)",
               "ppres": "Participe présent", "pp": "Participe passé (причастие)"},
    },
}
PERSONS = {
    "es": ["yo", "tú", "él / ella / usted", "nosotros", "vosotros", "ellos / ellas / ustedes"],
    "fr": ["je (j’)", "tu", "il / elle / on", "nous", "vous", "ils / elles"],
}
CHARS = {"es": ["á", "é", "í", "ó", "ú", "ñ", "ü", "¿", "¡"],
         "fr": ["é", "è", "ê", "ë", "à", "â", "î", "ï", "ô", "û", "ù", "ç", "œ", "’"]}
TTS = {"es": "es-ES", "fr": "fr-FR"}
TITLES = {
    "es-en": ("Spanish", "for English speakers"),
    "fr-en": ("French", "for English speakers"),
    "fr-ru": ("Французский", "для русскоговорящих"),
}
PACK_TITLE = {"en": "Vocabulary boost {lvl} · {n}", "ru": "Словарный запас {lvl} · {n}"}
GOOD_AUDIO_LIC = ("CC BY", "CC BY-NC", "CC BY-SA", "CC0", "CC BY-NC-ND", "CC BY-ND")


def load_module(path):
    spec = importlib.util.spec_from_file_location("curr", path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def strip_stress(s):
    return s.replace("́", "").replace("̀", "")


BAD_AUTO_GLOSS = re.compile(r"(used |form of|plural of|feminine of|indicates|denotes|expresses|^\(|inflection of|"
                            r"Forms |apocopic|alternative|elided|spelling|abbreviation)", re.I)


def auto_gloss(item, native):
    """Concise gloss from dictionary data (used where no curated gloss exists)."""
    if native == "ru":
        cands = [strip_stress(x) for x in item["gl"].get("ru", [])]
    else:
        cands = list(item["gl"].get("en_kaikki", [])) + list(item["gl"].get("en", []))
    out = []
    for g in cands:
        g = g.strip(" ,.;")
        if not g or len(g) > 40 or BAD_AUTO_GLOSS.search(g):
            continue
        if native == "en" and item["pos"] == "verb" and not g.startswith("to ") and " " not in g and g.isalpha():
            g = "to " + g
        key = g.lower()
        if key not in [o.lower() for o in out]:
            out.append(g)
        if len(out) >= 3:
            break
    return out


def read_glossary(lang):
    """content/{lang}/glossary*.txt lines:  w|pos|en|ru|note_en|note_ru   ('#' comments, empty fields allowed).
    A gloss starting with '!' keeps the word in the dictionary but out of the units; '-' drops it."""
    g = {}
    order = []
    for path in sorted((CONTENT / lang).glob("glossary*.txt")):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\r\n")
                if not line.strip() or line.startswith("#"):
                    continue
                parts = [p.strip() for p in line.split("|")]
                while len(parts) < 6:
                    parts.append("")
                w, pos, en, ru, note_en, note_ru = parts[:6]
                key = (w, pos)
                if key not in g:
                    order.append(key)
                g[key] = {"en": en, "ru": ru, "note_en": note_en, "note_ru": note_ru}
    return g, order


def parse_drills(path):
    """Line format:
         gap: Yo ___ (hablar) inglés. => hablo | hablo yo
         choice: ___ agua está fría. => El | La | Los
         transform[en=Make it negative|ru=Сделайте отрицательным]: Je mange. => Je ne mange pas.
    For choice, the first option after => is the right one."""
    drills = []
    if not path.exists():
        return drills
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=>" not in line:
            continue
        m = re.match(r"^(gap|choice|transform|order)(\[[^\]]*\])?\s*:\s*(.*?)\s*=>\s*(.*)$", line)
        if not m:
            print("  bad drill line:", line)
            continue
        t, hints, q, a = m.groups()
        h = {}
        if hints:
            for part in hints[1:-1].split("|"):
                if "=" in part:
                    k, v = part.split("=", 1)
                    h[k.strip()] = v.strip()
        answers = [x.strip() for x in a.split("|") if x.strip()]
        d = {"t": t, "q": q, "a": answers[:1] if t == "choice" else answers}
        if t == "choice":
            d["o"] = answers
        if h:
            d["_h"] = h
        drills.append(d)
    return drills


def parse_placement(path):
    items = []
    if not path.exists():
        return items
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 4:
            continue
        lvl, q, opts = parts[0], parts[1], parts[2:]
        items.append({"lvl": lvl, "q": q, "o": opts, "a": 0})
    return items


def main(course):
    t0 = time.time()
    lang, native = course.split("-")
    cur = load_module(CONTENT / lang / "curriculum.py")
    lex = json.load(open(WORK / f"{lang}_lex.json", encoding="utf-8"))
    conj = json.load(open(WORK / f"{lang}_conj.json", encoding="utf-8"))
    glossary, gorder = read_glossary(lang)
    _kaikki = {}

    def kaikki_lemmas():
        if not _kaikki:
            _kaikki.update(pickle.load(open(WORK / f"{lang}_kaikki.pkl", "rb"))["lemmas"])
        return _kaikki
    print(course, "loaded", f"{time.time() - t0:.0f}s")

    # ---------- lexicon ----------
    words = []
    by_key = {}
    by_lemma = defaultdict(list)
    skip_pos = {"propn", "phrase", "contr", "part"}
    for item in lex:
        w, pos = item["w"], item["pos"]
        if pos in skip_pos or "'" in w or "’" in w or (w, pos) in by_key:
            continue
        gl = glossary.get((w, pos))
        if gl and gl.get(native) == "-":
            continue  # explicitly excluded
        nofill = False
        if gl and gl.get(native):
            gtxt = gl[native]
            if gtxt.startswith("!"):
                nofill = True
                gtxt = gtxt[1:]
            trs = [x.strip() for x in gtxt.split(";") if x.strip()]
            curated = True
        else:
            trs = auto_gloss(item, native)
            curated = False
        if not trs:
            continue
        entry = {"id": 0, "w": w, "pos": pos, "tr": "; ".join(trs[:3]) if not curated else "; ".join(trs), "r": 0}
        for k in ("g", "ipa", "pl", "fem"):
            if item.get(k):
                entry[k] = item[k]
        if gl and gl.get(f"note_{native}"):
            entry["note"] = gl[f"note_{native}"]
        entry["_cur"] = curated
        if nofill:
            entry["_nofill"] = True
        by_key[(w, pos)] = entry
        words.append(entry)
        if len(words) >= LEXICON_SIZE:
            break
    # custom glossary entries (phrases, reflexive verbs, …) not in the frequency lexicon
    for key in gorder:
        if key in by_key:
            continue
        gl = glossary[key]
        if not gl.get(native) or gl[native] == "-":
            continue
        w, pos = key
        src = next((x for x in lex if x["w"] == w and x["pos"] == pos), None) or next((x for x in lex if x["w"] == w), None)
        if not src and pos in ("noun", "adj", "verb", "adv", "det", "conj"):
            kk = kaikki_lemmas().get(w) or []
            src = next((x for x in kk if x["pos"] == pos), None)
        entry = {"id": 0, "w": w, "pos": pos, "tr": gl[native].lstrip("!"), "r": 0, "_cur": True, "_custom": True}
        if gl[native].startswith("!"):
            entry["_nofill"] = True
        if src:
            for k in ("g", "ipa", "pl", "fem"):
                if src.get(k):
                    entry[k] = src[k]
        if gl.get(f"note_{native}"):
            entry["note"] = gl[f"note_{native}"]
        by_key[key] = entry
        words.append(entry)
    n_freq = sum(1 for e in words if "_custom" not in e)
    wa_path = WORK / f"{lang}_wordaudio.json"
    word_audio = json.load(open(wa_path, encoding="utf-8")) if wa_path.exists() else {}
    for e in words:
        if e["w"] in word_audio:
            e["wa"] = word_audio[e["w"]]
    for i, e in enumerate(words):
        e["id"] = i + 1
        # custom entries (phrases, reflexives) get a mid-frequency rank for distractor selection
        e["r"] = i + 1 if "_custom" not in e else min(n_freq, 1500)
        by_lemma[e["w"]].append(e)
    print(course, "lexicon", len(words), "curated", sum(1 for e in words if e["_cur"]))

    def resolve(spec):
        spec = spec.strip()
        if ":" in spec and not spec.startswith(":"):
            w, pos = spec.rsplit(":", 1)
            return by_key.get((w, pos))
        cands = by_lemma.get(spec)
        if not cands:
            return None
        return sorted(cands, key=lambda e: (not e["_cur"], e["r"]))[0]

    # ---------- units ----------
    units = []
    assigned = set()
    missing = []
    fill_pool = [e for e in words if e["pos"] not in ("intj",) and len(e["w"]) > 1 or e["w"] in ("a", "y", "o", "e", "u", "à", "y")]
    curated_first = sorted(fill_pool, key=lambda e: (not e["_cur"], e["r"]))
    pack_counter = defaultdict(int)
    reserved = set()
    for u in cur.UNITS:
        for spec in u.get("words", []):
            e = resolve(spec)
            if e:
                reserved.add(e["id"])
    for n, u in enumerate(cur.UNITS):
        lvl = u["level"]
        uw = []
        for spec in u.get("words", []):
            e = resolve(spec)
            if not e:
                missing.append(spec)
                continue
            if e["id"] in assigned:
                continue
            uw.append(e["id"])
            assigned.add(e["id"])
        target = PACK_SIZE if u.get("pack") else WORDS_PER_UNIT[lvl]
        for e in curated_first:
            if len(uw) >= target:
                break
            if e["id"] in assigned or e["id"] in reserved or e.get("_nofill"):
                continue
            uw.append(e["id"])
            assigned.add(e["id"])
        if u.get("pack"):
            pack_counter[lvl] += 1
            title = PACK_TITLE[native].format(lvl=lvl, n=pack_counter[lvl])
        else:
            title = u["title"][native] if isinstance(u["title"], dict) else u["title"]
        units.append({"id": u["id"], "n": n + 1, "level": lvl, "title": title, "topics": u.get("topics", []), "words": uw, "sents": []})
    unit_of = {}
    for ui, u in enumerate(units):
        for wid in u["words"]:
            unit_of[wid] = ui
    for e in words:
        if e["id"] in unit_of:
            e["u"] = unit_of[e["id"]]
    if missing:
        print(course, "MISSING theme words:", " ".join(missing))

    # ---------- sentences ----------
    sents = pickle.load(open(WORK / f"{lang}_sents.pkl", "rb"))
    INF = 10 ** 6
    pool = []
    for s in sents:
        trs = s["tr"].get(native)
        if not trs:
            continue
        tr = trs[0]
        toks = s["toks"]
        if len(toks) > 18:
            continue
        tk = []
        cover = -1
        ok = True
        for (w, lem, up, morph, ws) in toks:
            wid = 0
            if up not in ("PUNCT", "SYM", "SPACE", "X"):
                pos = UPOS.get(up)
                e = None
                if pos and up in CLOSED:
                    e = by_key.get((w.lower(), pos))
                if not e and pos:
                    e = by_key.get((lem.lower(), pos))
                if not e and pos:
                    e = by_key.get((w.lower(), pos))
                if not e and up != "PROPN":
                    cands = by_lemma.get(lem.lower()) or by_lemma.get(w.lower())
                    e = cands[0] if cands else None
                if e:
                    wid = e["id"]
                    # grammar-only forms (lo, la, me, se…) are taught by topics; they don't block coverage
                    if not (e.get("_nofill") and e["pos"] in ("det", "pron", "prep", "conj", "adv")):
                        cover = max(cover, unit_of.get(wid, INF))
                elif up not in ("PROPN", "NUM") and re.search(r"\w", w):
                    ok = False
            tk.append([w, wid, 1 if ws else 0])
        if not ok:
            continue
        nw = sum(1 for x in tk if x[1])
        quality = (2 if s["native"] else 0) + (1 if s.get("audio") else 0) - abs(nw - 7) * 0.15
        pool.append({"id": s["id"], "tk": tk, "tr": tr, "alt": trs[1:3], "cover": cover,
                     "q": quality, "audio": s.get("audio"), "toks": toks, "nw": nw})
    print(course, "sentence pool", len(pool), f"{time.time() - t0:.0f}s")

    used = set()
    # unit practice sentences: covered exactly at this unit
    by_cover = defaultdict(list)
    for p in pool:
        if p["cover"] < INF and 2 <= p["nw"] <= 14:
            by_cover[p["cover"]].append(p)
    for ui, u in enumerate(units):
        cands = sorted(by_cover.get(ui, []), key=lambda p: -p["q"])
        seen_txt = set()
        for p in cands:
            key = " ".join(x[0].lower() for x in p["tk"])
            if key in seen_txt:
                continue
            seen_txt.add(key)
            u["sents"].append(p["id"])
            used.add(p["id"])
            if len(u["sents"]) >= 40:
                break

    # word examples
    by_word = defaultdict(list)
    for p in pool:
        if 3 <= p["nw"] <= 12:
            for x in {t[1] for t in p["tk"] if t[1]}:
                by_word[x].append(p)
    for e in words:
        cands = by_word.get(e["id"], [])
        if not cands:
            continue
        wu = unit_of.get(e["id"], len(units))

        def score(p):
            gap = p["cover"] - wu if p["cover"] < INF else 50
            return (gap < 0) * 5 + abs(gap) * 0.5 - p["q"]

        best = sorted(cands, key=score)[:3]
        e["ex"] = [p["id"] for p in best]
        used.update(e["ex"])

    # ---------- topics ----------
    ctx = {"conj": conj, "lang": lang}
    topic_unit = {}
    for ui, u in enumerate(units):
        for tid in u["topics"]:
            topic_unit.setdefault(tid, ui)
    topics = []
    missing_content = []
    for tdef in cur.TOPICS:
        tid = tdef["id"]
        tu = topic_unit.get(tid, len(units))
        auto = []
        sel = tdef.get("auto")
        if sel:
            cands = [p for p in pool if p["nw"] <= 14 and (p["cover"] <= tu + 8 or (p["cover"] >= INF and tu >= len(units) - 30))]
            cands.sort(key=lambda p: (max(0, p["cover"] - tu) if p["cover"] < INF else 30) * 0.4 - p["q"])
            seen_txt = set()
            found = []  # (item, group key, surface form)
            for p in cands:
                hits = sel(p["toks"], ctx)
                if not hits:
                    continue
                key = " ".join(x[0].lower() for x in p["tk"])
                if key in seen_txt:
                    continue
                seen_txt.add(key)
                i, n, hint, opts = hits[0]
                a = {"s": p["id"], "i": i}
                form = " ".join(t[0] for t in p["toks"][i:i + n]).lower().replace("’", "'")
                if opts:
                    low_opts = [o.lower() for o in opts]
                    if form not in low_opts:
                        alias = form[:-1] + "e" if form.endswith("'") else None
                        if alias and alias in low_opts:
                            a["x"] = alias
                        else:
                            continue
                if n > 1:
                    a["n"] = n
                if hint:
                    a["h"] = hint
                if opts:
                    a["o"] = opts
                found.append((a, hint or a.get("x") or form, form))
                if len(found) >= 1200:
                    break
            # keep variety: the same verb (or the same answer) must not fill the whole set,
            # while easy sentences (early in `cands`) still come first
            rank_g, rank_f, scored = Counter(), Counter(), []
            for idx, (a, g, form) in enumerate(found):
                if rank_f[form] >= 16 and "h" in a:
                    continue
                scored.append((rank_g[g] / 8 + rank_f[form] / 4 + idx / 400, idx, a))
                rank_g[g] += 1
                rank_f[form] += 1
            auto = [a for _, idx, a in sorted(scored, key=lambda x: x[:2])[:120]]
        md_path = CONTENT / lang / "grammar" / f"{tid}.{native}.md"
        md = md_path.read_text(encoding="utf-8") if md_path.exists() else f"*(explanation coming soon)*"
        drills = parse_drills(CONTENT / lang / "drills" / f"{tid}.txt")
        for d in drills:
            h = d.pop("_h", None)
            if h and h.get(native):
                d["h"] = h[native]
        title = tdef["title"][native] if isinstance(tdef["title"], dict) else tdef["title"]
        topic = {"id": tid, "level": tdef["level"], "title": title, "md": md, "drills": drills, "auto": auto,
                 "ex": [a["s"] for a in auto[:10]]}
        if tdef.get("tenses"):
            topic["tenses"] = tdef["tenses"]
        for a in auto:
            used.add(a["s"])
        topics.append(topic)
        if not md_path.exists() or not drills:
            missing_content.append(f"{tid}(md={'ok' if md_path.exists() else '-'},drills={len(drills)},auto={len(auto)})")

    if missing_content:
        print(course, "topics without full content:", len(missing_content), " ".join(missing_content[:6]), "…" if len(missing_content) > 6 else "")

    # ---------- output ----------
    pool_by_id = {p["id"]: p for p in pool}
    out_sents = []
    for sid in sorted(used):
        p = pool_by_id[sid]
        s = {"id": sid, "tk": p["tk"], "tr": p["tr"]}
        if p["alt"]:
            s["alt"] = p["alt"]
        a = p["audio"]
        if a and a.get("lic") and a["lic"].startswith(GOOD_AUDIO_LIC):
            s["au"] = int(a["aid"])
        out_sents.append(s)
    for e in words:
        e.pop("_cur", None)
        e.pop("_nofill", None)
        e.pop("_custom", None)
    verbs_used = {e["w"] for e in words if e["pos"] == "verb"}
    out_conj = {v: t for v, t in conj.items() if v in verbs_used}
    placement = parse_placement(CONTENT / lang / "placement.txt")
    title, subtitle = TITLES[course]
    meta = {
        "id": course, "target": lang, "ui": native, "title": title, "subtitle": subtitle, "tts": TTS[lang],
        "chars": CHARS[lang], "persons": PERSONS[lang], "tenseNames": TENSE_NAMES[lang].get(native, TENSE_NAMES[lang]["en"]),
        "version": time.strftime("%Y-%m-%d"),
        "stats": {"words": len(words), "sentences": len(out_sents), "topics": len(topics), "units": len(units)},
    }
    od = OUT / course
    od.mkdir(parents=True, exist_ok=True)
    json.dump({"meta": meta, "units": units, "topics": topics, "placement": placement},
              open(od / "course.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(words, open(od / "lexicon.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(out_sents, open(od / "sentences.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(out_conj, open(od / "conj.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    sizes = {f.name: f"{f.stat().st_size / 1e6:.1f}MB" for f in od.iterdir()}
    print(course, "done", meta["stats"], sizes, f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    for c in sys.argv[1:] or ["es-en", "fr-en", "fr-ru"]:
        main(c)
