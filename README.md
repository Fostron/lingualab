# LinguaLab

An app for really learning Spanish and French, from zero to C1. It is not a game: grammar is explained properly, vocabulary is scheduled with spaced repetition (FSRS), there is native-speaker audio, and you write, listen and build sentences. A placement test lets people who already know some of the language skip what they know.

| Course | For speakers of | Units | Lessons | Grammar topics | Words taught | Sentences | Reference dictionary |
|---|---|---|---|---|---|---|---|
| `es-en` Spanish | English | 151 (A1–C1) | 1 380 | 75 | 6 160 | 27 735 | 93 000 entries |
| `fr-en` French | English | 145 (A1–C1) | 1 324 | 68 | 5 963 | 29 567 | 74 000 entries |
| `fr-ru` French | Russian | 145 (A1–C1) | 1 324 | 68 (explanations in Russian) | 5 963 | 26 597 | 74 000 entries |

Each grammar topic has a written explanation and hand-made drills (~1 000 per course). On top of that come up to 120 gap exercises per topic, generated from real Tatoeba sentences.

## Running

```bash
npm install
npm run dev        # http://localhost:5180
npm run build      # static site in dist/ (relative paths, deploy to any folder)
npm run preview    # serve dist/
```

The app is fully static and runs in the browser. Progress lives in that browser's IndexedDB; Settings has export and import for moving it to another device. The service worker (`public/sw.js`) caches the app, the course packs and the word recordings already played, so lessons work offline once loaded.

## How learning works

- **Start**: a beginner starts at unit 1, lesson 1 (how the language sounds). Anyone else can take the **placement test** (`src/screens/Placement.tsx`): an adaptive vocabulary check across frequency bands (with guessing correction) plus 4–6 grammar questions per level. The resulting level is the lower of the two. Units below it are marked as known; no review cards are created for them.
- **Unit**: theme words plus frequency words (22 per unit at A1, rising to 45 at C1, 50 in vocabulary-only units), one or more grammar topics, and sentences that use only known words.
- **Lessons** (`src/lessons.ts`): each unit is split into small lessons that open one after another.
  - *Words*: 5–8 new words, introduced three at a time, then recognised, picked, typed, heard and used in sentences, plus a few earlier words.
  - *Rule*: the explanation step by step (split at its `##` headings), with the drills that belong to each step asked right after it.
  - *Practice*: drills, gaps in real sentences, and conjugation of known verbs.
  - *Putting it together*: listening, reading, building and translating the unit's sentences.
  - *Unit test*: ≥ 80 %, typing only, no hints. It can be taken early to test out of the unit.
  - *Level exam*: comes at the end of every level.

  Lessons pass at 70 % of first answers (60 % for rule lessons). A unit opens when the previous one is complete.
- **Help when stuck**:
  - A hint button reveals the answer letter by letter (half credit).
  - "Why?" shows the part of the rule behind a grammar question.
  - A wrong answer comes back a few questions later, after re-teaching: the word card and an easier question, the rule step, or the verb table.
  - Difficulty is adaptive by default: more choices while recent accuracy is low, more typing when it is high.
- **Cards**:
  - `wr:<word>`: recognition.
  - `wp:<word>`: production, typed with accent and typo tolerance.
  - `g:<topic>`: grammar.
  - `c:<verb>`: conjugation, for the tenses unlocked so far.

  The first answer of a review is the rating: right → Good, small typo → Hard, wrong → Again.
- **Answer checking** (`src/answer.ts`):
  - Vocabulary tolerates missing accents and one-letter typos. A missing article counts as a partial answer.
  - Grammar items and conjugations are strict, because *hablo* and *habló* are different forms.
  - Choices are judged exactly.
  - An "I was right" button overrides the verdict.
- **Audio**:
  - Sentences use native recordings from Tatoeba (about 92–95 % of unit sentences).
  - Words use recordings from Wikimedia Commons / Lingua Libre (94 % of the top 3 000 for Spanish, 99 % for French).
  - Anything without a recording falls back to the browser's speech synthesis.

## Content pipeline

The app's data is in `public/content/<course>/{course,lexicon,sentences,conj,dict}.json` (`dict.json`, the reference dictionary, is only fetched when someone searches). It is generated from open datasets plus the hand-written material in `content/`.

