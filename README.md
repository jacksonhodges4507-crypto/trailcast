# TrailCast

**Live conditions, scored per trail, with receipts.**

Most outdoor apps show you a forecast and leave the decision to you. A forecast
says "62 °F, 0.8 inches of rain in the last three days." It does not say that
those three days of rain mean the north-facing clay singletrack in Draper will
be a rutted mess while the south-facing slickrock in Moab is already dry.

TrailCast closes that gap. It ingests live environmental data from several
independent sources, scores each trail against **its own terrain** and against
**the activity you are doing**, and shows you exactly which number produced the
verdict and where that number came from.

**[Live demo](https://trailcast-sigma.vercel.app)** · no sign-up, no API key required.

---

## What it actually does

| | |
|---|---|
| **Ingests** | weather + 72-hour precipitation history, hours since last rain, air quality, active wildfire perimeters |
| **Joins against** | a curated trail dataset with soil type, rock type, aspect, exposure and stream crossings |
| **Scores** | seven weighted factors, re-weighted per activity (hiking, trail running, mountain biking, climbing) |
| **Explains** | a plain-English reason per factor, a headline, and a source link with a fetch timestamp for every value |
| **Answers** | natural-language questions — *"where should I ride Saturday near Park City?"* |

---

## Architecture

```
                 ┌──────────────────────────────────────────┐
  Open-Meteo ───▶│  source adapters                         │
  Air Quality ──▶│  · one file per upstream                 │
  NIFC WFIGS ───▶│  · typed SourceAdapter interface         │
                 │  · per-source TTL + stale-while-revalidate│
                 │  · failures isolated, never propagated    │
                 └────────────────┬─────────────────────────┘
                                  │  flat `${date}:${field}` values
                                  │  + one SourceRef per value
                                  ▼
                 ┌──────────────────────────────────────────┐
  trail dataset ▶│  conditions assembly                      │
  (soil, aspect, │  normalised readings, provenance carried  │
   exposure)     └────────────────┬─────────────────────────┘
                                  ▼
                 ┌──────────────────────────────────────────┐
                 │  scoring engine — pure functions          │
                 │  7 rules · activity weights · vetoes      │
                 │  no I/O, no clock, no randomness          │
                 └────────────────┬─────────────────────────┘
                                  ▼
                 ┌──────────────────────────────────────────┐
                 │  Verdict { score, grade, factors[],       │
                 │            sources[], confidence }        │
                 └──────┬──────────────────────┬────────────┘
                        ▼                      ▼
                  map + detail UI        /api/ask
                                         (NL → query → ranked → narrated)
```

The layering is the point: **the scoring engine never learns an upstream
schema, and the adapters never learn what a score is.** Adding SNOTEL snow
telemetry or an avalanche forecast means writing one file and adding it to a
registry array. Nothing downstream changes.

---

## Five decisions worth defending

**1. Missing data lowers confidence, not the score.**
Scoring an absent input as zero turns an upstream outage into bad advice. If the
air-quality API is down, that factor is dropped, the remaining weights are
renormalised, and the verdict reports `confidence: 0.84` instead of quietly
recommending a smoky canyon. → [`scoring/index.ts`](src/lib/scoring/index.ts)

**2. A veto beats the average.**
A 92-point day with a wildfire two miles away is not a 92-point day. Certain
conditions — heavy rain on exposed terrain, 45 mph gusts on a fall-consequence
ridge, a fire inside five miles — force the grade to *no-go* regardless of how
good everything else looks. Averages hide exactly the conditions that hurt
people. → [`scoring/rules.ts`](src/lib/scoring/rules.ts)

**3. Show the reading, not the model's opinion of it.**
An earlier panel rendered each factor as a percentage with a second bar for
its weight. Both were wrong. A temperature is not 87% of anything, so the
percentage claimed a precision the score does not have while hiding the number
the reader actually wanted; and the weight bar was identical on every trail,
so it could not say anything about the one on screen. Each factor now leads
with its real reading — `44–62 °F`, `AQI 39`, `31 h dry` — followed by a
five-step rating, and weight is expressed by the ordering instead of ink.
→ [`TrailDetail.tsx`](src/app/components/TrailDetail.tsx)

**3. Every number is traceable.**
A `SourceRef` — source, URL, upstream field, fetch timestamp — is attached at
the moment a value is parsed and carried through assembly, scoring and into the
UI. Open the detail panel and every factor links back to the exact request that
produced it. This is the feature that makes the tool trustworthy enough to act
on. → [`types.ts`](src/lib/types.ts)

**4. A percentage has to be a percentage.**
Auditing every number that reaches a user split them cleanly. Precipitation
chance (`45% chance`) is a real probability; a factor's share of the weighted
sum (`counts for 16%`) is a real share; sandstone losing `75%` of its strength
is a cited figure. Those stay. `confidence 84%` did not: it is the fraction of
scoring weight that had data behind it, and rendering it as a percentage
invited reading it as statistical confidence in the forecast — something this
app does not compute. It now reads `7 of 8 inputs available`, and names the
missing ones. On the trail cards it appears only when something is actually
missing, since a figure that reads 100% on every card is noise everywhere
except the one place it matters.

**4. One dead source never blanks the page.**
Sources are fetched in parallel and settled independently; each has its own TTL
and a stale-while-revalidate window. The header shows live per-source health —
latency, cache age, or the error string. → [`sources/index.ts`](src/lib/sources/index.ts)

**5. The AI layer is optional, and the deterministic path is the reference
implementation.**
`/api/ask` parses questions with regex rules and narrates results from a
template. When `ANTHROPIC_API_KEY` is set, a model improves both steps — but it
must return the *same* `AskQuery` shape, and it is given only the scored facts
and told not to add any. **The model explains a decision; it never makes one.**
That is why the scoring engine is deterministic, why the ask feature is fully
unit-testable without a network call, and why the demo works with no key at
all. → [`ask/`](src/lib/ask)

---

## The climbing case

The clearest example of why per-trail attributes beat a forecast.

Western sandstone **loses up to 75% of its strength while wet**. Climbing
Wingate or Navajo within a day or two of rain snaps holds and permanently
destroys routes — the Access Fund's guidance is 24–48 hours minimum, longer
when it is cool or shaded. Granite in Little Cottonwood, by contrast, is fine
within a few hours.

So the engine tracks *hours since the last measurable hour of rain*, not just
how much fell, and pairs it with each crag's rock type and aspect:

| Rock | Hard veto | Fully dry |
|---|---|---|
| Sandstone (Indian Creek, Moab, Zion, Joe's Valley) | 48 h | 96 h |
| Conglomerate (Maple Canyon) | 18 h | 48 h |
| Limestone (American Fork, Logan, VRG) | 8 h | 30 h |
| Quartzite (Big Cottonwood, Ogden, Rock Canyon) | 6 h | 24 h |
| Granite (Little Cottonwood) | 4 h | 16 h |

North-facing and shaded crags get those windows multiplied. The result: 24
hours after a storm, Indian Creek is a hard *no-go* and Gate Buttress is
*prime* — same weather, same day, opposite answers. A forecast cannot tell you
that; it needs to know what the rock is made of.

Climbers also get their own temperature band. Friction falls off with heat, so
66 °F is a perfect hiking day and an already-warm climbing one.

---

## Bounding the work

Two mechanisms keep a bigger catalogue from turning into a bigger bill for
somebody else's free API.

**Grid clustering.** Areas are collapsed onto a ~17 × 13 mile grid before
fetching, so a canyon with six crags costs one upstream request per source
rather than six. → [`geo.ts`](src/lib/geo.ts)

**A hard cap.** Importing a real climbing dataset took the catalogue from 18
hand-written entries to 76 areas, which unbounded would have fanned out into
hundreds of calls per page load. A request scores at most 40 areas — the
nearest when an origin is named, the largest otherwise — fetches at most 8
cells at a time, and returns `scored` and `available` so the UI can say
"scoring 40 of 73" rather than silently truncating.
→ [`report.ts`](src/lib/report.ts)

---

## Data sources

| Source | Used for | Key required |
|---|---|---|
| [Open-Meteo](https://open-meteo.com/) | temperature, precipitation + 72 h history, wind, gusts, snow depth, daylight | no |
| [Open-Meteo Air Quality](https://open-meteo.com/en/docs/air-quality-api) | US AQI, PM2.5 (daytime peak) | no |
| [NIFC WFIGS](https://data-nifc.opendata.arcgis.com/) | active wildfire perimeters within 35 mi | no |
| [OpenFreeMap](https://openfreemap.org/) | basemap tiles | no |
| [Anthropic API](https://docs.claude.com/) | *optional* NL parsing + narration | optional |
| [OpenBeta](https://openbeta.io/) | climbing area catalogue (imported, not live) | no |

Climbing areas are imported from [OpenBeta](https://openbeta.io), an open
climbing database, by walking its public GraphQL API. **Mountain Project is
deliberately not used**: its public data API was retired and its terms do not
permit scraping, and a portfolio project is a poor place to launder a terms
violation.

Trail attributes (soil, aspect, exposure, stream crossings) are hand-curated in
[`trails.ts`](src/lib/trails.ts). Imported areas carry a `rockTypeSource` of
`curated` or `inferred`, so the panel can say which rock types were verified
and which were guessed from the surrounding region. Inferred types still fire
the sandstone veto, because on the Colorado Plateau the conservative error is
telling someone to wait. In production this moves to PostGIS.

---

## API

```bash
curl "$HOST/api/conditions?date=2026-09-19&activity=mtb"
curl "$HOST/api/ask?q=where+should+I+hike+saturday+near+salt+lake"
curl "$HOST/api/health"
```

`/api/conditions` returns a scored report per trail with full factor
breakdowns, source provenance and per-source health.

`/api/ask` resolves a question to a structured query. Naming a place without
a radius implies a 50-mile search, and near-ties on conditions are broken by
distance from that origin — a trail eight miles out and one point worse is the
better answer to "near Park City" than one thirty miles away.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

No API keys required. Optionally:

```bash
cp .env.example .env.local   # add ANTHROPIC_API_KEY to enable the model layer
```

```bash
npm run typecheck
npm run test
npm run build
```

Tests cover the scoring engine, the adapters (against stubbed payloads,
including malformed ones), source-failure isolation, caching and
stale-while-revalidate, date resolution, and the natural-language parser — all
without touching the network.

---

## How this was built

Built end-to-end with AI tooling, which is how I work on everything.

The useful part was not code generation. It was using the model to attack my
own design: I described the scoring engine and asked for the cases where it
would give dangerous advice. *Missing data scored as zero* and *a veto getting
averaged away* both came out of that, and both are now invariants with tests
named after them. I used the same approach on the adapters — "what shape could
this payload take that breaks the parser?" — which is why `snow_depth` is
unit-converted from the response's own units block rather than assumed, and why
there is a test for a payload with whole blocks missing.

I write the interfaces and the invariants myself, then move fast inside them.
The boundaries in this repo — pure scoring, isolated adapters, provenance
threaded through every value — exist because they are what make the generated
parts safe to trust and cheap to replace.

---

## What I would do next

- **PostGIS + OSM ingest** to replace the seed dataset and support arbitrary trails
- **SNOTEL telemetry and avalanche forecasts** for a winter mode — the adapter interface already takes them
- **Backfill and calibration**: store daily verdicts, then check them against trip reports to tune the weights against reality instead of intuition
- **Per-user profiles**: heat tolerance and turnaround discipline vary enormously between people

---

MIT licensed. Built by [Jackson Hodges](https://github.com/jacksonhodges4507-crypto).
