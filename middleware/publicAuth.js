const jwt = require('jsonwebtoken');
const db = require('../db');
const { cookieOptions } = require('./security');
const { JWT_SECRET } = require('./auth');

const USER_COOKIE = 'userToken';

function signPublicUser(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      username: user.username || '',
      name: user.name,
      verified: !!user.verified,
      setupComplete: !!user.setupComplete,
      type: 'public'
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

async function publicUserLocals(req, res, next) {
  res.locals.currentUser = null;
  const token = req.cookies?.[USER_COOKIE];
  if (!token) return next();

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'public') throw new Error('Invalid user token type');
    const user = await db.getPublicUserById(payload.id);
    if (!user) throw new Error('User not found');
    req.publicUser = user;
    res.locals.currentUser = {
      id: user.id,
      email: user.email,
      username: user.username || '',
      name: user.name,
      avatar: user.avatar || '',
      verified: !!user.verified,
      setupComplete: !!user.setupComplete
    };
  } catch {
    res.clearCookie(USER_COOKIE, cookieOptions);
  }
  next();
}

function requirePublicUser(req, res, next) {
  if (!req.publicUser) return res.redirect('/login');
  next();
}

function requireVerifiedPublicUser(req, res, next) {
  if (!req.publicUser) return res.redirect('/login');
  if (!req.publicUser.verified) return res.redirect('/account?verify=required');
  next();
}

function setPublicUserCookie(res, user) {
  res.cookie(USER_COOKIE, signPublicUser(user), {
    ...cookieOptions,
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function clearPublicUserCookie(res) {
  res.clearCookie(USER_COOKIE, cookieOptions);
}

module.exports = {
  USER_COOKIE,
  publicUserLocals,
  requirePublicUser,
  requireVerifiedPublicUser,
  setPublicUserCookie,
  clearPublicUserCookie,
  signPublicUser
};
