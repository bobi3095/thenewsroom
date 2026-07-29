const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authMiddleware, adminOnly, JWT_SECRET } = require('../middleware/auth');
const { upload, saveFile, deleteFile } = require('../middleware/upload');
const { clearCache, clearArticleCache, getCacheStats } = require('../middleware/cache');
const { cookieOptions, csrfProtection, createLoginRateLimiter } = require('../middleware/security');
const { sanitizeArticleHtml } = require('../middleware/sanitize');

const slugify = str => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const loginRateLimiter = createLoginRateLimiter();
const passwordIsStrong = password => typeof password === 'string' && password.length >= 10;
const usernameIsValid = username => /^[a-zA-Z0-9_-]{3,32}$/.test(username || '');
const cleanText = value => String(value || '').trim();
const cleanProfileUrl = value => {
  const url = cleanText(value);
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return 'https://' + url;
  return url;
};
const asArray = value => Array.isArray(value) ? value : (value ? [value] : []);
const isAllowedDocumentUrl = value => {
  try {
    const url = new URL(cleanProfileUrl(value));
    return ['drive.google.com', 'docs.google.com'].includes(url.hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
};
const parseArticleDocuments = body => {
  const titles = asArray(body.documentTitles);
  const urls = asArray(body.documentUrls);
  const notes = asArray(body.documentNotes);

  return urls.map((url, index) => {
    const cleanUrl = cleanProfileUrl(url);
    return {
      title: cleanText(titles[index]) || `Document ${index + 1}`,
      url: cleanUrl,
      note: cleanText(notes[index])
    };
  }).filter(doc => doc.url && isAllowedDocumentUrl(doc.url)).slice(0, 12);
};

async function notifyFollowersSafely(article) {
  try {
    await db.notifyFollowersOfArticle(article);
  } catch (err) {
    console.error('Article published, but follower notification failed:', err);
  }
}

async function buildUniqueArticleSlug(title, currentArticleId = null) {
  const baseSlug = slugify(title) || 'article';
  const currentId = currentArticleId ? Number(currentArticleId) : null;
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const existing = await db.getArticle({ slug: candidate });
    if (!existing || (currentId && Number(existing.id) === currentId)) return candidate;
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

// ── AUTH ──────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  const token = req.cookies?.token;
  if (token) { try { jwt.verify(token, JWT_SECRET); return res.redirect('/admin'); } catch {} }
  res.render('admin/login', { error: null });
});

router.post('/login', csrfProtection, loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!usernameIsValid(username)) return res.render('admin/login', { error: 'Invalid username or password' });
  const user = await db.getUser(username);
  if (!user) return res.render('admin/login', { error: 'Invalid username or password' });
  const hashToCheck = (user.role === 'admin' && process.env.ADMIN_PASSWORD_HASH) ? process.env.ADMIN_PASSWORD_HASH : user.password;
  if (!bcrypt.compareSync(password, hashToCheck)) return res.render('admin/login', { error: 'Invalid username or password' });
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role, avatar: user.avatar }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { ...cookieOptions, maxAge: 7*24*60*60*1000 });
  res.redirect('/admin');
});

router.get('/logout', (req, res) => { res.clearCookie('token', cookieOptions); res.redirect('/admin/login'); });

