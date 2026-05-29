const express = require('express');
const router = express.Router();
const toolsController = require('../controllers/toolsController');
const multer = require('multer');

// Use memory storage because we don't want to save the original file permanently
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only audio files are allowed.'), false);
    }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB limit

router.get('/stem-cost', toolsController.getStemSplitCost);
router.post('/split-stem', upload.single('track'), toolsController.splitStem);

module.exports = router;