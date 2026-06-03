const blockchainService = require('../services/blockchainService');

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
}

module.exports = new ToolsController();