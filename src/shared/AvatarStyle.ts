export class AvatarStyle {
  static getInitials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return '?';
    }
    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  // The same person keeps the same color everywhere: graph rows, details, blame annotations.
  static getColor(email: string): string {
    let hash = 0;
    for (let index = 0; index < email.length; index++) {
      hash = (hash * 31 + email.charCodeAt(index)) | 0;
    }
    return `hsl(${Math.abs(hash) % 360} 45% 42%)`;
  }
}
