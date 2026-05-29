const blockchainService = require('../services/blockchainService');
const profileService = require('../services/profileService');
const fs = require('fs');
const path = require('path');

const IPFS_DIR = path.join(__dirname, '..', 'mock_ipfs');

class FeedController {
    getFeed(req, res) {
        try { return res.status(200).json(profileService.getFeedEngine()); } 
        catch (error) { return res.status(500).json({ error: error.message }); }
    }

    submitInteraction(req, res) {
        try {
            let { sender, receiver, type, data, timestamp, signature } = req.body;
            type = (type || '').toString().trim().toUpperCase();
            console.log('[FeedController] submitInteraction payload:', { sender, receiver, type, data, timestamp, signature });
            // Whitelist all market and media transaction types
            const validTypes = ['SONG_UPLOAD', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST', 'STORY_POST', 'TEXT_POST', 'LIKE_IMAGE', 'LIKE_POST', 'REPLY_POST', 'DELETE_POST', 'STREAM_COMPLETED', 'BUY_SONG_SHARE', 'TRANSFER_COIN', 'SHOUTBOX_POST', 'CREATE_COMMISSION', 'FULFILL_COMMISSION', 'CREATE_BOUNTY', 'SUBMIT_BOUNTY', 'AWARD_BOUNTY', 'LIST_ITEM', 'BUY_ITEM', 'BRIDGE_WITHDRAW', 'BRIDGE_DEPOSIT', 'ADMIN_MINT', 'ADMIN_DELETE_USER', 'REQUEST_SONG_SHARE', 'ACCEPT_SHARE_REQUEST', 'DECLINE_SHARE_REQUEST', 'VOTE_HOT_OR_NOT', 'SUBMIT_HOT_OR_NOT', 'PURCHASE_ZINE_RIGHTS', 'EDIT_POST_METADATA', 'EDIT_SONG_METADATA', 'REPOST_POST', 'STEM_SPLIT'];
            if (!validTypes.includes(type)) {
                console.error(`[FeedController] Invalid feed operation type: ${type} (typeof ${typeof type})`);
                return res.status(400).json({ error: `Invalid feed operation profile: ${type}` });
            }
            const activeBlock = blockchainService.addTransaction({ sender, receiver, type, data, timestamp, signature });
            const io = req.app.get('socketio');
            io.emit('blockchain_update', { type, transaction: activeBlock.transactions[0] });

            // Skip notifications for admin operations
            if (['ADMIN_DELETE_USER', 'ADMIN_MINT'].includes(type)) {
                console.log(`[FeedController] Admin operation ${type} - skipping notifications`);
                return res.status(201).json({ message: "Admin action processed", block: activeBlock });
            }

            const sendPush = req.app.get('sendPushNotification');
            const getProfiles = req.app.get('getProfileDirectory');
            const socialGraph = profileService.getSocialGraph();
            const fromProfile = getProfiles ? (getProfiles()[sender] || { username: `Node_${sender.substring(0,6)}` }) : { username: `Node_${sender.substring(0,6)}` };

            // --- NEW UNIFIED NOTIFICATION SENDER ---
            const connectedNodes = req.app.get('connectedNodes');
            const sendNotification = (receiverAddress, payload) => {
                if (!receiverAddress || receiverAddress === '0x00') return;

                // 1. Send Web Push for background/offline users
                sendPush(receiverAddress, payload);

                // 2. Send Socket.io event for real-time in-app notifications
                if (connectedNodes && io) {
                    // Find socket ID for the given public key
                    const targetSocketId = Object.keys(connectedNodes).find(
                        id => connectedNodes[id].address === receiverAddress
                    );
                    if (targetSocketId) {
                        io.to(targetSocketId).emit('new_notification', payload);
                    }
                }
            };

            // --- NOTIFICATION ENGINE ---
            if (type === 'LIKE_POST') {
                sendNotification(receiver, { title: '🔥 Post Liked!', body: `${fromProfile.username} liked your post.` });
            } else if (type === 'LIKE_IMAGE') {
                sendNotification(receiver, { title: '🖼️ Image Liked!', body: `${fromProfile.username} liked your image.` });
            } else if (type === 'REPLY_POST') {
                sendNotification(receiver, { title: '💬 New Reply', body: `${fromProfile.username} replied to your post.` });
            } else if (type === 'SHOUTBOX_POST') {
                sendNotification(receiver, { title: '📢 New Shout!', body: `${fromProfile.username} posted on your shoutbox.` });
            } else if (type === 'BUY_ITEM') {
                sendNotification(receiver, { title: '💰 Item Sold!', body: `${fromProfile.username} purchased your item from the marketplace.` });
            } else if (['SONG_UPLOAD', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST'].includes(type)) {
                const followers = socialGraph.followers[sender] || [];
                const assetType = type.replace('_POST', '').replace('_UPLOAD', '').toLowerCase();
                const title = data.trackTitle || data.caption || `new ${assetType}`;
                followers.forEach(followerAddress => {
                    sendNotification(followerAddress, { title: 'New Mint from your Crew ⭐', body: `${fromProfile.username} just minted a new ${assetType}: "${title.substring(0, 40)}..."` });
                });
            } else if (type === 'CREATE_COMMISSION') {
                sendNotification(receiver, { title: 'New Commission Request 💼', body: `${fromProfile.username} sent you a commission request for ${data.amount} $VOD.` });
            } else if (type === 'FULFILL_COMMISSION') {
                const commissionBlock = blockchainService.getBlockByHash(data.commissionId);
                if (commissionBlock) {
                    const commissionTx = commissionBlock.transactions.find(t => t.type === 'CREATE_COMMISSION');
                    if (commissionTx) {
                        const originalBuyer = commissionTx.sender;
                        sendNotification(originalBuyer, { title: 'Commission Fulfilled! 📦', body: `${fromProfile.username} has delivered your commission.` });
                    }
                }
            } else if (type === 'SUBMIT_BOUNTY') {
                const bountyBlock = blockchainService.getBlockByHash(data.bountyId);
                if (bountyBlock) {
                    const bountyTx = bountyBlock.transactions.find(t => t.type === 'CREATE_BOUNTY');
                    if (bountyTx) {
                        const bountyCreator = bountyTx.sender;
                        sendNotification(bountyCreator, { title: 'New Bounty Submission 📥', body: `${fromProfile.username} submitted to your bounty: "${bountyTx.data.description.substring(0, 30)}..."` });
                    }
                }
            } else if (type === 'LIST_ITEM') {
                const followers = socialGraph.followers[sender] || [];
                followers.forEach(followerAddress => {
                    sendNotification(followerAddress, { title: 'New Marketplace Listing 🏪', body: `${fromProfile.username} listed "${data.title}" for ${data.price} $VOD.` });
                });
            } else if (type === 'TRANSFER_COIN') {
                sendNotification(receiver, { title: 'Incoming $VOD Transfer 💸', body: `You received ${data.amount} $VOD from ${fromProfile.username}.` });
            } else if (type === 'STREAM_COMPLETED') {
                const feed = profileService.getFeedEngine();
                const originalPost = feed.find(item => item.type === 'SONG_UPLOAD' && item.data.audioHash === data.audioHash);
                if (originalPost && originalPost.sender !== sender) {
                    sendNotification(originalPost.sender, { title: 'Royalty Dividend Paid 💎', body: `Your track "${originalPost.data.trackTitle}" was streamed, and you earned royalties!` });
                }
            } else if (type === 'PURCHASE_ZINE_RIGHTS') {
                sendNotification(receiver, { title: 'Curation Rights Sold 📰', body: `${fromProfile.username} bought the rights to your Zine article.` });
            } else if (type === 'AWARD_BOUNTY') {
                const bountyBlock = blockchainService.getBlockByHash(data.bountyId);
                if (bountyBlock) {
                    const bountyTx = bountyBlock.transactions.find(t => t.type === 'CREATE_BOUNTY');
                    if (bountyTx) {
                        sendNotification(data.winner, { title: '🏆 Bounty Awarded!', body: `You won the bounty for "${bountyTx.data.description.substring(0, 30)}..."!` });
                    }
                }
            } else if (type === 'VOTE_HOT_OR_NOT' && data.vote === 1) {
                const hotOrNotData = profileService.getHotOrNotEngine();
                const submission = hotOrNotData.find(s => s.id === data.submissionId);
                const submissionTitle = (submission && submission.trackDetails) ? `"${submission.trackDetails.title}"` : 'your submission';
                sendNotification(receiver, { title: '🔥 Hot or Not!', body: `${fromProfile.username} voted HOT on ${submissionTitle}!` });
            }
            
            // Emit stake-specific notifications and push notifications
            if (type === 'REQUEST_SONG_SHARE') {
                const reqTx = activeBlock.transactions[0];
                const assetHash = reqTx.data.audioHash || reqTx.data.imageHash || reqTx.data.videoHash || reqTx.data.fileHash || reqTx.data.targetHash;
                const payload = { title: 'New Stake Request 📈', body: `${fromProfile.username} wants to buy ${reqTx.data.shareCount}% of your asset.` };
                sendNotification(receiver, payload);
                io.emit('stake_request_notification', { to: receiver, from: sender, requestId: activeBlock.hash, assetHash, shareCount: reqTx.data.shareCount, pricePerShare: reqTx.data.pricePerShare });
            }
            if (type === 'ACCEPT_SHARE_REQUEST' || type === 'DECLINE_SHARE_REQUEST') {
                const respTx = activeBlock.transactions[0];
                const originalRequestBlock = blockchainService.getBlockByHash(respTx.data.requestId);
                if (originalRequestBlock) {
                    const originalRequestTx = originalRequestBlock.transactions.find(tx => tx.type === 'REQUEST_SONG_SHARE');
                    if (originalRequestTx) {
                        const originalRequester = originalRequestTx.sender;
                        const payload = { title: `Stake Request ${type === 'ACCEPT_SHARE_REQUEST' ? 'Accepted' : 'Declined'}`, body: `${fromProfile.username} has ${type === 'ACCEPT_SHARE_REQUEST' ? 'accepted' : 'declined'} your request.` };
                        sendNotification(originalRequester, payload);
                        io.emit('stake_request_response', { to: originalRequester, from: sender, requestId: respTx.data.requestId, accepted: type === 'ACCEPT_SHARE_REQUEST' });
                    }
                }
            }

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

    processHotOrNot(req, res) {
        const { targetHash } = req.body;
        if (!targetHash) {
            return res.status(400).json({ error: "Missing targetHash" });
        }

        const sourcePath = path.join(IPFS_DIR, targetHash);
        if (!fs.existsSync(sourcePath)) {
            return res.status(404).json({ error: "Original asset not found on this node." });
        }

        const formattedHash = `hotornot_${Date.now()}_${targetHash}`;
        const destPath = path.join(IPFS_DIR, formattedHash);

        try {
            // In a real app, you'd use ffmpeg to trim to 30s. Here we just copy.
            fs.copyFileSync(sourcePath, destPath);
            console.log(`[HOTORNOT] Formatted ${targetHash} -> ${formattedHash}`);
            return res.status(200).json({ formattedHash });
        } catch (error) {
            console.error('[HOTORNOT] Processing Error:', error);
            return res.status(500).json({ error: "Failed to process asset for Hot or Not." });
        }
    }
}
module.exports = new FeedController();