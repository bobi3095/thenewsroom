const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../public/uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const slugify = str => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Login
router.get('/login', (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    try { jwt.verify(token, JWT_SECRET); return res.redirect('/admin'); } catch {}
  }
  res.render('admin/login', { error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.getUser(username);
  if (!user) return res.render('admin/login', { error: 'Invalid username or password' });
  const hashToCheck = process.env.ADMIN_PASSWORD_HASH || user.password;
  if (!bcrypt.compareSync(password, hashToCheck)) {
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
router.get('/', authMiddleware, async (req, res) => {
  const articles = await db.getArticles({});
  const published = articles.filter(a => a.status === 'published').length;
  const drafts = articles.filter(a => a.status === 'draft').length;
  const totalViews = articles.reduce((s, a) => s + (a.views || 0), 0);
  res.render('admin/dashboard', {
    user: req.user,
    articles: articles.slice(0, 20),
    stats: { total: articles.length, published, drafts, totalViews },
    categories: db.categories
  });
});

// New article
router.get('/articles/new', authMiddleware, (req, res) => {
  res.render('admin/editor', { article: null, categories: db.categories, user: req.user });
});

// Edit article
router.get('/articles/edit/:id', authMiddleware, async (req, res) => {
  const article = await db.getArticle({ id: parseInt(req.params.id) });
  if (!article) return res.redirect('/admin');
  res.render('admin/editor', { article, categories: db.categories, user: req.user });
});

// Save article
router.post('/articles/save', authMiddleware, upload.single('image'), async (req, res) => {
  const { id, title, content, excerpt, category, status, featured } = req.body;
  const imageVal = req.file ? `/uploads/${req.file.filename}` : (req.body.existingImage || '');

  if (id) {
    const existing = await db.getArticle({ id: parseInt(id) });
    await db.updateArticle(parseInt(id), {
      title, content, excerpt, category,
      status: status || 'draft',
      featured: featured === 'on',
      slug: slugify(title),
      image: req.file ? `/uploads/${req.file.filename}` : existing?.image || ''
    });
  } else {
    await db.createArticle({
      title, content, excerpt, category,
      status: status || 'draft',
      featured: featured === 'on',
      slug: slugify(title),
      author: req.user.name,
      authorId: req.user.id,
      image: imageVal
    });
  }
  res.redirect('/admin');
});

// Delete article
router.post('/articles/delete/:id', authMiddleware, async (req, res) => {
  await db.deleteArticle(parseInt(req.params.id));
  res.redirect('/admin');
});

// Image upload
router.post('/upload-image', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

module.exports = router;
