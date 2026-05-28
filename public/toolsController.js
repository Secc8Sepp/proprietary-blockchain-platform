const blockchainService = require('../services/blockchainService');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TMP_DIR = path.join(__dirname, '..', 'tmp');

class ToolsController {
    getStemSplitCost(req, res) {
        try {
            // We need the user's public key to calculate their personal usage cost
            const { publicKey } = req.query;
            if (!publicKey) {
                return res.status(400).json({ error: "Missing publicKey query parameter." });
            }
            const cost = blockchainService.calculateStemSplitCost(publicKey);
            return res.status(200).json({ cost });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    splitStem(req, res) {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file was uploaded.' });
        }

        // In a real application, this is where you would invoke a stem-splitting
        // library like Spleeter (https://github.com/deezer/spleeter).
        // For this demo, we will simulate the process by creating dummy files.

        console.log(`[STEMS] Simulating split for: ${req.file.originalname}`);

        const uniqueId = crypto.randomBytes(8).toString('hex');
        const stems = {
            vocals: `vocals_${uniqueId}.mp3`,
            drums: `drums_${uniqueId}.mp3`,
            bass: `bass_${uniqueId}.mp3`,
            melody: `melody_${uniqueId}.mp3`
        };

        const stemPaths = {};
        for (const [name, filename] of Object.entries(stems)) {
            const tempPath = path.join(TMP_DIR, filename);
            fs.writeFileSync(tempPath, `This is a dummy file for ${name} stem.`);
            stemPaths[name] = `/tmp/${filename}`; // The public-facing URL
            // Clean up the temporary file after 10 minutes
            setTimeout(() => fs.unlink(tempPath, () => {}), 10 * 60 * 1000);
        }

        res.status(200).json({ message: 'Splitting process simulated.', stems: stemPaths });
    }
}

module.exports = new ToolsController();