# The News Room — Deployment Guide

## 🚀 Quick Start (Local)

```bash
npm install
npm start
```
Visit: http://localhost:3000  
Admin: http://localhost:3000/admin  
Login: `admin` / `admin123`

---

## 🌐 Deploy to the Internet (Free Options)

### Option 1: Railway.app (Recommended — Easiest)

1. **Create account** at https://railway.app
2. **Install Railway CLI:**
   ```bash
   npm install -g @railway/cli
   railway login
   ```
3. **Deploy:**
   ```bash
   cd thenewsroom
   railway init
   railway up
   ```
4. Railway gives you a live URL like `https://thenewsroom-production.up.railway.app`

**Environment Variables to set in Railway dashboard:**
```
JWT_SECRET=your-strong-random-secret-here
NODE_ENV=production
PORT=3000
```

---

### Option 2: Render.com (Free tier available)

1. Push your code to GitHub first:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/thenewsroom.git
   git push -u origin main
   ```

2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Add Environment Variables:
   - `JWT_SECRET` = (generate a random string)
   - `NODE_ENV` = `production`

---

### Option 3: Fly.io (Free tier)

1. Install flyctl: https://fly.io/docs/getting-started/installing-flyctl/
2. Login: `flyctl auth login`
3. Create a `fly.toml` in project root:
   ```toml
   app = "thenewsroom"
   
   [env]
     NODE_ENV = "production"
     PORT = "8080"
   
   [[services]]
     internal_port = 8080
     protocol = "tcp"
   
     [[services.ports]]
       port = 80
       handlers = ["http"]
     
     [[services.ports]]
       port = 443
       handlers = ["tls", "http"]
   ```
4. Deploy: `flyctl launch` then `flyctl deploy`

---

### Option 4: VPS (DigitalOcean / Linode / Hetzner)

Best for full control and custom domain.

1. **Get a VPS** ($4-6/month at Hetzner or DigitalOcean)
2. **SSH in** and install Node.js:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs nginx
   ```
3. **Upload your files** (use `scp` or `git clone`)
4. **Install PM2** (keeps your app running):
   ```bash
   npm install -g pm2
   pm2 start server.js --name thenewsroom
   pm2 save
   pm2 startup
   ```
5. **Configure Nginx** as reverse proxy:
   ```nginx
   server {
     listen 80;
     server_name yournewsroom.com www.yournewsroom.com;
     
     location / {
       proxy_pass http://localhost:3000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection 'upgrade';
       proxy_set_header Host $host;
       proxy_cache_bypass $http_upgrade;
     }
   }
   ```
6. **Add SSL** (free with Let's Encrypt):
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d yournewsroom.com
   ```

---

## 🔒 Security Checklist Before Going Live

- [ ] Change `JWT_SECRET` in `.env` to a strong random string (32+ chars)
- [ ] Change admin password via the DB or add a password change page
- [ ] Set `NODE_ENV=production`
- [ ] Keep `data/db.json` backed up (this is your database)
- [ ] Consider moving uploads to a cloud storage (Cloudinary, S3) for persistence on cloud platforms

---

## 📁 Project Structure

```
thenewsroom/
├── server.js          # Main app entry point
├── db.js              # Database (lowdb JSON)
├── data/
│   └── db.json        # Your articles & users (BACK THIS UP!)
├── routes/
│   ├── public.js      # Homepage, articles, categories, search
│   └── admin.js       # Admin panel routes
├── middleware/
│   └── auth.js        # JWT authentication
├── views/
│   ├── home.html      # Homepage
│   ├── article.html   # Article page
│   ├── category.html  # Category listing
│   ├── search.html    # Search results
│   ├── 404.html       # Error page
│   ├── partials/      # Header & footer
│   └── admin/         # Admin panel views
└── public/
    ├── css/style.css  # Public styles
    ├── css/admin.css  # Admin styles
    ├── js/main.js     # Public JS
    └── uploads/       # Uploaded images
```

---

## 🛠 Adding Features Later

### Custom Domain
After deploying to Railway/Render, go to their settings → Custom Domain → enter your domain → update DNS records.

### Backup
Periodically download `data/db.json` — it contains all your articles and users.

### Change Admin Password
Edit `db.js` temporarily to set a new bcrypt hash, or add a settings page.
