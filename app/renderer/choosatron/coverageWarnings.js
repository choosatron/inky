// Turning a coverage report into the issues Inky already knows how to show.
//
// Kept apart from coverage.js on purpose. coverage.js decides what is true and
// has no dependencies, so it runs under bare `node`; this file owns the words
// and pulls in electron through i18n, so it cannot. Findings cross the line as
// data, never as prose.
//
// The issues produced here are ordinary Inky issues - { type, filename,
// lineNumber, message } - so they get the toolbar pane, the issue count, the
// warning icon, click-to-navigate and the inline Ace gutter marker without any
// new interface. `WARNING` is deliberate: an unprintable character is not a
// compile error, the story still runs, and inklecate is not the one complaining.

const i18n = require("../i18n.js");
const Coverage = require("./coverage.js");

// How many characters a single message names before it gives up and counts.
// A line with thirty uncovered characters is one problem, not thirty, and the
// author only needs to see enough of it to recognise which line is meant.
const MAX_NAMED_CHARS = 6;

// The firmware's placeholder convention, so a translator sees the same shape
// of string in the editor as in the device's interface.
function fill(template, values) {
    return template.replace(/\$([A-Z_]+)\$/g, (whole, name) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole
    );
}

/** `U+0416 Ж`, which is the only form that is useful in both directions: the
    author recognises the glyph, and the code point is what they can search for
    if the glyph is one their own font does not draw either. */
function describeChar(cp) {
    return "U+" + cp.toString(16).toUpperCase().padStart(4, "0") + " " + String.fromCodePoint(cp);
}

function describeChars(chars) {
    const named = chars.slice(0, MAX_NAMED_CHARS).map(describeChar).join("  ");
    if (chars.length <= MAX_NAMED_CHARS) return named;
    return fill(i18n._("$CHARS$ and $COUNT$ more"), {
        CHARS: named,
        COUNT: chars.length - MAX_NAMED_CHARS,
    });
}

function messageFor(finding) {
    switch (finding.kind) {
        case "unprintable":
            // Says what will happen, not that something is forbidden - the
            // story still compiles and still plays.
            return fill(
                i18n._("Will print as '?' on $PAGE$: $CHARS$"),
                { PAGE: finding.pageName, CHARS: describeChars(finding.chars) }
            );

        case "language-mismatch":
            // The one the device cannot possibly notice, and the one most
            // likely to be a simple mistake in the metadata block.
            // One line, however long. generateLocale.js finds strings with a
            // regex that does not cross newlines, so a wrapped call is silently
            // never extracted and can never be translated. (Do not write an
            // example of the call form in a comment either - the extractor
            // cannot tell a comment from code, and picks up the example.)
            return fill(
                i18n._("Language is '$LANG$', so the printer uses $PAGE$ - but this story's text fits $BETTER$. $COUNT$ characters will print as '?' until the language tag is corrected."),
                {
                    LANG: finding.language,
                    PAGE: finding.selectedPageName,
                    BETTER: finding.betterPageName,
                    COUNT: finding.recovered,
                }
            );

        case "language-unsupported": {
            const base = fill(
                i18n._("The printer has no code page or built-in font for '$LANG$'."),
                { LANG: finding.language }
            );
            if (finding.shaping && finding.shaping.length > 0) {
                // Worth the extra sentence: for these scripts a font pack is
                // necessary and not sufficient, so "add glyphs" is not the fix.
                return (
                    base +
                    " " +
                    fill(i18n._("This script also needs $REASON$, which glyphs alone do not provide."), {
                        REASON: finding.shaping.join(", "),
                    })
                );
            }
            return base;
        }

        default:
            return "";
    }
}

/**
 * Inky issues for a project.
 *
 * `files` is [{ filename, text }] using the same relative paths Inky filters
 * issues by, so a warning lands on the right file's gutter.
 */
function issuesForProject(files, mainFilename) {
    if (!files || files.length === 0) return [];

    const report = Coverage.analyzeProject(files, mainFilename);
    return report.findings.map((finding) => ({
        type: "WARNING",
        filename: finding.filename,
        lineNumber: finding.lineNumber,
        message: messageFor(finding),
        // Marks ours so the merge in liveCompiler can drop the previous round
        // without disturbing anything inklecate reported.
        choosatron: true,
    }));
}

module.exports = {
    issuesForProject,
    // Exported for tests and for anything that wants the report itself.
    analyzeProject: Coverage.analyzeProject,
};
