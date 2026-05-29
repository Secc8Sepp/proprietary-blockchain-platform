const blockchainService = require('../services/blockchainService');
const profileService = require('../services/profileService');

// For performance and clarity, define the allowed actions in a Set.
const ALLOWED_SOCIAL_ACTIONS = new Set([
    'FOLLOW_USER',
    'UNFOLLOW_USER',
    'PROFILE_UPDATE',
    'THEME_UPDATE',
    'SET_TOP_8',
    'ADMIN_DELETE_USER'
]);

class SocialController {
    getProfileData(req, res) {
        try {
            const { publicKey } = req.query;
            if (!publicKey) return res.status(400).json({ error: "Missing public key." });
            return res.status(200).json(profileService.getProfile(publicKey));
        } catch (error) { return res.status(500).json({ error: error.message }); }
    }

    getMarketplace(req, res) {
        try { return res.status(200).json(profileService.getMarketData()); }
        catch (error) { return res.status(500).json({ error: error.message }); }
    }

    handleAction(req, res) {
        try {
            const { sender, receiver, type, data, timestamp, signature } = req.body;

            // For definitive debugging, log the exact action type received by the server.
            console.log(`[SocialController] Handling action of type: "${type}"`);

            // Refactored validation for improved robustness.
            if (!ALLOWED_SOCIAL_ACTIONS.has(type)) {
                return res.status(400).json({ error: "Invalid social action block." });
            }
            const activeBlock = blockchainService.addTransaction({ sender, receiver, type, data, timestamp, signature });
            req.app.get('socketio').emit('blockchain_update', { type, transaction: activeBlock.transactions[0] });
            return res.status(201).json({ message: "Action broadcasted", block: activeBlock });
        } catch (error) { return res.status(400).json({ error: error.message }); }
    }
}
module.exports = new SocialController();