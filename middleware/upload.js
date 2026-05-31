const multer = require('multer');
const path = require('path');
const fs = require('fs');

const useCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

// Always use memory storage — we handle saving ourselves
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Accept all image mimetypes broadly
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed'));
    }
  }
});

// Call this after multer to actually save the file
async function saveFile(file) {
  if (!file) return null;

  if (useCloudinary) {
    // Upload directly using Cloudinary SDK v2
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'thenewsroom',
          resource_type: 'image',
          transformation: [{ width: 1200, crop: 'limit', quality: 'auto:good' }]
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary error:', error);
            return reject(error);
          }
          console.log('✅ Cloudinary upload success:', result.secure_url);
          resolve(result.secure_url);
        }
      );
      // Pipe the buffer directly
      const streamifier = require('streamifier');
      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });

  } else {
    // Save locally for dev
    const uploadDir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filename = Date.now() + path.extname(file.originalname);
    const filepath = path.join(uploadDir, filename);
    fs.writeFileSync(filepath, file.buffer);
    console.log('💾 Local upload:', filename);
    return '/uploads/' + filename;
  }
}

if (useCloudinary) {
  console.log('✅ Cloudinary upload enabled');
} else {
  console.log('⚠️  Local upload (images will reset on Render restart)');
}

// Delete a file from Cloudinary by its URL
async function deleteFile(url) {
  if (!url || !useCloudinary) return;
  try {
    // Extract public_id from Cloudinary URL
    // URL format: https://res.cloudinary.com/cloud/image/upload/v123/thenewsroom/filename.jpg
    const matches = url.match(/thenewsroom\/([^.]+)/);
    if (!matches) return;
    const publicId = 'thenewsroom/' + matches[1];
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
    const result = await cloudinary.uploader.destroy(publicId);
    console.log('🗑️  Cloudinary delete:', publicId, result.result);
  } catch(err) {
    console.error('Cloudinary delete error:', err.message);
  }
}

module.exports = { upload, saveFile, deleteFile };
