// Can the Choosatron actually print this story?
//
// WHY AT WRITING TIME
// The thermal printer draws single bytes through one built-in code page at a
// time. A character no page covers reaches the paper as '?'. The device cannot
// do better and by upload time the text is already written, so the editor is
// the only place where saying so is still useful - the author can change a
// character, pick a different quote mark, or fix the language tag.
//
// THE PAGE COMES FROM THE TAG, NOT THE TEXT
// This is the failure worth catching. The firmware selects its page with
// pageForLanguage(), which reads the story's `# language:` tag. It does not
// look at the text. So a story tagged `en` that contains Cyrillic is printed
// on CP850 and comes out as rows of '?', even though CP866 would have covered
// every letter of it. The characters are fine; the tag is wrong. Nothing on
// the device can notice this, because from the device's side a '?' is just
// what that page says.
//
// SUBSTITUTION IS NOT FAILURE
// pageFallback() stands in where it can - a straight quote for a curly one, a
// hyphen for an em dash, a base letter for an accented one. Those print as
// something sensible and are not warned about as unprintable. Ignoring this
// distinction is not a detail: scanning the archive without it reported four
// stories in nine as broken, and every single character it flagged was one the
// firmware already substitutes.
//
// This module is deliberately free of dependencies - no electron, no jquery -
// so it can be run and tested with bare `node coverage.test.js`. Message text
// and i18n belong to the layer above.

const TABLES = require("./coverageTables.js");

// The tiers, as printer-language-support.md numbers them.
const TIER_ASCII = 0; // any page will do
const TIER_PAGE = 2; // one code page covers it, possibly with the built-in font
const TIER_GLYPHS = 3; // what is left would fit the 64 downloadable slots
const TIER_RASTER = 4; // raster or shaping needed; no font pack alone fixes it

const CJK_PAGE = 255; // not an `ESC t` page: the built-in Chinese font
const DEFAULT_PAGE = 2; // CP850, the page the printer starts on

// Built once. The generated file is sorted arrays so it stays readable in a
// diff; membership tests want sets.
const PAGE_SETS = new Map(TABLES.pages.map((p) => [p.escT, new Set(p.codepoints)]));
const PAGE_NAMES = new Map(TABLES.pages.map((p) => [p.escT, p.name]));
const SUBSTITUTED = new Set(TABLES.substituted);

function inRanges(cp, ranges) {
    for (const range of ranges) {
        if (cp >= range[0] && cp <= range[1]) return true;
    }
    return false;
}

/** Whether pageFallback() has a real stand-in for this code point. */
function isSubstituted(cp) {
    return SUBSTITUTED.has(cp) || inRanges(cp, TABLES.substitutedRanges);
}

/** Whether the printer's built-in Chinese font draws this in Kanji mode.
    Independent of the selected page, so these cost nothing and rule nothing
    out - mirrors inChineseFont() in codepage.cpp. */
function inChineseFont(cp) {
    return inRanges(cp, TABLES.chineseFont);
}

/** Why this code point needs more than a glyph, or null. */
function shapingReason(cp) {
    for (const [lo, hi, why] of TABLES.shaping) {
        if (cp >= lo && cp <= hi) return why;
    }
    return null;
}

/** Whether `escT` draws `cp`. ASCII is its own byte on every page. */
function pageCovers(escT, cp) {
    if (cp < 0x80) return true;
    const set = PAGE_SETS.get(escT);
    return set !== undefined && set.has(cp);
}

/** The primary subtag, lowercased: "pl" from "pl", "sr" from "sr-Latn".
    Returns null when it is not a subtag the firmware would recognise - the C++
    holds it in a 4-byte buffer and gives up past three characters. */
function primarySubtag(tag) {
    if (typeof tag !== "string") return null;
    const primary = tag.split("-")[0].toLowerCase();
    if (primary.length === 0 || primary.length > 3) return null;
    return primary;
}

function hasSubtag(tag, subtag) {
    return String(tag)
        .toLowerCase()
        .split("-")
        .includes(subtag);
}

/** The page the firmware will select for this tag - pageForLanguage() in
    codepage.cpp, rule for rule. CP850 for anything unlisted, including a
    missing or empty tag, because that is the page the printer starts on. */
function pageForLanguage(tag) {
    const primary = primarySubtag(tag);
    if (primary === null) return DEFAULT_PAGE;
    if (TABLES.central.includes(primary)) return 18; // CP852
    // Serbian is written in both scripts; only the Latin one is on CP852.
    if (primary === "sr" && hasSubtag(tag, "latn")) return 18;
    if (primary === "ru" || primary === "bg") return 7; // CP866
    if (primary === "tr") return 29; // CP857
    if (primary === "zh" || primary === "ja") return CJK_PAGE;
    return DEFAULT_PAGE;
}

