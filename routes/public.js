const express = require('express');
const router = express.Router();
const db = require('../db');
const { cacheMiddleware, clearArticleCache, KEYS } = require('../middleware/cache');
const { sanitizeArticleHtml } = require('../middleware/sanitize');
const { csrfProtection } = require('../middleware/security');
const { requirePublicUser } = require('../middleware/publicAuth');

// All categories including new ones
const ALL_CATEGORIES = ['Politics', 'Technology', 'Sports', 'World News', 'Uncovered', 'Opinion', 'India', 'Data', 'Law', 'Govt Schemes', 'Education'];
const NAV_CATEGORIES = ['Politics', 'World News', 'India', 'Uncovered', 'Opinion'];
const MORE_CATEGORIES = ['Data', 'Sports', 'Law', 'Govt Schemes', 'Education', 'Technology'];

// Category slug map
const catMap = {
  'politics': 'Politics',
  'technology': 'Technology',
  'sports': 'Sports',
  'world-news': 'World News',
  'uncovered': 'Uncovered',
  'opinion': 'Opinion',
  'india': 'India',
  'data': 'Data',
  'law': 'Law',
  'govt-schemes': 'Govt Schemes',
  'education': 'Education',
  'latest': 'latest'
};

const DEFAULT_FEED_WINDOW_DAYS = 30;

// Helper: articles from last 24 hours
function getLatest6hrs(articles) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return articles.filter(a => new Date(a.createdAt) >= oneDayAgo);
}

