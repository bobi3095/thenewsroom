const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authMiddleware, adminOnly, JWT_SECRET } = require('../middleware/auth');
const { upload, saveFile, deleteFile } = require('../middleware/upload');

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
  const allArticles = await db.getArticles({});

  if (req.user.role === 'author') {
    // Author sees only their own articles
    const myArticles = allArticles.filter(a => a.authorId === req.user.id);
    const stats = {
      total: myArticles.length,
      published: myArticles.filter(a => a.status === 'published').length,
      drafts: myArticles.filter(a => a.status === 'draft').length,
      totalViews: myArticles.reduce((s, a) => s + (a.views||0), 0)
    };
    return res.render('admin/author-dashboard', {
      user: req.user,
      articles: myArticles,
      stats,
      categories: db.categories
    });
  }

  // Admin sees everything
  const allUsers = await db.getAllUsers();
  const published = allArticles.filter(a => a.status === 'published').length;
  const drafts = allArticles.filter(a => a.status === 'draft').length;
  const totalViews = allArticles.reduce((s, a) => s + (a.views||0), 0);
  res.render('admin/dashboard', {
    user: req.user,
    articles: allArticles.slice(0, 20),
    stats: { total: allArticles.length, published, drafts, totalViews, authors: allUsers.filter(u => u.role === 'author').length },
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
  if (req.user.role !== 'admin' && article.authorId !== req.user.id) return res.redirect('/admin');
  res.render('admin/editor', { article, categories: db.categories, user: req.user });
});

router.post('/articles/save', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { id, title, content, excerpt, status, featured, removeImage } = req.body;
    // Handle multiple categories - comes as array or single value
    const rawCats = req.body.categories;
    const categoriesArr = Array.isArray(rawCats) ? rawCats : (rawCats ? [rawCats] : []);
    const primaryCategory = categoriesArr[0] || '';
    const imageUrl = await saveFile(req.file);

    if (id) {
      const existing = await db.getArticle({ id: parseInt(id) });
      if (req.user.role !== 'admin' && existing?.authorId !== req.user.id) return res.redirect('/admin');
      // Delete old image if new one uploaded OR user clicked Remove
      if ((imageUrl || removeImage === '1') && existing?.image) {
        await deleteFile(existing.image);
      }
      await db.updateArticle(parseInt(id), {
        title, content, excerpt,
        category: primaryCategory,
        categories: categoriesArr,
        status: status || 'draft',
        featured: req.user.role === 'admin' ? featured === 'on' : existing.featured,
        slug: slugify(title),
        image: removeImage === '1' ? '' : (imageUrl || existing?.image || '')
      });
    } else {
      await db.createArticle({
        title, content, excerpt,
        category: primaryCategory,
        categories: categoriesArr,
        status: status || 'draft',
        featured: req.user.role === 'admin' ? featured === 'on' : false,
        slug: slugify(title),
        author: req.user.name,
        authorId: req.user.id,
        image: imageUrl || ''
      });
    }
    res.redirect('/admin');
  } catch(err) {
    console.error('Save article error:', err);
    res.status(500).send('Error saving article: ' + err.message);
  }
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
  try {
    const { username, name, password, bio } = req.body;
    const existing = await db.getUser(username);
    if (existing) return res.render('admin/author-form', { author: null, user: req.user, categories: db.categories, error: 'Username already taken' });
    const avatarUrl = await saveFile(req.file);
    const hash = bcrypt.hashSync(password, 10);
    await db.createUser({ username, name, password: hash, role: 'author', bio: bio||'', avatar: avatarUrl||'' });
    res.redirect('/admin/authors');
  } catch(err) {
    console.error('Create author error:', err);
    res.status(500).send('Error creating author: ' + err.message);
  }
});

router.get('/authors/edit/:id', authMiddleware, adminOnly, async (req, res) => {
  const author = await db.getUserById(parseInt(req.params.id));
  if (!author) return res.redirect('/admin/authors');
  res.render('admin/author-form', { author, user: req.user, categories: db.categories, error: null });
});

router.post('/authors/update/:id', authMiddleware, adminOnly, upload.single('avatar'), async (req, res) => {
  try {
    const { name, bio, password } = req.body;
    const id = parseInt(req.params.id);
    const updates = { name, bio: bio||'' };
    const avatarUrl = await saveFile(req.file);
    if (avatarUrl) {
      // Delete old avatar from Cloudinary
      const existing = await db.getUserById(id);
      if (existing?.avatar) await deleteFile(existing.avatar);
      updates.avatar = avatarUrl;
    }
    if (password && password.trim()) updates.password = bcrypt.hashSync(password, 10);
    await db.updateUser(id, updates);
    res.redirect('/admin/authors');
  } catch(err) {
    console.error('Update author error:', err);
    res.status(500).send('Error updating author: ' + err.message);
  }
});

router.post('/authors/delete/:id', authMiddleware, adminOnly, async (req, res) => {
  await db.deleteUser(parseInt(req.params.id));
  res.redirect('/admin/authors');
});

// ── PROFILE ───────────────────────────────────────────────────────
router.get('/profile', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  res.render('admin/profile', { profileUser: user, user: req.user, categories: db.categories, success: null, error: null });
});

router.post('/profile/update', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    const { name, bio, password, confirmPassword } = req.body;
    const updates = { name, bio: bio||'' };
    const avatarUrl = await saveFile(req.file);
    if (avatarUrl) {
      // Delete old avatar from Cloudinary
      const currentUser = await db.getUserById(req.user.id);
      if (currentUser?.avatar) await deleteFile(currentUser.avatar);
      updates.avatar = avatarUrl;
    }
    if (password && password.trim()) {
      if (password !== confirmPassword) {
        const user = await db.getUserById(req.user.id);
        return res.render('admin/profile', { profileUser: user, user: req.user, categories: db.categories, error: 'Passwords do not match', success: null });
      }
      updates.password = bcrypt.hashSync(password, 10);
    }
    await db.updateUser(req.user.id, updates);
    const updated = await db.getUserById(req.user.id);
    const token = jwt.sign({ id: updated.id, username: updated.username, name: updated.name, role: updated.role, avatar: avatarUrl || req.user.avatar }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7*24*60*60*1000 });
    res.redirect('/admin/profile?success=1');
  } catch(err) {
    console.error('Profile update error:', err);
    res.status(500).send('Error updating profile: ' + err.message);
  }
});

// ── IMAGE UPLOAD (editor) ─────────────────────────────────────────
router.post('/upload-image', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = await saveFile(req.file);
    res.json({ url });
  } catch(err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
