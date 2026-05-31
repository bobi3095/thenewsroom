const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const isPostgres = !!process.env.DATABASE_URL;

let pool;
if (isPostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function initPostgres() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'author',
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS articles (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      category TEXT,
      categories TEXT[] DEFAULT '{}',
      excerpt TEXT,
      content TEXT,
      author TEXT,
      author_id INTEGER,
      status TEXT DEFAULT 'draft',
      featured BOOLEAN DEFAULT false,
      image TEXT DEFAULT '',
      views INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Add new columns if upgrading from old schema
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT '';
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE articles ADD COLUMN IF NOT EXISTS categories TEXT[] DEFAULT '{}';
  `).catch(() => {});

  // Seed admin
  const { rows } = await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if (rows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query(
      'INSERT INTO users (username, password, name, role, bio, avatar) VALUES ($1,$2,$3,$4,$5,$6)',
      ['admin', hash, 'Admin', 'admin', 'Site administrator', '']
    );
    console.log('✅ Admin user created in PostgreSQL');
  }

  // Seed welcome article
  const { rows: arts } = await pool.query('SELECT id FROM articles LIMIT 1');
  if (arts.length === 0) {
    await pool.query(`
      INSERT INTO articles (title,slug,category,excerpt,content,author,author_id,status,featured)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      'Welcome to The News Room', 'welcome-to-the-news-room', 'World News',
      'Independent journalism that goes beyond the headlines.',
      '<p>Welcome to <strong>The News Room</strong> — a new kind of news platform.</p><p>Our mission is simple: cover the truth, wherever it leads.</p>',
      'Admin', 1, 'published', true
    ]);
  }
  console.log('✅ PostgreSQL ready');
}

const db = {
  categories: ['Politics', 'Technology', 'Sports', 'World News', 'Uncovered', 'Opinion', 'India', 'Data', 'Law', 'Govt Schemes', 'Education'],

  // ── ARTICLES ──────────────────────────────────────────────────────
  async getArticles(filter = {}) {
    if (isPostgres) {
      let q = `SELECT a.*, u.avatar as author_avatar, u.bio as author_bio
               FROM articles a LEFT JOIN users u ON a.author_id = u.id`;
      const conditions = [], vals = [];
      if (filter.status) { conditions.push(`a.status = $${vals.length+1}`); vals.push(filter.status); }
      if (filter.category) { 
        // Match if primary category OR in categories array
        conditions.push(`(a.category = $${vals.length+1} OR $${vals.length+1} = ANY(a.categories))`); 
        vals.push(filter.category); 
      }
      if (filter.slug) { conditions.push(`a.slug = $${vals.length+1}`); vals.push(filter.slug); }
      if (filter.id) { conditions.push(`a.id = $${vals.length+1}`); vals.push(filter.id); }
      if (filter.authorId) { conditions.push(`a.author_id = $${vals.length+1}`); vals.push(filter.authorId); }
      if (conditions.length) q += ' WHERE ' + conditions.join(' AND ');
      q += ' ORDER BY a.created_at DESC';
      const { rows } = await pool.query(q, vals);
      return rows.map(pgToArticle);
    } else {
      const lowdb = getLowdb();
      let arts = lowdb.data.articles;
      if (filter.status) arts = arts.filter(a => a.status === filter.status);
      if (filter.category) arts = arts.filter(a => a.category === filter.category);
      if (filter.slug) arts = arts.filter(a => a.slug === filter.slug);
      if (filter.id) arts = arts.filter(a => a.id === filter.id);
      if (filter.authorId) arts = arts.filter(a => a.authorId === filter.authorId);
      // join author info
      return arts.sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).map(a => {
        const user = lowdb.data.users.find(u => u.id === a.authorId);
        return { ...a, authorAvatar: user?.avatar||'', authorBio: user?.bio||'' };
      });
    }
  },

  async getArticle(filter) {
    const arts = await db.getArticles(filter);
    return arts[0] || null;
  },

  async createArticle(data) {
    if (isPostgres) {
      const cats = data.categories || [data.category];
      const { rows } = await pool.query(`
        INSERT INTO articles (title,slug,category,categories,excerpt,content,author,author_id,status,featured,image)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
      `, [data.title,data.slug,data.category,cats,data.excerpt,data.content,data.author,data.authorId,data.status,data.featured,data.image||'']);
      return pgToArticle(rows[0]);
    } else {
      const lowdb = getLowdb();
      const id = Math.max(0, ...lowdb.data.articles.map(a => a.id)) + 1;
      const article = { id, ...data, views:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
      lowdb.data.articles.push(article);
      lowdb.write();
      return article;
    }
  },

  async updateArticle(id, data) {
    if (isPostgres) {
      const cats = data.categories || [data.category];
      const { rows } = await pool.query(`
        UPDATE articles SET title=$1,slug=$2,category=$3,categories=$4,excerpt=$5,content=$6,
        status=$7,featured=$8,image=$9,updated_at=NOW() WHERE id=$10 RETURNING *
      `, [data.title,data.slug,data.category,cats,data.excerpt,data.content,data.status,data.featured,data.image,id]);
      return rows[0] ? pgToArticle(rows[0]) : null;
    } else {
      const lowdb = getLowdb();
      const idx = lowdb.data.articles.findIndex(a => a.id === id);
      if (idx !== -1) { lowdb.data.articles[idx] = {...lowdb.data.articles[idx],...data,updatedAt:new Date().toISOString()}; lowdb.write(); }
    }
  },

  async deleteArticle(id) {
    if (isPostgres) {
      await pool.query('DELETE FROM articles WHERE id=$1', [id]);
    } else {
      const lowdb = getLowdb();
      lowdb.data.articles = lowdb.data.articles.filter(a => a.id !== id);
      lowdb.write();
    }
  },

  async incrementViews(id) {
    if (isPostgres) {
      await pool.query('UPDATE articles SET views = views + 1 WHERE id=$1', [id]);
    } else {
      const lowdb = getLowdb();
      const a = lowdb.data.articles.find(a => a.id === id);
      if (a) { a.views = (a.views||0)+1; lowdb.write(); }
    }
  },

  // ── USERS ─────────────────────────────────────────────────────────
  async getUser(username) {
    if (isPostgres) {
      const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
      return rows[0] ? pgToUser(rows[0]) : null;
    } else {
      const lowdb = getLowdb();
      return lowdb.data.users.find(u => u.username === username) || null;
    }
  },

  async getUserById(id) {
    if (isPostgres) {
      const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
      return rows[0] ? pgToUser(rows[0]) : null;
    } else {
      const lowdb = getLowdb();
      return lowdb.data.users.find(u => u.id === id) || null;
    }
  },

  async getAllUsers() {
    if (isPostgres) {
      const { rows } = await pool.query("SELECT * FROM users ORDER BY created_at DESC");
      return rows.map(pgToUser);
    } else {
      const lowdb = getLowdb();
      return lowdb.data.users;
    }
  },

  async createUser(data) {
    if (isPostgres) {
      const { rows } = await pool.query(
        'INSERT INTO users (username,password,name,role,bio,avatar) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [data.username, data.password, data.name, data.role||'author', data.bio||'', data.avatar||'']
      );
      return pgToUser(rows[0]);
    } else {
      const lowdb = getLowdb();
      const id = Math.max(0, ...lowdb.data.users.map(u => u.id)) + 1;
      const user = { id, ...data, createdAt: new Date().toISOString() };
      lowdb.data.users.push(user);
      lowdb.write();
      return user;
    }
  },

  async updateUser(id, data) {
    if (isPostgres) {
      const fields = [], vals = [];
      if (data.name !== undefined) { fields.push(`name=$${vals.length+1}`); vals.push(data.name); }
      if (data.bio !== undefined) { fields.push(`bio=$${vals.length+1}`); vals.push(data.bio); }
      if (data.avatar !== undefined) { fields.push(`avatar=$${vals.length+1}`); vals.push(data.avatar); }
      if (data.password !== undefined) { fields.push(`password=$${vals.length+1}`); vals.push(data.password); }
      if (!fields.length) return;
      vals.push(id);
      await pool.query(`UPDATE users SET ${fields.join(',')} WHERE id=$${vals.length}`, vals);
    } else {
      const lowdb = getLowdb();
      const idx = lowdb.data.users.findIndex(u => u.id === id);
      if (idx !== -1) { lowdb.data.users[idx] = {...lowdb.data.users[idx], ...data}; lowdb.write(); }
    }
  },

  async deleteUser(id) {
    if (isPostgres) {
      await pool.query('DELETE FROM users WHERE id=$1', [id]);
    } else {
      const lowdb = getLowdb();
      lowdb.data.users = lowdb.data.users.filter(u => u.id !== id);
      lowdb.write();
    }
  },

  async init() {
    if (isPostgres) await initPostgres();
    else initLowdb();
  }
};

