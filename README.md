# LinguaLab

An app for really learning Spanish and French, from zero to C1. It is not a game: grammar is explained properly, vocabulary is scheduled with spaced repetition (FSRS), there is native-speaker audio, and you write, listen and build sentences. A placement test lets people who already know some of the language skip what they know.

| Course | For speakers of | Units | Grammar topics | Words | Sentences |
|---|---|---|---|---|---|
| `es-en` Spanish | English | 111 (A1–C1) | 75 | 10 114 | 27 141 |
| `fr-en` French | English | 105 (A1–C1) | 68 | 10 096 | 28 811 |
| `fr-ru` French | Russian | 105 (A1–C1) | 68 (explanations in Russian) | 10 096 | 26 009 |

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

- **Placement test** (`src/screens/Placement.tsx`): an adaptive vocabulary check across frequency bands (with guessing correction) plus 4–6 grammar questions per level. The resulting level is the lower of the two. Units below it are marked as known; no review cards are created for them.
- **Unit**: theme words plus frequency words (22 per unit at A1, rising to 45 at C1), one or more grammar topics, and sentences that use only known words. A unit test (≥ 80 %) lets the learner test out of a unit.
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

The app's data is in `public/content/<course>/{course,lexicon,sentences,conj}.json`. It is generated from open datasets plus the hand-written material in `content/`.

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
| `src/exercises.ts` | exercise generation for lessons, reviews, unit tests |
| `src/progress.ts` | unit progress, lesson/test results, placement |
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
