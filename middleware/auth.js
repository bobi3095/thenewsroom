const jwt = require('jsonwebtoken');
const { cookieOptions } = require('./security');
const isProduction = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET && isProduction) {
  throw new Error('JWT_SECRET must be set in production');
}

if (!JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set. Using an insecure development-only secret.');
}

const ACTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-change-me';

function authMiddleware(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.redirect('/admin/login');
  try {
    req.user = jwt.verify(token, ACTIVE_JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token', cookieOptions);
    return res.redirect('/admin/login');
  }
}

function apiAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, ACTIVE_JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.redirect('/admin');
  next();
}

module.exports = { authMiddleware, apiAuth, adminOnly, JWT_SECRET: ACTIVE_JWT_SECRET };