// ── DASHBOARD ─────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  const allArticles = await db.getArticles({});
  const allVideos = await db.getVideos({});

  if (req.user.role === 'author') {
    // Author sees only their own articles
    const myArticles = allArticles.filter(a => a.authorId === req.user.id);
    const myVideos = allVideos.filter(v => v.authorId === req.user.id);
    const stats = {
      total: myArticles.length,
      published: myArticles.filter(a => a.status === 'published').length,
      drafts: myArticles.filter(a => a.status === 'draft').length,
      videos: myVideos.length,
      totalViews: myArticles.reduce((s, a) => s + (a.views||0), 0) + myVideos.reduce((s, v) => s + (v.views||0), 0)
    };
    return res.render('admin/author-dashboard', {
      user: req.user,
      articles: myArticles,
      videos: myVideos,
      stats,
      categories: db.categories,
      cacheStats: getCacheStats(),
      publishedSuccess: req.query.published === '1'
    });
  }

  // Admin sees everything
  const allUsers = await db.getAllUsers();
  const published = allArticles.filter(a => a.status === 'published').length;
  const drafts = allArticles.filter(a => a.status === 'draft').length;
  const totalViews = allArticles.reduce((s, a) => s + (a.views||0), 0) + allVideos.reduce((s, v) => s + (v.views||0), 0);
  res.render('admin/dashboard', {
    user: req.user,
    articles: allArticles.slice(0, 20),
    videos: allVideos.slice(0, 20),
    stats: { total: allArticles.length, published, drafts, videos: allVideos.length, totalViews, authors: allUsers.filter(u => u.role === 'author').length },
    categories: db.categories,
    publishedSuccess: req.query.published === '1'
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
  article.content = sanitizeArticleHtml(article.content);
  res.render('admin/editor', { article, categories: db.categories, user: req.user });
});

router.post('/articles/save', authMiddleware, upload.single('image'), csrfProtection, async (req, res) => {
  try {
    const { id, title, content, excerpt, status, featured, removeImage } = req.body;
    const coverHeight = Math.min(700, Math.max(220, parseInt(req.body.coverHeight, 10) || 460));
    const coverFit = ['cover', 'contain'].includes(req.body.coverFit) ? req.body.coverFit : 'cover';
    const validCoverPositions = new Set([
      'left top', 'center top', 'right top',
      'left center', 'center center', 'right center',
      'left bottom', 'center bottom', 'right bottom'
    ]);
    const coverPosition = validCoverPositions.has(req.body.coverPosition) ? req.body.coverPosition : 'center center';
    const documents = parseArticleDocuments(req.body);
    if (!title || title.trim().length < 3) return res.status(400).send('Article title is required');
    // Handle multiple categories - comes as array or single value
    const rawCats = req.body.categories;
    const categoriesArr = Array.isArray(rawCats) ? rawCats : (rawCats ? [rawCats] : []);
    const validCategories = categoriesArr.filter(cat => db.categories.includes(cat));
    if (!validCategories.length) return res.status(400).send('At least one valid category is required');
    const primaryCategory = validCategories[0] || '';
    const imageUrl = await saveFile(req.file);
    const cleanContent = sanitizeArticleHtml(content);

    if (id) {
      const existing = await db.getArticle({ id: parseInt(id) });
      if (req.user.role !== 'admin' && existing?.authorId !== req.user.id) return res.redirect('/admin');
      const articleSlug = await buildUniqueArticleSlug(title, parseInt(id));
      // Delete old image if new one uploaded OR user clicked Remove
      if ((imageUrl || removeImage === '1') && existing?.image) {
        await deleteFile(existing.image);
      }
      const updatedArticle = await db.updateArticle(parseInt(id), {
        title: title.trim(), content: cleanContent, excerpt,
        category: primaryCategory,
        categories: validCategories,
        status: status || 'draft',
        featured: req.user.role === 'admin' ? featured === 'on' : existing.featured,
        slug: articleSlug,
        image: removeImage === '1' ? '' : (imageUrl || existing?.image || ''),
        documents,
        coverHeight,
        coverFit,
        coverPosition
      });
      if (existing?.status !== 'published' && updatedArticle?.status === 'published') {
        await notifyFollowersSafely(updatedArticle);
      }
      clearCache(); // Clear all cache so updated article appears immediately
      return res.redirect('/admin' + (updatedArticle?.status === 'published' ? '?published=1' : ''));
    } else {
      const createdArticle = await db.createArticle({
        title: title.trim(), content: cleanContent, excerpt,
        category: primaryCategory,
        categories: validCategories,
        status: status || 'draft',
        featured: req.user.role === 'admin' ? featured === 'on' : false,
        slug: await buildUniqueArticleSlug(title),
        author: req.user.name,
        authorId: req.user.id,
        image: imageUrl || '',
        documents,
        coverHeight,
        coverFit,
        coverPosition
      });
      if (createdArticle?.status === 'published') {
        await notifyFollowersSafely(createdArticle);
      }
      clearCache(); // Clear all cache so new article appears immediately
      return res.redirect('/admin' + (createdArticle?.status === 'published' ? '?published=1' : ''));
    }
  } catch(err) {
    console.error('Save article error:', err);
    res.status(500).send('Error saving article: ' + err.message);
  }
});

