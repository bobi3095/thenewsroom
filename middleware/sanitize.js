const allowedTags = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'h2', 'h3', 'blockquote', 'ul', 'ol', 'li',
  'a', 'img', 'figure', 'figcaption'
]);

const voidTags = new Set(['br', 'img']);
const allowedAttrs = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'style']),
  figure: new Set(['class', 'style']),
  figcaption: new Set(['style'])
};

function sanitizeStyle(value = '') {
  const safe = [];
  String(value).split(';').forEach(part => {
    const [rawProp, ...rawValueParts] = part.split(':');
    if (!rawProp || !rawValueParts.length) return;
    const prop = rawProp.trim().toLowerCase();
    const val = rawValueParts.join(':').trim().toLowerCase();
    if (!val || /url|expression|javascript|<|>/i.test(val)) return;

    if (prop === 'width' && /^([1-9][0-9]?|100)%$/.test(val)) safe.push(`width:${val}`);
    if (prop === 'max-width' && val === '100%') safe.push('max-width:100%');
    if (prop === 'height' && (val === 'auto' || /^([1-9][0-9]{1,2})px$/.test(val))) safe.push(`height:${val}`);
    if (prop === 'display' && ['block', 'inline-block'].includes(val)) safe.push(`display:${val}`);
    if (
      prop === 'margin'
      && (
        /^([0-9.]+em|[0-9]+px)\s+(auto|0)$/.test(val)
        || /^([0-9.]+em|[0-9]+px)\s+(auto|0)\s+([0-9.]+em|[0-9]+px)\s+(auto|0)$/.test(val)
      )
    ) safe.push(`margin:${val}`);
    if (prop === 'text-align' && ['left', 'center', 'right'].includes(val)) safe.push(`text-align:${val}`);
    if (prop === 'object-fit' && ['cover', 'contain'].includes(val)) safe.push(`object-fit:${val}`);
    if (prop === 'object-position' && /^(left|center|right)\s+(top|center|bottom)$/.test(val)) safe.push(`object-position:${val}`);
  });
  return safe.join(';');
}

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
          if (name === 'style') {
            const safeStyle = sanitizeStyle(value);
            if (!safeStyle) return '';
            attrs.push(`style="${safeStyle.replace(/"/g, '&quot;')}"`);
            return '';
          }
          if (name === 'class' && !/^article-image(\s+is-resizable)?$/.test(value)) return '';
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
