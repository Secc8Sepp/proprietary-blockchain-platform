const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Ensure the submission directory exists
const uploadDir = path.join(__dirname, '../pending-submissions');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Create a unique filename to prevent overwrites
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB limit

// The submission route
router.post('/submit-track', upload.single('track'), (req, res) => {
    const { artistName, trackTitle } = req.body;
    const trackFile = req.file;

    if (!artistName || !trackTitle || !trackFile) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    // Save metadata alongside the track
    const metadataPath = path.join(uploadDir, trackFile.filename.replace(path.extname(trackFile.filename), '.json'));
    const metadata = { artistName, trackTitle, originalFilename: trackFile.originalname, submittedAt: new Date() };
    
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    console.log(`[SUBMISSION] Received track "${trackTitle}" by ${artistName}. File: ${trackFile.filename}`);
    res.status(200).json({ success: true, message: 'Track submitted successfully for review!' });
});

module.exports = router;