function getArticleAgeHours(article) {
  const createdAt = new Date(article.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return Number.POSITIVE_INFINITY;
  return Math.max(0.25, (Date.now() - createdAt) / (60 * 60 * 1000));
}

function isInsideDefaultFeedWindow(article) {
  return getArticleAgeHours(article) <= DEFAULT_FEED_WINDOW_DAYS * 24;
}

function scoreArticleForDiscovery(article, followedAuthorIds = new Set()) {
  const ageHours = getArticleAgeHours(article);
  const ageDays = ageHours / 24;
  let freshnessScore = 0;

  if (ageHours <= 6) freshnessScore = 420 - ageHours * 8;
  else if (ageHours <= 24) freshnessScore = 360 - ageHours * 5;
  else if (ageDays <= 3) freshnessScore = 260 - ageDays * 30;
  else if (ageDays <= 7) freshnessScore = 190 - ageDays * 16;
  else if (ageDays <= 14) freshnessScore = 100 - ageDays * 5;
  else if (ageDays <= DEFAULT_FEED_WINDOW_DAYS) freshnessScore = 45 - ageDays;

  const engagementScore = Math.min(55, Math.log1p(article.views || 0) * 7);
  const followingBoost = followedAuthorIds.has(Number(article.authorId)) ? 45 : 0;
  const verifiedBoost = article.authorVerified !== false ? 10 : 0;
  const featuredBoost = article.featured && ageDays <= 7 ? 16 : 0;
  return freshnessScore + engagementScore + followingBoost + verifiedBoost + featuredBoost;
}

function buildFairFeed(articles, followedAuthorIds = new Set()) {
  const eligibleArticles = articles.filter(isInsideDefaultFeedWindow);
  const archiveArticles = articles.filter(article => !isInsideDefaultFeedWindow(article));
  const sourceArticles = eligibleArticles.length ? eligibleArticles : articles;
  const ranked = [...sourceArticles].sort((a, b) => {
    const scoreDiff = scoreArticleForDiscovery(b, followedAuthorIds) - scoreArticleForDiscovery(a, followedAuthorIds);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const feed = [];
  const remaining = [...ranked];
  const firstPageAuthorCount = new Map();
  const recentWindow = 6;
  const firstPageLimit = 24;

  while (remaining.length) {
    const recentAuthors = new Set(feed.slice(-recentWindow).map(a => Number(a.authorId)).filter(Boolean));
    let pickIndex = remaining.findIndex(article => {
      const authorId = Number(article.authorId);
      const usedInFirstPage = firstPageAuthorCount.get(authorId) || 0;
      if (feed.length < firstPageLimit && usedInFirstPage >= 2) return false;
      return !recentAuthors.has(authorId);
    });

    if (pickIndex === -1) pickIndex = 0;
    const [picked] = remaining.splice(pickIndex, 1);
    feed.push(picked);

    if (feed.length <= firstPageLimit) {
      const authorId = Number(picked.authorId);
      firstPageAuthorCount.set(authorId, (firstPageAuthorCount.get(authorId) || 0) + 1);
    }
  }

  if (eligibleArticles.length && archiveArticles.length) {
    const archiveFeed = archiveArticles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return feed.concat(archiveFeed);
  }

  return feed;
}

// Homepage
router.get('/', cacheMiddleware(req => KEYS.home(req.query.sort === 'newest' ? 'newest' : 'default'), 120), async (req, res) => {
  try {
    const articles = await db.getArticles({ status: 'published' });
    const followedAuthors = req.publicUser ? await db.getFollowedAuthors(req.publicUser.id) : [];
    const followedAuthorIds = new Set(followedAuthors.map(author => Number(author.id)));
    const homeSort = req.query.sort === 'newest' ? 'newest' : 'default';
    const newestArticles = [...articles].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const feedArticles = homeSort === 'newest' ? newestArticles : buildFairFeed(articles, followedAuthorIds);
    const trendingArticles = await db.getTrendingArticles(articles, 24);

    // Hero: admin-marked featured articles only
    const heroArticles = articles.filter(a => a.featured);
    const hero = heroArticles[0] || null;
    const heroSidebar = heroArticles.slice(1, 5);

    // Latest news (last 6 hours)
    const latestNews = getLatest6hrs(articles).slice(0, 10);

    // Today's news (last 24 hours)
    const last24hrs = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todaysNews = articles.filter(a => new Date(a.createdAt) >= last24hrs).slice(0, 8);

    // By category sections - check both primary category AND categories array
    const byCategory = {};
    ALL_CATEGORIES.forEach(cat => {
      byCategory[cat] = articles.filter(a =>
        a.category === cat ||
        (Array.isArray(a.categories) && a.categories.includes(cat))
      ).slice(0, 4);
    });

    // Bottom articles (all recent non-featured)
    const bottomArticles = articles.filter(a => !a.featured).slice(0, 12);

    res.render('home', {
      hero, heroSidebar, latestNews, todaysNews,
      byCategory, bottomArticles, articles: feedArticles, trendingArticles,
      followedAuthors,
      homeSort,
      categories: ALL_CATEGORIES,
      navCategories: NAV_CATEGORIES,
      moreCategories: MORE_CATEGORIES,
      page: 'home'
    });
  } catch(e) { console.error(e); res.status(500).send('Server error: ' + e.message); }
});

router.get('/following', requirePublicUser, async (req, res) => {
  try {
    const followedAuthors = await db.getFollowedAuthors(req.publicUser.id);
    const followedAuthorIds = new Set(followedAuthors.map(author => Number(author.id)));
    const allArticles = await db.getArticles({ status: 'published' });
    const articles = allArticles
      .filter(article => followedAuthorIds.has(Number(article.authorId)))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const suggestedArticles = buildFairFeed(allArticles).slice(0, 12);
    res.render('following', {
      articles,
      followedAuthors,
      suggestedArticles,
      categories: ALL_CATEGORIES,
      navCategories: NAV_CATEGORIES,
      moreCategories: MORE_CATEGORIES,
      page: 'following'
    });
  } catch(e) {
    console.error('Following feed error:', e);
    res.status(500).send('Server error');
  }
});

router.post('/track/article/:id', async (req, res) => {
  try {
    await db.recordArticleMetric(req.params.id, req.body?.type);
    res.sendStatus(204);
  } catch(e) {
    console.error('Track article metric error:', e);
    res.sendStatus(204);
  }
});

router.get('/journalist/:id', async (req, res) => {
  try {
    const profile = await db.getAuthorProfile(req.params.id, req.publicUser?.id || null);
    if (!profile) {
      return res.status(404).render('404', {
        categories: ALL_CATEGORIES,
        navCategories: NAV_CATEGORIES,
        moreCategories: MORE_CATEGORIES,
        page: '404'
      });
    }
    res.render('journalist-profile', {
      profile,
      categories: ALL_CATEGORIES,
      navCategories: NAV_CATEGORIES,
      moreCategories: MORE_CATEGORIES,
      page: 'journalist'
    });
  } catch(e) {
    console.error('Journalist profile error:', e);
    res.status(500).send('Server error');
  }
});

router.post('/journalist/:id/follow', requirePublicUser, csrfProtection, async (req, res) => {
  await db.followAuthor(req.publicUser.id, req.params.id);
  res.redirect('/journalist/' + req.params.id);
});

router.post('/journalist/:id/unfollow', requirePublicUser, csrfProtection, async (req, res) => {
  await db.unfollowAuthor(req.publicUser.id, req.params.id);
  res.redirect('/journalist/' + req.params.id);
});

// Latest news page (last 6 hours)
router.get('/latest', async (req, res) => {
  try {
    const articles = await db.getArticles({ status: 'published' });
    const latestNews = getLatest6hrs(articles);
    res.render('category', {
      category: 'Latest News',
      subtitle: 'Stories from the last 24 hours',
      articles: latestNews,
      categories: ALL_CATEGORIES,
      navCategories: NAV_CATEGORIES,
      moreCategories: MORE_CATEGORIES,
      page: 'category'
    });
  } catch(e) { console.error(e); res.status(500).send('Server error'); }
});

// Category page
router.get('/category/:slug', cacheMiddleware(req => KEYS.category(req.params.slug), 180), async (req, res) => {
  try {
    const category = catMap[req.params.slug] || req.params.slug;
    const articles = await db.getArticles({ status: 'published', category });
    res.render('category', {
      category, subtitle: null, articles,
      categories: ALL_CATEGORIES,
      navCategories: NAV_CATEGORIES,
      moreCategories: MORE_CATEGORIES,
      page: 'category'
    });
  } catch(e) { console.error(e); res.status(500).send('Server error'); }
});

// Article page
router.get('/article/:slug', cacheMiddleware(req => KEYS.article(req.params.slug), 600), async (req, res) => {
  try {
    const article = await db.getArticle({ slug: req.params.slug, status: 'published' });
    if (!article) return res.status(404).render('404', { categories: ALL_CATEGORIES, navCategories: NAV_CATEGORIES, moreCategories: MORE_CATEGORIES, page: '404' });
    const commentSort = ['top', 'newest', 'oldest'].includes(req.query.comments) ? req.query.comments : 'top';
    article.content = sanitizeArticleHtml(article.content);
    article.authorFollowerCount = await db.getAuthorFollowerCount(article.authorId);
    article.isFollowingAuthor = req.publicUser ? await db.isFollowingAuthor(req.publicUser.id, article.authorId) : false;
    article.likeSummary = await db.getArticleLikeSummary(article.id, req.publicUser?.id || null);
    article.commentSummary = await db.getArticleCommentSummary(article.id);
    const comments = await db.getArticleComments(article.id, commentSort, req.publicUser?.id || null);
    // Get related from all categories this article belongs to
    const articleCats = Array.isArray(article.categories) && article.categories.length > 0
      ? article.categories : [article.category];
    const allPublished = await db.getArticles({ status: 'published' });
    const related = allPublished
      .filter(a => a.id !== article.id && articleCats.some(cat =>
        a.category === cat || (Array.isArray(a.categories) && a.categories.includes(cat))
      )).slice(0, 3);
    res.render('article', {
      article, related, comments, commentSort,
      categories: ALL_CATEGORIES,
      navCategories: NAV_CATEGORIES,
      moreCategories: MORE_CATEGORIES,
      page: 'article'
    });
  } catch(e) { console.error(e); res.status(500).send('Server error'); }
});

router.post('/article/:slug/like', requirePublicUser, csrfProtection, async (req, res) => {
  try {
    const article = await db.getArticle({ slug: req.params.slug, status: 'published' });
    if (article) {
      await db.toggleArticleLike(article.id, req.publicUser.id);
      clearArticleCache(article.slug);
    }
    res.redirect('/article/' + req.params.slug + '#discussion');
  } catch(e) {
    console.error('Article like error:', e);
    res.redirect('/article/' + req.params.slug);
  }
});

router.post('/article/:slug/comments', requirePublicUser, csrfProtection, async (req, res) => {
  try {
    const article = await db.getArticle({ slug: req.params.slug, status: 'published' });
    if (!article) return res.redirect('/');
    const body = String(req.body.body || '').trim();
    if (body.length >= 1 && body.length <= 1000) {
      await db.createArticleComment(article.id, req.publicUser.id, body);
      clearArticleCache(article.slug);
    }
    res.redirect('/article/' + article.slug + '?comments=newest#discussion');
  } catch(e) {
    console.error('Create comment error:', e);
    res.redirect('/article/' + req.params.slug + '#discussion');
  }
});

router.post('/article/:slug/comments/:commentId/delete', requirePublicUser, csrfProtection, async (req, res) => {
  try {
    const articleId = await db.deleteOwnArticleComment(req.params.commentId, req.publicUser.id);
    const article = articleId ? await db.getArticle({ id: articleId }) : await db.getArticle({ slug: req.params.slug });
    if (article) clearArticleCache(article.slug);
    res.redirect('/article/' + req.params.slug + '#discussion');
  } catch(e) {
    console.error('Delete comment error:', e);
    res.redirect('/article/' + req.params.slug + '#discussion');
  }
});

router.post('/article/:slug/comments/:commentId/like', requirePublicUser, csrfProtection, async (req, res) => {
  try {
    const articleId = await db.toggleArticleCommentLike(req.params.commentId, req.publicUser.id);
    const article = articleId ? await db.getArticle({ id: articleId }) : await db.getArticle({ slug: req.params.slug });
    if (article) clearArticleCache(article.slug);
    const sort = ['top', 'newest', 'oldest'].includes(req.body.comments) ? req.body.comments : 'top';
    res.redirect('/article/' + req.params.slug + '?comments=' + sort + '#discussion');
  } catch(e) {
    console.error('Comment like error:', e);
    res.redirect('/article/' + req.params.slug + '#discussion');
  }
});

// Search
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase();
    const all = await db.getArticles({ status: 'published' });
    const results = q ? all.filter(a =>
      a.title?.toLowerCase().includes(q) ||
      a.excerpt?.toLowerCase().includes(q) ||
      a.content?.toLowerCase().includes(q) ||
      a.category?.toLowerCase().includes(q) ||
      (Array.isArray(a.categories) && a.categories.some(c => c.toLowerCase().includes(q)))
    ) : [];
    res.render('search', {
      results, q,
      categories: ALL_CATEGORIES,
      navCategories: NAV_CATEGORIES,
      moreCategories: MORE_CATEGORIES,
      page: 'search'
    });
  } catch(e) { console.error(e); res.status(500).send('Server error'); }
});

