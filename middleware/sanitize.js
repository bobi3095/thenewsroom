const allowedTags = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'h2', 'h3', 'blockquote', 'ul', 'ol', 'li',
  'a', 'img', 'figure', 'figcaption'
]);

const voidTags = new Set(['br', 'img']);
const allowedAttrs = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title'])
};

function isSafeUrl(value, allowDataImage = false) {
  if (!value) return false;
  const trimmed = value.trim();
  if (allowDataImage && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(trimmed)) return true;
  if (trimmed.startsWith('/')) return !trimmed.startsWith('//');
  try {
    const parsed = new URL(trimmed);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function sanitizeArticleHtml(html = '') {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?([a-zA-Z0-9-]+)([^>]*)>/g, (match, rawTag, rawAttrs) => {
      const tag = rawTag.toLowerCase();
      if (!allowedTags.has(tag)) return '';
      if (match.startsWith('</')) return voidTags.has(tag) ? '' : `</${tag}>`;

      const attrs = [];
      const allowed = allowedAttrs[tag];
      if (allowed) {
        rawAttrs.replace(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g, (_, rawName, __, dQuote, sQuote, bare) => {
          const name = rawName.toLowerCase();
          if (!allowed.has(name) || name.startsWith('on')) return '';
          const value = dQuote ?? sQuote ?? bare ?? '';
          if ((name === 'href' && !isSafeUrl(value)) || (name === 'src' && !isSafeUrl(value, true))) return '';
          const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
          attrs.push(`${name}="${escaped}"`);
          return '';
        });
      }
      if (tag === 'a') {
        attrs.push('rel="noopener noreferrer"');
        if (!attrs.some(attr => attr.startsWith('target='))) attrs.push('target="_blank"');
      }
      return `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
    });
}

module.exports = { sanitizeArticleHtml };