/** Whether the printer can really render this language, as opposed to having
    a page to fall back to. Deliberately not `pageForLanguage(tag) !== 2`:
    CP850 is both the Western European page and the answer for a language the
    firmware has never heard of. */
function printerRenders(tag) {
    const primary = primarySubtag(tag);
    if (primary === null) return false;
    if (TABLES.covered.includes(primary)) return true;
    return primary === "sr" && hasSubtag(tag, "latn");
}

/** The pages a story could be printed on, in the firmware's preference order.
    CP850 first: it is the startup page, so choosing it costs no switch. */
function candidatePages() {
    return TABLES.pages.map((p) => p.escT);
}

/** How a set of code points fares on one page.

    `counts` is a Map of codepoint -> occurrences. Returns the distinct code
    points that would print as '?' and those that would print as a stand-in. */
function underPage(counts, escT) {
    const missing = [];
    const substituted = [];
    for (const cp of counts.keys()) {
        if (cp < 0x80) continue;
        // The font draws these whatever page is selected - out first, exactly
        // as CoverageScanner::feed() takes them out first.
        if (inChineseFont(cp)) continue;
        if (pageCovers(escT, cp)) continue;
        if (isSubstituted(cp)) substituted.push(cp);
        else missing.push(cp);
    }
    return { missing, substituted };
}

/** Which tier a story needs, and why - the same judgement as
    CoverageScanner::finish() and 13_scan_glyph_coverage.py's classify().

    `page` is the page that leaves the least behind, which is NOT necessarily
    the page the device will pick. Ties go to the earlier candidate, putting
    CP850 first. */
function classify(counts) {
    const nonAscii = [...counts.keys()].filter((cp) => cp >= 0x80);
    if (nonAscii.length === 0) {
        return {
            tier: TIER_ASCII,
            page: null,
            pageName: null,
            font: 0,
            missing: [],
            substituted: [],
            shaping: [],
        };
    }

    const font = nonAscii.filter(inChineseFont);

    let best = null;
    for (const escT of candidatePages()) {
        const result = underPage(counts, escT);
        if (best === null || result.missing.length < best.result.missing.length) {
            best = { escT, result };
        }
        if (result.missing.length === 0) break;
    }

    const { missing, substituted } = best.result;
    const shaping = [...new Set(missing.map(shapingReason).filter(Boolean))];

    let tier;
    if (missing.length === 0) tier = TIER_PAGE;
    // Glyphs alone will not print these however few there are, so the custom
    // slots are not an answer and raster is only half of one.
    else if (shaping.length > 0) tier = TIER_RASTER;
    else if (missing.length <= TABLES.customGlyphSlots) tier = TIER_GLYPHS;
    else tier = TIER_RASTER;

    return {
        tier,
        page: best.escT,
        pageName: PAGE_NAMES.get(best.escT) || null,
        font: font.length,
        missing: missing.sort((a, b) => a - b),
        substituted: substituted.sort((a, b) => a - b),
        shaping,
    };
}

// --------------------------------------------------------------------------
// Reading a story's own text
// --------------------------------------------------------------------------

// The metadata block the Choosatron reads, as fsm_ink_parser.cpp names the
// keys. Only `language` decides anything here; the rest are recognised so a
// typo in the block can be told apart from prose that happens to start with #.
const TAG_KEYS = [
    "title", "subtitle", "author", "credits", "contact", "rating", "warning",
    "version", "published", "language", "translation", "translator", "ifid",
];

const TAG_LINE = /^\s*#\s*([a-z]+)\s*:\s*(.*)$/;

/** The story's declared metadata, with the line each tag was found on so a
    warning about the tag can point at the tag. First occurrence wins, which is
    what the firmware's parser does. */
function parseMetadata(text) {
    const tags = {};
    const lines = String(text).split("\n");
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(TAG_LINE);
        if (match === null) continue;
        const key = match[1].toLowerCase();
        if (!TAG_KEYS.includes(key)) continue;
        if (Object.prototype.hasOwnProperty.call(tags, key)) continue;
        tags[key] = { value: match[2].trim(), lineNumber: i + 1 };
    }
    return tags;
}

/** Every distinct non-ASCII code point in `text`, and where it appears.

    Returns { counts, lines } where counts is codepoint -> occurrences and
    lines is codepoint -> sorted [1-based line numbers]. Iterating the string
    rather than indexing it keeps astral characters whole. */
function scanText(text) {
    const counts = new Map();
    const lines = new Map();
    const sourceLines = String(text).split("\n");

    for (let i = 0; i < sourceLines.length; i++) {
        for (const ch of sourceLines[i]) {
            const cp = ch.codePointAt(0);
            if (cp < 0x80) continue;
            counts.set(cp, (counts.get(cp) || 0) + 1);
            let where = lines.get(cp);
            if (where === undefined) lines.set(cp, (where = []));
            if (where[where.length - 1] !== i + 1) where.push(i + 1);
        }
    }
    return { counts, lines };
}

