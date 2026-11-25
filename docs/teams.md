# Teams

Six team leads and one orchestrator work on this project. They are a layer on top of the factory, not a second process: the factory still has only two roles that change or judge code, **build** and **review**, and one build runs at a time.

A lead is a specialist view. It audits its area, writes tickets, and reviews diffs that touch its files. It becomes a builder only when the orchestrator hands it one ticket.

## Who owns what

| Lead (`.claude/agents/`) | Team | Owns | Also reviews |
| --- | --- | --- | --- |
| `carto-ux-lead` | Cartography and UI/UX | `style.css`, `icons/`, Hebrew UI text, map symbols | marker, popup and legend templates in `app.js` |
| `web-app-lead` | Web development A | `app.js`, `index.html`, `test.html`, `test-map.html` | anything that builds HTML from data |
| `web-platform-lead` | Web development B | `sw.js`, `manifest.json`, `README.md`, the `<head>` of `index.html`, `.factory/` (with a person only) | the cached file list after any new file |
| `data-pipeline-lead` | Data 1, engineering | `scraper.js`, `test-scraper.js`, `facilities.json` | every change to `locations.json` |
| `data-quality-lead` | Data 2, analysis | attribute checks in `validate_data.js`, `city` entries in `data_overrides.json` | names, addresses and cities users will read |
| `spatial-data-lead` | Data 3, spatial data science | position checks in `validate_data.js`, `exclude` entries in `data_overrides.json` | anything that measures distance or places a point |

Nobody edits `cartowolf/tokens.css` (it is copied from the factory) or `locations.json` (it is written by `scraper.js`).

## How work moves

```
audit      all six leads, in parallel, read-only        -> tickets with evidence
plan       orchestrator merges, removes duplicates,     -> docs/designs/<name>.md + SITEMAP.md line
           orders by priority and by file
build      one ticket at a time, by the lead that owns  -> failing test, then code, then gate
           the files
review     a fresh agent that did not build it,         -> VERDICT: PASS or BLOCK
           diff + ticket only
merge      a person
```

- **Audits run in parallel because they only read.** Builds do not: two builders in one working tree race on `app.js`, `sw.js` and the cache version. This is the factory's "one build at a time per repository" decision, applied to teams.
- **Two tickets may build at the same time only if their file lists do not overlap** and neither touches `sw.js`. The orchestrator checks this, not the leads.
- **The reviewer never saw the build.** It gets the diff and the ticket, nothing else, and follows the factory's `prompts/review.md` and `.factory/review-checklist.md`.

## Rules every lead follows

These are the factory rules in `CLAUDE.md`, plus four working rules taken from Andrej Karpathy's notes on coding agents.

1. **Read first.** `CLAUDE.md`, `docs/brain/DECISIONS.md`, the lesson titles in `docs/brain/lessons/`, and the factory brain (`.factory-run/brain/` in an unattended run; a clone of `Zeevmala/factory` otherwise). Search decisions and lessons for the ticket's key terms.
2. **Think before coding.** Say what will be true when the ticket is done. If two readings give different behaviour, ask (or write `.factory-run/BLOCKED.md` in an unattended run). Do not pick one silently.
3. **Simplest thing that works.** No new dependency, no build tool, no feature the ticket did not ask for.
4. **Surgical changes.** Touch only the ticket's files. Match the style already there. Do not tidy, rename or reformat code next to your change; mention it in the summary instead.
5. **Goal first.** Turn the ticket into a check that fails now, then make it pass. A change in behaviour with no test that would catch its absence is not finished.
6. **Evidence, not claims.** "Passes" needs the command and what it printed, from this run. Something you did not confirm goes under Questions.
7. **Run the gate.** `bash .factory/check.sh` must pass before a ticket is called done. Bump `STATIC_CACHE` in `sw.js` whenever a cached file changed.
8. **Leave what you learned.** One lesson file in `docs/brain/lessons/` if the next run should know something; one dated line in `docs/brain/DECISIONS.md` if a decision was made. Never edit an existing entry.
9. **Never** merge, push to the default branch, weaken a test, or commit secrets.

## The orchestrator

The orchestrator is the main Claude Code session (or you). It does four things:

1. Starts the audit with one shared brief, so every lead reports in the same shape.
2. Merges the reports into one ordered ticket list, and settles disagreements between leads by the factory's `PRINCIPLES.md` (correctness before performance; small and boring beats clever).
3. Runs builds one at a time, runs the gate itself after each one, and does not trust a builder's summary.
4. Hands each finished diff to a fresh reviewer, then reports to the person who merges.

## Report shape (audit)

```
## Summary
## Tickets
### <P1|P2|P3> <title>
- Area/files:
- Evidence:      command + output, or file:line + the concrete wrong case
- Fix:           the smallest change
- Done when:     a check that can be run
## Questions
## Checked and fine
```

P1 blocks launch. P2 should be fixed before launch. P3 can wait.
