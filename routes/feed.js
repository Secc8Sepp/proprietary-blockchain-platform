const express = require('express');
const router = express.Router();
const feedController = require('../controllers/feedController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(process.cwd(), 'mock_ipfs');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
        cb(null, name);
    }
});

// SECURITY UPGRADE: Only allow specific MIME types (Images & Audio)
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', // Audio
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', // Visual Art/Avatars
        'video/mp4', 'video/webm', 'video/ogg', // Video
        'application/zip', 'application/x-zip-compressed', 'application/octet-stream', 'application/x-rar-compressed' // Project Files & Stems
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only Audio, Video, Archives, and Images are allowed.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 500 * 1024 * 1024 } // Increased to 500MB to support Project Files & Zipped Stems
});

router.get('/', feedController.getFeed);
router.post('/interact', feedController.submitInteraction);

router.post('/upload-file', (req, res) => {
    upload.single('mediaAsset')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            console.error("[UPLOAD ERROR] Multer:", err);
            return res.status(500).json({ error: 'Multer error: ' + err.message });
        } else if (err) {
            console.error("[UPLOAD ERROR] Server:", err);
            return res.status(400).json({ error: err.message }); // Sends the fileFilter error to UI
        }
        
        if (!req.file) {
            console.error("[UPLOAD ERROR] No file received.");
            return res.status(400).json({ error: 'No file received' });
        }
        
        console.log("[SUCCESS] File saved as:", req.file.filename);
        res.json({ fileHash: req.file.filename });
    });
});

module.exports = router;