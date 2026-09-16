// Wiring the printer coverage warnings into Inky's existing issue channel.
//
// Everything that decides anything lives in coverage.js and coverageWarnings.js.
// This file exists so the edits to upstream files stay down to a require and a
// call: see CHOOSATRON.md on why that matters for a fork we merge into forever.
//
// The scan does not need inklecate. It reads the .ink source directly, so it
// runs on its own timer rather than waiting for a compile - which is just as
// well, because `play-generated-errors` only fires when inklecate has something
// to say, and a story whose only problem is an unprintable character compiles
// perfectly cleanly.

const CoverageWarnings = require("./coverageWarnings.js");

// Matches liveCompiler's own pause detection. Scanning is cheap - it is a walk
// over text already in memory - but warning about a character the author is
// still in the middle of typing is just noise.
const RESCAN_DELAY_MS = 500;

var rescanTimer = null;
var currentIssues = [];

/** The project's files in the shape coverage.js wants. Relative paths, because
    that is what Inky filters issues by and therefore what puts a gutter marker
    on the right file. */
function collectFiles() {
    const InkProject = require("../inkProject.js").InkProject;
    const project = InkProject.currentProject;
    if (!project || !project.files || project.files.length === 0) return null;

    return {
        files: project.files.map((f) => ({
            filename: f.relativePath(),
            text: f.getValue(),
        })),
        mainFilename: project.mainInk ? project.mainInk.relativePath() : null,
    };
}

/** Push the current issue set into both surfaces.

    Both calls are idempotent - updateIssueSummary rebuilds the table, and
    setErrors clears before it re-adds - so this can run as often as it likes.
    EditorView.addError() appends, which is why nothing here uses it. */
function apply() {
    const EditorView = require("../editorView.js").EditorView;
    const ToolbarView = require("../toolbarView.js").ToolbarView;
    const LiveCompiler = require("../liveCompiler.js").LiveCompiler;
    const InkProject = require("../inkProject.js").InkProject;

    LiveCompiler.setChoosatronIssues(currentIssues);
    ToolbarView.updateIssueSummary(LiveCompiler.getIssues());

    const project = InkProject.currentProject;
    if (project && project.activeInkFile) {
        EditorView.setErrors(
            LiveCompiler.getIssuesForFilename(project.activeInkFile.relativePath())
        );
    }
}

/** Scan now. */
function rescan() {
    rescanTimer = null;

    const collected = collectFiles();
    if (collected === null) return;

    try {
        currentIssues = CoverageWarnings.issuesForProject(
            collected.files,
            collected.mainFilename
        );
    } catch (err) {
        // A warning system that can break the editor is worse than no warning
        // system. Nothing here is load-bearing for writing or compiling ink.
        console.error("Choosatron coverage scan failed:", err);
        currentIssues = [];
    }

    apply();
}

const ChoosatronWarnings = {
    /** Rescan once the author pauses. Safe to call on every keystroke. */
    scheduleRescan: () => {
        if (rescanTimer !== null) clearTimeout(rescanTimer);
        rescanTimer = setTimeout(rescan, RESCAN_DELAY_MS);
    },

    /** Put our warnings back after something cleared the issue views - a new
        compile does that, and it has no idea ours were in there. */
    refresh: () => {
        if (currentIssues.length > 0) apply();
    },

    getIssues: () => currentIssues,
};

exports.ChoosatronWarnings = ChoosatronWarnings;
