const blockchainService = require('../services/blockchainService');
const profileService = require('../services/profileService');

class FeedController {
    getFeed(req, res) {
        try { return res.status(200).json(profileService.getFeedEngine()); } 
        catch (error) { return res.status(500).json({ error: error.message }); }
    }

    submitInteraction(req, res) {
        try {
            const { sender, receiver, type, data, timestamp, signature } = req.body;
            // Whitelist all market and media transaction types
            if (!['SONG_UPLOAD', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST', 'STORY_POST', 'TEXT_POST', 'LIKE_IMAGE', 'LIKE_POST', 'REPLY_POST', 'DELETE_POST', 'STREAM_COMPLETED', 'BUY_SONG_SHARE', 'TRANSFER_COIN', 'SHOUTBOX_POST', 'CREATE_COMMISSION', 'FULFILL_COMMISSION', 'CREATE_BOUNTY', 'SUBMIT_BOUNTY', 'AWARD_BOUNTY', 'LIST_ITEM', 'BUY_ITEM', 'BRIDGE_WITHDRAW', 'BRIDGE_DEPOSIT', 'ADMIN_MINT', 'REQUEST_SONG_SHARE', 'ACCEPT_SHARE_REQUEST', 'DECLINE_SHARE_REQUEST', 'VOTE_HOT_OR_NOT', 'SUBMIT_HOT_OR_NOT'].includes(type)) {
                return res.status(400).json({ error: "Invalid feed operation profile." });
            }
            const activeBlock = blockchainService.addTransaction({ sender, receiver, type, data, timestamp, signature });
            req.app.get('socketio').emit('blockchain_update', { type, transaction: activeBlock.transactions[0] });
            
            // Broadcast to other Full Nodes (Dedicated Servers/PCs)
            const peers = req.app.get('peers') || [];
            if (globalThis.fetch) {
                peers.forEach(peerUrl => {
                    fetch(`${peerUrl}/api/network/block`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ block: activeBlock })
                    }).catch(e => {}); // Ignore if peer went offline
                });
            }

            return res.status(201).json({ message: "Block broadcasted", block: activeBlock });
        } catch (error) { return res.status(400).json({ error: error.message }); }
    }
}
module.exports = new FeedController();