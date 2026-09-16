# Instructions for AI Agents

Read [CHOOSATRON.md](CHOOSATRON.md) before changing anything. It explains why
this repository is run the way it is. This file is only the rules.

## What this repository is

A **permanent downstream fork** of inkle/inky, customised for authoring
Choosatron stories. We pull upstream forever; nothing goes back.

Do not apply the `cdam-inkcpp` workflow here. That fork aims its commits
upstream and is organised for cherry-picking. This one is not, and organising
for it costs us merges we have to pay for at every upstream release.

## Rules

- **Work on `choosatron`.** It is the default branch. `master` is a pristine
  upstream mirror — never commit to it.
- **Merge upstream, never rebase onto it.** `git merge master` into
  `choosatron`. Rebasing rewrites pushed history and re-litigates every
  conflict on every sync.
- **New code goes in new files.** Choosatron logic belongs in
  `app/renderer/choosatron/`, never spread through upstream files. A line
  changed in an upstream file is a conflict paid for at every release.
- **Mark every line you touch in an upstream file:**
  ```js
  // CHOOSATRON: why this line is here
  ```
  The whole footprint must stay findable with `git grep -n "CHOOSATRON:"`.
  Before adding a hook, check whether the feature can live entirely in
  `app/renderer/choosatron/` with a single call site. Usually it can.
- **Never edit `app/renderer/choosatron/coverageTables.js`.** It is generated
  from the firmware source. Change `codepage.cpp` and regenerate with
  `choosatron-esp32/choosatron/tools/14_gen_coverage_tables.py`.
- **User-facing strings go through `i18n._()`** with a plain quoted literal.
  The extractor is a regex — `i18n._("text")` only, never a template literal,
  a concatenation or a variable. **The literal must be on the same line as
  `i18n._(`**; the regex does not cross newlines, so a wrapped call is silently
  never extracted and can never be translated. Keep the line long instead.
  Substitute values outside the call using the `$NAME$` placeholder convention.

  The extractor cannot tell code from comments, so do not write an example of
  the call form in a comment either — it gets picked up as a real string.

  After adding strings, these two counts must match:

  ```bash
  grep -o 'i18n\._(' <file> | wc -l           # call sites
  grep -o 'i18n\._("[^"]*")' <file> | wc -l   # of those, extractable
  ```

## Checks

```bash
node app/renderer/choosatron/coverage.test.js   # no npm install needed
git grep -n "CHOOSATRON:"                       # seams intact after a merge
```

Run both after merging upstream.

## Before running the app

`inklecate` is in Git LFS. Without it the app cannot compile ink:

```bash
git lfs install && git lfs pull
cd app && npm install
npm start
```
