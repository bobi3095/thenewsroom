const express = require('express');
const router = express.Router();
const db = require('../db');

const slugify = str => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Homepage
router.get('/', async (req, res) => {
  try {
    const articles = await db.getArticles({ status: 'published' });
    const featured = articles.find(a => a.featured) || articles[0];
    const latest = articles.filter(a => a.id !== featured?.id).slice(0, 8);
    const byCategory = {};
    db.categories.forEach(cat => {
      byCategory[cat] = articles.filter(a => a.category === cat).slice(0, 3);
    });
    res.render('home', { featured, latest, articles, byCategory, categories: db.categories, page: 'home' });
  } catch(e) { console.error(e); res.status(500).send('Server error'); }
});

// Category
router.get('/category/:slug', async (req, res) => {
  try {
    const catMap = { politics:'Politics', technology:'Technology', sports:'Sports', 'world-news':'World News', uncovered:'Uncovered' };
    const category = catMap[req.params.slug] || req.params.slug;
    const articles = await db.getArticles({ status: 'published', category });
    res.render('category', { category, articles, categories: db.categories, page: 'category' });
  } catch(e) { console.error(e); res.status(500).send('Server error'); }
});

// Article
router.get('/article/:slug', async (req, res) => {
  try {
    const article = await db.getArticle({ slug: req.params.slug, status: 'published' });
    if (!article) return res.status(404).render('404', { categories: db.categories, page: '404' });
    await db.incrementViews(article.id);
    const allPublished = await db.getArticles({ status: 'published', category: article.category });
    const related = allPublished.filter(a => a.id !== article.id).slice(0, 3);
    res.render('article', { article, related, categories: db.categories, page: 'article' });
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
    res.render('search', { results, q, categories: db.categories, page: 'search' });
  } catch(e) { console.error(e); res.status(500).send('Server error'); }
});

module.exports = router;
