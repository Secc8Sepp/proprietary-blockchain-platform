const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');

const router = express.Router();

// IMPORTANT: This should be the absolute path to your Liquidsoap music directory.
// I'm using the path from your documentation. Please verify this is correct for your server environment.
const RADIO_MUSIC_DIR = '/home/nullsecc/vod-radio/music';

// Ensure the submission directory exists
const uploadDir = path.join(__dirname, '../pending-submissions');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({ storage: storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB limit

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

// --- ADMIN ROUTES ---

// GET /api/radio/submissions - List all pending submissions
router.get('/submissions', async (req, res) => {
    try {
        const files = await fs.readdir(uploadDir);
        const submissions = [];
        for (const file of files) {
            if (path.extname(file) === '.json') {
                const metadata = JSON.parse(await fs.readFile(path.join(uploadDir, file), 'utf8'));
                const audioFilename = file.replace('.json', '.mp3');
                if (files.includes(audioFilename)) {
                    submissions.push({
                        id: audioFilename,
                        ...metadata
                    });
                }
            }
        }
        res.json(submissions.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)));
    } catch (error) {
        console.error('[SUBMISSION] Error listing submissions:', error);
        res.status(500).json({ success: false, message: 'Failed to list submissions.' });
    }
});

// POST /api/radio/submissions/:id/approve - Approve a track
router.post('/submissions/:id/approve', async (req, res) => {
    const { id } = req.params;
    const sourcePath = path.join(uploadDir, id);
    const destPath = path.join(RADIO_MUSIC_DIR, req.body.newFilename); // Use a clean filename
    const metaPath = sourcePath.replace('.mp3', '.json');

    try {
        await fs.move(sourcePath, destPath);
        await fs.remove(metaPath);
        console.log(`[SUBMISSION] Approved: ${id} -> ${destPath}`);
        res.json({ success: true, message: 'Track approved and moved to radio library.' });
    } catch (error) {
        console.error(`[SUBMISSION] Approve Error for ${id}:`, error);
        res.status(500).json({ success: false, message: 'Failed to approve track.' });
    }
});

// POST /api/radio/submissions/:id/reject - Reject a track
router.post('/submissions/:id/reject', async (req, res) => {
    const { id } = req.params;
    const sourcePath = path.join(uploadDir, id);
    const metaPath = sourcePath.replace('.mp3', '.json');

    try {
        await fs.remove(sourcePath);
        await fs.remove(metaPath);
        console.log(`[SUBMISSION] Rejected: ${id}`);
        res.json({ success: true, message: 'Track rejected and deleted.' });
    } catch (error) {
        console.error(`[SUBMISSION] Reject Error for ${id}:`, error);
        res.status(500).json({ success: false, message: 'Failed to reject track.' });
    }
});

module.exports = router;