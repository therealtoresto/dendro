# Dendro

Dendrochronology reads a tree's history from its rings. Dendro reads your git tree: a commit graph for Cursor / VS Code.

## What it does

**Commit Graph**
- Lanes, merges, branch / remote / tag pills (with ahead / behind), Working Changes on top, 500 commits at a time.
- Resizable columns (drag a header border, double-click to reset): Branch / Tag, Graph, Message, Author, Changes
  (files changed + added / deleted bar), Date, SHA. Columns can be hidden in the settings.
- Pull / Push / Fetch from the toolbar through the built-in Git extension; publish a branch without upstream.
- Commit details: author, dates, parents, message, changed files with `+/-`; click a file for its diff.
- Cmd/Ctrl+click a second commit to compare the two.
- Search by message, author or SHA; minimap of daily activity; markers on the scrollbar.
- All / smart / current branches, three commit orders, dimmed merges, Gravatar (opt-in).
- Context menu: copy, checkout, create branch, cherry-pick, revert, reset. Shown in the editor or the bottom panel.
- Hover a row for a card with the author's picture, dates, files added / modified / deleted, changed lines and the full message.
- Working Changes on top counts added / modified / deleted / conflicted files and what is staged.

**Avatars** — account pictures from GitHub, GitLab and Gravatar, downloaded by the extension and cached for a week.
A private GitLab shows its users' pictures only with a token: run **Dendro: Connect GitLab for Avatars** (a token with
the `read_user` scope, kept in Cursor's secret storage).

**Editor**
- Inline blame at the end of the current line, and blame in the status bar.
- Blame hovers with the full message, links and the line's diff.
- File Blame, File Heatmap and File Changes annotations (editor title button, editor context menu → Dendro Annotations).

**Settings screen** — Command palette → **Dendro: Open Settings**, or the gear in the graph toolbar. Every section has a
live preview; values go to your settings.json (`dendro.*`).

## Build and install

```sh
npm install
npm test               # graph layout + git output parsers
npm run install-cursor # builds dendro.vsix and installs it into Cursor
```

`npm run watch` rebuilds on change; reload the Cursor window to pick up a new build.
