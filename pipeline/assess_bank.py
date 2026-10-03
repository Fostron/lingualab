"""Item bank for the level assessment (public/content/{course}/assess.json).

- reading:   a sentence of a given CEFR level + its translation + 3 distractor translations of the same level
- listening: the same, for sentences with a native recording (Tatoeba audio)
- ctest:     sentences for C-tests (the app removes the second half of every second word)
- pseudo:    made-up words that look like real ones (to correct the yes/no vocabulary test for guessing)

A sentence's level is the level of the first unit by which all its words have been taught.
"""
import json, random, re, unicodedata
from collections import Counter

LEVELS = ["A1", "A2", "B1", "B2", "C1"]
# sentence length (words) that suits each level
LEN = {"A1": (3, 8), "A2": (4, 10), "B1": (5, 12), "B2": (6, 14), "C1": (7, 16)}
GOOD_AUDIO_LIC = ("CC BY", "CC BY-NC", "CC BY-SA", "CC0", "CC BY-NC-ND", "CC BY-ND")
VOWELS = {"es": "aeiouáéíóúü", "fr": "aeiouyàâäéèêëîïôöùûüœæ"}


def text_of(tk):
    return "".join(t[0] + (" " if t[2] else "") for t in tk).strip()


def words_of(s):
    return set(re.findall(r"\w+", s.lower()))


def pick_distractors(item, cands, rng, n=3):
    """Translations of other sentences of the same level, similar length, sharing a little vocabulary
    (plausible, but clearly a different meaning)."""
    tw = words_of(item["tr"])
    L = len(item["tr"])
    scored = []
    for c in cands:
        if c["id"] == item["id"] or c["tr"] == item["tr"]:
            continue
        ratio = len(c["tr"]) / max(1, L)
        if not 0.65 <= ratio <= 1.5:
            continue
        cw = words_of(c["tr"])
        overlap = len(tw & cw) / max(1, len(tw | cw))
        if overlap > 0.45:
            continue  # too close: might also be a correct reading
        scored.append((abs(overlap - 0.2) + abs(1 - ratio) * 0.5 + rng.random() * 0.3, c["tr"]))
    scored.sort()
    out = []
    for _, tr in scored:
        if tr not in out:
            out.append(tr)
        if len(out) >= n:
            break
    return out


def syllables(w, vowels):
    parts = re.findall(rf"[^{vowels}]*[{vowels}]+", w)
    tail = w[len("".join(parts)):]
    if parts and tail:
        parts[-1] += tail
    return parts


def strip_acute(w):
    return "".join(ch for ch in unicodedata.normalize("NFD", w) if unicodedata.category(ch) != "Mn" or ch == "̃")


def pseudowords(lang, lexicon, real, rng, n=220):
    vowels = VOWELS[lang]
    src = [w["w"] for w in lexicon if w["pos"] in ("noun", "verb", "adj", "adv") and 5 <= len(w["w"]) <= 10
           and w["w"].isalpha() and w["w"].islower() and 300 <= w["r"] <= 8000]
    grams = Counter()
    for w in [x["w"] for x in lexicon if x["w"].isalpha()]:
        ww = f"^{w}$"
        for k in (2, 3):
            for i in range(len(ww) - k + 1):
                grams[ww[i:i + k]] += 1
    plain = {strip_acute(w) for w in real}  # "conico" is just "cónico" without its accent
    syl = {w: syllables(w, vowels) for w in src}
    src = [w for w in src if len(syl[w]) >= 2]
    out = set()
    tries = 0
    while len(out) < n and tries < 200000:
        tries += 1
        a, b = rng.choice(src), rng.choice(src)
        if a == b:
            continue
        sa, sb = syl[a], syl[b]
        k = rng.randint(1, len(sa) - 1)
        m = rng.randint(1, len(sb) - 1)
        w = "".join(sa[:k] + sb[m:])
        if lang == "es":
            w = strip_acute(w)
        if not 5 <= len(w) <= 10 or w in real or w in out or strip_acute(w) in plain:
            continue
        ww = f"^{w}$"
        if any(grams[ww[i:i + 3]] < 3 for i in range(len(ww) - 2)):
            continue  # every three-letter sequence must be common in real words
        # not one letter away from a real word (it would just look like a typo)
        if any(strip_acute(w[:i] + w[i + 1:]) in plain for i in range(len(w))):
            continue
        out.add(w)
    return sorted(out)


def build(lang, units, pool, lexicon, real_forms, od, seed=7):
    rng = random.Random(seed)
    n_units = len(units)
    by_lvl = {L: [] for L in LEVELS}
    for p in pool:
        if p["cover"] < 0 or p["cover"] >= n_units:
            continue
        L = units[p["cover"]]["level"]
        lo, hi = LEN[L]
        if not lo <= p["nw"] <= hi:
            continue
        txt = text_of(p["tk"])
        if len(txt) < 8 or not p["tr"]:
            continue
        a = p.get("audio")
        au = int(a["aid"]) if a and a.get("lic") and a["lic"].startswith(GOOD_AUDIO_LIC) else None
        by_lvl[L].append({"id": p["id"], "t": txt, "tr": p["tr"], "au": au, "q": p["q"], "nw": p["nw"]})
    bank = {"reading": {}, "listening": {}, "ctest": {}, "pseudo": []}
    for L in LEVELS:
        xs = sorted(by_lvl[L], key=lambda x: -x["q"] - rng.random())
        seen = set()
        uniq = []
        for x in xs:
            k = x["t"].lower()
            if k in seen:
                continue
            seen.add(k)
            uniq.append(x)
        reading = uniq[:45]
        listening = [x for x in uniq if x["au"]][:40]
        ctest = [x for x in uniq if x["nw"] >= max(6, LEN[L][0] + 1) and len(re.findall(r"\w{2,}", x["t"])) >= 6][:20]
        for name, items in (("reading", reading), ("listening", listening)):
            out = []
            for x in items:
                d = pick_distractors(x, uniq, rng)
                if len(d) == 3:
                    o = {"t": x["t"], "tr": x["tr"], "d": d}
                    if name == "listening":
                        o["au"] = x["au"]
                    out.append(o)
            bank[name][L] = out
        bank["ctest"][L] = [{"t": x["t"], "tr": x["tr"]} for x in ctest]
    bank["pseudo"] = pseudowords(lang, lexicon, real_forms, rng)
    with open(od / "assess.json", "w", encoding="utf-8") as f:
        json.dump(bank, f, ensure_ascii=False, separators=(",", ":"))
    counts = {k: {L: len(v[L]) for L in LEVELS} for k, v in bank.items() if isinstance(v, dict)}
    return counts, len(bank["pseudo"])
