"""Generate conjugation tables for the verbs of the lexicon with verbecc.

Output: data/work/{lang}_conj.json  {infinitive: {tense: [6 forms]}}; alternatives joined by "/".
"""
import json, logging, sys
from pathlib import Path

logging.disable(logging.CRITICAL)
from verbecc import CompleteConjugator  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "data" / "work"

ES_TENSES = {
    ("indicativo", "presente"): "pres",
    ("indicativo", "pretérito-perfecto-simple"): "pret",
    ("indicativo", "pretérito-imperfecto"): "impf",
    ("indicativo", "futuro"): "fut",
    ("indicativo", "pretérito-perfecto-compuesto"): "perf",
    ("indicativo", "pretérito-pluscuamperfecto"): "plup",
    ("indicativo", "futuro-perfecto"): "fut_perf",
    ("condicional", "presente"): "cond",
    ("condicional", "perfecto"): "cond_perf",
    ("subjuntivo", "presente"): "subj",
    ("subjuntivo", "pretérito-imperfecto-1"): "subj_impf",
    ("subjuntivo", "pretérito-perfecto"): "subj_perf",
    ("subjuntivo", "pretérito-pluscuamperfecto-1"): "subj_plup",
    ("imperativo", "afirmativo"): "imp",
    ("imperativo", "negativo"): "imp_neg",
    ("gerundio", "gerundio"): "ger",
    ("participo", "participo"): "part",
}
ES_PERSON = {"yo": 0, "tú": 1, "él": 2, "nosotros": 3, "vosotros": 4, "ellos": 5}
ES_IMP_PERSON = {"tú": 1, "usted": 2, "nosotros": 3, "vosotros": 4, "ustedes": 5}

FR_TENSES = {
    ("indicatif", "présent"): "pres",
    ("indicatif", "passé-composé"): "pc",
    ("indicatif", "imparfait"): "impf",
    ("indicatif", "plus-que-parfait"): "pqp",
    ("indicatif", "futur-simple"): "fut",
    ("indicatif", "futur-antérieur"): "futant",
    ("indicatif", "passé-simple"): "ps",
    ("conditionnel", "présent"): "cond",
    ("conditionnel", "passé"): "condp",
    ("subjonctif", "présent"): "subj",
    ("subjonctif", "passé"): "subjp",
    ("subjonctif", "imparfait"): "subj_impf",
    ("imperatif", "imperatif-présent"): "imp",
    ("participe", "participe-présent"): "ppres",
    ("participe", "participe-passé"): "pp",
}
FR_PERSON = {"je": 0, "j'": 0, "tu": 1, "il": 2, "elle": 2, "on": 2, "nous": 3, "vous": 4, "ils": 5, "elles": 5}


def table(conj, lang, verb):
    try:
        d = json.loads(conj.conjugate(verb, conjugate_pronouns=False).to_json())
    except Exception:
        return None
    if d.get("verb", {}).get("predicted"):
        return None
    tmap = ES_TENSES if lang == "es" else FR_TENSES
    out = {}
    for mood, tenses in d["moods"].items():
        for tense, entries in tenses.items():
            key = tmap.get((mood, tense))
            if not key:
                continue
            if key in ("ger", "part", "ppres", "pp"):
                forms = []
                for e in entries:
                    for f in e["c"]:
                        if f not in forms:
                            forms.append(f)
                out[key] = ["/".join(forms[:4])]
                continue
            pmap = ES_IMP_PERSON if (lang == "es" and key.startswith("imp")) else (ES_PERSON if lang == "es" else FR_PERSON)
            slots = [[] for _ in range(6)]
            # masculine before feminine
            for e in sorted(entries, key=lambda e: 1 if e.get("g") == "f" else 0):
                p = pmap.get(e.get("pr"))
                if p is None:
                    continue
                for f in e["c"]:
                    f = f.strip()
                    if key == "imp_neg" and f.startswith("no "):
                        f = f[3:]
                    if f and f not in slots[p]:
                        slots[p].append(f)
            out[key] = ["/".join(s) for s in slots]
    return out


def main(lang):
    lex = json.load(open(WORK / f"{lang}_lex.json", encoding="utf-8"))
    verbs = []
    for x in lex:
        if x["pos"] == "verb" and x["w"] not in verbs and " " not in x["w"]:
            verbs.append(x["w"])
    verbs = verbs[:2500]
    conj = CompleteConjugator(lang=lang)
    out = {}
    for i, v in enumerate(verbs):
        t = table(conj, lang, v)
        if t and t.get("pres"):
            out[v] = t
        if i % 250 == 0:
            print(lang, i, len(out), flush=True)
    with open(WORK / f"{lang}_conj.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(lang, "verbs", len(out))


if __name__ == "__main__":
    for lang in sys.argv[1:] or ["es", "fr"]:
        main(lang)