function pgToArticle(row) {
  return {
    id: row.id, title: row.title, slug: row.slug, category: row.category,
    categories: row.categories || [],
    excerpt: row.excerpt, content: row.content, author: row.author,
    authorId: row.author_id, status: row.status, featured: row.featured,
    image: row.image, views: row.views,
    authorAvatar: row.author_avatar || '',
    authorBio: row.author_bio || '',
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function pgToUser(row) {
  return {
    id: row.id, username: row.username, password: row.password,
    name: row.name, role: row.role, bio: row.bio || '',
    avatar: row.avatar || '', createdAt: row.created_at
  };
}

let _lowdb;
function getLowdb() { return _lowdb; }
function initLowdb() {
  const { Low } = require('lowdb');
  const { JSONFileSync } = require('lowdb/node');
  const path = require('path'), fs = require('fs');
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  const adapter = new JSONFileSync(path.join(dataDir, 'db.json'));
  _lowdb = new Low(adapter, { users:[], articles:[], categories:['Politics','Technology','Sports','World News','Uncovered'] });
  _lowdb.read();
  if (!_lowdb.data.users?.length) {
    _lowdb.data.users = [{ id:1, username:'admin', password:bcrypt.hashSync('admin123',10), name:'Admin', role:'admin', bio:'', avatar:'', createdAt:new Date().toISOString() }];
    _lowdb.write();
  }
  if (!_lowdb.data.articles?.length) {
    _lowdb.data.articles = [{ id:1, title:'Welcome to The News Room', slug:'welcome-to-the-news-room', category:'World News', excerpt:'Independent journalism.', content:'<p>Welcome to <strong>The News Room</strong>.</p>', author:'Admin', authorId:1, status:'published', featured:true, image:'', views:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }];
    _lowdb.write();
  }
  console.log('✅ Local lowdb ready');
}

module.exports = db;
