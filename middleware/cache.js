const NodeCache = require('node-cache');

// Cache settings:
// - Homepage: 2 minutes (news changes frequently)
// - Category pages: 3 minutes
// - Article pages: 10 minutes (articles don't change often)
// - Search: no cache (dynamic)

const cache = new NodeCache({ stdTTL: 120, checkperiod: 60 });

// Cache keys
const KEYS = {
  home: 'page:home',
  category: (slug) => `page:category:${slug}`,
  article: (slug) => `page:article:${slug}`,
  latest: 'page:latest',
  more: 'page:more'
};

// Middleware factory - caches rendered HTML
function cacheMiddleware(keyFn, ttl = 120) {
  return (req, res, next) => {
    // Never cache for admin users (they need fresh data)
    if (req.cookies?.token) return next();

    const key = typeof keyFn === 'function' ? keyFn(req) : keyFn;
    const cached = cache.get(key);

    if (cached) {
      console.log('⚡ Cache hit:', key);
      return res.send(cached);
    }

    // Override res.send to cache the response
    const originalSend = res.send.bind(res);
    res.send = (body) => {
      // Only cache successful HTML responses
      if (res.statusCode === 200 && typeof body === 'string') {
        cache.set(key, body, ttl);
        console.log('💾 Cached:', key, `(${ttl}s)`);
      }
      return originalSend(body);
    };

    next();
  };
}

// Clear cache when new article is published/updated/deleted
function clearCache() {
  cache.flushAll();
  console.log('🗑️  Cache cleared');
}

// Clear only article-related cache
function clearArticleCache(slug) {
  cache.del(KEYS.article(slug));
  cache.del(KEYS.home);
  cache.del(KEYS.latest);
  cache.del(KEYS.more);
  console.log('🗑️  Cache cleared for:', slug);
}

// Cache stats for monitoring
function getCacheStats() {
  const stats = cache.getStats();
  return {
    keys: cache.keys().length,
    hits: stats.hits,
    misses: stats.misses,
    hitRate: stats.hits + stats.misses > 0
      ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) + '%'
      : '0%'
  };
}

module.exports = { cacheMiddleware, clearCache, clearArticleCache, getCacheStats, KEYS };
