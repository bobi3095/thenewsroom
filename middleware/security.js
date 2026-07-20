const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';
const CSRF_COOKIE = 'csrfToken';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
  path: '/'
};

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://platform.twitter.com https://cdn.syndication.twimg.com https://www.instagram.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "media-src 'self' data: https:",
      "connect-src 'self'",
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://platform.twitter.com https://www.instagram.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  );
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

function csrfToken(req, res, next) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, { ...cookieOptions, httpOnly: false });
  }
  res.locals.csrfToken = token;
  next();
}

function csrfProtection(req, res, next) {
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const submittedToken = req.body?._csrf || req.get('x-csrf-token');
  if (!cookieToken || !submittedToken || cookieToken !== submittedToken) {
    const wantsJson = req.xhr || req.get('accept')?.includes('application/json');
    if (wantsJson) {
      return res.status(403).json({
        error: 'Invalid CSRF token. Refresh the page and try again.'
      });
    }
    return res.status(403).send('Invalid CSRF token');
  }
  next();
}

function sameOriginPost(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const source = req.get('origin') || req.get('referer');
  if (!source) return next();
  try {
    const sourceUrl = new URL(source);
    const host = req.get('host');
    if (sourceUrl.host !== host) return res.status(403).send('Cross-origin request blocked');
  } catch {
    return res.status(403).send('Invalid request origin');
  }
  next();
}

function createLoginRateLimiter({ windowMs = 15 * 60 * 1000, max = 10, view = 'admin/login', viewData = {} } = {}) {
  const attempts = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = attempts.get(key) || { count: 0, resetAt: now + windowMs };
    if (entry.resetAt <= now) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count += 1;
    attempts.set(key, entry);
    if (entry.count > max) {
      return res.status(429).render(view, {
        ...viewData,
        error: 'Too many login attempts. Try again in a few minutes.'
      });
    }
    next();
  };
}

module.exports = {
  cookieOptions,
  securityHeaders,
  csrfToken,
  csrfProtection,
  sameOriginPost,
  createLoginRateLimiter
};
