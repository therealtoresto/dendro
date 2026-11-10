// "${author}, ${agoOrDate} • ${message|50}": `|50` cuts a value to 50 characters with an ellipsis,
// `|14-` also pads a shorter one to 14.
const TOKEN_PATTERN = /\$\{(\w+)(?:\|(\d+)(-)?)?\}/g;

export class TokenTemplate {
  static format(template: string, values: Record<string, string>): string {
    return template.replace(TOKEN_PATTERN, (_match, name: string, width: string | undefined, pad: string | undefined) => {
      const value = (values[name] ?? '').replace(/\s+/g, ' ');
      if (!width) {
        return value;
      }

      const size = Number(width);
      if (value.length > size) {
        return value.slice(0, Math.max(0, size - 1)) + '…';
      }
      return pad ? value.padEnd(size, ' ') : value;
    });
  }
}
