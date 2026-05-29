const blockchainService = require('../services/blockchainService');
const profileService = require('../services/profileService');

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
 
            // Whitelist actions that are explicitly for identity and social graph management.
            // This provides a security layer and ensures this controller only handles its designated tasks.
            const validSocialActions = ['PROFILE_UPDATE', 'THEME_UPDATE', 'SET_TOP_8', 'FOLLOW_USER', 'ADMIN_MINT', 'ADMIN_DELETE_USER'];
            if (!validSocialActions.includes(type)) {
                return res.status(400).json({ error: `Invalid action type for social controller: ${type}` });
            }

            const activeBlock = blockchainService.addTransaction({ sender, receiver, type, data, timestamp, signature });

            req.app.get('socketio').emit('blockchain_update', { type, transaction: activeBlock.transactions[0] });
            return res.status(201).json({ message: "Action broadcasted", block: activeBlock });
        } catch (error) {
            // The service layer will throw an error if the transaction is invalid.
            // This provides much more specific and useful error messages to the client.
            console.error(`[SocialController] Action failed for type "${req.body.type}":`, error.message);
            return res.status(400).json({ error: error.message });
        }
    }
}
module.exports = new SocialController();