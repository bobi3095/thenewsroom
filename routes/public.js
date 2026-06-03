const express = require('express');
const router = express.Router();
const db = require('../db');
const { cacheMiddleware, KEYS } = require('../middleware/cache');
const { sanitizeArticleHtml } = require('../middleware/sanitize');

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

// Helper: articles from last 24 hours
function getLatest6hrs(articles) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return articles.filter(a => new Date(a.createdAt) >= oneDayAgo);
}

// Homepage
router.get('/', cacheMiddleware(KEYS.home, 120), async (req, res) => {
  try {
    const articles = await db.getArticles({ status: 'published' });

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
      byCategory, bottomArticles, articles,
      categories: ALL_CATEGORIES,
      navCategories: NAV_CATEGORIES,
      moreCategories: MORE_CATEGORIES,
      page: 'home'
    });
  } catch(e) { console.error(e); res.status(500).send('Server error: ' + e.message); }
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
    article.content = sanitizeArticleHtml(article.content);
    await db.incrementViews(article.id);
    // Get related from all categories this article belongs to
    const articleCats = Array.isArray(article.categories) && article.categories.length > 0
      ? article.categories : [article.category];
    const allPublished = await db.getArticles({ status: 'published' });
    const related = allPublished
      .filter(a => a.id !== article.id && articleCats.some(cat =>
        a.category === cat || (Array.isArray(a.categories) && a.categories.includes(cat))
      )).slice(0, 3);
    res.render('article', {
      article, related,
      categories: ALL_CATEGORIES,
      navCategories: NAV_CATEGORIES,
      moreCategories: MORE_CATEGORIES,
      page: 'article'
    });
  } catch(e) { console.error(e); res.status(500).send('Server error'); }
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
