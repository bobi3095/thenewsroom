const express = require('express');
const router = express.Router();
const db = require('../db');

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
router.get('/', async (req, res) => {
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

    // By category sections
    const byCategory = {};
    ALL_CATEGORIES.forEach(cat => {
      byCategory[cat] = articles.filter(a => a.category === cat).slice(0, 4);
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
router.get('/category/:slug', async (req, res) => {
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
router.get('/article/:slug', async (req, res) => {
  try {
    const article = await db.getArticle({ slug: req.params.slug, status: 'published' });
    if (!article) return res.status(404).render('404', { categories: ALL_CATEGORIES, navCategories: NAV_CATEGORIES, moreCategories: MORE_CATEGORIES, page: '404' });
    await db.incrementViews(article.id);
    const allPublished = await db.getArticles({ status: 'published', category: article.category });
    const related = allPublished.filter(a => a.id !== article.id).slice(0, 3);
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
      a.category?.toLowerCase().includes(q)
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

module.exports = router;
