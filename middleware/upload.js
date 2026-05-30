const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Use Cloudinary if credentials are set, otherwise save locally
const useCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

let upload;

if (useCloudinary) {
  const cloudinary = require('cloudinary').v2;
  const { CloudinaryStorage } = require('multer-storage-cloudinary');

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  const storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: 'thenewsroom',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }]
    }
  });

  upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
  console.log('✅ Cloudinary upload enabled');

} else {
  // Local storage fallback (for local dev)
  const uploadDir = path.join(__dirname, '../public/uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
  });

  upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
  console.log('⚠️  Local upload (images will reset on Render restart)');
}

// Helper to get the URL from an uploaded file
function getFileUrl(file) {
  if (!file) return null;
  if (useCloudinary) {
    // Log file object so we can debug what Cloudinary returns
    console.log('Cloudinary file object:', JSON.stringify(file));
    return file.secure_url || file.path || file.url || null;
  }
  return '/uploads/' + file.filename; // Local
}

module.exports = { upload, getFileUrl };
