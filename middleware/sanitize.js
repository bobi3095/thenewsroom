const allowedTags = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'h2', 'h3', 'blockquote', 'ul', 'ol', 'li',
  'a', 'img', 'figure', 'figcaption',
  'div', 'iframe', 'video', 'source'
]);

const voidTags = new Set(['br', 'img', 'source']);
const allowedAttrs = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'style']),
  figure: new Set(['class', 'style']),
  figcaption: new Set(['style']),
  div: new Set(['class', 'style', 'data-url']),
  blockquote: new Set(['class', 'style', 'data-lang', 'data-instgrm-permalink', 'data-instgrm-version']),
  iframe: new Set(['src', 'title', 'allow', 'allowfullscreen', 'loading', 'referrerpolicy', 'style', 'frameborder']),
  video: new Set(['controls', 'style', 'poster']),
  source: new Set(['src', 'type'])
};

const allowedClasses = {
  figure: /^article-image(\s+is-resizable)?$/,
  div: /^(article-embed|article-embed-frame|article-embed-fallback|embed-twitter|embed-instagram)(\s+(is-youtube|is-instagram|is-twitter))?$/,
  blockquote: /^(twitter-tweet|instagram-media)$/
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
    if (prop === 'min-width' && /^([0-9]{2,4})px$/.test(val)) safe.push(`min-width:${val}`);
    if (prop === 'height' && (val === 'auto' || /^([1-9][0-9]{1,2})px$/.test(val))) safe.push(`height:${val}`);
    if (prop === 'display' && ['block', 'inline-block'].includes(val)) safe.push(`display:${val}`);
    if (prop === 'position' && ['relative', 'absolute'].includes(val)) safe.push(`position:${val}`);
    if (prop === 'overflow' && val === 'hidden') safe.push('overflow:hidden');
    if (prop === 'padding-bottom' && /^([1-9][0-9]?|100)(\.[0-9]+)?%$/.test(val)) safe.push(`padding-bottom:${val}`);
    if (['top', 'left'].includes(prop) && val === '0') safe.push(`${prop}:0`);
    if (prop === 'border' && (val === '0' || /^1px solid #[0-9a-f]{3,6}$/i.test(val))) safe.push(`border:${val}`);
    if (prop === 'border-radius' && /^([0-9]{1,2})px$/.test(val)) safe.push(`border-radius:${val}`);
    if (prop === 'background' && /^#[0-9a-f]{3,6}$/i.test(val)) safe.push(`background:${val}`);
    if (prop === 'padding' && /^([0-9]{1,3})px$/.test(val)) safe.push(`padding:${val}`);
    if (
      prop === 'margin'
      && (
        /^([0-9.]+em|[0-9]+px)\s+(auto|0)$/.test(val)
        || /^([0-9.]+em|[0-9]+px)\s+(auto|0)\s+([0-9.]+em|[0-9]+px)\s+(auto|0)$/.test(val)
        || /^([0-9.]+em|[0-9]+px)\s+0$/.test(val)
        || /^1px$/.test(val)
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

function isSafeEmbedUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (parsed.protocol !== 'https:') return false;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      return /^\/embed\/[a-zA-Z0-9_-]{11}$/.test(parsed.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

function isSafeSocialUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (host === 'instagram.com') return /^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname);
    if (host === 'twitter.com' || host === 'x.com') return /^\/[A-Za-z0-9_]+\/status\/[0-9]+\/?$/.test(parsed.pathname);
    return false;
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
          if (tag === 'iframe' && name === 'src' && !isSafeEmbedUrl(value)) return '';
          if (['data-url', 'data-instgrm-permalink'].includes(name) && !isSafeSocialUrl(value)) return '';
          if (name === 'style') {
            const safeStyle = sanitizeStyle(value);
            if (!safeStyle) return '';
            attrs.push(`style="${safeStyle.replace(/"/g, '&quot;')}"`);
            return '';
          }
          if (name === 'class' && (!allowedClasses[tag] || !allowedClasses[tag].test(value))) return '';
          if (name === 'allowfullscreen') {
            attrs.push('allowfullscreen');
            return '';
          }
          if (['controls'].includes(name)) {
            attrs.push(name);
            return '';
          }
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
