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

function validUsername(username) {
  return /^[a-z0-9_]{3,24}$/.test(String(username || '').trim().toLowerCase());
}

function createOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp || '')).digest('hex');
}

async function sendOtpEmail(email, otp) {
  if (process.env.RESEND_API_KEY) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.AUTH_EMAIL_FROM || 'The News Room <onboarding@resend.dev>',
        to: email,
        subject: 'Your The News Room verification code',
        text: `Your The News Room OTP is ${otp}. It expires in 10 minutes.`
      })
    });
    if (!response.ok) throw new Error('Could not send OTP email');
    return;
  }
  console.log(`OTP for ${email}: ${otp}`);
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

    if (!validEmail(email)) {
      return res.status(400).render('register', authViewData({ error: 'Please enter a valid email address', form: { email } }));
    }

    const existing = await db.getPublicUserByEmail(email);
    if (existing?.setupComplete) {
      return res.status(409).render('register', authViewData({ error: 'An account already exists for this email. Please sign in.', form: { email } }));
    }

    const otp = createOtp();
    await db.createOrUpdatePublicUserOtp(email, hashOtp(otp), new Date(Date.now() + 10 * 60 * 1000).toISOString());
    await sendOtpEmail(email, otp);
    res.render('verify-otp', authViewData({
      email,
      error: null,
      devOtp: process.env.NODE_ENV !== 'production' || process.env.SHOW_VERIFICATION_LINK === 'true' ? otp : null
    }));
  } catch(err) {
    console.error('Register user error:', err);
    res.status(500).render('register', authViewData({ error: 'Could not send OTP. Please try again.', form: req.body || {} }));
  }
});

router.post('/verify-otp', csrfProtection, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || '').trim();
  const user = await db.verifyPublicUserOtp(email, otp);
  if (!user) {
    return res.status(400).render('verify-otp', authViewData({ email, error: 'Invalid or expired OTP. Please request a new code.', devOtp: null }));
  }
  setPublicUserCookie(res, user);
  res.redirect('/setup-account');
});

router.get('/setup-account', requirePublicUser, (req, res) => {
  if (req.publicUser.setupComplete) return res.redirect('/account');
  res.render('setup-account', authViewData({ user: req.publicUser, error: null, form: {} }));
});

router.post('/setup-account', requirePublicUser, csrfProtection, async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const password = req.body.password || '';
  if (!validUsername(username)) {
    return res.status(400).render('setup-account', authViewData({ user: req.publicUser, error: 'User ID must be 3-24 characters using letters, numbers, or underscore.', form: { username, name } }));
  }
  if (!name || name.length < 2) {
    return res.status(400).render('setup-account', authViewData({ user: req.publicUser, error: 'Please enter your display name.', form: { username, name } }));
  }
  if (!strongPassword(password)) {
    return res.status(400).render('setup-account', authViewData({ user: req.publicUser, error: 'Password must be at least 10 characters.', form: { username, name } }));
  }
  const existing = await db.getPublicUserByUsername(username);
  if (existing && existing.id !== req.publicUser.id) {
    return res.status(409).render('setup-account', authViewData({ user: req.publicUser, error: 'That user ID is already taken.', form: { username, name } }));
  }
  const updated = await db.completePublicUserSetup(req.publicUser.id, {
    username,
    name,
    password: bcrypt.hashSync(password, 10)
  });
  setPublicUserCookie(res, updated);
  res.redirect('/account');
});

router.get('/login', (req, res) => {
  if (req.publicUser) return res.redirect('/account');
  const googleMessage = req.query.google === 'unavailable'
    ? 'Google login is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.'
    : req.query.google === 'failed'
      ? 'Google login failed. Please try again or use email login.'
      : null;
  res.render('login', authViewData({ error: null, googleMessage, form: {} }));
});

router.post('/login', csrfProtection, loginRateLimiter, async (req, res) => {
  const login = String(req.body.login || req.body.email || '').trim();
  const password = req.body.password || '';
  const user = await db.getPublicUserByLogin(login);
  if (!user || !user.setupComplete || !user.password || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).render('login', authViewData({ error: 'Invalid user ID/email or password', form: { login } }));
  }
  setPublicUserCookie(res, user);
  res.redirect('/account');
});

router.get('/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.redirect('/login?google=unavailable');
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('googleOAuthState', state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60 * 1000 });
  const redirectUri = `${process.env.SITE_URL || `${req.protocol}://${req.get('host')}`}/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

router.get('/auth/google/callback', async (req, res) => {
  try {
    if (!req.query.code || req.query.state !== req.cookies?.googleOAuthState) return res.redirect('/login?google=failed');
    res.clearCookie('googleOAuthState');
    const redirectUri = `${process.env.SITE_URL || `${req.protocol}://${req.get('host')}`}/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    if (!tokenResponse.ok) return res.redirect('/login?google=failed');
    const tokenData = await tokenResponse.json();
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!profileResponse.ok) return res.redirect('/login?google=failed');
    const profile = await profileResponse.json();
    const user = await db.createOrUpdateGooglePublicUser({
      email: profile.email,
      name: profile.name,
      googleId: profile.sub
    });
    setPublicUserCookie(res, user);
    res.redirect('/account');
  } catch(err) {
    console.error('Google login error:', err);
    res.redirect('/login?google=failed');
  }
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

router.get('/account', requirePublicUser, async (req, res) => {
  if (!req.publicUser.setupComplete) return res.redirect('/setup-account');
  const followedAuthors = await db.getFollowedAuthors(req.publicUser.id);
  res.render('account', authViewData({
    user: req.publicUser,
    followedAuthors,
    success: req.query.resent === '1' ? 'A new verification link was generated.' : req.query.profile === 'updated' ? 'Profile updated.' : null,
    warning: req.query.verify === 'required' ? 'Please verify your email before using that feature.' : req.query.profile === 'invalid' ? 'Please enter a valid display name.' : null
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

router.post('/account/profile', requirePublicUser, csrfProtection, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length < 2) return res.redirect('/account?profile=invalid');
  await db.updatePublicUserProfile(req.publicUser.id, { name });
  res.redirect('/account?profile=updated');
});

module.exports = router;
