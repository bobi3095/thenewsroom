require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const ejs = require('ejs');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { securityHeaders, csrfToken, sameOriginPost } = require('./middleware/security');
const { publicUserLocals } = require('./middleware/publicAuth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(securityHeaders);
app.use(compression());

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/', publicLimiter);

app.engine('html', ejs.renderFile);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');

app.use(express.json({ limit: '250kb' }));
app.use(express.urlencoded({ extended: true, limit: '250kb' }));
app.use(cookieParser());
app.use(csrfToken);
app.use(sameOriginPost);
app.use(publicUserLocals);

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));

// Robots.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /account
Disallow: /login
Disallow: /register

Sitemap: ${process.env.SITE_URL}/sitemap.xml`);
});

app.use('/', require('./routes/user'));
app.use('/', require('./routes/public'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => {
  res.status(404).render('404', {
    categories: db.categories,
    navCategories: ['Politics', 'World News', 'India', 'Uncovered', 'Opinion'],
    moreCategories: ['Data', 'Sports', 'Law', 'Govt Schemes', 'Education', 'Technology'],
    page: '404'
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Something went wrong. Please try again.');
});

db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`\nThe News Room is live at http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin`);
    console.log('Compression: enabled');
    console.log('Security headers: enabled');
    console.log('Rate limiting: enabled\n');
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
