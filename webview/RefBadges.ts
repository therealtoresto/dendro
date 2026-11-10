import type { RefInfo } from '../src/protocol';
import { Format } from './Format';
import { Icons } from './Icons';

export interface Badge {
  ref: RefInfo;
  remotes: string[];
  isCurrent: boolean;
  // Other tags on the same commit, folded into this tag's badge as "+N".
  moreTags?: string[];
}

export interface BadgeOptions {
  maxPills: number;
  showRemoteNames: boolean;
  showUpstreamStatus: boolean;
}

const DETAILS_OPTIONS: BadgeOptions = { maxPills: Infinity, showRemoteNames: true, showUpstreamStatus: true };

export class RefBadges {
  // A local branch and its remote copy on the same commit read as one badge, as "master ☁ origin".
  static groupRefs(refs: RefInfo[], headBranch: string | null): Badge[] {
    const remotes = refs.filter((ref) => ref.kind === 'remote');
    const mergedRemotes = new Set<RefInfo>();
    const badges: Badge[] = [];

    for (const ref of refs) {
      if (ref.kind !== 'head') {
        continue;
      }
      const copies = remotes.filter((remote) => remote.name === `${remote.remote}/${ref.name}`);
      for (const copy of copies) {
        mergedRemotes.add(copy);
      }
      badges.push({
        ref,
        remotes: copies.map((copy) => copy.remote ?? ''),
        isCurrent: ref.name === headBranch,
      });
    }

    badges.sort((left, right) => Number(right.isCurrent) - Number(left.isCurrent));

    for (const ref of remotes) {
      if (!mergedRemotes.has(ref)) {
        badges.push({ ref, remotes: [], isCurrent: false });
      }
    }
    for (const ref of refs) {
      if (ref.kind === 'tag' || ref.kind === 'worktree') {
        badges.push({ ref, remotes: [], isCurrent: false });
      }
    }

    return badges;
  }

  // A row has room for little, so a commit's tags share one badge: the first tag and "+N" for the rest.
  static render(refs: RefInfo[], headBranch: string | null, color: string, options: BadgeOptions): string {
    const badges = RefBadges.foldTags(RefBadges.groupRefs(refs, headBranch));
    if (badges.length === 0) {
      return '';
    }

    const visible = badges.slice(0, options.maxPills).map((badge) => RefBadges.renderBadge(badge, color, options));
    const hidden = badges.slice(options.maxPills);
    if (hidden.length > 0) {
      const names = hidden.map((badge) => badge.ref.name).join('\n');
      visible.push(`<span class="badge badge-more" title="${Format.escapeHtml(names)}">+${hidden.length}</span>`);
    }

    return visible.join('');
  }

  private static foldTags(badges: Badge[]): Badge[] {
    const tags = badges.filter((badge) => badge.ref.kind === 'tag');
    if (tags.length < 2) {
      return badges;
    }
    const first: Badge = { ...tags[0], moreTags: tags.slice(1).map((badge) => badge.ref.name) };
    return badges.filter((badge) => badge.ref.kind !== 'tag' || badge === tags[0]).map((badge) => (badge === tags[0] ? first : badge));
  }

  static renderAll(refs: RefInfo[], headBranch: string | null, color: string): string {
    return RefBadges.groupRefs(refs, headBranch)
      .map((badge) => RefBadges.renderBadge(badge, color, DETAILS_OPTIONS))
      .join('');
  }

  private static renderBadge(badge: Badge, color: string, options: BadgeOptions): string {
    const { ref } = badge;
    const context = Format.escapeHtml(
      JSON.stringify({
        webviewSection: 'ref',
        refName: ref.name,
        refKind: ref.kind,
        refPath: ref.path,
        preventDefaultContextMenuItems: true,
      }),
    );

    // A local branch wears a computer and a remote one a cloud, so "master" here and "master" on the server never
    // look alike when they point at different commits.
    let icon = Icons.render('branch', 12);
    if (ref.kind === 'head') {
      icon = Icons.render(badge.isCurrent ? 'laptopCheck' : 'laptop', 12);
    } else if (ref.kind === 'remote') {
      icon = Icons.render('cloud', 12);
    } else if (ref.kind === 'tag') {
      icon = Icons.render('tag', 12);
    } else if (ref.kind === 'worktree') {
      icon = Icons.render('folder', 12);
    }

    let label = ref.name;
    let remoteMark = '';
    if (ref.kind === 'remote' && ref.remote) {
      label = ref.name.slice(ref.remote.length + 1);
      if (options.showRemoteNames) {
        remoteMark = `<span class="badge-origin">${Format.escapeHtml(ref.remote)}</span>`;
      }
    } else if (badge.remotes.length > 0) {
      const names = options.showRemoteNames ? Format.escapeHtml(badge.remotes.join(' ')) : '';
      remoteMark = `<span class="badge-origin">${Icons.render('cloud', 11)}${names}</span>`;
    }

    let moreTagsMark = '';
    if (badge.moreTags?.length) {
      moreTagsMark = `<span class="badge-origin badge-more-tags">${Icons.render('tag', 11)}+${badge.moreTags.length}</span>`;
    }

    let upstreamMark = '';
    if (options.showUpstreamStatus && ref.upstream && (ref.ahead || ref.behind)) {
      const ahead = ref.ahead ? `<span title="${ref.ahead} to push">↑${ref.ahead}</span>` : '';
      const behind = ref.behind ? `<span title="${ref.behind} to pull">↓${ref.behind}</span>` : '';
      upstreamMark = `<span class="badge-upstream">${ahead}${behind}</span>`;
    }

    const kindNote = ref.kind === 'head' ? ' (local branch)' : ref.kind === 'remote' ? ' (remote branch)' : '';
    const tooltipLines = [`${ref.name}${kindNote}`, ...badge.remotes.map((remote) => `${remote}/${ref.name} (remote branch)`), ...(badge.moreTags ?? [])];
    if (ref.upstream) {
      tooltipLines.push(`tracks ${ref.upstream}: ${ref.ahead ?? 0} ahead, ${ref.behind ?? 0} behind`);
    }
    if (ref.kind === 'worktree') {
      tooltipLines.push(`worktree at ${ref.path}`);
    }
    const classes = ['badge', `badge-${ref.kind}`, badge.isCurrent ? 'badge-current' : ''].join(' ');
    // Branches can be dragged onto a commit to merge or rebase.
    const draggable = ref.kind === 'head' || ref.kind === 'remote' ? ' draggable="true"' : '';

    return (
      `<span class="${classes}"${draggable} style="--lane:${color}" data-ref-name="${Format.escapeHtml(ref.name)}" ` +
      `data-ref-kind="${ref.kind}" data-vscode-context="${context}" title="${Format.escapeHtml(tooltipLines.join('\n'))}">` +
      `${icon}<span class="badge-name">${Format.escapeHtml(label)}</span>${remoteMark}${moreTagsMark}${upstreamMark}</span>`
    );
  }
}