```bash
python -m venv .venv
.venv/Scripts/pip install -r pipeline/requirements.txt     # (bin/ on Linux/macOS)
.venv/Scripts/python -m spacy download es_core_news_md
.venv/Scripts/python -m spacy download fr_core_news_md

export PYTHONIOENCODING=utf-8
.venv/Scripts/python pipeline/p00_download.py      # ~3 GB into data/raw
.venv/Scripts/python pipeline/p01_kaikki.py        # Wiktionary lemmas, forms, IPA, gender
.venv/Scripts/python pipeline/p02_sentences.py     # Tatoeba sentences + spaCy annotation (slow)
.venv/Scripts/python pipeline/p03_lexicon.py       # frequency-ranked lexicon with glosses
.venv/Scripts/python pipeline/p04_conj.py          # conjugation tables (verbecc)
.venv/Scripts/python pipeline/p06_word_audio.py    # word recordings listed in Wiktionary
.venv/Scripts/python pipeline/p06b_commons_audio.py es   # + Commons categories (rate-limited, slow)
.venv/Scripts/python pipeline/p05_build.py es-en fr-en fr-ru   # assemble the packs
.venv/Scripts/python pipeline/p07_refdict.py es-en fr-en fr-ru # reference dictionary (after p05)
```

Steps 01–06 write to `data/work/`. After editing anything in `content/`, only `p05_build.py` needs to be rerun (about 20 s per course).

### Authored content (`content/es`, `content/fr`)

- **`curriculum.py`**:
  - `TOPICS`: id, level, title (for French, `T(en, ru)`), `auto` and `tenses`.
    - `auto` is a selector from `pipeline/sel.py` that picks the gap in real sentences. Examples: `V(["pret"])` matches a verb form verified against the conjugation table; `VC(a, b)` contrasts two tenses; `W([...], options=[...])` matches words with a fixed choice set; `PARTITIVE()`, `NOQ(...)` and `NEGIMP()` are also available.
    - `tenses` lists the conjugation drills the topic unlocks.
  - `UNITS`: title, topics, theme words (`"bajo:adj"` pins the part of speech). `pack=True` makes a vocabulary-only unit.
- **`glossary-*.txt`**: curated translations, one per line: `word|pos|en|ru|note_en|note_ru`.
  - `!` before the translation marks a dictionary-only entry: it gives the translation for tap-to-translate but is not taught as a word.
  - `-` drops a word from the course.
- **`grammar/<topic>.<en|ru>.md`**: the explanation. `[[phrase]]` makes a target-language phrase clickable and spoken.
- **`drills/<topic>.txt`**, one drill per line:
  ```
  gap: Yo ___ estudiante. => soy
  choice[en=She had her hair cut.|ru=Она подстриглась.]: Elle s'est ___ couper les cheveux. => fait | faite | faits
  transform[en=Make it negative|ru=Сделайте отрицательным]: Je mange. => Je ne mange pas.
  ```
  For `choice`, the first option is the correct one. The other drill types accept every answer listed after `=>`.
- **`placement.txt`**: `LEVEL | question with ___ | correct | wrong | wrong | wrong`.

## Code map

| | |
|---|---|
| `src/content.ts` | course list, pack loading, articles/display forms |
| `src/lessons.ts` | lessons of a unit, unlocking, next lesson |
| `src/exercises.ts` | exercise generation for each lesson type, reviews, tests; re-teaching after mistakes |
| `src/progress.ts` | lesson results, test-out, placement, adaptive difficulty, weak spots |
| `src/srs.ts` | FSRS wrapper |
| `src/db.ts` | IndexedDB (cards, logs, units, settings), export/import |
| `src/tts.ts` | native audio + speech synthesis |
| `src/ui/ExerciseView.tsx` | all exercise renderers and feedback |
| `src/screens/` | Home/path/units/grammar/dictionary, study sessions, placement, stats, settings |

## Data sources and licences

- **Sentences and sentence audio:** [Tatoeba](https://tatoeba.org) (CC BY 2.0 FR; audio under each contributor's licence).
- **Dictionary data:**
  - [Wiktionary](https://en.wiktionary.org) via [kaikki.org](https://kaikki.org) and [WikDict](https://www.wikdict.com) (CC BY-SA).
  - [Lexique 3.83](http://www.lexique.org) (CC BY-SA).
  - [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (subtitle frequencies).
- **Word recordings:** [Wikimedia Commons](https://commons.wikimedia.org) and [Lingua Libre](https://lingualibre.org) (mostly CC BY-SA).
- **Conjugation tables:** [verbecc](https://github.com/bretttolbert/verbecc).
- **Text analysis:** [spaCy](https://spacy.io) models.

The curriculum, grammar explanations, drills, curated glossaries and placement tests in `content/` were written for this project.
