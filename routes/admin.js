const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');


const db = require('../db');
const { authMiddleware, adminOnly, JWT_SECRET } = require('../middleware/auth');

const { upload, getFileUrl } = require('../middleware/upload');
const slugify = str => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// ── AUTH ──────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  const token = req.cookies?.token;
  if (token) { try { jwt.verify(token, JWT_SECRET); return res.redirect('/admin'); } catch {} }
  res.render('admin/login', { error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.getUser(username);
  if (!user) return res.render('admin/login', { error: 'Invalid username or password' });
  const hashToCheck = (user.role === 'admin' && process.env.ADMIN_PASSWORD_HASH) ? process.env.ADMIN_PASSWORD_HASH : user.password;
  if (!bcrypt.compareSync(password, hashToCheck)) return res.render('admin/login', { error: 'Invalid username or password' });
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role, avatar: user.avatar }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7*24*60*60*1000 });
  res.redirect('/admin');
});

router.get('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/admin/login'); });

// ── DASHBOARD ─────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  const articles = await db.getArticles({});
  const allUsers = await db.getAllUsers();
  const published = articles.filter(a => a.status === 'published').length;
  const drafts = articles.filter(a => a.status === 'draft').length;
  const totalViews = articles.reduce((s, a) => s + (a.views||0), 0);
  // Authors only see their own articles
  const myArticles = req.user.role === 'admin' ? articles : articles.filter(a => a.authorId === req.user.id);
  res.render('admin/dashboard', {
    user: req.user,
    articles: myArticles.slice(0, 20),
    stats: { total: myArticles.length, published, drafts, totalViews, authors: allUsers.filter(u => u.role === 'author').length },
    categories: db.categories
  });
});

// ── ARTICLES ──────────────────────────────────────────────────────
router.get('/articles/new', authMiddleware, (req, res) => {
  res.render('admin/editor', { article: null, categories: db.categories, user: req.user });
});

router.get('/articles/edit/:id', authMiddleware, async (req, res) => {
  const article = await db.getArticle({ id: parseInt(req.params.id) });
  if (!article) return res.redirect('/admin');
  // Authors can only edit their own
  if (req.user.role !== 'admin' && article.authorId !== req.user.id) return res.redirect('/admin');
  res.render('admin/editor', { article, categories: db.categories, user: req.user });
});

router.post('/articles/save', authMiddleware, upload.single('image'), async (req, res) => {
  const { id, title, content, excerpt, category, status, featured } = req.body;
  if (id) {
    const existing = await db.getArticle({ id: parseInt(id) });
    if (req.user.role !== 'admin' && existing?.authorId !== req.user.id) return res.redirect('/admin');
    await db.updateArticle(parseInt(id), {
      title, content, excerpt, category,
      status: status || 'draft',
      featured: req.user.role === 'admin' ? featured === 'on' : existing.featured,
      slug: slugify(title),
      image: getFileUrl(req.file) || existing?.image || ''
    });
  } else {
    await db.createArticle({
      title, content, excerpt, category,
      status: status || 'draft',
      featured: req.user.role === 'admin' ? featured === 'on' : false,
      slug: slugify(title),
      author: req.user.name,
      authorId: req.user.id,
      image: getFileUrl(req.file) || ''
    });
  }
  res.redirect('/admin');
});

router.post('/articles/delete/:id', authMiddleware, async (req, res) => {
  const article = await db.getArticle({ id: parseInt(req.params.id) });
  if (req.user.role !== 'admin' && article?.authorId !== req.user.id) return res.redirect('/admin');
  await db.deleteArticle(parseInt(req.params.id));
  res.redirect('/admin');
});

// ── AUTHORS (Admin only) ──────────────────────────────────────────
router.get('/authors', authMiddleware, adminOnly, async (req, res) => {
  const users = await db.getAllUsers();
  const authors = users.filter(u => u.role === 'author');
  res.render('admin/authors', { authors, user: req.user, categories: db.categories });
});

router.get('/authors/new', authMiddleware, adminOnly, (req, res) => {
  res.render('admin/author-form', { author: null, user: req.user, categories: db.categories, error: null });
});

router.post('/authors/create', authMiddleware, adminOnly, upload.single('avatar'), async (req, res) => {
  const { username, name, password, bio } = req.body;
  const existing = await db.getUser(username);
  if (existing) {
    return res.render('admin/author-form', { author: null, user: req.user, categories: db.categories, error: 'Username already taken' });
  }
  const hash = bcrypt.hashSync(password, 10);
  await db.createUser({
    username, name, password: hash, role: 'author', bio: bio || '',
    avatar: getFileUrl(req.file) || ''
  });
  res.redirect('/admin/authors');
});

router.get('/authors/edit/:id', authMiddleware, adminOnly, async (req, res) => {
  const author = await db.getUserById(parseInt(req.params.id));
  if (!author) return res.redirect('/admin/authors');
  res.render('admin/author-form', { author, user: req.user, categories: db.categories, error: null });
});

router.post('/authors/update/:id', authMiddleware, adminOnly, upload.single('avatar'), async (req, res) => {
  const { name, bio, password } = req.body;
  const id = parseInt(req.params.id);
  const updates = { name, bio: bio||'' };
  if (req.file) updates.avatar = getFileUrl(req.file);
  if (password && password.trim()) updates.password = bcrypt.hashSync(password, 10);
  await db.updateUser(id, updates);
  res.redirect('/admin/authors');
});

router.post('/authors/delete/:id', authMiddleware, adminOnly, async (req, res) => {
  await db.deleteUser(parseInt(req.params.id));
  res.redirect('/admin/authors');
});

// ── PROFILE (Author edits own profile) ───────────────────────────
router.get('/profile', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  res.render('admin/profile', { profileUser: user, user: req.user, categories: db.categories, success: null, error: null });
});

router.post('/profile/update', authMiddleware, upload.single('avatar'), async (req, res) => {
  const { name, bio, password, confirmPassword } = req.body;
  const updates = { name, bio: bio||'' };
  if (req.file) updates.avatar = getFileUrl(req.file);
  if (password && password.trim()) {
    if (password !== confirmPassword) {
      const user = await db.getUserById(req.user.id);
      return res.render('admin/profile', { profileUser: user, user: req.user, categories: db.categories, error: 'Passwords do not match', success: null });
    }
    updates.password = bcrypt.hashSync(password, 10);
  }
  await db.updateUser(req.user.id, updates);
  // Refresh token with new name/avatar
  const updated = await db.getUserById(req.user.id);
  const token = jwt.sign({ id: updated.id, username: updated.username, name: updated.name, role: updated.role, avatar: updates.avatar || req.user.avatar }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7*24*60*60*1000 });
  res.redirect('/admin/profile?success=1');
});

// ── IMAGE UPLOAD ──────────────────────────────────────────────────
router.post('/upload-image', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: getFileUrl(req.file) });
});

module.exports = router;
