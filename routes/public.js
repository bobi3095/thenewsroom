const express = require('express');
const router = express.Router();
const db = require('../db');

// Homepage
router.get('/', (req, res) => {
  db.read();
  const articles = db.data.articles.filter(a => a.status === 'published')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const featured = articles.find(a => a.featured) || articles[0];
  const latest = articles.filter(a => a.id !== (featured?.id)).slice(0, 8);
  const byCategory = {};
  db.data.categories.forEach(cat => {
    byCategory[cat] = articles.filter(a => a.category === cat).slice(0, 3);
  });
  res.render('home', { featured, latest, articles, byCategory, categories: db.data.categories, page: 'home' });
});

// Category page
router.get('/category/:slug', (req, res) => {
  db.read();
  const catMap = { politics: 'Politics', technology: 'Technology', sports: 'Sports', 'world-news': 'World News', uncovered: 'Uncovered' };
  const category = catMap[req.params.slug] || req.params.slug;
  const articles = db.data.articles.filter(a => a.status === 'published' && a.category === category)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.render('category', { category, articles, categories: db.data.categories, page: 'category' });
});

// Article page
router.get('/article/:slug', (req, res) => {
  db.read();
  const article = db.data.articles.find(a => a.slug === req.params.slug && a.status === 'published');
  if (!article) return res.status(404).render('404', { categories: db.data.categories });
  // Increment views
  article.views = (article.views || 0) + 1;
  db.write();
  const related = db.data.articles.filter(a => a.status === 'published' && a.category === article.category && a.id !== article.id).slice(0, 3);
  res.render('article', { article, related, categories: db.data.categories, page: 'article' });
});

// Search
router.get('/search', (req, res) => {
  db.read();
  const q = (req.query.q || '').toLowerCase();
  const results = q ? db.data.articles.filter(a =>
    a.status === 'published' && (
      a.title.toLowerCase().includes(q) ||
      a.excerpt?.toLowerCase().includes(q) ||
      a.content?.toLowerCase().includes(q) ||
      a.category?.toLowerCase().includes(q)
    )
  ) : [];
  res.render('search', { results, q, categories: db.data.categories, page: 'search' });
});

module.exports = router;
