const { Low } = require('lowdb');
const { JSONFileSync } = require('lowdb/node');
const bcrypt = require('bcryptjs');
const path = require('path');

const file = path.join(__dirname, 'data', 'db.json');
const adapter = new JSONFileSync(file);
const db = new Low(adapter, {
  users: [],
  articles: [],
  categories: ['Politics', 'Technology', 'Sports', 'World News', 'Uncovered']
});

db.read();

// Seed admin user if none exists
if (!db.data.users || db.data.users.length === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.data.users = [{
    id: 1,  
    username: 'admin',
    password: hash,
    name: 'Admin',
    role: 'admin',
    createdAt: new Date().toISOString()
  }];
  db.write();
  console.log('✅ Admin user created: admin / admin123');
}

// Seed sample articles if none
if (!db.data.articles || db.data.articles.length === 0) {
  db.data.articles = [
    {
      id: 1,
      title: 'Welcome to The News Room',
      slug: 'welcome-to-the-news-room',
      category: 'World News',
      excerpt: 'Independent journalism that goes beyond the headlines. We cover the stories that matter.',
      content: '<p>Welcome to <strong>The News Room</strong> — a new kind of news platform. We believe in honest, independent reporting without the noise of mainstream agendas.</p><p>Our mission is simple: cover the truth, wherever it leads. From politics and technology to sports and stories the mainstream media won\'t touch — we\'re here for all of it.</p><p>Stay tuned. The real news starts here.</p>',
      author: 'Admin',
      authorId: 1,
      status: 'published',
      featured: true,
      image: '',
      views: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];
  db.write();
}

module.exports = db;
