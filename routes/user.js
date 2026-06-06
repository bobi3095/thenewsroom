const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { csrfProtection, createLoginRateLimiter } = require('../middleware/security');
const {
  requirePublicUser,
  setPublicUserCookie,
  clearPublicUserCookie
} = require('../middleware/publicAuth');

const router = express.Router();

const categories = db.categories;
const navCategories = ['Politics', 'World News', 'India', 'Uncovered', 'Opinion'];
const moreCategories = ['Data', 'Sports', 'Law', 'Govt Schemes', 'Education', 'Technology'];

function authViewData(extra = {}) {
  return {
    categories,
    navCategories,
    moreCategories,
    page: 'auth',
    ...extra
  };
}

const loginRateLimiter = createLoginRateLimiter({
  view: 'login',
  viewData: authViewData({ form: {} })
});

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function strongPassword(password) {
  return typeof password === 'string' && password.length >= 10;
}

function createVerificationToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return { token, tokenHash, expiresAt };
}

function verificationUrl(req, token) {
  const baseUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl.replace(/\/$/, '')}/verify/${token}`;
}

function shouldShowVerificationLink() {
  return process.env.NODE_ENV !== 'production' || process.env.SHOW_VERIFICATION_LINK === 'true';
}

function logVerificationLink(email, url) {
  console.log(`Verification link for ${email}: ${url}`);
}

router.get('/register', (req, res) => {
  if (req.publicUser) return res.redirect('/account');
  res.render('register', authViewData({ error: null, form: {} }));
});

router.post('/register', csrfProtection, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const name = String(req.body.name || '').trim();
    const password = req.body.password;

    if (!name || name.length < 2) {
      return res.status(400).render('register', authViewData({ error: 'Please enter your name', form: { email, name } }));
    }
    if (!validEmail(email)) {
      return res.status(400).render('register', authViewData({ error: 'Please enter a valid email address', form: { email, name } }));
    }
    if (!strongPassword(password)) {
      return res.status(400).render('register', authViewData({ error: 'Password must be at least 10 characters', form: { email, name } }));
    }

    const existing = await db.getPublicUserByEmail(email);
    if (existing) {
      return res.status(409).render('register', authViewData({ error: 'An account already exists for this email', form: { email, name } }));
    }

    const verification = createVerificationToken();
    const user = await db.createPublicUser({
      email,
      name,
      password: bcrypt.hashSync(password, 10),
      verificationToken: verification.tokenHash,
      verificationExpires: verification.expiresAt
    });
    setPublicUserCookie(res, user);

    const url = verificationUrl(req, verification.token);
    logVerificationLink(email, url);
    res.render('verify-sent', authViewData({
      email,
      verificationUrl: shouldShowVerificationLink() ? url : null
    }));
  } catch(err) {
    console.error('Register user error:', err);
    res.status(500).render('register', authViewData({ error: 'Could not create account. Please try again.', form: req.body || {} }));
  }
});

router.get('/login', (req, res) => {
  if (req.publicUser) return res.redirect('/account');
  res.render('login', authViewData({ error: null, form: {} }));
});

router.post('/login', csrfProtection, loginRateLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = req.body.password || '';
  const user = await db.getPublicUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).render('login', authViewData({ error: 'Invalid email or password', form: { email } }));
  }
  setPublicUserCookie(res, user);
  res.redirect('/account');
});

router.get('/logout', (req, res) => {
  clearPublicUserCookie(res);
  res.redirect('/');
});

router.get('/verify/:token', async (req, res) => {
  const user = await db.getPublicUserByVerificationToken(req.params.token);
  if (!user) {
    return res.status(400).render('verify-result', authViewData({
      success: false,
      title: 'Verification link expired',
      message: 'This verification link is invalid or expired. Sign in and request a new verification link.'
    }));
  }
  const verifiedUser = await db.verifyPublicUser(user.id);
  setPublicUserCookie(res, verifiedUser);
  res.render('verify-result', authViewData({
    success: true,
    title: 'Email verified',
    message: 'Your account is verified. You can now use reader features that require a verified email.'
  }));
});

router.get('/account', requirePublicUser, (req, res) => {
  res.render('account', authViewData({
    user: req.publicUser,
    success: req.query.resent === '1' ? 'A new verification link was generated.' : null,
    warning: req.query.verify === 'required' ? 'Please verify your email before using that feature.' : null
  }));
});

router.post('/account/resend-verification', requirePublicUser, csrfProtection, async (req, res) => {
  if (req.publicUser.verified) return res.redirect('/account');
  const verification = createVerificationToken();
  await db.setPublicUserVerificationToken(req.publicUser.id, verification.tokenHash, verification.expiresAt);
  const url = verificationUrl(req, verification.token);
  logVerificationLink(req.publicUser.email, url);
  res.render('verify-sent', authViewData({
    email: req.publicUser.email,
    verificationUrl: shouldShowVerificationLink() ? url : null
  }));
});

module.exports = router;
