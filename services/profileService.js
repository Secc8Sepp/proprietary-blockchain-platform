const blockchainService = require('./blockchainService');

// --- PERFORMANCE CACHING ---
let fullProfileCache = new Map();
let lastProfileCacheChainLength = 0;
let feedCache = null;
let lastFeedCacheChainLength = 0;
// --- END CACHING ---

class ProfileService {
    getSocialGraph() {
        const chain = blockchainService.getChain();
        const followers = {};
        const following = {};

        for (const block of chain) {
            for (const tx of block.transactions) {
                if (tx.type === 'FOLLOW_USER') {
                    const actor = tx.sender;
                    const target = tx.receiver;

                    if (!followers[target]) followers[target] = new Set();
                    if (!following[actor]) following[actor] = new Set();

                    followers[target].add(actor);
                    following[actor].add(target);
                }
            }
        }

        const serializedFollowers = {};
        const serializedFollowing = {};

        for (const [key, value] of Object.entries(followers)) {
            serializedFollowers[key] = Array.from(value);
        }
        for (const [key, value] of Object.entries(following)) {
            serializedFollowing[key] = Array.from(value);
        }

        return { followers: serializedFollowers, following: serializedFollowing };
    }

    getProfile(publicKey) {
        const chain = blockchainService.getChain();

        // Invalidate entire profile cache if chain has grown
        if (chain.length !== lastProfileCacheChainLength) {
            fullProfileCache.clear();
            lastProfileCacheChainLength = chain.length;
        } else {
            // Return from cache if available
            if (fullProfileCache.has(publicKey)) {
                return fullProfileCache.get(publicKey);
            }
        }
        
        let profile = {
            publicKey: publicKey,
            username: "ANON_PUNK",
            bio: "No customized bio logged to the ledger.",
            avatarHash: "",
            bannerHash: "",
            customCss: "",
            balance: blockchainService.calculateBalance(publicKey, chain),
            followerCount: 0,
            followingCount: 0,
            followers: [],
            following: [],
            recommended: [],
            uploadedTracks: [],
            uploadedImages: [],
            top8: [],
            shoutbox: [],
            transactions: [],
            activeCommissions: []
        };
        
        const allShareRequests = {};
        // Pre-compute playcounts for the user's uploaded tracks
        const playCounts = {};
        for (const block of chain) {
            for (const tx of block.transactions) {
                if (tx.type === 'STREAM_COMPLETED') {
                    playCounts[tx.data.audioHash] = (playCounts[tx.data.audioHash] || 0) + 1;
                }
            }
        }

        const allCommissions = {};
        const marketData = this.getMarketData();
        const itemsList = marketData.items || [];
        profile.ownedItems = [];
        const shareDistribution = {};
        profile._trackDetails = {};

        // Trace the entire ledger chronologically to compute current state variables
        for (const block of chain) {
            for (const tx of block.transactions) {
                
                // Populate Personal Transaction History
                if (tx.sender === publicKey || tx.receiver === publicKey) {
                    let txAmt = tx.data.amount || null;
                    if (tx.type === 'BUY_SONG_SHARE') txAmt = (parseInt(tx.data.shareCount) || 0) * (parseFloat(tx.data.pricePerShare) || 0);
                    if (tx.type === 'BUY_ITEM') txAmt = parseFloat(tx.data.price) || 0;

                    profile.transactions.unshift({ 
                        type: tx.type, 
                        sender: tx.sender, 
                        receiver: tx.receiver, 
                        amount: txAmt, 
                        timestamp: tx.timestamp,
                        hash: block.hash
                    });
                }

                // Track Commissions for Escrow Dashboard
                if (tx.type === 'CREATE_COMMISSION') {
                    allCommissions[block.hash] = {
                        id: block.hash,
                        buyer: tx.sender,
                        creator: tx.receiver,
                        amount: tx.data.amount,
                        terms: tx.data.terms,
                        timestamp: tx.timestamp,
                        fulfilled: false
                    };
                }
                if (tx.type === 'FULFILL_COMMISSION') {
                    if (allCommissions[tx.data.commissionId] && tx.sender === allCommissions[tx.data.commissionId].creator) {
                        allCommissions[tx.data.commissionId].fulfilled = true;
                    }
                }

                if (tx.type === 'BUY_ITEM' && tx.sender === publicKey) {
                    const item = itemsList.find(i => i.id === tx.data.itemId);
                    if (item) profile.ownedItems.push(item);
                }
                if (tx.type === 'SONG_UPLOAD') {
                    shareDistribution[tx.data.audioHash] = {};
                    let rem = 100;
                    if (tx.data.collaborators) {
                        for (const c of tx.data.collaborators) {
                            const p = parseInt(c.percentage) || 0;
                            if (p > 0 && rem >= p) {
                                shareDistribution[tx.data.audioHash][c.address] = (shareDistribution[tx.data.audioHash][c.address] || 0) + p;
                                rem -= p;
                            }
                        }
                    }
                    if (rem > 0) shareDistribution[tx.data.audioHash][tx.sender] = (shareDistribution[tx.data.audioHash][tx.sender] || 0) + rem;

                    profile._trackDetails[tx.data.audioHash] = { title: tx.data.trackTitle, creator: tx.sender, artist: tx.data.artist, offPlatformCollaborator: tx.data.offPlatformCollaborator, coverHash: tx.data.coverHash };
                }
                if (tx.type === 'EDIT_SONG_METADATA') {
                    if (profile._trackDetails[tx.data.audioHash] && profile._trackDetails[tx.data.audioHash].creator === tx.sender) {
                        if (tx.data.title) profile._trackDetails[tx.data.audioHash].title = tx.data.title;
                        if (tx.data.artist) profile._trackDetails[tx.data.audioHash].artist = tx.data.artist;
                        if (tx.data.offPlatformCollaborator !== undefined) profile._trackDetails[tx.data.audioHash].offPlatformCollaborator = tx.data.offPlatformCollaborator;
                    }
                }
                if (tx.type === 'BUY_SONG_SHARE') {
                    const hash = tx.data.audioHash;
                    const buyer = tx.sender;
                    const seller = tx.receiver;
                    const count = parseInt(tx.data.shareCount) || 0;
                    if (shareDistribution[hash] && shareDistribution[hash][seller] >= count) {
                        shareDistribution[hash][seller] -= count;
                        if (!shareDistribution[hash][buyer]) shareDistribution[hash][buyer] = 0;
                        shareDistribution[hash][buyer] += count;
                    }
                }
                
                if (tx.type === 'REQUEST_SONG_SHARE') {
                    allShareRequests[block.hash] = {
                        id: block.hash,
                        audioHash: tx.data.audioHash,
                        buyer: tx.sender,
                        seller: tx.receiver,
                        count: tx.data.shareCount,
                        price: tx.data.pricePerShare,
                        status: 'pending'
                    };
                }
                if (tx.type === 'ACCEPT_SHARE_REQUEST' && allShareRequests[tx.data.requestId] && allShareRequests[tx.data.requestId].seller === tx.sender) {
                    allShareRequests[tx.data.requestId].status = 'accepted';
                }
                if (tx.type === 'DECLINE_SHARE_REQUEST' && allShareRequests[tx.data.requestId] && allShareRequests[tx.data.requestId].seller === tx.sender) {
                    allShareRequests[tx.data.requestId].status = 'declined';
                }

                // 1. Process mutations belonging to this specific user profile
                if (tx.sender === publicKey) {
                    if (tx.type === 'PROFILE_UPDATE') {
                        profile.username = tx.data.username || profile.username;
                        profile.bio = tx.data.bio || profile.bio;
                        if (tx.data.avatarHash) profile.avatarHash = tx.data.avatarHash;
                        if (tx.data.bannerHash) profile.bannerHash = tx.data.bannerHash;
                        if (tx.data.playlistOrder) profile.playlistOrder = tx.data.playlistOrder;
                        if (tx.data.sectionImages) profile.sectionImages = tx.data.sectionImages;
                        if (tx.data.layoutOrder) profile.layoutOrder = tx.data.layoutOrder;
                        if (tx.data.tags) profile.tags = tx.data.tags;
                    }
                    if (tx.type === 'THEME_UPDATE') {
                        profile.customCss = tx.data.customCss || "";
                    }
                    if (tx.type === 'SET_TOP_8') {
                        profile.top8 = Array.isArray(tx.data.top8Keys) ? tx.data.top8Keys : [];
                    }
                    if (tx.type === 'SONG_UPLOAD') {
                        const artistToUse = tx.data.artist;
                        const titleToUse = tx.data.trackTitle;
                        profile.uploadedTracks.push({
                            title: titleToUse,
                            artist: artistToUse,
                            offPlatformCollaborator: tx.data.offPlatformCollaborator,
                            hash: tx.data.audioHash,
                            coverHash: tx.data.coverHash || null,
                            timestamp: tx.timestamp,
                            playCount: playCounts[tx.data.audioHash] || 0
                        });
                    }
                    if (tx.type === 'EDIT_SONG_METADATA') {
                        const idx = profile.uploadedTracks.findIndex(t => t.hash === tx.data.audioHash);
                        if (idx !== -1) {
                            if(tx.data.title) profile.uploadedTracks[idx].title = tx.data.title;
                            if(tx.data.artist) profile.uploadedTracks[idx].artist = tx.data.artist;
                            if(tx.data.offPlatformCollaborator !== undefined) profile.uploadedTracks[idx].offPlatformCollaborator = tx.data.offPlatformCollaborator;
                            if(tx.data.coverHash) profile.uploadedTracks[idx].coverHash = tx.data.coverHash;
                        }
                    }
                    if (tx.type === 'IMAGE_POST') {
                        profile.uploadedImages.push({
                            caption: tx.data.caption,
                            hash: tx.data.imageHash,
                            timestamp: tx.timestamp
                        });
                    }
                    if (tx.type === 'VIDEO_POST') {
                        profile.uploadedImages.push({
                            caption: tx.data.caption,
                            hash: tx.data.videoHash,
                            timestamp: tx.timestamp
                        });
                    }
                    if (tx.type === 'PROJECT_FILE_POST') {
                        profile.uploadedImages.push({
                            caption: tx.data.caption,
                            hash: tx.data.fileHash,
                            timestamp: tx.timestamp
                        });
                    }
                }

                // 2. Collect Shoutbox messages sent TO this specific profile wall
                if (tx.type === 'SHOUTBOX_POST' && tx.receiver === publicKey) {
                    profile.shoutbox.push({
                        sender: tx.sender,
                        message: tx.data.message,
                        timestamp: tx.timestamp
                    });
                }
            }
        }

        // Handle structural follower graph logic parameters
        const graph = this.getSocialGraph();
        profile.followerCount = graph.followers[publicKey] ? graph.followers[publicKey].length : 0;
        profile.followingCount = graph.following[publicKey] ? graph.following[publicKey].length : 0;
        profile.followers = Array.from(graph.followers[publicKey] || []);
        profile.following = Array.from(graph.following[publicKey] || []);

        // Recommendation Algorithm: Count frequencies of friends-of-friends
        const recommendedCounts = {};
        for (const followee of profile.following) {
            const followeeFollowing = graph.following[followee] || [];
            for (const f of followeeFollowing) {
                if (f !== publicKey && !profile.following.includes(f)) {
                    recommendedCounts[f] = (recommendedCounts[f] || 0) + 1;
                }
            }
        }
        // Sort by frequency (most likely to want to add)
        profile.recommended = Object.keys(recommendedCounts)
            .sort((a, b) => recommendedCounts[b] - recommendedCounts[a])
            .slice(0, 8)
            .map(k => ({ key: k, mutuals: recommendedCounts[k] }));

        profile.activeCommissions = Object.values(allCommissions)
            .filter(c => !c.fulfilled && (c.buyer === publicKey || c.creator === publicKey))
            .sort((a,b) => b.timestamp - a.timestamp);

        profile.bounties = this.getMarketData().bounties.filter(b => b.creator === publicKey);
        profile.posts = this.getFeedEngine().filter(item => item.sender === publicKey);
        
        profile.shareRequestsReceived = Object.values(allShareRequests).filter(r => r.seller === publicKey && r.status === 'pending');

        profile.ownedShares = [];
        for (const [hash, shares] of Object.entries(shareDistribution)) {
            if (shares[publicKey] > 0 && profile._trackDetails[hash] && profile._trackDetails[hash].creator !== publicKey) {
                profile.ownedShares.push({
                    audioHash: hash,
                    title: profile._trackDetails[hash].title,
                    creator: profile._trackDetails[hash].creator,
                    shares: shares[publicKey]
                });
            }
        }
        delete profile._trackDetails;

        const adminAddress = blockchainService.getAdminAddress(chain);
        profile.isAdmin = (publicKey === adminAddress);

        fullProfileCache.set(publicKey, profile); // Store result in cache
        return profile;
    }

