// Run with bare node - no npm install, no electron, no mocha:
//
//     node app/renderer/choosatron/coverage.test.js
//
// The first fourteen cases are the ones in
// choosatron-esp32/choosatron/tools/13_scan_glyph_coverage.py --selftest and in
// choosatron/test/glyph_coverage/. Three implementations of one judgement is
// two too many to keep in step by hand, so they are meant to agree case for
// case: if one of these changes, the other two change with it.
//
// The rest are what the editor adds over the device: line numbers, the metadata
// block, and the tag-versus-text disagreement the device cannot see.

const assert = require("assert");
const C = require("./coverage.js");

let failures = 0;
let count = 0;

function test(name, fn) {
    count++;
    try {
        fn();
        console.log("ok   " + name);
    } catch (err) {
        failures++;
        console.log("FAIL " + name);
        console.log("     " + err.message.split("\n").join("\n     "));
    }
}

function tierOf(text) {
    return C.classify(C.scanText(text).counts).tier;
}

// --------------------------------------------------------------------------
// The shared cases. Same text, same expected tier, as the Python and the C++.
// --------------------------------------------------------------------------

const SHARED = [
    ["plain English", "Hello there.", C.TIER_ASCII],
    ["German umlauts", "Grüße für Mädchen", C.TIER_PAGE],
    ["Russian", "Привет мир", C.TIER_PAGE],
    ["Polish", "Zażółć gęślą jaźń", C.TIER_PAGE],
    ["Turkish", "İstanbul ğüşıöç", C.TIER_PAGE],
    ["Japanese with ASCII", "幽霊狩り test", C.TIER_PAGE],
    ["em dash and ellipsis", "wait — really…", C.TIER_PAGE],
    ["Russian with guillemets", "«Да» сказал он", C.TIER_PAGE],
    // No single page has both, which is the whole point of asking for one page.
    ["Polish AND Russian", "Zażółć Привет", C.TIER_GLYPHS],
    ["Hebrew", "שלום עולם", C.TIER_RASTER],
    ["Arabic", "مرحبا بالعالم", C.TIER_RASTER],
    ["Devanagari", "नमस्ते", C.TIER_RASTER],
    // Korean is tier 4 for its unbounded inventory, not for any one glyph:
    // two syllables genuinely do fit the 64 custom slots.
    ["a few Korean syllables", "안녕", C.TIER_GLYPHS],
    [
        "many Korean syllables",
        Array.from({ length: 80 }, (_, i) => String.fromCodePoint(0xac00 + i)).join(""),
        C.TIER_RASTER,
    ],
];

for (const [name, text, expected] of SHARED) {
    test("shared: " + name, () => {
        assert.strictEqual(tierOf(text), expected);
    });
}

// --------------------------------------------------------------------------
// The judgements that are easy to get wrong
// --------------------------------------------------------------------------

test("substitution does not count as missing", () => {
    // The bug this exists for: counting stand-ins as failures reported four
    // archive stories in nine as broken, every one of them wrongly.
    const r = C.classify(C.scanText("wait — really…").counts);
    assert.strictEqual(r.missing.length, 0);
    assert.strictEqual(r.substituted.length, 2);
});

test("the table flip prints, because every piece of it substitutes", () => {
    const r = C.classify(C.scanText("(╯°□°)╯︵ ┻━┻").counts);
    assert.strictEqual(r.missing.length, 0, "missing: " + JSON.stringify(r.missing));
});

test("the built-in font is free and needs no page", () => {
    const r = C.classify(C.scanText("幽霊狩り test").counts);
    assert.strictEqual(r.missing.length, 0);
    assert.ok(r.font > 0);
});

test("distinct code points, not occurrences", () => {
    const r = C.classify(C.scanText("안".repeat(1000)).counts);
    assert.strictEqual(r.missing.length, 1);
    assert.strictEqual(r.tier, C.TIER_GLYPHS);
});

test("feeding order does not change the answer", () => {
    const a = C.classify(C.scanText("Grüße — Привет").counts);
    const b = C.classify(C.scanText("Привет — Grüße").counts);
    assert.strictEqual(a.tier, b.tier);
    assert.strictEqual(a.page, b.page);
    assert.strictEqual(a.missing.length, b.missing.length);
});

// --------------------------------------------------------------------------
// The language tag, which is what the device actually selects its page with
// --------------------------------------------------------------------------

test("pageForLanguage matches the firmware's mapping", () => {
    assert.strictEqual(C.pageForLanguage("en"), 2);
    assert.strictEqual(C.pageForLanguage("de"), 2);
    assert.strictEqual(C.pageForLanguage("pl"), 18);
    assert.strictEqual(C.pageForLanguage("ru"), 7);
    assert.strictEqual(C.pageForLanguage("bg"), 7);
    assert.strictEqual(C.pageForLanguage("tr"), 29);
    assert.strictEqual(C.pageForLanguage("zh"), C.CJK_PAGE);
    assert.strictEqual(C.pageForLanguage("ja"), C.CJK_PAGE);
    // Serbian only counts as Central European in Latin script.
    assert.strictEqual(C.pageForLanguage("sr-Latn"), 18);
    assert.strictEqual(C.pageForLanguage("sr"), 2);
    // Unknown, empty and malformed tags all fall to the startup page.
    assert.strictEqual(C.pageForLanguage("ko"), 2);
    assert.strictEqual(C.pageForLanguage(""), 2);
    assert.strictEqual(C.pageForLanguage("klingon"), 2);
});