// ── MORE PAGE ────────────────────────────────────────────────────
router.get('/more', cacheMiddleware(KEYS.more, 180), async (req, res) => {
  try {
    const articles = await db.getArticles({ status: 'published' });
    res.render('more', {
      articles, categories: ALL_CATEGORIES,
      navCategories: NAV_CATEGORIES,
      moreCategories: MORE_CATEGORIES,
      page: 'more'
    });
  } catch(e) { console.error(e); res.status(500).send('Server error'); }
});

// ── STATIC PAGES ─────────────────────────────────────────────────
router.get('/editorial-policy', (req, res) => {
  res.render('editorial-policy', {
    categories: ALL_CATEGORIES, navCategories: NAV_CATEGORIES,
    moreCategories: MORE_CATEGORIES, page: 'editorial-policy'
  });
});

router.get('/contact', (req, res) => {
  res.render('contact', {
    categories: ALL_CATEGORIES, navCategories: NAV_CATEGORIES,
    moreCategories: MORE_CATEGORIES, page: 'contact'
  });
});

// ── SITEMAP ───────────────────────────────────────────────────────
router.get('/sitemap.xml', async (req, res) => {
  try {
    const articles = await db.getArticles({ status: 'published' });
    const baseUrl = process.env.SITE_URL || 'https://thenewsroom-vo82.onrender.com';
    const cats = ['politics','technology','sports','world-news','uncovered','opinion','india','data','law','govt-schemes','education'];

    let xml = '<?xml version="1.0" encoding="UTF-8"?>';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">';

    // Homepage
    xml += '<url><loc>' + baseUrl + '/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>';
    xml += '<url><loc>' + baseUrl + '/latest</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>';

    // Categories
    cats.forEach(cat => {
      xml += '<url><loc>' + baseUrl + '/category/' + cat + '</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>';
    });

    // Articles
    articles.forEach(a => {
      const title = (a.title || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const date = new Date(a.createdAt).toISOString();
      const lastmod = new Date(a.updatedAt || a.createdAt).toISOString().split('T')[0];
      xml += '<url>';
      xml += '<loc>' + baseUrl + '/article/' + a.slug + '</loc>';
      xml += '<lastmod>' + lastmod + '</lastmod>';
      xml += '<changefreq>weekly</changefreq>';
      xml += '<priority>0.9</priority>';
      xml += '<news:news>';
      xml += '<news:publication><news:name>The News Room</news:name><news:language>en</news:language></news:publication>';
      xml += '<news:publication_date>' + date + '</news:publication_date>';
      xml += '<news:title>' + title + '</news:title>';
      xml += '</news:news>';
      xml += '</url>';
    });

    xml += '</urlset>';
    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch(e) {
    console.error('Sitemap error:', e);
    res.status(500).send('Error generating sitemap');
  }
});

// ── ROBOTS.TXT ────────────────────────────────────────────────────
router.get('/robots.txt', (req, res) => {
  const baseUrl = process.env.SITE_URL || 'https://thenewsroom-vo82.onrender.com';
  res.header('Content-Type', 'text/plain');
  res.send('User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ' + baseUrl + '/sitemap.xml');
});

module.exports = router;
