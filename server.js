require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const ejs = require('ejs');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY HEADERS (Helmet) ──────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // disabled to allow embedded videos/tweets
  crossOriginEmbedderPolicy: false
}));

// ── COMPRESSION (Gzip) ─────────────────────────────────────────
// Compresses all responses - reduces bandwidth by 70%
app.use(compression());

// ── RATE LIMITING ──────────────────────────────────────────────
// Public pages: 200 requests per minute per IP
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

// Login: 10 attempts per 15 minutes per IP (brute force protection)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false
});

// Apply limiters
app.use('/admin/login', loginLimiter);
app.use('/', publicLimiter);

// ── VIEW ENGINE ────────────────────────────────────────────────
app.engine('html', ejs.renderFile);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');

// ── MIDDLEWARE ─────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files with cache headers (1 day for CSS/JS/images)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));

// ── ROUTES ─────────────────────────────────────────────────────
app.use('/', require('./routes/public'));
app.use('/admin', require('./routes/admin'));

// ── 404 ────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', {
    categories: db.categories,
    navCategories: ['Politics', 'World News', 'India', 'Uncovered', 'Opinion'],
    moreCategories: ['Data', 'Sports', 'Law', 'Govt Schemes', 'Education', 'Technology'],
    page: '404'
  });
});

// ── ERROR HANDLER ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Something went wrong. Please try again.');
});

// ── START ──────────────────────────────────────────────────────
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🗞️  The News Room is live at http://localhost:${PORT}`);
    console.log(`   Admin: http://localhost:${PORT}/admin`);
    console.log(`   ⚡ Compression: enabled`);
    console.log(`   🔒 Security headers: enabled`);
    console.log(`   🚦 Rate limiting: enabled\n`);
  });
}).catch(err => {
  console.error('❌ DB init failed:', err);
  process.exit(1);
});
