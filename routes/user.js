const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { csrfProtection } = require('../middleware/security');
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

router.get('/register', (req, res) => res.redirect('/login'));
router.post('/register', (req, res) => res.status(410).redirect('/login'));
router.post('/verify-otp', (req, res) => res.status(410).redirect('/login'));
router.get('/setup-account', requirePublicUser, (req, res) => res.redirect('/account'));
router.post('/setup-account', requirePublicUser, (req, res) => res.status(410).redirect('/account'));

router.get('/login', (req, res) => {
  if (req.publicUser) return res.redirect('/account');
  const googleMessage = req.query.google === 'unavailable'
    ? 'Google login is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.'
    : req.query.google === 'failed'
      ? 'Google login failed. Please try again.'
      : null;
  res.render('login', authViewData({ googleMessage }));
});
router.post('/login', (req, res) => res.status(405).redirect('/login'));

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
      googleId: profile.sub,
      avatar: profile.picture
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

router.get('/verify/:token', (req, res) => res.redirect('/login'));

router.get('/account', requirePublicUser, async (req, res) => {
  const followedAuthors = await db.getFollowedAuthors(req.publicUser.id);
  res.render('account', authViewData({
    user: req.publicUser,
    followedAuthors,
    success: req.query.profile === 'updated' ? 'Profile updated.' : null,
    warning: req.query.profile === 'invalid' ? 'Please enter a valid display name.' : null
  }));
});

router.post('/account/resend-verification', requirePublicUser, (req, res) => res.status(410).redirect('/account'));

router.post('/account/profile', requirePublicUser, csrfProtection, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length < 2) return res.redirect('/account?profile=invalid');
  await db.updatePublicUserProfile(req.publicUser.id, { name });
  res.redirect('/account?profile=updated');
});

module.exports = router;
