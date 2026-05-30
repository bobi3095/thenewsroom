const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authMiddleware, apiAuth, JWT_SECRET } = require('../middleware/auth');

// Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../public/uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Login page
router.get('/login', (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    try { jwt.verify(token, JWT_SECRET); return res.redirect('/admin'); } catch {}
  }
  res.render('admin/login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.read();
  const user = db.data.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('admin/login', { error: 'Invalid username or password' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.redirect('/admin');
});

router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/admin/login');
});

// Dashboard
router.get('/', authMiddleware, (req, res) => {
  db.read();
  const articles = db.data.articles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const published = articles.filter(a => a.status === 'published').length;
  const drafts = articles.filter(a => a.status === 'draft').length;
  const totalViews = articles.reduce((s, a) => s + (a.views || 0), 0);
  res.render('admin/dashboard', {
    user: req.user, articles: articles.slice(0, 10),
    stats: { total: articles.length, published, drafts, totalViews },
    categories: db.data.categories
  });
});

// New article
router.get('/articles/new', authMiddleware, (req, res) => {
  res.render('admin/editor', { article: null, categories: db.data.categories, user: req.user });
});

// Edit article
router.get('/articles/edit/:id', authMiddleware, (req, res) => {
  db.read();
  const article = db.data.articles.find(a => a.id === parseInt(req.params.id));
  if (!article) return res.redirect('/admin');
  res.render('admin/editor', { article, categories: db.data.categories, user: req.user });
});

// Save article (create/update)
router.post('/articles/save', authMiddleware, upload.single('image'), (req, res) => {
  db.read();
  const { id, title, content, excerpt, category, status, featured } = req.body;
  const slugify = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  if (id) {
    // Update
    const idx = db.data.articles.findIndex(a => a.id === parseInt(id));
    if (idx !== -1) {
      db.data.articles[idx] = {
        ...db.data.articles[idx],
        title, content, excerpt, category,
        status: status || 'draft',
        featured: featured === 'on',
        slug: slugify(title),
        image: req.file ? `/uploads/${req.file.filename}` : db.data.articles[idx].image,
        updatedAt: new Date().toISOString()
      };
    }
  } else {
    // Create
    const newId = Math.max(0, ...db.data.articles.map(a => a.id)) + 1;
    db.data.articles.push({
      id: newId, title, content, excerpt, category,
      status: status || 'draft',
      featured: featured === 'on',
      slug: slugify(title),
      author: 'Admin',
      authorId: 1,
      image: req.file ? `/uploads/${req.file.filename}` : '',
      views: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  db.write();
  res.redirect('/admin');
});

// Delete article
router.post('/articles/delete/:id', authMiddleware, (req, res) => {
  db.read();
  db.data.articles = db.data.articles.filter(a => a.id !== parseInt(req.params.id));
  db.write();
  res.redirect('/admin');
});

// Upload image via editor
router.post('/upload-image', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

module.exports = router;