router.post('/articles/delete/:id', authMiddleware, csrfProtection, async (req, res) => {
  const article = await db.getArticle({ id: parseInt(req.params.id) });
  if (req.user.role !== 'admin' && article?.authorId !== req.user.id) return res.redirect('/admin');
  await db.deleteArticle(parseInt(req.params.id));
  clearCache(); // Clear cache after deletion
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

router.post('/authors/create', authMiddleware, adminOnly, upload.single('avatar'), csrfProtection, async (req, res) => {
  try {
    const { username, name, password, bio, location, beat, websiteUrl, twitterUrl, instagramUrl, youtubeUrl } = req.body;
    if (!usernameIsValid(username)) return res.render('admin/author-form', { author: null, user: req.user, categories: db.categories, error: 'Username must be 3-32 letters, numbers, underscores, or hyphens' });
    if (!passwordIsStrong(password)) return res.render('admin/author-form', { author: null, user: req.user, categories: db.categories, error: 'Password must be at least 10 characters' });
    const existing = await db.getUser(username);
    if (existing) return res.render('admin/author-form', { author: null, user: req.user, categories: db.categories, error: 'Username already taken' });
    const avatarUrl = await saveFile(req.file);
    const hash = bcrypt.hashSync(password, 10);
    await db.createUser({
      username,
      name,
      password: hash,
      role: 'author',
      bio: bio || '',
      avatar: avatarUrl || '',
      location: cleanText(location),
      beat: cleanText(beat),
      websiteUrl: cleanProfileUrl(websiteUrl),
      twitterUrl: cleanProfileUrl(twitterUrl),
      instagramUrl: cleanProfileUrl(instagramUrl),
      youtubeUrl: cleanProfileUrl(youtubeUrl),
      isVerified: req.body.isVerified === 'on'
    });
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

router.post('/authors/update/:id', authMiddleware, adminOnly, upload.single('avatar'), csrfProtection, async (req, res) => {
  try {
    const { name, bio, password, location, beat, websiteUrl, twitterUrl, instagramUrl, youtubeUrl } = req.body;
    const id = parseInt(req.params.id);
    const updates = {
      name,
      bio: bio || '',
      location: cleanText(location),
      beat: cleanText(beat),
      websiteUrl: cleanProfileUrl(websiteUrl),
      twitterUrl: cleanProfileUrl(twitterUrl),
      instagramUrl: cleanProfileUrl(instagramUrl),
      youtubeUrl: cleanProfileUrl(youtubeUrl),
      isVerified: req.body.isVerified === 'on'
    };
    const avatarUrl = await saveFile(req.file);
    if (avatarUrl) {
      // Delete old avatar from Cloudinary
      const existing = await db.getUserById(id);
      if (existing?.avatar) await deleteFile(existing.avatar);
      updates.avatar = avatarUrl;
    }
    if (password && password.trim()) {
      if (!passwordIsStrong(password)) {
        const author = await db.getUserById(id);
        return res.render('admin/author-form', { author, user: req.user, categories: db.categories, error: 'Password must be at least 10 characters' });
      }
      updates.password = bcrypt.hashSync(password, 10);
    }
    await db.updateUser(id, updates);
    res.redirect('/admin/authors');
  } catch(err) {
    console.error('Update author error:', err);
    res.status(500).send('Error updating author: ' + err.message);
  }
});

router.post('/authors/delete/:id', authMiddleware, adminOnly, csrfProtection, async (req, res) => {
  await db.deleteUser(parseInt(req.params.id));
  res.redirect('/admin/authors');
});

// ── PROFILE ───────────────────────────────────────────────────────
router.get('/profile', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  res.render('admin/profile', { profileUser: user, user: req.user, categories: db.categories, success: null, error: null });
});

router.post('/profile/update', authMiddleware, upload.single('avatar'), csrfProtection, async (req, res) => {
  try {
    const { name, bio, password, confirmPassword, location, beat, websiteUrl, twitterUrl, instagramUrl, youtubeUrl } = req.body;
    const updates = {
      name,
      bio: bio || '',
      location: cleanText(location),
      beat: cleanText(beat),
      websiteUrl: cleanProfileUrl(websiteUrl),
      twitterUrl: cleanProfileUrl(twitterUrl),
      instagramUrl: cleanProfileUrl(instagramUrl),
      youtubeUrl: cleanProfileUrl(youtubeUrl)
    };
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
      if (!passwordIsStrong(password)) {
        const user = await db.getUserById(req.user.id);
        return res.render('admin/profile', { profileUser: user, user: req.user, categories: db.categories, error: 'Password must be at least 10 characters', success: null });
      }
      updates.password = bcrypt.hashSync(password, 10);
    }
    await db.updateUser(req.user.id, updates);
    const updated = await db.getUserById(req.user.id);
    const token = jwt.sign({ id: updated.id, username: updated.username, name: updated.name, role: updated.role, avatar: avatarUrl || req.user.avatar }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { ...cookieOptions, maxAge: 7*24*60*60*1000 });
    res.redirect('/admin/profile?success=1');
  } catch(err) {
    console.error('Profile update error:', err);
    res.status(500).send('Error updating profile: ' + err.message);
  }
});

// ── CACHE MANAGEMENT ─────────────────────────────────────────────
router.get('/comments', authMiddleware, adminOnly, async (req, res) => {
  const comments = await db.getAllArticleComments();
  res.render('admin/comments', {
    user: req.user,
    comments,
    categories: db.categories
  });
});

router.post('/comments/delete/:id', authMiddleware, adminOnly, csrfProtection, async (req, res) => {
  await db.adminDeleteArticleComment(req.params.id);
  clearCache();
  res.redirect('/admin/comments');
});

router.get('/journalist-applications', authMiddleware, adminOnly, async (req, res) => {
  const applications = await db.getJournalistApplications();
  res.render('admin/journalist-applications', {
    user: req.user,
    applications,
    categories: db.categories,
    success: req.query.reviewed === '1' ? 'Application review saved.' : null
  });
});

router.post('/journalist-applications/:id/approve', authMiddleware, adminOnly, csrfProtection, async (req, res) => {
  await db.reviewJournalistApplication(req.params.id, 'approved', req.user.id, req.body.reviewNote || '');
  clearCache();
  res.redirect('/admin/journalist-applications?reviewed=1');
});

router.post('/journalist-applications/:id/reject', authMiddleware, adminOnly, csrfProtection, async (req, res) => {
  await db.reviewJournalistApplication(req.params.id, 'rejected', req.user.id, req.body.reviewNote || '');
  res.redirect('/admin/journalist-applications?reviewed=1');
});

router.post('/cache/clear', authMiddleware, adminOnly, csrfProtection, (req, res) => {
  clearCache();
  res.redirect('/admin');
});

// ── IMAGE UPLOAD (editor) ─────────────────────────────────────────
router.post('/upload-image', authMiddleware, csrfProtection, upload.single('image'), async (req, res) => {
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
