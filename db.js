const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const isPostgres = !!process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

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
      cover_height INTEGER DEFAULT 460,
      cover_fit TEXT DEFAULT 'cover',
      cover_position TEXT DEFAULT 'center center',
      views INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      verified BOOLEAN DEFAULT false,
      setup_complete BOOLEAN DEFAULT false,
      auth_provider TEXT DEFAULT 'email',
      google_id TEXT UNIQUE,
      verification_token TEXT,
      verification_expires TIMESTAMPTZ,
      otp_hash TEXT,
      otp_expires TIMESTAMPTZ,
      otp_attempts INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS article_metrics (
      id SERIAL PRIMARY KEY,
      article_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public_user_follows (
      public_user_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (public_user_id, author_id)
    );
  `);

  // Add new columns if upgrading from old schema
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT '';
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE articles ADD COLUMN IF NOT EXISTS categories TEXT[] DEFAULT '{}';
    ALTER TABLE articles ADD COLUMN IF NOT EXISTS cover_height INTEGER DEFAULT 460;
    ALTER TABLE articles ADD COLUMN IF NOT EXISTS cover_fit TEXT DEFAULT 'cover';
    ALTER TABLE articles ADD COLUMN IF NOT EXISTS cover_position TEXT DEFAULT 'center center';
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS username TEXT;
    ALTER TABLE public_users ALTER COLUMN password SET DEFAULT '';
    ALTER TABLE public_users ALTER COLUMN name SET DEFAULT '';
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false;
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN DEFAULT false;
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'email';
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS google_id TEXT;
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS verification_token TEXT;
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMPTZ;
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS otp_hash TEXT;
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS otp_expires TIMESTAMPTZ;
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS otp_attempts INTEGER DEFAULT 0;
    UPDATE public_users SET setup_complete=true WHERE password <> '' AND setup_complete=false;
  `).catch(() => {});
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS public_users_username_unique ON public_users(username) WHERE username IS NOT NULL').catch(() => {});
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS public_users_google_id_unique ON public_users(google_id) WHERE google_id IS NOT NULL').catch(() => {});

  // Seed admin
  const { rows } = await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if (rows.length === 0) {
    if (isProduction && !process.env.ADMIN_PASSWORD_HASH) {
      throw new Error('ADMIN_PASSWORD_HASH must be set before creating the first admin user in production');
    }
    const hash = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync('admin123', 10);
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
        INSERT INTO articles (title,slug,category,categories,excerpt,content,author,author_id,status,featured,image,cover_height,cover_fit,cover_position)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
      `, [data.title,data.slug,data.category,cats,data.excerpt,data.content,data.author,data.authorId,data.status,data.featured,data.image||'',data.coverHeight||460,data.coverFit||'cover',data.coverPosition||'center center']);
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
        status=$7,featured=$8,image=$9,cover_height=$10,cover_fit=$11,cover_position=$12,updated_at=NOW() WHERE id=$13 RETURNING *
      `, [data.title,data.slug,data.category,cats,data.excerpt,data.content,data.status,data.featured,data.image,data.coverHeight||460,data.coverFit||'cover',data.coverPosition||'center center',id]);
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

  async getAuthorProfile(authorId, publicUserId = null) {
    const author = await db.getUserById(parseInt(authorId, 10));
    if (!author || !['admin', 'author'].includes(author.role)) return null;
    const articles = await db.getArticles({ status: 'published', authorId: author.id });
    const followerCount = await db.getAuthorFollowerCount(author.id);
    const isFollowing = publicUserId ? await db.isFollowingAuthor(publicUserId, author.id) : false;
    return { ...author, articles, followerCount, isFollowing };
  },

  async followAuthor(publicUserId, authorId) {
    const readerId = parseInt(publicUserId, 10);
    const writerId = parseInt(authorId, 10);
    if (!readerId || !writerId) return;
    if (isPostgres) {
      await pool.query(
        `INSERT INTO public_user_follows (public_user_id, author_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [readerId, writerId]
      );
      return;
    }
    const lowdb = getLowdb();
    lowdb.data.publicUserFollows ||= [];
    if (!lowdb.data.publicUserFollows.some(f => f.publicUserId === readerId && f.authorId === writerId)) {
      lowdb.data.publicUserFollows.push({ publicUserId: readerId, authorId: writerId, createdAt: new Date().toISOString() });
      lowdb.write();
    }
  },

  async unfollowAuthor(publicUserId, authorId) {
    const readerId = parseInt(publicUserId, 10);
    const writerId = parseInt(authorId, 10);
    if (!readerId || !writerId) return;
    if (isPostgres) {
      await pool.query('DELETE FROM public_user_follows WHERE public_user_id=$1 AND author_id=$2', [readerId, writerId]);
      return;
    }
    const lowdb = getLowdb();
    lowdb.data.publicUserFollows = (lowdb.data.publicUserFollows || []).filter(f => !(f.publicUserId === readerId && f.authorId === writerId));
    lowdb.write();
  },

  async isFollowingAuthor(publicUserId, authorId) {
    const readerId = parseInt(publicUserId, 10);
    const writerId = parseInt(authorId, 10);
    if (!readerId || !writerId) return false;
    if (isPostgres) {
      const { rows } = await pool.query(
        'SELECT 1 FROM public_user_follows WHERE public_user_id=$1 AND author_id=$2 LIMIT 1',
        [readerId, writerId]
      );
      return rows.length > 0;
    }
    const lowdb = getLowdb();
    return (lowdb.data.publicUserFollows || []).some(f => f.publicUserId === readerId && f.authorId === writerId);
  },

  async getAuthorFollowerCount(authorId) {
    const writerId = parseInt(authorId, 10);
    if (!writerId) return 0;
    if (isPostgres) {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM public_user_follows WHERE author_id=$1', [writerId]);
      return rows[0]?.count || 0;
    }
    const lowdb = getLowdb();
    return (lowdb.data.publicUserFollows || []).filter(f => f.authorId === writerId).length;
  },

  async getFollowedAuthors(publicUserId) {
    const readerId = parseInt(publicUserId, 10);
    if (!readerId) return [];
    if (isPostgres) {
      const { rows } = await pool.query(`
        SELECT u.*, COUNT(a.id)::int AS article_count, MAX(f.created_at) AS followed_at
        FROM public_user_follows f
        JOIN users u ON u.id = f.author_id
        LEFT JOIN articles a ON a.author_id = u.id AND a.status = 'published'
        WHERE f.public_user_id=$1
        GROUP BY u.id
        ORDER BY followed_at DESC
      `, [readerId]);
      return rows.map(row => ({ ...pgToUser(row), articleCount: row.article_count || 0 }));
    }
    const lowdb = getLowdb();
    const follows = (lowdb.data.publicUserFollows || []).filter(f => f.publicUserId === readerId);
    return follows.map(f => {
      const author = lowdb.data.users.find(u => u.id === f.authorId);
      if (!author) return null;
      const articleCount = lowdb.data.articles.filter(a => a.authorId === author.id && a.status === 'published').length;
      return { ...author, articleCount };
    }).filter(Boolean);
  },

  async getPublicUserByEmail(email) {
    const normalized = normalizeEmail(email);
    if (isPostgres) {
      const { rows } = await pool.query('SELECT * FROM public_users WHERE email=$1', [normalized]);
      return rows[0] ? pgToPublicUser(rows[0]) : null;
    }
    const lowdb = getLowdb();
    return (lowdb.data.publicUsers || []).find(u => u.email === normalized) || null;
  },

  async getPublicUserByUsername(username) {
    const normalized = normalizeUsername(username);
    if (!normalized) return null;
    if (isPostgres) {
      const { rows } = await pool.query('SELECT * FROM public_users WHERE username=$1', [normalized]);
      return rows[0] ? pgToPublicUser(rows[0]) : null;
    }
    const lowdb = getLowdb();
    return (lowdb.data.publicUsers || []).find(u => u.username === normalized) || null;
  },

  async getPublicUserByLogin(login) {
    const value = String(login || '').trim();
    if (!value) return null;
    return value.includes('@') ? db.getPublicUserByEmail(value) : db.getPublicUserByUsername(value);
  },

  async getPublicUserById(id) {
    if (isPostgres) {
      const { rows } = await pool.query('SELECT * FROM public_users WHERE id=$1', [id]);
      return rows[0] ? pgToPublicUser(rows[0]) : null;
    }
    const lowdb = getLowdb();
    return (lowdb.data.publicUsers || []).find(u => u.id === id) || null;
  },

  async getPublicUserByVerificationToken(token) {
    const tokenHash = hashToken(token);
    if (isPostgres) {
      const { rows } = await pool.query(
        'SELECT * FROM public_users WHERE verification_token=$1 AND verification_expires > NOW()',
        [tokenHash]
      );
      return rows[0] ? pgToPublicUser(rows[0]) : null;
    }
    const lowdb = getLowdb();
    const now = Date.now();
    return (lowdb.data.publicUsers || []).find(u =>
      u.verificationToken === tokenHash &&
      new Date(u.verificationExpires).getTime() > now
    ) || null;
  },

  async createPublicUser(data) {
    const normalized = normalizeEmail(data.email);
    if (isPostgres) {
      const { rows } = await pool.query(
        `INSERT INTO public_users (email,password,name,verified,verification_token,verification_expires)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [normalized, data.password, data.name, false, data.verificationToken, data.verificationExpires]
      );
      return pgToPublicUser(rows[0]);
    }
    const lowdb = getLowdb();
    lowdb.data.publicUsers ||= [];
    const id = Math.max(0, ...lowdb.data.publicUsers.map(u => u.id)) + 1;
    const user = {
      id,
      email: normalized,
      password: data.password,
      name: data.name,
      verified: false,
      verificationToken: data.verificationToken,
      verificationExpires: data.verificationExpires,
      createdAt: new Date().toISOString()
    };
    lowdb.data.publicUsers.push(user);
    lowdb.write();
    return user;
  },

  async createOrUpdatePublicUserOtp(email, otpHash, expiresAt) {
    const normalized = normalizeEmail(email);
    const defaultName = normalized.split('@')[0] || 'Reader';
    if (isPostgres) {
      const { rows } = await pool.query(`
        INSERT INTO public_users (email,password,name,verified,setup_complete,auth_provider,otp_hash,otp_expires,otp_attempts)
        VALUES ($1,'',$2,false,false,'email',$3,$4,0)
        ON CONFLICT (email) DO UPDATE SET
          otp_hash=EXCLUDED.otp_hash,
          otp_expires=EXCLUDED.otp_expires,
          otp_attempts=0
        RETURNING *
      `, [normalized, defaultName, otpHash, expiresAt]);
      return pgToPublicUser(rows[0]);
    }
    const lowdb = getLowdb();
    lowdb.data.publicUsers ||= [];
    let user = lowdb.data.publicUsers.find(u => u.email === normalized);
    if (!user) {
      const id = Math.max(0, ...lowdb.data.publicUsers.map(u => u.id)) + 1;
      user = {
        id,
        email: normalized,
        username: '',
        password: '',
        name: defaultName,
        verified: false,
        setupComplete: false,
        authProvider: 'email',
        createdAt: new Date().toISOString()
      };
      lowdb.data.publicUsers.push(user);
    }
    user.otpHash = otpHash;
    user.otpExpires = expiresAt;
    user.otpAttempts = 0;
    lowdb.write();
    return user;
  },

  async verifyPublicUserOtp(email, otp) {
    const normalized = normalizeEmail(email);
    const otpHash = hashToken(otp);
    if (isPostgres) {
      const { rows } = await pool.query('SELECT * FROM public_users WHERE email=$1', [normalized]);
      const user = rows[0];
      if (!user || !user.otp_hash || !user.otp_expires) return null;
      if (new Date(user.otp_expires).getTime() < Date.now()) return null;
      if ((user.otp_attempts || 0) >= 5) return null;
      if (user.otp_hash !== otpHash) {
        await pool.query('UPDATE public_users SET otp_attempts=otp_attempts+1 WHERE id=$1', [user.id]);
        return null;
      }
      const { rows: updated } = await pool.query(`
        UPDATE public_users
        SET verified=true, otp_hash=NULL, otp_expires=NULL, otp_attempts=0
        WHERE id=$1 RETURNING *
      `, [user.id]);
      return updated[0] ? pgToPublicUser(updated[0]) : null;
    }
    const lowdb = getLowdb();
    const user = (lowdb.data.publicUsers || []).find(u => u.email === normalized);
    if (!user || !user.otpHash || !user.otpExpires) return null;
    if (new Date(user.otpExpires).getTime() < Date.now()) return null;
    if ((user.otpAttempts || 0) >= 5) return null;
    if (user.otpHash !== otpHash) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      lowdb.write();
      return null;
    }
    user.verified = true;
    user.otpHash = null;
    user.otpExpires = null;
    user.otpAttempts = 0;
    lowdb.write();
    return user;
  },

  async completePublicUserSetup(id, data) {
    const username = normalizeUsername(data.username);
    const name = String(data.name || '').trim();
    if (!username || !name || !data.password) return null;
    if (isPostgres) {
      const { rows } = await pool.query(`
        UPDATE public_users
        SET username=$1,name=$2,password=$3,setup_complete=true
        WHERE id=$4 RETURNING *
      `, [username, name, data.password, id]);
      return rows[0] ? pgToPublicUser(rows[0]) : null;
    }
    const lowdb = getLowdb();
    const user = (lowdb.data.publicUsers || []).find(u => u.id === id);
    if (!user) return null;
    user.username = username;
    user.name = name;
    user.password = data.password;
    user.setupComplete = true;
    lowdb.write();
    return user;
  },

  async createOrUpdateGooglePublicUser(profile) {
    const email = normalizeEmail(profile.email);
    if (!email) return null;
    const name = String(profile.name || email.split('@')[0] || 'Reader').trim();
    if (isPostgres) {
      const { rows } = await pool.query(`
        INSERT INTO public_users (email,password,name,verified,setup_complete,auth_provider,google_id)
        VALUES ($1,'',$2,true,true,'google',$3)
        ON CONFLICT (email) DO UPDATE SET
          name=COALESCE(NULLIF(public_users.name,''), EXCLUDED.name),
          verified=true,
          setup_complete=true,
          auth_provider='google',
          google_id=EXCLUDED.google_id
        RETURNING *
      `, [email, name, profile.googleId || null]);
      return pgToPublicUser(rows[0]);
    }
    const lowdb = getLowdb();
    lowdb.data.publicUsers ||= [];
    let user = lowdb.data.publicUsers.find(u => u.email === email);
    if (!user) {
      const id = Math.max(0, ...lowdb.data.publicUsers.map(u => u.id)) + 1;
      user = { id, email, username: '', password: '', name, createdAt: new Date().toISOString() };
      lowdb.data.publicUsers.push(user);
    }
    user.name ||= name;
    user.verified = true;
    user.setupComplete = true;
    user.authProvider = 'google';
    user.googleId = profile.googleId || user.googleId || '';
    lowdb.write();
    return user;
  },

  async setPublicUserVerificationToken(id, tokenHash, expiresAt) {
    if (isPostgres) {
      await pool.query(
        'UPDATE public_users SET verification_token=$1, verification_expires=$2 WHERE id=$3',
        [tokenHash, expiresAt, id]
      );
      return;
    }
    const lowdb = getLowdb();
    const user = (lowdb.data.publicUsers || []).find(u => u.id === id);
    if (user) {
      user.verificationToken = tokenHash;
      user.verificationExpires = expiresAt;
      lowdb.write();
    }
  },

  async updatePublicUserProfile(id, data) {
    const name = String(data.name || '').trim();
    if (!name || name.length < 2) return null;
    if (isPostgres) {
      const { rows } = await pool.query(
        'UPDATE public_users SET name=$1 WHERE id=$2 RETURNING *',
        [name, id]
      );
      return rows[0] ? pgToPublicUser(rows[0]) : null;
    }
    const lowdb = getLowdb();
    const user = (lowdb.data.publicUsers || []).find(u => u.id === id);
    if (!user) return null;
    user.name = name;
    lowdb.write();
    return user;
  },

  async recordArticleMetric(articleId, type) {
    const validTypes = new Set(['view', 'click', 'share']);
    const metricType = validTypes.has(type) ? type : 'view';
    const id = parseInt(articleId, 10);
    if (!id) return;
    if (isPostgres) {
      await pool.query('INSERT INTO article_metrics (article_id,type) VALUES ($1,$2)', [id, metricType]);
      if (metricType === 'view') await pool.query('UPDATE articles SET views = views + 1 WHERE id=$1', [id]);
    } else {
      const lowdb = getLowdb();
      lowdb.data.articleMetrics ||= [];
      lowdb.data.articleMetrics.push({ articleId: id, type: metricType, createdAt: new Date().toISOString() });
      if (metricType === 'view') {
        const a = lowdb.data.articles.find(a => a.id === id);
        if (a) a.views = (a.views || 0) + 1;
      }
      lowdb.write();
    }
  },

  async getTrendingArticles(articles, hours = 24) {
    const articleMap = new Map(articles.map(a => [a.id, a]));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const scores = new Map();
    const addScore = (articleId, type, count = 1) => {
      const weight = type === 'share' ? 4 : type === 'click' ? 2 : 1;
      const current = scores.get(articleId) || { score: 0, views: 0, clicks: 0, shares: 0 };
      current.score += weight * count;
      if (type === 'view') current.views += count;
      if (type === 'click') current.clicks += count;
      if (type === 'share') current.shares += count;
      scores.set(articleId, current);
    };

    if (isPostgres) {
      const { rows } = await pool.query(`
        SELECT article_id, type, COUNT(*)::int AS count
        FROM article_metrics
        WHERE created_at >= $1
        GROUP BY article_id, type
      `, [since]);
      rows.forEach(row => addScore(row.article_id, row.type, row.count));
    } else {
      const lowdb = getLowdb();
      (lowdb.data.articleMetrics || [])
        .filter(m => new Date(m.createdAt) >= since)
        .forEach(m => addScore(m.articleId, m.type));
    }

    return [...scores.entries()]
      .map(([id, stats]) => ({ ...articleMap.get(id), trending: stats }))
      .filter(a => a.id && a.status === 'published')
      .sort((a, b) => b.trending.score - a.trending.score || new Date(b.createdAt) - new Date(a.createdAt));
  },

  async verifyPublicUser(id) {
    if (isPostgres) {
      const { rows } = await pool.query(
        `UPDATE public_users
         SET verified=true, verification_token=NULL, verification_expires=NULL
         WHERE id=$1 RETURNING *`,
        [id]
      );
      return rows[0] ? pgToPublicUser(rows[0]) : null;
    }
    const lowdb = getLowdb();
    const user = (lowdb.data.publicUsers || []).find(u => u.id === id);
    if (!user) return null;
    user.verified = true;
    user.verificationToken = null;
    user.verificationExpires = null;
    lowdb.write();
    return user;
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
    coverHeight: row.cover_height || 460,
    coverFit: row.cover_fit || 'cover',
    coverPosition: row.cover_position || 'center center',
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

function pgToPublicUser(row) {
  return {
    id: row.id,
    username: row.username || '',
    email: row.email,
    password: row.password,
    name: row.name,
    verified: row.verified,
    setupComplete: row.setup_complete,
    authProvider: row.auth_provider || 'email',
    googleId: row.google_id || '',
    verificationToken: row.verification_token,
    verificationExpires: row.verification_expires,
    otpHash: row.otp_hash,
    otpExpires: row.otp_expires,
    otpAttempts: row.otp_attempts || 0,
    createdAt: row.created_at
  };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
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
  _lowdb = new Low(adapter, { users:[], publicUsers:[], articles:[], categories:['Politics','Technology','Sports','World News','Uncovered'] });
  _lowdb.read();
  _lowdb.data.publicUsers ||= [];
  _lowdb.data.articleMetrics ||= [];
  _lowdb.data.publicUserFollows ||= [];
  _lowdb.data.publicUsers.forEach(user => {
    user.username ||= '';
    user.setupComplete = user.setupComplete !== undefined ? user.setupComplete : !!user.password;
    user.authProvider ||= 'email';
    user.otpAttempts ||= 0;
  });
  if (!_lowdb.data.users?.length) {
    if (isProduction && !process.env.ADMIN_PASSWORD_HASH) {
      throw new Error('ADMIN_PASSWORD_HASH must be set before creating the first admin user in production');
    }
    _lowdb.data.users = [{ id:1, username:'admin', password: process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync('admin123',10), name:'Admin', role:'admin', bio:'', avatar:'', createdAt:new Date().toISOString() }];
    _lowdb.write();
  }
  if (!_lowdb.data.articles?.length) {
    _lowdb.data.articles = [{ id:1, title:'Welcome to The News Room', slug:'welcome-to-the-news-room', category:'World News', excerpt:'Independent journalism.', content:'<p>Welcome to <strong>The News Room</strong>.</p>', author:'Admin', authorId:1, status:'published', featured:true, image:'', views:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }];
    _lowdb.write();
  }
  console.log('✅ Local lowdb ready');
}

module.exports = db;