    getFeedEngine() {
        const chain = blockchainService.getChain();

        // Return from cache if available and chain hasn't changed
        if (feedCache && chain.length === lastFeedCacheChainLength) {
            return feedCache;
        }

        const feedItems = []; // Recompute if not cached
        lastFeedCacheChainLength = chain.length; // Update cache timestamp
        
        const playCounts = {};
        const shareDistribution = {};
        const likeCounts = {};
        const postReplies = {};
        const postOwners = {};
        const deletedPosts = new Set();
        const songListings = {};
        const trackMetadata = {};

        // Pass 1: Gather metric aggregates from the ledger
        for (const block of chain) {
            for (const tx of block.transactions) {
                if (['SONG_UPLOAD', 'TEXT_POST', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST', 'STORY_POST'].includes(tx.type)) {
                    postOwners[block.hash] = tx.sender;
                }
                if (tx.type === 'SONG_UPLOAD') {
                    trackMetadata[tx.data.audioHash] = { title: tx.data.trackTitle, artist: tx.data.artist, offPlatformCollaborator: tx.data.offPlatformCollaborator, coverHash: tx.data.coverHash, creator: tx.sender };
                    shareDistribution[tx.data.audioHash] = {};
                    let rem = 100;
                    if (tx.data.collaborators) {
                        for (const c of tx.data.collaborators) {
                            const p = parseInt(c.percentage) || 0;
                            if (p > 0 && rem >= p) {
                                shareDistribution[tx.data.audioHash][c.address] = (shareDistribution[tx.data.audioHash][c.address] || 0) + p;
                                rem -= p;
                            }
                        }
                    }
                    if (rem > 0) shareDistribution[tx.data.audioHash][tx.sender] = (shareDistribution[tx.data.audioHash][tx.sender] || 0) + rem;

                    playCounts[tx.data.audioHash] = 0;
                    if (tx.data.forStake) songListings[tx.data.audioHash] = { available: parseInt(tx.data.sellPercentage)||0, price: parseFloat(tx.data.pricePerShare)||0 };
                }
                if (tx.type === 'EDIT_SONG_METADATA') {
                    if (trackMetadata[tx.data.audioHash] && trackMetadata[tx.data.audioHash].creator === tx.sender) {
                        if (tx.data.title) trackMetadata[tx.data.audioHash].title = tx.data.title;
                        if (tx.data.artist) trackMetadata[tx.data.audioHash].artist = tx.data.artist;
                        if (tx.data.offPlatformCollaborator !== undefined) trackMetadata[tx.data.audioHash].offPlatformCollaborator = tx.data.offPlatformCollaborator;
                        if (tx.data.coverHash) trackMetadata[tx.data.audioHash].coverHash = tx.data.coverHash;
                    }
                }
                if (tx.type === 'STREAM_COMPLETED') {
                    if (playCounts[tx.data.audioHash] !== undefined) playCounts[tx.data.audioHash]++;
                }
                if (tx.type === 'BUY_SONG_SHARE') {
                    const hash = tx.data.audioHash;
                    const buyer = tx.sender;
                    const seller = tx.receiver;
                    const count = parseInt(tx.data.shareCount) || 0;
                    if (shareDistribution[hash] && shareDistribution[hash][seller] >= count) {
                        shareDistribution[hash][seller] -= count;
                        if (!shareDistribution[hash][buyer]) shareDistribution[hash][buyer] = 0;
                        shareDistribution[hash][buyer] += count;
                        if (songListings[hash]) songListings[hash].available -= count;
                    }
                }
                if (tx.type === 'LIKE_POST') {
                    likeCounts[tx.data.txHash] = (likeCounts[tx.data.txHash] || 0) + 1;
                }
                if (tx.type === 'REPLY_POST') {
                    if (!postReplies[tx.data.txHash]) postReplies[tx.data.txHash] = [];
                    const replyId = tx.data.replyId || (tx.timestamp + '_' + tx.sender.substring(0, 10));
                    postReplies[tx.data.txHash].push({ 
                        id: replyId,
                        sender: tx.sender, 
                        text: tx.data.text, 
                        timestamp: tx.timestamp,
                        parentReplyId: tx.data.parentReplyId || null,
                        replies: []
                    });
                }
                if (tx.type === 'DELETE_POST') {
                    // Security check: Only the original creator can delete their post
                    if (postOwners[tx.data.txHash] === tx.sender) {
                        deletedPosts.add(tx.data.txHash);
                    }
                }
            }
        }

        // Pass 2: Compile the feed
        for (const block of chain) {
            if (deletedPosts.has(block.hash)) continue; // Hide deleted blocks from the feed
            
            for (const tx of block.transactions) {
                if (['SONG_UPLOAD', 'TEXT_POST', 'PROFILE_UPDATE', 'FOLLOW_USER', 'LIKE_POST', 'LIKE_IMAGE', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST', 'THEME_UPDATE', 'SHOUTBOX_POST', 'SET_TOP_8', 'STREAM_COMPLETED', 'BUY_SONG_SHARE', 'TRANSFER_COIN', 'REQUEST_SONG_SHARE', 'ACCEPT_SHARE_REQUEST', 'STORY_POST', 'PURCHASE_ZINE_RIGHTS'].includes(tx.type)) {
                    
                    const senderBalance = blockchainService.calculateBalance(tx.sender, chain);
                    const adminAddress = blockchainService.getAdminAddress(chain);
                    const roles = [];
                    if (tx.sender === adminAddress) roles.push('admin');
                    if (senderBalance >= 10000) roles.push('whale');
                    if (tx.type === 'SONG_UPLOAD') roles.push('artist');

                    const feedItem = {
                        transactionHash: block.hash,
                        type: tx.type,
                        sender: tx.sender,
                        receiver: tx.receiver,
                        data: tx.data,
                        timestamp: tx.timestamp,
                        roles: roles
                    };

                    feedItem.likeCount = likeCounts[block.hash] || 0;
                    
                    const rawReplies = postReplies[block.hash] || [];
                    const replyMap = {};
                    const rootReplies = [];
                    rawReplies.forEach(r => { r.replies = []; replyMap[r.id] = r; });
                    rawReplies.forEach(r => {
                        if (r.parentReplyId && replyMap[r.parentReplyId]) {
                            replyMap[r.parentReplyId].replies.push(r);
                        } else {
                            rootReplies.push(r);
                        }
                    });
                    feedItem.replies = rootReplies;

                    if (tx.type === 'SONG_UPLOAD') {
                        feedItem.playCount = playCounts[tx.data.audioHash] || 0;
                        feedItem.shares = shareDistribution[tx.data.audioHash] || {};
                        feedItem.listing = songListings[tx.data.audioHash];
                        if (trackMetadata[tx.data.audioHash]) {
                            feedItem.data.trackTitle = trackMetadata[tx.data.audioHash].title;
                            feedItem.data.artist = trackMetadata[tx.data.audioHash].artist;
                            feedItem.data.offPlatformCollaborator = trackMetadata[tx.data.audioHash].offPlatformCollaborator;
                            feedItem.data.coverHash = trackMetadata[tx.data.audioHash].coverHash;
                        }
                    }

                    feedItems.push(feedItem);
                }
            }
        }

        const sortedFeed = feedItems.sort((a, b) => b.timestamp - a.timestamp);
        feedCache = sortedFeed; // Store result in cache
        return sortedFeed;
    }

    getMarketData() {
        const chain = blockchainService.getChain();
        const bounties = {};
        const items = {};

        for (const block of chain) {
            for (const tx of block.transactions) {
                if (tx.type === 'CREATE_BOUNTY') {
                    bounties[block.hash] = {
                        id: block.hash,
                        creator: tx.sender,
                        amount: tx.data.amount,
                        description: tx.data.description,
                        submissions: [],
                        awarded: false,
                        winner: null,
                        timestamp: tx.timestamp
                    };
                }
                if (tx.type === 'SUBMIT_BOUNTY') {
                    if (bounties[tx.data.bountyId]) {
                        bounties[tx.data.bountyId].submissions.push({
                            sender: tx.sender,
                            assetHash: tx.data.assetHash,
                            message: tx.data.message
                        });
                    }
                }
                if (tx.type === 'AWARD_BOUNTY') {
                    if (bounties[tx.data.bountyId] && tx.sender === bounties[tx.data.bountyId].creator) {
                        bounties[tx.data.bountyId].awarded = true;
                        bounties[tx.data.bountyId].winner = tx.data.winner;
                    }
                }
                if (tx.type === 'LIST_ITEM') {
                    items[block.hash] = {
                        id: block.hash,
                        seller: tx.sender,
                        title: tx.data.title,
                        itemType: tx.data.itemType,
                        price: tx.data.price,
                        assetHash: tx.data.assetHash,
                        sales: 0
                    };
                }
                if (tx.type === 'BUY_ITEM') {
                    if (items[tx.data.itemId]) items[tx.data.itemId].sales += 1;
                }
            }
        }
        return {
            bounties: Object.values(bounties).sort((a,b) => b.timestamp - a.timestamp),
            items: Object.values(items).sort((a,b) => b.timestamp - a.timestamp)
        };
    }

    getHotOrNotEngine() {
        const chain = blockchainService.getChain();
        const submissions = {};
        const votes = {};
        const trackDetails = {};

        for (const block of chain) {
            for (const tx of block.transactions) {
                if (tx.type === 'SONG_UPLOAD') {
                    trackDetails[tx.data.audioHash] = { title: tx.data.trackTitle, creator: tx.sender, coverHash: tx.data.coverHash };
                }
                if (tx.type === 'EDIT_SONG_METADATA') {
                    if (trackDetails[tx.data.audioHash] && trackDetails[tx.data.audioHash].creator === tx.sender) {
                        if (tx.data.title) trackDetails[tx.data.audioHash].title = tx.data.title;
                        if (tx.data.artist) trackDetails[tx.data.audioHash].artist = tx.data.artist;
                        if (tx.data.coverHash) trackDetails[tx.data.audioHash].coverHash = tx.data.coverHash;
                    }
                }
                if (tx.type === 'SUBMIT_HOT_OR_NOT') {
                    const category = tx.data.category || 'music';
                    const targetHash = tx.data.targetHash || tx.data.audioHash;
                    submissions[block.hash] = {
                        id: block.hash,
                        category: category,
                        targetHash: targetHash,
                        submitter: tx.sender,
                        timestamp: tx.timestamp,
                        score: 0,
                        upvotes: 0,
                        downvotes: 0
                    };
                    
                    // Link the formatted copy back to the original track details
                    if (tx.data.originalHash && trackDetails[tx.data.originalHash]) {
                        trackDetails[targetHash] = trackDetails[tx.data.originalHash];
                    }
                }
                if (tx.type === 'VOTE_HOT_OR_NOT') {
                    const subId = tx.data.submissionId;
                    if (submissions[subId]) {
                        if (!votes[subId]) votes[subId] = {};
                        if (!votes[subId][tx.sender]) {
                            votes[subId][tx.sender] = tx.data.vote;
                            if (tx.data.vote === 1) {
                                submissions[subId].score += 1;
                                submissions[subId].upvotes += 1;
                            } else {
                                submissions[subId].score -= 1;
                                submissions[subId].downvotes += 1;
                            }
                        }
                    }
                }
            }
        }
        
        const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
        const now = Date.now();

        return Object.values(submissions).map(s => {
            return {
                ...s,
                trackDetails: s.category === 'music' ? (trackDetails[s.targetHash] || { title: "Unknown Track", creator: s.submitter }) : null,
                votes: votes[s.id] || {}
            }
        }).filter(s => {
            // Rotate off and delete tracks older than a week if not hot enough
            const isOld = (now - s.timestamp) > ONE_WEEK;
            if (isOld && s.score < 5) {
                if (s.targetHash && s.targetHash.startsWith('hotornot_')) {
                    const fs = require('fs'); const path = require('path');
                    const filePath = path.join(__dirname, '..', 'mock_ipfs', s.targetHash);
                    if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch(e) {} }
                }
                return false;
            }
            return true;
        }).sort((a,b) => b.timestamp - a.timestamp);
    }
}

module.exports = new ProfileService();