/** Merge several files' scans into one, keeping per-file line numbers.

    A project is one story: INCLUDEd files print through the same page, so the
    page has to cover all of them at once. Analysing a single file in isolation
    would call a story printable that is not. */
function mergeScans(scans) {
    const counts = new Map();
    const where = new Map(); // codepoint -> [{filename, lineNumber}]
    for (const { filename, scan } of scans) {
        for (const [cp, n] of scan.counts) {
            counts.set(cp, (counts.get(cp) || 0) + n);
        }
        for (const [cp, lineNumbers] of scan.lines) {
            let list = where.get(cp);
            if (list === undefined) where.set(cp, (list = []));
            for (const lineNumber of lineNumbers) list.push({ filename, lineNumber });
        }
    }
    return { counts, where };
}

/**
 * Analyse a whole project.
 *
 * `files` is [{ filename, text }] - every .ink file in the project, because
 * they are one story. `mainFilename` names the one whose metadata block counts.
 *
 * Returns a report, not prose: the layer above turns findings into messages so
 * that this stays testable without electron.
 */
function analyzeProject(files, mainFilename) {
    const scans = files.map((f) => ({ filename: f.filename, scan: scanText(f.text) }));
    const { counts, where } = mergeScans(scans);

    const main = files.find((f) => f.filename === mainFilename) || files[0];
    const tags = main ? parseMetadata(main.text) : {};
    const languageTag = tags.language ? tags.language.value : "";

    // What the device will really do, and what the text would have preferred.
    const selected = pageForLanguage(languageTag);
    const best = classify(counts);

    // The Chinese font is reached whatever page is selected, so a CJK story is
    // measured against CP850 for everything the font does not draw.
    const effective = selected === CJK_PAGE ? DEFAULT_PAGE : selected;
    const actual = underPage(counts, effective);

    const findings = [];

    // A language the printer has no page and no font for. Worth saying plainly,
    // because no amount of editing the text fixes it.
    if (languageTag !== "" && !printerRenders(languageTag)) {
        findings.push({
            kind: "language-unsupported",
            language: languageTag,
            filename: main.filename,
            lineNumber: tags.language.lineNumber,
            shaping: [...new Set(
                [...counts.keys()].map(shapingReason).filter(Boolean))],
        });
    }

    // The tag and the text disagree: another page would print this correctly,
    // and the tag is what stops the firmware choosing it.
    if (
        actual.missing.length > 0 &&
        best.page !== null &&
        best.page !== effective &&
        best.missing.length < actual.missing.length
    ) {
        findings.push({
            kind: "language-mismatch",
            language: languageTag,
            filename: main.filename,
            lineNumber: tags.language ? tags.language.lineNumber : 1,
            selectedPage: effective,
            selectedPageName: PAGE_NAMES.get(effective) || null,
            betterPage: best.page,
            betterPageName: best.pageName,
            recovered: actual.missing.length - best.missing.length,
        });
    }

    // One finding per line that contains characters the selected page loses,
    // so the warning lands on the line the author has to look at.
    const byLine = new Map();
    for (const cp of actual.missing) {
        for (const site of where.get(cp) || []) {
            const key = site.filename + ":" + site.lineNumber;
            let entry = byLine.get(key);
            if (entry === undefined) {
                byLine.set(key, (entry = {
                    kind: "unprintable",
                    filename: site.filename,
                    lineNumber: site.lineNumber,
                    chars: [],
                    pageName: PAGE_NAMES.get(effective) || null,
                }));
            }
            if (!entry.chars.includes(cp)) entry.chars.push(cp);
        }
    }
    for (const entry of byLine.values()) {
        entry.chars.sort((a, b) => a - b);
        entry.shaping = [...new Set(entry.chars.map(shapingReason).filter(Boolean))];
        findings.push(entry);
    }

    findings.sort(
        (a, b) =>
            String(a.filename).localeCompare(String(b.filename)) ||
            a.lineNumber - b.lineNumber
    );

    return {
        tier: best.tier,
        language: languageTag,
        selectedPage: effective,
        selectedPageName: PAGE_NAMES.get(effective) || null,
        usesChineseFont: selected === CJK_PAGE || best.font > 0,
        missing: actual.missing,
        substituted: actual.substituted,
        best,
        findings,
    };
}

module.exports = {
    TIER_ASCII,
    TIER_PAGE,
    TIER_GLYPHS,
    TIER_RASTER,
    CJK_PAGE,
    isSubstituted,
    inChineseFont,
    shapingReason,
    pageCovers,
    pageForLanguage,
    printerRenders,
    classify,
    parseMetadata,
    scanText,
    underPage,
    analyzeProject,
};
