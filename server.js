require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const ejs = require('ejs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.engine('html', ejs.renderFile);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', require('./routes/public'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => {
  res.status(404).render('404', { categories: db.categories, page: '404' });
});

// Init DB then start server
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🗞️  The News Room is live at http://localhost:${PORT}`);
    console.log(`   Admin: http://localhost:${PORT}/admin\n`);
  });
}).catch(err => {
  console.error('❌ DB init failed:', err);
  process.exit(1);
});
