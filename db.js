const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Use PostgreSQL if DATABASE_URL is set (Render), otherwise fall back to lowdb (local)
const isPostgres = !!process.env.DATABASE_URL;

let pool;
if (isPostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

// ── PostgreSQL helpers ──────────────────────────────────────────────
async function initPostgres() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS articles (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      category TEXT,
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

  // Seed admin user if none exists
  const { rows } = await pool.query('SELECT id FROM users LIMIT 1');
  if (rows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query(
      'INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)',
      ['admin', hash, 'Admin', 'admin']
    );
    console.log('✅ Admin user created in PostgreSQL');
  }

  // Seed welcome article if none
  const { rows: arts } = await pool.query('SELECT id FROM articles LIMIT 1');
  if (arts.length === 0) {
    await pool.query(`
      INSERT INTO articles (title, slug, category, excerpt, content, author, author_id, status, featured)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      'Welcome to The News Room',
      'welcome-to-the-news-room',
      'World News',
      'Independent journalism that goes beyond the headlines. We cover the stories that matter.',
      '<p>Welcome to <strong>The News Room</strong> — a new kind of news platform. We believe in honest, independent reporting without the noise of mainstream agendas.</p><p>Our mission is simple: cover the truth, wherever it leads. From politics and technology to sports and stories the mainstream media won\'t touch — we\'re here for all of it.</p><p>Stay tuned. The real news starts here.</p>',
      'Admin', 1, 'published', true
    ]);
  }

  console.log('✅ PostgreSQL ready');
}

// ── Unified DB interface ────────────────────────────────────────────
const db = {
  categories: ['Politics', 'Technology', 'Sports', 'World News', 'Uncovered'],

  async getArticles(filter = {}) {
    if (isPostgres) {
      let q = 'SELECT * FROM articles';
      const conditions = [];
      const vals = [];
      if (filter.status) { conditions.push(`status = $${vals.length+1}`); vals.push(filter.status); }
      if (filter.category) { conditions.push(`category = $${vals.length+1}`); vals.push(filter.category); }
      if (filter.slug) { conditions.push(`slug = $${vals.length+1}`); vals.push(filter.slug); }
      if (filter.id) { conditions.push(`id = $${vals.length+1}`); vals.push(filter.id); }
      if (conditions.length) q += ' WHERE ' + conditions.join(' AND ');
      q += ' ORDER BY created_at DESC';
      const { rows } = await pool.query(q, vals);
      return rows.map(pgToArticle);
    } else {
      const lowdb = getLowdb();
      let arts = lowdb.data.articles;
      if (filter.status) arts = arts.filter(a => a.status === filter.status);
      if (filter.category) arts = arts.filter(a => a.category === filter.category);
      if (filter.slug) arts = arts.filter(a => a.slug === filter.slug);
      if (filter.id) arts = arts.filter(a => a.id === filter.id);
      return arts.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
  },

  async getArticle(filter) {
    const arts = await db.getArticles(filter);
    return arts[0] || null;
  },

  async createArticle(data) {
    if (isPostgres) {
      const { rows } = await pool.query(`
        INSERT INTO articles (title,slug,category,excerpt,content,author,author_id,status,featured,image)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
      `, [data.title,data.slug,data.category,data.excerpt,data.content,data.author,data.authorId,data.status,data.featured,data.image||'']);
      return pgToArticle(rows[0]);
    } else {
      const lowdb = getLowdb();
      const id = Math.max(0, ...lowdb.data.articles.map(a => a.id)) + 1;
      const article = { id, ...data, views: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      lowdb.data.articles.push(article);
      lowdb.write();
      return article;
    }
  },

  async updateArticle(id, data) {
    if (isPostgres) {
      const { rows } = await pool.query(`
        UPDATE articles SET title=$1,slug=$2,category=$3,excerpt=$4,content=$5,
        status=$6,featured=$7,image=$8,updated_at=NOW()
        WHERE id=$9 RETURNING *
      `, [data.title,data.slug,data.category,data.excerpt,data.content,data.status,data.featured,data.image,id]);
      return rows[0] ? pgToArticle(rows[0]) : null;
    } else {
      const lowdb = getLowdb();
      const idx = lowdb.data.articles.findIndex(a => a.id === id);
      if (idx !== -1) {
        lowdb.data.articles[idx] = { ...lowdb.data.articles[idx], ...data, updatedAt: new Date().toISOString() };
        lowdb.write();
      }
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

  async getUser(username) {
    if (isPostgres) {
      const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
      return rows[0] ? pgToUser(rows[0]) : null;
    } else {
      const lowdb = getLowdb();
      return lowdb.data.users.find(u => u.username === username) || null;
    }
  },

  async init() {
    if (isPostgres) {
      await initPostgres();
    } else {
      initLowdb();
    }
  }
};

// ── Row mappers ─────────────────────────────────────────────────────
function pgToArticle(row) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    category: row.category,
    excerpt: row.excerpt,
    content: row.content,
    author: row.author,
    authorId: row.author_id,
    status: row.status,
    featured: row.featured,
    image: row.image,
    views: row.views,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function pgToUser(row) {
  return {
    id: row.id,
    username: row.username,
    password: row.password,
    name: row.name,
    role: row.role,
    createdAt: row.created_at
  };
}

// ── Lowdb fallback (local dev) ──────────────────────────────────────
let _lowdb;
function getLowdb() { return _lowdb; }

function initLowdb() {
  const { Low } = require('lowdb');
  const { JSONFileSync } = require('lowdb/node');
  const path = require('path');
  const fs = require('fs');
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  const adapter = new JSONFileSync(path.join(dataDir, 'db.json'));
  _lowdb = new Low(adapter, { users: [], articles: [], categories: ['Politics','Technology','Sports','World News','Uncovered'] });
  _lowdb.read();
  if (!_lowdb.data.users || _lowdb.data.users.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    _lowdb.data.users = [{ id:1, username:'admin', password:hash, name:'Admin', role:'admin', createdAt: new Date().toISOString() }];
    _lowdb.write();
  }
  if (!_lowdb.data.articles || _lowdb.data.articles.length === 0) {
    _lowdb.data.articles = [{
      id:1, title:'Welcome to The News Room', slug:'welcome-to-the-news-room',
      category:'World News', excerpt:'Independent journalism that goes beyond the headlines.',
      content:'<p>Welcome to <strong>The News Room</strong>.</p>', author:'Admin', authorId:1,
      status:'published', featured:true, image:'', views:0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }];
    _lowdb.write();
  }
  console.log('✅ Local lowdb ready');
}

module.exports = db;
