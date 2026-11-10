import type { RefInfo } from '../src/protocol';
import { Format } from './Format';
import { Icons } from './Icons';

export interface Badge {
  ref: RefInfo;
  remotes: string[];
  isCurrent: boolean;
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
      if (ref.kind === 'tag') {
        badges.push({ ref, remotes: [], isCurrent: false });
      }
    }

    return badges;
  }

  static render(refs: RefInfo[], headBranch: string | null, color: string, options: BadgeOptions): string {
    const badges = RefBadges.groupRefs(refs, headBranch);
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
        preventDefaultContextMenuItems: true,
      }),
    );

    let icon = Icons.render('branch', 12);
    if (badge.isCurrent) {
      icon = Icons.render('check', 12);
    } else if (ref.kind === 'remote') {
      icon = Icons.render('cloud', 12);
    } else if (ref.kind === 'tag') {
      icon = Icons.render('tag', 12);
    }

    let label = ref.name;
    if (ref.kind === 'remote' && !options.showRemoteNames && ref.remote) {
      label = ref.name.slice(ref.remote.length + 1);
    }

    let remoteMark = '';
    if (badge.remotes.length > 0) {
      const names = options.showRemoteNames ? Format.escapeHtml(badge.remotes.join(' ')) : '';
      remoteMark = `<span class="badge-origin">${Icons.render('cloud', 11)}${names}</span>`;
    }

    let upstreamMark = '';
    if (options.showUpstreamStatus && ref.upstream && (ref.ahead || ref.behind)) {
      const ahead = ref.ahead ? `<span title="${ref.ahead} to push">↑${ref.ahead}</span>` : '';
      const behind = ref.behind ? `<span title="${ref.behind} to pull">↓${ref.behind}</span>` : '';
      upstreamMark = `<span class="badge-upstream">${ahead}${behind}</span>`;
    }

    const tooltipLines = [ref.name, ...badge.remotes.map((remote) => `${remote}/${ref.name}`)];
    if (ref.upstream) {
      tooltipLines.push(`tracks ${ref.upstream}: ${ref.ahead ?? 0} ahead, ${ref.behind ?? 0} behind`);
    }
    const classes = ['badge', `badge-${ref.kind}`, badge.isCurrent ? 'badge-current' : ''].join(' ');

    return (
      `<span class="${classes}" style="--lane:${color}" data-ref-name="${Format.escapeHtml(ref.name)}" ` +
      `data-ref-kind="${ref.kind}" data-vscode-context="${context}" title="${Format.escapeHtml(tooltipLines.join('\n'))}">` +
      `${icon}<span class="badge-name">${Format.escapeHtml(label)}</span>${remoteMark}${upstreamMark}</span>`
    );
  }
}
