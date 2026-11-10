export class Format {
  static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  static highlight(text: string, query: string): string {
    if (!query) {
      return Format.escapeHtml(text);
    }

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let html = '';
    let position = 0;

    while (position < text.length) {
      const found = lowerText.indexOf(lowerQuery, position);
      if (found < 0) {
        break;
      }
      html += Format.escapeHtml(text.slice(position, found));
      html += `<mark>${Format.escapeHtml(text.slice(found, found + query.length))}</mark>`;
      position = found + query.length;
    }

    return html + Format.escapeHtml(text.slice(position));
  }

  static splitPath(filePath: string): { name: string; folder: string } {
    const slash = filePath.lastIndexOf('/');
    if (slash < 0) {
      return { name: filePath, folder: '' };
    }
    return { name: filePath.slice(slash + 1), folder: filePath.slice(0, slash) };
  }
}
