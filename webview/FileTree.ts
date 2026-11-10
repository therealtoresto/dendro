export interface FileLeaf {
  kind: 'file';
  name: string;
  index: number;
}

export interface FolderNode {
  kind: 'folder';
  name: string;
  path: string;
  fileCount: number;
  children: TreeNode[];
}

export type TreeNode = FolderNode | FileLeaf;

// Changed files as folders: folders first, then files, each by name; a folder whose only child is a folder is
// shown as one row ("server/src/rest"), the way a long path of one change reads best.
export class FileTree {
  static build(files: { path: string; index: number }[]): TreeNode[] {
    const root: FolderNode = { kind: 'folder', name: '', path: '', fileCount: 0, children: [] };

    for (const file of files) {
      const parts = file.path.split('/');
      let folder = root;
      for (let depth = 0; depth < parts.length - 1; depth++) {
        const path = parts.slice(0, depth + 1).join('/');
        let child = folder.children.find((node): node is FolderNode => node.kind === 'folder' && node.path === path);
        if (!child) {
          child = { kind: 'folder', name: parts[depth], path, fileCount: 0, children: [] };
          folder.children.push(child);
        }
        folder = child;
      }
      folder.children.push({ kind: 'file', name: parts[parts.length - 1], index: file.index });
    }

    return FileTree.finish(root).children;
  }

  private static finish(folder: FolderNode): FolderNode {
    folder.children = folder.children.map((node) => (node.kind === 'folder' ? FileTree.finish(node) : node));
    folder.children.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'folder' ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    folder.fileCount = folder.children.reduce((sum, node) => sum + (node.kind === 'folder' ? node.fileCount : 1), 0);

    const only = folder.children[0];
    if (folder.path && folder.children.length === 1 && only.kind === 'folder') {
      return { ...only, name: `${folder.name}/${only.name}` };
    }
    return folder;
  }
}
