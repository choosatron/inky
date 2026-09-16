# The Choosatron fork of Inky

This is a permanent downstream fork of [inkle/inky](https://github.com/inkle/inky),
customised for authoring [Choosatron](https://choosatron.com) stories. We pull
upstream's fixes and features forever; we do not send anything back.

That one-way relationship decides everything else in this document.

## How this differs from the inkCPP fork

The Choosatron project also forks inkCPP, and that fork is run the opposite way:
`master` mirrors upstream, fixes live as self-contained commits on a `choosatron`
branch, and each one is shaped so it can be cherry-picked into an upstream PR.
That discipline exists because those changes *are* aimed upstream — they are
genuine inkCPP bugs.

Inky is not that. Nothing here is expected to make sense to inkle, so optimising
for extractable commits would be paying a cost for a benefit we never collect.
What we optimise for instead is **cheap merges, forever**.

Do not copy the inkCPP workflow into this repository.

## Branches

| Branch | What it is |
|---|---|
| `choosatron` | **The default branch.** All work happens here. This is the Choosatron editor. |
| `master` | A pristine mirror of `upstream/master`. Never commit to it. Its only job is to be a merge source. |

## Syncing with upstream

Merge. Never rebase onto upstream.

```bash
git fetch upstream
git checkout master
git merge --ff-only upstream/master     # master only ever fast-forwards
git checkout choosatron
git merge master
```

Rebasing `choosatron` onto upstream would rewrite every commit on every sync,
break any history already pushed, and force you to resolve the same conflicts
again each time. Merging records each resolution once.

Two local settings make repeat merges much cheaper. They are per-clone, so each
person sets them once:

```bash
git config rerere.enabled true          # remember conflict resolutions, replay them
git config merge.conflictstyle zdiff3   # show the common ancestor in a conflict
```

`rerere` is the important one. The same handful of seams conflict on most
upstream releases, and it replays the resolution you already worked out.

After a merge, before trusting it:

```bash
node app/renderer/choosatron/coverage.test.js
git grep -n "CHOOSATRON:"               # every seam still present and intact?
```

## The rule that keeps merges cheap

**Choosatron code goes in new files. Upstream files get the thinnest possible
hook.**

A line we change inside a file upstream also changes is a conflict we pay for at
every release. A new file upstream has never heard of costs nothing, forever. So
the real logic lives in `app/renderer/choosatron/`, and the edits to upstream
files are reduced to a `require` and a call.

Every line we touch in an upstream file carries a marker:

```js
// CHOOSATRON: one line saying why
```

That makes the entire footprint greppable (`git grep -n "CHOOSATRON:"`), and it
tells whoever resolves a conflict which side is ours and what it was for.

When you add a feature, ask first whether it can live entirely in
`app/renderer/choosatron/` with one call site. Usually it can.

### Known conflict hotspots

- `app/package.json` — upstream bumps `version` every release. If we ever
  rebrand `productName` or the app id, that file conflicts on each one. Keep
  such edits to the fewest possible lines.
- `app/main-process/i18n/*.json` — upstream adds strings; we add ours. Additive
  on both sides, so conflicts are usually trivial to resolve.

## Git LFS

`app/main-process/ink/inklecate_*` are stored in Git LFS and are ~137 MB. A
clone without LFS gets pointer files and the app cannot compile ink at all:

```bash
git lfs install
git lfs pull
```

If `inklecate_mac` is about 130 bytes and starts with
`version https://git-lfs.github.com/spec/v1`, this is the step you missed.

## Installing dependencies

```bash
cd app && npm install
```

Two traps here, both of which fail quietly.

**npm will not run install scripts unless they are approved.** electron's
`postinstall` is what downloads the actual Electron binary, so without it
`npm install` reports success and leaves you with no runnable app. The
approvals are recorded in `app/package.json` as `allowScripts`, which is why
that upstream file carries a Choosatron change it cannot mark with a comment:

```json
"allowScripts": {
  "electron@30.0.4": true,
  "fsevents@2.3.3": true
}
```

If that block is ever lost to a merge, `npm install-scripts ls` will show the
packages as pending and the app will not start.

**electron's extractor can fail silently on a new Node.** `extract-zip` 2.0.1,
which electron 30 depends on, exits 0 without extracting on Node 26 — leaving
`node_modules/electron/dist/` holding only `LICENSES.chromium.html` and no
`path.txt`. The download itself is fine, so the cached zip can be extracted by
hand:

```bash
cd app/node_modules/electron
ZIP=$(find ~/Library/Caches/electron -name 'electron-v30.0.4-darwin-arm64.zip' | head -1)
rm -rf dist && mkdir dist
ditto -x -k "$ZIP" dist                                   # ditto, not unzip: it is an .app bundle
printf 'Electron.app/Contents/MacOS/Electron' > path.txt   # no trailing newline
```

Verify with `./node_modules/.bin/electron --version`, which should print the
version rather than an error about a missing binary.

## What we have added

### Printer coverage warnings

`app/renderer/choosatron/` warns an author, while they write, that a character
will not reach the Choosatron's paper.

The thermal printer draws single bytes through one built-in code page at a time.
A character no page covers prints as `?`. The device cannot do better, and by
upload time the story is already written — so the editor is the only place where
saying so is still useful.

The failure most worth catching is not an exotic character. It is a **wrong
language tag**. The firmware picks its code page from the story's
`# language:` tag, never from the text, so a story tagged `en` containing
Cyrillic is printed on CP850 and comes out as rows of `?` — even though CP866
would have covered every letter. Nothing on the device can notice this. The
editor can.

| File | What it is |
|---|---|
| `coverage.js` | The analysis. No dependencies — not even electron — so it runs under bare `node`. |
| `coverageTables.js` | **Generated. Do not edit.** The printer's code pages, read out of the firmware source. |
| `coverageWarnings.js` | Turns findings into Inky issues and owns the wording and `i18n`. |
| `coverage.test.js` | Runs with bare `node`, no `npm install` required. |

Findings become ordinary Inky issues (`{ type, filename, lineNumber, message }`)
with type `WARNING`, so they get the toolbar pane, the issue count, the warning
icon, click-to-navigate and the inline Ace gutter marker without any new
interface. `WARNING` rather than `ERROR` is deliberate: the story still compiles
and still plays, and inklecate is not the one complaining.

#### Regenerating the tables

`coverageTables.js` is generated from the firmware's `codepage.cpp` and
`glyph_coverage.cpp` so the editor and the device cannot disagree about what the
printer draws. It is committed here so this repository stays standalone.

From `choosatron-esp32/choosatron/`:

```bash
./tools/14_gen_coverage_tables.py            # regenerate
./tools/14_gen_coverage_tables.py --check    # fail if stale
```

Run `--check` after any change to the firmware's code page tables. The failure
it guards against is silent: the firmware learns a character, the editor keeps
saying it is unprintable, and nothing announces the disagreement.

#### Testing

```bash
node app/renderer/choosatron/coverage.test.js
```

The first fourteen cases are deliberately identical to those in
`choosatron-esp32/choosatron/tools/13_scan_glyph_coverage.py --selftest` and in
`choosatron/test/glyph_coverage/`. Three implementations of one judgement is two
too many to keep in step by hand — if a case changes in one, change it in all
three.