test("printerRenders is not pageForLanguage() !== CP850", () => {
    // The trap the firmware comment calls out: CP850 is both the Western
    // European page and the fallback, so that test calls Korean printable.
    assert.strictEqual(C.printerRenders("ko"), false);
    assert.strictEqual(C.printerRenders("hi"), false);
    assert.strictEqual(C.printerRenders("el"), false);
    assert.strictEqual(C.printerRenders("th"), false);
    assert.strictEqual(C.printerRenders("en"), true);
    assert.strictEqual(C.printerRenders("ru"), true);
    assert.strictEqual(C.printerRenders("sr-Latn"), true);
    assert.strictEqual(C.printerRenders("sr"), false);
});

// --------------------------------------------------------------------------
// The metadata block
// --------------------------------------------------------------------------

const HEADER = [
    "// --- Choosatron Metadata Tags Start ---",
    "# title: A Test",
    "# author: Nobody",
    "# language: en",
    "# ifid: 00000000-0000-0000-0000-000000000000",
    "// --- Choosatron Metadata Tags End ---",
    "",
].join("\n");

test("metadata is read with the line each tag sits on", () => {
    const tags = C.parseMetadata(HEADER);
    assert.strictEqual(tags.title.value, "A Test");
    assert.strictEqual(tags.language.value, "en");
    assert.strictEqual(tags.language.lineNumber, 4);
});

test("an empty tag value is kept, not dropped", () => {
    const tags = C.parseMetadata("# subtitle:  \n# language: de\n");
    assert.strictEqual(tags.subtitle.value, "");
    assert.strictEqual(tags.language.value, "de");
});

test("prose starting with # is not mistaken for a tag", () => {
    const tags = C.parseMetadata("# language: en\nThe sign read # warning: keep out\n");
    assert.strictEqual(Object.keys(tags).length, 1);
});

// --------------------------------------------------------------------------
// What the editor knows that the device cannot
// --------------------------------------------------------------------------

function project(body, language) {
    const header = HEADER.replace("# language: en", "# language: " + language);
    return C.analyzeProject([{ filename: "main.ink", text: header + body }], "main.ink");
}

test("a correctly tagged story reports nothing", () => {
    const r = project("Привет, мир!\n", "ru");
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
    assert.strictEqual(r.selectedPage, 7);
});

test("the wrong tag is caught, and the right page named", () => {
    // The whole point: the characters are fine, the tag is what breaks it.
    const r = project("Привет, мир!\n", "en");
    const mismatch = r.findings.find((f) => f.kind === "language-mismatch");
    assert.ok(mismatch, "expected a language-mismatch finding");
    assert.strictEqual(mismatch.selectedPageName, "CP850");
    assert.strictEqual(mismatch.betterPageName, "CP866");
    // It points at the tag, not at the prose.
    assert.strictEqual(mismatch.lineNumber, 4);
});

test("unprintable characters are reported on their own lines", () => {
    const r = project("All fine here.\nПривет!\nStill fine.\nМир!\n", "en");
    const lines = r.findings
        .filter((f) => f.kind === "unprintable")
        .map((f) => f.lineNumber);
    // The header is six lines and ends in a newline, so the body starts at
    // line 7 and its second and fourth lines are 8 and 10.
    assert.deepStrictEqual(lines, [8, 10]);
});

test("a line names the characters it is complaining about", () => {
    const r = project("Привет\n", "en");
    const finding = r.findings.find((f) => f.kind === "unprintable");
    assert.ok(finding.chars.length > 0);
    assert.ok(finding.chars.every((cp) => cp >= 0x80));
});

test("a language with no page and no font says so", () => {
    const r = project("안녕하세요\n", "ko");
    assert.ok(r.findings.some((f) => f.kind === "language-unsupported"));
});

test("Hebrew reports the reason, not just the characters", () => {
    const r = project("שלום עולם\n", "he");
    const unsupported = r.findings.find((f) => f.kind === "language-unsupported");
    assert.ok(unsupported);
    assert.ok(unsupported.shaping.some((why) => /Hebrew/.test(why)));
});

test("an INCLUDEd file is part of the same story", () => {
    // One page prints the whole project, so a second file can be what makes a
    // page impossible. Scanning files separately would call this printable.
    const r = C.analyzeProject(
        [
            { filename: "main.ink", text: HEADER + "Zażółć\n" },
            { filename: "two.ink", text: "Привет\n" },
        ],
        "main.ink"
    );
    assert.ok(r.findings.some((f) => f.filename === "two.ink"));
});

test("a pure ASCII story is silent whatever its tag", () => {
    for (const tag of ["en", "ru", "ko", ""]) {
        const r = project("Just plain words.\n", tag);
        assert.strictEqual(
            r.findings.filter((f) => f.kind === "unprintable").length,
            0,
            "tag " + tag
        );
    }
});

test("a CJK story prints through the font, not a page", () => {
    const r = project("幽霊狩り\n", "ja");
    assert.strictEqual(
        r.findings.filter((f) => f.kind === "unprintable").length,
        0,
        JSON.stringify(r.findings)
    );
    assert.ok(r.usesChineseFont);
});

console.log("\n" + (count - failures) + " of " + count + " passed");
process.exit(failures ? 1 : 0);
