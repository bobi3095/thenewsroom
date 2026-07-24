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
      location TEXT DEFAULT '',
      beat TEXT DEFAULT '',
      website_url TEXT DEFAULT '',
      twitter_url TEXT DEFAULT '',
      instagram_url TEXT DEFAULT '',
      youtube_url TEXT DEFAULT '',
      is_verified BOOLEAN DEFAULT true,
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

    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      category TEXT,
      video_url TEXT NOT NULL,
      author TEXT,
      author_id INTEGER,
      status TEXT DEFAULT 'draft',
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
      avatar TEXT DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS article_likes (
      public_user_id INTEGER NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (public_user_id, article_id)
    );

    CREATE TABLE IF NOT EXISTS article_comments (
      id SERIAL PRIMARY KEY,
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      public_user_id INTEGER NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
      body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 1000),
      status TEXT DEFAULT 'visible' CHECK (status IN ('visible', 'deleted')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS article_comment_likes (
      public_user_id INTEGER NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
      comment_id INTEGER NOT NULL REFERENCES article_comments(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (public_user_id, comment_id)
    );

    CREATE TABLE IF NOT EXISTS journalist_applications (
      id SERIAL PRIMARY KEY,
      public_user_id INTEGER NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      location TEXT DEFAULT '',
      beat TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      experience TEXT DEFAULT '',
      portfolio_url TEXT DEFAULT '',
      social_links TEXT DEFAULT '',
      sample_pitch TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      review_note TEXT DEFAULT '',
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      public_user_id INTEGER NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      url TEXT DEFAULT '',
      dedupe_key TEXT UNIQUE,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Add new columns if upgrading from old schema
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS beat TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS website_url TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS twitter_url TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram_url TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS youtube_url TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT true;
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
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT '';
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS verification_token TEXT;
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMPTZ;
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS otp_hash TEXT;
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS otp_expires TIMESTAMPTZ;
    ALTER TABLE public_users ADD COLUMN IF NOT EXISTS otp_attempts INTEGER DEFAULT 0;
    UPDATE public_users SET setup_complete=true WHERE password <> '' AND setup_complete=false;
  `).catch(() => {});
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS public_users_username_unique ON public_users(username) WHERE username IS NOT NULL').catch(() => {});
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS public_users_google_id_unique ON public_users(google_id) WHERE google_id IS NOT NULL').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_article_likes_article_id ON article_likes(article_id)').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_article_comments_article_id_created_at ON article_comments(article_id, created_at DESC)').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_article_comments_status ON article_comments(status)').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_article_comment_likes_comment_id ON article_comment_likes(comment_id)').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_journalist_applications_status_created ON journalist_applications(status, created_at DESC)').catch(() => {});
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS journalist_applications_one_pending_per_user ON journalist_applications(public_user_id) WHERE status='pending'").catch(() => {});
  await pool.query(`
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
  `).catch(() => {});
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_key_unique ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_public_user_created ON notifications(public_user_id, created_at DESC)').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_public_user_unread ON notifications(public_user_id) WHERE read_at IS NULL').catch(() => {});

  // Seed admin
  const { rows } = await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if (rows.length === 0) {
    if (isProduction && !process.env.ADMIN_PASSWORD_HASH) {
      throw new Error('ADMIN_PASSWORD_HASH must be set before creating the first admin user in production');
    }
    const hash = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync('admin123', 10);
    await pool.query(
      'INSERT INTO users (username, password, name, role, bio, avatar, location, beat, is_verified) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      ['admin', hash, 'Admin', 'admin', 'Site administrator', '', '', 'Newsroom', true]
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
      let q = `SELECT a.*, u.avatar as author_avatar, u.bio as author_bio, u.is_verified as author_verified
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
        return { ...a, authorAvatar: user?.avatar||'', authorBio: user?.bio||'', authorVerified: user?.isVerified !== false };
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
  async getVideos(filter = {}) {
    if (isPostgres) {
      let q = `SELECT v.*, u.avatar as author_avatar, u.bio as author_bio
               FROM videos v LEFT JOIN users u ON v.author_id = u.id`;
      const conditions = [], vals = [];
      if (filter.status) { conditions.push(`v.status = $${vals.length + 1}`); vals.push(filter.status); }
      if (filter.category) { conditions.push(`v.category = $${vals.length + 1}`); vals.push(filter.category); }
      if (filter.slug) { conditions.push(`v.slug = $${vals.length + 1}`); vals.push(filter.slug); }
      if (filter.id) { conditions.push(`v.id = $${vals.length + 1}`); vals.push(filter.id); }
      if (filter.authorId) { conditions.push(`v.author_id = $${vals.length + 1}`); vals.push(filter.authorId); }
      if (conditions.length) q += ' WHERE ' + conditions.join(' AND ');
      q += ' ORDER BY v.created_at DESC';
      const { rows } = await pool.query(q, vals);
      return rows.map(pgToVideo);
    }
    const lowdb = getLowdb();
    let videos = lowdb.data.videos || [];
    if (filter.status) videos = videos.filter(v => v.status === filter.status);
    if (filter.category) videos = videos.filter(v => v.category === filter.category);
    if (filter.slug) videos = videos.filter(v => v.slug === filter.slug);
    if (filter.id) videos = videos.filter(v => v.id === filter.id);
    if (filter.authorId) videos = videos.filter(v => v.authorId === filter.authorId);
    return videos.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).map(v => {
      const user = lowdb.data.users.find(u => u.id === v.authorId);
      return { ...v, authorAvatar: user?.avatar || '', authorBio: user?.bio || '' };
    });
  },

  async getVideo(filter) {
    const videos = await db.getVideos(filter);
    return videos[0] || null;
  },

  async createVideo(data) {
    if (isPostgres) {
      const { rows } = await pool.query(`
        INSERT INTO videos (title,slug,description,category,video_url,author,author_id,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
      `, [data.title, data.slug, data.description || '', data.category || '', data.videoUrl, data.author, data.authorId, data.status || 'draft']);
      return pgToVideo(rows[0]);
    }
    const lowdb = getLowdb();
    lowdb.data.videos ||= [];
    const id = Math.max(0, ...lowdb.data.videos.map(v => v.id)) + 1;
    const video = { id, ...data, views: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    lowdb.data.videos.push(video);
    lowdb.write();
    return video;
  },

  async updateVideo(id, data) {
    if (isPostgres) {
      const { rows } = await pool.query(`
        UPDATE videos SET title=$1,slug=$2,description=$3,category=$4,video_url=$5,status=$6,updated_at=NOW()
        WHERE id=$7 RETURNING *
      `, [data.title, data.slug, data.description || '', data.category || '', data.videoUrl, data.status || 'draft', id]);
      return rows[0] ? pgToVideo(rows[0]) : null;
    }
    const lowdb = getLowdb();
    const idx = (lowdb.data.videos || []).findIndex(v => v.id === id);
    if (idx !== -1) {
      lowdb.data.videos[idx] = { ...lowdb.data.videos[idx], ...data, updatedAt: new Date().toISOString() };
      lowdb.write();
      return lowdb.data.videos[idx];
    }
    return null;
  },

  async deleteVideo(id) {
    if (isPostgres) {
      await pool.query('DELETE FROM videos WHERE id=$1', [id]);
      return;
    }
    const lowdb = getLowdb();
    lowdb.data.videos = (lowdb.data.videos || []).filter(v => v.id !== id);
    lowdb.write();
  },

  async incrementVideoViews(id) {
    if (isPostgres) {
      await pool.query('UPDATE videos SET views = views + 1 WHERE id=$1', [id]);
      return;
    }
    const lowdb = getLowdb();
    const video = (lowdb.data.videos || []).find(v => v.id === id);
    if (video) {
      video.views = (video.views || 0) + 1;
      lowdb.write();
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
        `INSERT INTO users
          (username,password,name,role,bio,avatar,location,beat,website_url,twitter_url,instagram_url,youtube_url,is_verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          data.username,
          data.password,
          data.name,
          data.role || 'author',
          data.bio || '',
          data.avatar || '',
          data.location || '',
          data.beat || '',
          data.websiteUrl || '',
          data.twitterUrl || '',
          data.instagramUrl || '',
          data.youtubeUrl || '',
          data.isVerified !== undefined ? !!data.isVerified : true
        ]
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
      if (data.location !== undefined) { fields.push(`location=$${vals.length+1}`); vals.push(data.location); }
      if (data.beat !== undefined) { fields.push(`beat=$${vals.length+1}`); vals.push(data.beat); }
      if (data.websiteUrl !== undefined) { fields.push(`website_url=$${vals.length+1}`); vals.push(data.websiteUrl); }
      if (data.twitterUrl !== undefined) { fields.push(`twitter_url=$${vals.length+1}`); vals.push(data.twitterUrl); }
      if (data.instagramUrl !== undefined) { fields.push(`instagram_url=$${vals.length+1}`); vals.push(data.instagramUrl); }
      if (data.youtubeUrl !== undefined) { fields.push(`youtube_url=$${vals.length+1}`); vals.push(data.youtubeUrl); }
      if (data.isVerified !== undefined) { fields.push(`is_verified=$${vals.length+1}`); vals.push(!!data.isVerified); }
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

  async getJournalistApplicationByPublicUser(publicUserId) {
    const readerId = parseInt(publicUserId, 10);
    if (!readerId) return null;
    if (isPostgres) {
      const { rows } = await pool.query(
        'SELECT * FROM journalist_applications WHERE public_user_id=$1 ORDER BY created_at DESC LIMIT 1',
        [readerId]
      );
      return rows[0] ? pgToJournalistApplication(rows[0]) : null;
    }
    const lowdb = getLowdb();
    return (lowdb.data.journalistApplications || [])
      .filter(app => app.publicUserId === readerId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  },

  async createJournalistApplication(publicUser, data) {
    const readerId = parseInt(publicUser?.id, 10);
    if (!readerId) return null;
    const payload = {
      name: String(data.name || publicUser.name || '').trim(),
      email: String(publicUser.email || '').trim().toLowerCase(),
      location: String(data.location || '').trim(),
      beat: String(data.beat || '').trim(),
      bio: String(data.bio || '').trim(),
      experience: String(data.experience || '').trim(),
      portfolioUrl: String(data.portfolioUrl || '').trim(),
      socialLinks: String(data.socialLinks || '').trim(),
      samplePitch: String(data.samplePitch || '').trim(),
      publicUserAvatar: String(publicUser.avatar || '').trim()
    };
    if (isPostgres) {
      const { rows } = await pool.query(
        `INSERT INTO journalist_applications
          (public_user_id,name,email,location,beat,bio,experience,portfolio_url,social_links,sample_pitch)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          readerId,
          payload.name,
          payload.email,
          payload.location,
          payload.beat,
          payload.bio,
          payload.experience,
          payload.portfolioUrl,
          payload.socialLinks,
          payload.samplePitch
        ]
      );
      return pgToJournalistApplication(rows[0]);
    }
    const lowdb = getLowdb();
    lowdb.data.journalistApplications ||= [];
    const id = Math.max(0, ...lowdb.data.journalistApplications.map(app => app.id)) + 1;
    const app = {
      id,
      publicUserId: readerId,
      authorId: null,
      ...payload,
      status: 'pending',
      reviewNote: '',
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    lowdb.data.journalistApplications.push(app);
    lowdb.write();
    return app;
  },

  async getJournalistApplications() {
    if (isPostgres) {
      const { rows } = await pool.query(`
        SELECT ja.*, pu.avatar AS public_user_avatar
        FROM journalist_applications ja
        LEFT JOIN public_users pu ON pu.id = ja.public_user_id
        ORDER BY
          CASE ja.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
          ja.created_at DESC
      `);
      return rows.map(pgToJournalistApplication);
    }
    const lowdb = getLowdb();
    return (lowdb.data.journalistApplications || [])
      .slice()
      .sort((a, b) => {
        const rank = { pending: 0, approved: 1, rejected: 2 };
        return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || new Date(b.createdAt) - new Date(a.createdAt);
      });
  },

  async getJournalistApplicationById(id) {
    const appId = parseInt(id, 10);
    if (!appId) return null;
    if (isPostgres) {
      const { rows } = await pool.query(`
        SELECT ja.*, pu.avatar AS public_user_avatar
        FROM journalist_applications ja
        LEFT JOIN public_users pu ON pu.id = ja.public_user_id
        WHERE ja.id=$1
      `, [appId]);
      return rows[0] ? pgToJournalistApplication(rows[0]) : null;
    }
    const lowdb = getLowdb();
    return (lowdb.data.journalistApplications || []).find(app => app.id === appId) || null;
  },

  async reviewJournalistApplication(id, status, adminId, note = '') {
    const appId = parseInt(id, 10);
    const reviewerId = parseInt(adminId, 10);
    if (!appId || !['approved', 'rejected'].includes(status)) return null;
    const existing = await db.getJournalistApplicationById(appId);
    if (!existing) return null;
    let authorId = existing.authorId || null;

    if (status === 'approved' && !authorId) {
      const base = normalizeUsername(existing.email.split('@')[0] || existing.name || 'journalist').replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'journalist';
      let username = base;
      let suffix = 1;
      while (await db.getUser(username)) {
        username = `${base}${suffix++}`.slice(0, 32);
      }
      const hash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
      const author = await db.createUser({
        username,
        password: hash,
        name: existing.name,
        role: 'author',
        bio: existing.bio,
        avatar: existing.publicUserAvatar || '',
        location: existing.location,
        beat: existing.beat,
        websiteUrl: existing.portfolioUrl,
        twitterUrl: '',
        instagramUrl: '',
        youtubeUrl: '',
        isVerified: true
      });
      authorId = author?.id || null;
    }

    let reviewed = null;
    if (isPostgres) {
      const { rows } = await pool.query(
        `UPDATE journalist_applications
         SET status=$1, review_note=$2, reviewed_by=$3, reviewed_at=NOW(), updated_at=NOW(), author_id=$4
         WHERE id=$5
         RETURNING *`,
        [status, String(note || '').trim(), reviewerId || null, authorId, appId]
      );
      reviewed = rows[0] ? pgToJournalistApplication(rows[0]) : null;
    } else {
      const lowdb = getLowdb();
      const app = (lowdb.data.journalistApplications || []).find(item => item.id === appId);
      if (!app) return null;
      app.status = status;
      app.reviewNote = String(note || '').trim();
      app.reviewedBy = reviewerId || null;
      app.reviewedAt = new Date().toISOString();
      app.updatedAt = new Date().toISOString();
      app.authorId = authorId;
      lowdb.write();
      reviewed = app;
    }

    if (reviewed) {
      await db.createNotification({
        publicUserId: reviewed.publicUserId,
        type: 'journalist_application_' + status,
        title: status === 'approved' ? 'Your journalist application was approved' : 'Your journalist application was reviewed',
        body: status === 'approved'
          ? 'You have been approved as a verified journalist on The News Room.'
          : (String(note || '').trim() || 'Your application was not approved at this time.'),
        url: '/apply-journalist',
        dedupeKey: `journalist-application:${reviewed.id}:${status}`
      });
    }

    return reviewed;
  },

  async createNotification(data) {
    const publicUserId = parseInt(data.publicUserId, 10);
    if (!publicUserId || !data.title || !data.type) return null;
    const payload = {
      publicUserId,
      type: String(data.type || '').trim(),
      title: String(data.title || '').trim(),
      body: String(data.body || '').trim(),
      url: String(data.url || '').trim(),
      dedupeKey: data.dedupeKey ? String(data.dedupeKey).trim() : null
    };
    if (isPostgres) {
      if (payload.dedupeKey) {
        const existing = await pool.query(
          'SELECT * FROM notifications WHERE dedupe_key=$1 LIMIT 1',
          [payload.dedupeKey]
        );
        if (existing.rows[0]) return pgToNotification(existing.rows[0]);
      }
      try {
        const { rows } = await pool.query(
          `INSERT INTO notifications (public_user_id,type,title,body,url,dedupe_key)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [payload.publicUserId, payload.type, payload.title, payload.body, payload.url, payload.dedupeKey]
        );
        return rows[0] ? pgToNotification(rows[0]) : null;
      } catch (err) {
        if (payload.dedupeKey && err?.code === '23505') {
          const existing = await pool.query(
            'SELECT * FROM notifications WHERE dedupe_key=$1 LIMIT 1',
            [payload.dedupeKey]
          );
          if (existing.rows[0]) return pgToNotification(existing.rows[0]);
        }
        throw err;
      }
    }
    const lowdb = getLowdb();
    lowdb.data.notifications ||= [];
    if (payload.dedupeKey && lowdb.data.notifications.some(n => n.dedupeKey === payload.dedupeKey)) return null;
    const id = Math.max(0, ...lowdb.data.notifications.map(n => n.id)) + 1;
    const notification = { id, ...payload, readAt: null, createdAt: new Date().toISOString() };
    lowdb.data.notifications.push(notification);
    lowdb.write();
    return notification;
  },

  async notifyFollowersOfArticle(article) {
    if (!article?.id || !article.authorId || article.status !== 'published') return 0;
    if (isPostgres) {
      const { rows } = await pool.query('SELECT public_user_id FROM public_user_follows WHERE author_id=$1', [article.authorId]);
      await Promise.all(rows.map(row => db.createNotification({
        publicUserId: row.public_user_id,
        type: 'new_article',
        title: `${article.author || 'A journalist'} published a new story`,
        body: article.title,
        url: `/article/${article.slug}`,
        dedupeKey: `new-article:${article.id}:${row.public_user_id}`
      })));
      return rows.length;
    }
    const lowdb = getLowdb();
    const followers = (lowdb.data.publicUserFollows || []).filter(f => f.authorId === article.authorId);
    await Promise.all(followers.map(f => db.createNotification({
      publicUserId: f.publicUserId,
      type: 'new_article',
      title: `${article.author || 'A journalist'} published a new story`,
      body: article.title,
      url: `/article/${article.slug}`,
      dedupeKey: `new-article:${article.id}:${f.publicUserId}`
    })));
    return followers.length;
  },

  async getNotifications(publicUserId) {
    const readerId = parseInt(publicUserId, 10);
    if (!readerId) return [];
    if (isPostgres) {
      const { rows } = await pool.query(
        'SELECT * FROM notifications WHERE public_user_id=$1 ORDER BY created_at DESC LIMIT 80',
        [readerId]
      );
      return rows.map(pgToNotification);
    }
    const lowdb = getLowdb();
    return (lowdb.data.notifications || [])
      .filter(n => n.publicUserId === readerId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 80);
  },

  async getUnreadNotificationCount(publicUserId) {
    const readerId = parseInt(publicUserId, 10);
    if (!readerId) return 0;
    if (isPostgres) {
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM notifications WHERE public_user_id=$1 AND read_at IS NULL',
        [readerId]
      );
      return rows[0]?.count || 0;
    }
    const lowdb = getLowdb();
    return (lowdb.data.notifications || []).filter(n => n.publicUserId === readerId && !n.readAt).length;
  },

  async markNotificationsRead(publicUserId) {
    const readerId = parseInt(publicUserId, 10);
    if (!readerId) return;
    if (isPostgres) {
      await pool.query('UPDATE notifications SET read_at=NOW() WHERE public_user_id=$1 AND read_at IS NULL', [readerId]);
      return;
    }
    const lowdb = getLowdb();
    (lowdb.data.notifications || []).forEach(n => {
      if (n.publicUserId === readerId && !n.readAt) n.readAt = new Date().toISOString();
    });
    lowdb.write();
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
    const avatar = String(profile.avatar || '').trim();
    if (isPostgres) {
      const { rows } = await pool.query(`
        INSERT INTO public_users (email,password,name,verified,setup_complete,auth_provider,google_id,avatar)
        VALUES ($1,'',$2,true,true,'google',$3,$4)
        ON CONFLICT (email) DO UPDATE SET
          name=COALESCE(NULLIF(public_users.name,''), EXCLUDED.name),
          verified=true,
          setup_complete=true,
          auth_provider='google',
          google_id=EXCLUDED.google_id,
          avatar=COALESCE(NULLIF(EXCLUDED.avatar,''), public_users.avatar)
        RETURNING *
      `, [email, name, profile.googleId || null, avatar]);
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
    user.avatar = avatar || user.avatar || '';
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

  async getArticleLikeSummary(articleId, publicUserId = null) {
    const id = parseInt(articleId, 10);
    const readerId = parseInt(publicUserId, 10);
    if (!id) return { count: 0, liked: false };
    if (isPostgres) {
      const { rows } = await pool.query(`
        SELECT
          COUNT(*)::int AS count,
          BOOL_OR(public_user_id = $2)::boolean AS liked
        FROM article_likes
        WHERE article_id = $1
      `, [id, readerId || 0]);
      return { count: rows[0]?.count || 0, liked: !!rows[0]?.liked };
    }
    const lowdb = getLowdb();
    const likes = (lowdb.data.articleLikes || []).filter(l => l.articleId === id);
    return {
      count: likes.length,
      liked: readerId ? likes.some(l => l.publicUserId === readerId) : false
    };
  },

  async toggleArticleLike(articleId, publicUserId) {
    const id = parseInt(articleId, 10);
    const readerId = parseInt(publicUserId, 10);
    if (!id || !readerId) return { liked: false, count: 0 };
    if (isPostgres) {
      const existing = await pool.query(
        'SELECT 1 FROM article_likes WHERE article_id=$1 AND public_user_id=$2',
        [id, readerId]
      );
      if (existing.rows.length) {
        await pool.query('DELETE FROM article_likes WHERE article_id=$1 AND public_user_id=$2', [id, readerId]);
      } else {
        await pool.query(
          'INSERT INTO article_likes (article_id, public_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, readerId]
        );
      }
      return db.getArticleLikeSummary(id, readerId);
    }
    const lowdb = getLowdb();
    lowdb.data.articleLikes ||= [];
    const idx = lowdb.data.articleLikes.findIndex(l => l.articleId === id && l.publicUserId === readerId);
    if (idx >= 0) lowdb.data.articleLikes.splice(idx, 1);
    else lowdb.data.articleLikes.push({ articleId: id, publicUserId: readerId, createdAt: new Date().toISOString() });
    lowdb.write();
    return db.getArticleLikeSummary(id, readerId);
  },

  async getArticleComments(articleId, sort = 'top', publicUserId = null) {
    const id = parseInt(articleId, 10);
    const readerId = parseInt(publicUserId, 10);
    const safeSort = ['top', 'newest', 'oldest'].includes(sort) ? sort : 'top';
    if (!id) return [];
    if (isPostgres) {
      const orderBy = safeSort === 'newest'
        ? 'c.created_at DESC'
        : safeSort === 'oldest'
          ? 'c.created_at ASC'
          : 'like_count DESC, c.created_at DESC';
      const { rows } = await pool.query(`
        SELECT c.*, pu.name, pu.email,
          COUNT(cl.public_user_id)::int AS like_count,
          BOOL_OR(cl.public_user_id = $2)::boolean AS liked_by_me
        FROM article_comments c
        JOIN public_users pu ON pu.id = c.public_user_id
        LEFT JOIN article_comment_likes cl ON cl.comment_id = c.id
        WHERE c.article_id = $1 AND c.status = 'visible'
        GROUP BY c.id, pu.name, pu.email
        ORDER BY ${orderBy}
      `, [id, readerId || 0]);
      return rows.map(pgToArticleComment);
    }
    const lowdb = getLowdb();
    const commentLikes = lowdb.data.articleCommentLikes || [];
    const comments = (lowdb.data.articleComments || [])
      .filter(c => c.articleId === id && c.status === 'visible')
      .map(c => {
        const user = (lowdb.data.publicUsers || []).find(u => u.id === c.publicUserId);
        const likes = commentLikes.filter(l => l.commentId === c.id);
        return {
          ...c,
          userName: user?.name || user?.email || 'Reader',
          userEmail: user?.email || '',
          likeCount: likes.length,
          likedByMe: readerId ? likes.some(l => l.publicUserId === readerId) : false
        };
      });
    if (safeSort === 'newest') return comments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (safeSort === 'oldest') return comments.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return comments.sort((a, b) => b.likeCount - a.likeCount || new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getArticleCommentSummary(articleId) {
    const id = parseInt(articleId, 10);
    if (!id) return { count: 0 };
    if (isPostgres) {
      const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS count FROM article_comments WHERE article_id=$1 AND status='visible'",
        [id]
      );
      return { count: rows[0]?.count || 0 };
    }
    const lowdb = getLowdb();
    return { count: (lowdb.data.articleComments || []).filter(c => c.articleId === id && c.status === 'visible').length };
  },

  async createArticleComment(articleId, publicUserId, body) {
    const id = parseInt(articleId, 10);
    const readerId = parseInt(publicUserId, 10);
    const cleanBody = String(body || '').trim().slice(0, 1000);
    if (!id || !readerId || cleanBody.length < 1) return null;
    if (isPostgres) {
      const { rows } = await pool.query(`
        INSERT INTO article_comments (article_id, public_user_id, body, status)
        VALUES ($1,$2,$3,'visible') RETURNING *
      `, [id, readerId, cleanBody]);
      return rows[0] ? pgToArticleComment(rows[0]) : null;
    }
    const lowdb = getLowdb();
    lowdb.data.articleComments ||= [];
    const comment = {
      id: Math.max(0, ...lowdb.data.articleComments.map(c => c.id)) + 1,
      articleId: id,
      publicUserId: readerId,
      body: cleanBody,
      status: 'visible',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    lowdb.data.articleComments.push(comment);
    lowdb.write();
    return comment;
  },

  async deleteOwnArticleComment(commentId, publicUserId) {
    const id = parseInt(commentId, 10);
    const readerId = parseInt(publicUserId, 10);
    if (!id || !readerId) return null;
    if (isPostgres) {
      const { rows } = await pool.query(`
        UPDATE article_comments
        SET status='deleted', updated_at=NOW()
        WHERE id=$1 AND public_user_id=$2
        RETURNING article_id
      `, [id, readerId]);
      return rows[0]?.article_id || null;
    }
    const lowdb = getLowdb();
    const comment = (lowdb.data.articleComments || []).find(c => c.id === id && c.publicUserId === readerId);
    if (!comment) return null;
    comment.status = 'deleted';
    comment.updatedAt = new Date().toISOString();
    lowdb.write();
    return comment.articleId;
  },

  async toggleArticleCommentLike(commentId, publicUserId) {
    const id = parseInt(commentId, 10);
    const readerId = parseInt(publicUserId, 10);
    if (!id || !readerId) return null;
    if (isPostgres) {
      const existing = await pool.query(
        'SELECT 1 FROM article_comment_likes WHERE comment_id=$1 AND public_user_id=$2',
        [id, readerId]
      );
      if (existing.rows.length) {
        await pool.query('DELETE FROM article_comment_likes WHERE comment_id=$1 AND public_user_id=$2', [id, readerId]);
      } else {
        await pool.query(
          'INSERT INTO article_comment_likes (comment_id, public_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, readerId]
        );
      }
      const { rows } = await pool.query('SELECT article_id FROM article_comments WHERE id=$1', [id]);
      return rows[0]?.article_id || null;
    }
    const lowdb = getLowdb();
    lowdb.data.articleCommentLikes ||= [];
    const idx = lowdb.data.articleCommentLikes.findIndex(l => l.commentId === id && l.publicUserId === readerId);
    if (idx >= 0) lowdb.data.articleCommentLikes.splice(idx, 1);
    else lowdb.data.articleCommentLikes.push({ commentId: id, publicUserId: readerId, createdAt: new Date().toISOString() });
    lowdb.write();
    return (lowdb.data.articleComments || []).find(c => c.id === id)?.articleId || null;
  },

  async getAllArticleComments() {
    if (isPostgres) {
      const { rows } = await pool.query(`
        SELECT c.*, pu.name, pu.email, a.title AS article_title, a.slug AS article_slug,
          COUNT(cl.public_user_id)::int AS like_count
        FROM article_comments c
        JOIN public_users pu ON pu.id = c.public_user_id
        JOIN articles a ON a.id = c.article_id
        LEFT JOIN article_comment_likes cl ON cl.comment_id = c.id
        WHERE c.status = 'visible'
        GROUP BY c.id, pu.name, pu.email, a.title, a.slug
        ORDER BY c.created_at DESC
      `);
      return rows.map(pgToArticleComment);
    }
    const lowdb = getLowdb();
    return (lowdb.data.articleComments || [])
      .filter(c => c.status === 'visible')
      .map(c => {
        const user = (lowdb.data.publicUsers || []).find(u => u.id === c.publicUserId);
        const article = (lowdb.data.articles || []).find(a => a.id === c.articleId);
        return {
          ...c,
          userName: user?.name || user?.email || 'Reader',
          userEmail: user?.email || '',
          articleTitle: article?.title || 'Article',
          articleSlug: article?.slug || '',
          likeCount: (lowdb.data.articleCommentLikes || []).filter(l => l.commentId === c.id).length
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async adminDeleteArticleComment(commentId) {
    const id = parseInt(commentId, 10);
    if (!id) return;
    if (isPostgres) {
      await pool.query("UPDATE article_comments SET status='deleted', updated_at=NOW() WHERE id=$1", [id]);
      return;
    }
    const lowdb = getLowdb();
    const comment = (lowdb.data.articleComments || []).find(c => c.id === id);
    if (comment) {
      comment.status = 'deleted';
      comment.updatedAt = new Date().toISOString();
      lowdb.write();
    }
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
    authorVerified: row.author_verified !== false,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function pgToUser(row) {
  return {
    id: row.id, username: row.username, password: row.password,
    name: row.name, role: row.role, bio: row.bio || '',
    avatar: row.avatar || '',
    location: row.location || '',
    beat: row.beat || '',
    websiteUrl: row.website_url || '',
    twitterUrl: row.twitter_url || '',
    instagramUrl: row.instagram_url || '',
    youtubeUrl: row.youtube_url || '',
    isVerified: row.is_verified !== false,
    createdAt: row.created_at
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
    avatar: row.avatar || '',
    verificationToken: row.verification_token,
    verificationExpires: row.verification_expires,
    otpHash: row.otp_hash,
    otpExpires: row.otp_expires,
    otpAttempts: row.otp_attempts || 0,
    createdAt: row.created_at
  };
}

function pgToJournalistApplication(row) {
  return {
    id: row.id,
    publicUserId: row.public_user_id,
    authorId: row.author_id,
    name: row.name,
    email: row.email,
    location: row.location || '',
    beat: row.beat || '',
    bio: row.bio || '',
    experience: row.experience || '',
    portfolioUrl: row.portfolio_url || '',
    socialLinks: row.social_links || '',
    samplePitch: row.sample_pitch || '',
    status: row.status || 'pending',
    reviewNote: row.review_note || '',
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    publicUserAvatar: row.public_user_avatar || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function pgToNotification(row) {
  return {
    id: row.id,
    publicUserId: row.public_user_id,
    type: row.type,
    title: row.title,
    body: row.body || '',
    url: row.url || '',
    dedupeKey: row.dedupe_key || '',
    readAt: row.read_at,
    createdAt: row.created_at
  };
}

function pgToVideo(row) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description || '',
    category: row.category || '',
    videoUrl: row.video_url,
    author: row.author,
    authorId: row.author_id,
    status: row.status,
    views: row.views || 0,
    authorAvatar: row.author_avatar || '',
    authorBio: row.author_bio || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function pgToArticleComment(row) {
  return {
    id: row.id,
    articleId: row.article_id,
    publicUserId: row.public_user_id,
    body: row.body,
    status: row.status,
    userName: row.name || row.email || 'Reader',
    userEmail: row.email || '',
    articleTitle: row.article_title || '',
    articleSlug: row.article_slug || '',
    likeCount: row.like_count || 0,
    likedByMe: !!row.liked_by_me,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
  _lowdb.data.videos ||= [];
  _lowdb.data.articleLikes ||= [];
  _lowdb.data.articleComments ||= [];
  _lowdb.data.articleCommentLikes ||= [];
  _lowdb.data.journalistApplications ||= [];
  _lowdb.data.notifications ||= [];
  _lowdb.data.users ||= [];
  _lowdb.data.users.forEach(user => {
    user.location ||= '';
    user.beat ||= '';
    user.websiteUrl ||= '';
    user.twitterUrl ||= '';
    user.instagramUrl ||= '';
    user.youtubeUrl ||= '';
    user.isVerified = user.isVerified !== undefined ? !!user.isVerified : true;
  });
  _lowdb.data.publicUsers.forEach(user => {
    user.username ||= '';
    user.setupComplete = user.setupComplete !== undefined ? user.setupComplete : !!user.password;
    user.authProvider ||= 'email';
    user.avatar ||= '';
    user.otpAttempts ||= 0;
  });
  if (!_lowdb.data.users?.length) {
    if (isProduction && !process.env.ADMIN_PASSWORD_HASH) {
      throw new Error('ADMIN_PASSWORD_HASH must be set before creating the first admin user in production');
    }
    _lowdb.data.users = [{ id:1, username:'admin', password: process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync('admin123',10), name:'Admin', role:'admin', bio:'', avatar:'', location:'', beat:'Newsroom', websiteUrl:'', twitterUrl:'', instagramUrl:'', youtubeUrl:'', isVerified:true, createdAt:new Date().toISOString() }];
    _lowdb.write();
  }
  if (!_lowdb.data.articles?.length) {
    _lowdb.data.articles = [{ id:1, title:'Welcome to The News Room', slug:'welcome-to-the-news-room', category:'World News', excerpt:'Independent journalism.', content:'<p>Welcome to <strong>The News Room</strong>.</p>', author:'Admin', authorId:1, status:'published', featured:true, image:'', views:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }];
    _lowdb.write();
  }
  console.log('✅ Local lowdb ready');
}

module.exports = db;
