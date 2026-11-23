# Changelog

## 0.14.1

- Fetch remembers when it failed and why: the button is marked "failed" until a fetch works again, and its card shows
  git's reason (an unknown host off the VPN, say) and the time of the last fetch that worked. Auto-fetch failures,
  which never interrupt you, show there too.

## 0.14.0

- Working Changes reads like a commit: your avatar, the branch badge, file counts and Stash / Discard / Source
  Control buttons. Write the message and commit right there (Cmd/Ctrl+Enter); stage and unstage a file or a whole
  section with + and −.

## 0.13.0

- Working Changes: discard the changes of a file from its row or its right-click menu, or all changes at once from
  the panel header or the right-click menu of the Working Changes row. Untracked files go to the Trash.

## 0.12.1

First public release.

- Commit Graph: lanes, badges with ahead / behind, uncommitted changes on top, resizable and reorderable columns,
  pull / push / fetch / publish, automatic fetch, commit details and diffs, commit and branch actions, drag a branch
  to merge or rebase, compare two commits, search and scrollbar marks, a card on hover, editor tab or bottom panel.
- Side bar: Overview with the current branch, its actions, branches and latest commits; Remotes, Tags, Stashes,
  Worktrees, Contributors, File History and Line History.
- Editor: blame after the current line and in the status bar, blame cards on hover, CodeLens, File Blame, File
  Heatmap and File Changes annotations.
- Compare branches, tags or commits; interactive rebase editor; Visual File History; Repository Insights.
- Blame card on hover and on the status bar: author, message, files and lines changed, links to the changes, the
  file before the commit, the graph, the line history and the remote, and the changed lines as highlighted code.
  Blame works in the diff of a commit too, so you can walk from change to change.
- Settings screen with a tile and a switch for every part of Dendro and live previews.
- Avatars from GitHub, GitLab and Gravatar.
