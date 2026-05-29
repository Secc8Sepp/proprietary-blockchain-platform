const blockchainService = require('./blockchainService');

// --- PERFORMANCE CACHING ---
let aggregatedDataCache = null;
let lastAggregatedChainLength = 0;
let fullProfileCache = new Map();
let lastProfileCacheChainLength = 0;
let feedCache = null;
let lastFeedCacheChainLength = 0;
// --- END CACHING ---

/**
 * This is the new single source of truth for calculating the state of all user profiles.
 * It iterates the chain once, caches the result, and provides a consistent data source
 * for all other service functions, eliminating logical discrepancies.
 */
function _getAggregatedProfileData(chain) {
    if (aggregatedDataCache && chain.length === lastAggregatedChainLength) {
        return aggregatedDataCache;
    }

    const profiles = {};
    chain.forEach(block => {
        block.transactions.forEach(tx => {
            if (!profiles[tx.sender]) profiles[tx.sender] = { username: `Node_${tx.sender.substring(0,6)}`, avatarHash: '', joined: tx.timestamp, tags: [] };
            if (tx.receiver && tx.receiver !== '0x00' && !profiles[tx.receiver]) {
                profiles[tx.receiver] = { username: `Node_${tx.receiver.substring(0,6)}`, avatarHash: '', joined: tx.timestamp, tags: [] };
            }
            if (tx.type === 'PROFILE_UPDATE') {
                // This robust check correctly handles username changes, including setting it to an empty string.
                if (tx.data.username !== undefined) profiles[tx.sender].username = tx.data.username;
                if (tx.data.avatarHash) profiles[tx.sender].avatarHash = tx.data.avatarHash;
                if (tx.data.tags) profiles[tx.sender].tags = tx.data.tags;
            }
        });
    });

    lastAggregatedChainLength = chain.length;
    aggregatedDataCache = { profiles };
    return aggregatedDataCache;
}

function getDeletedUsers(chain) {
    const deletedUsers = new Set();
    const adminAddress = blockchainService.getAdminAddress(chain);

    // Only process explicit ADMIN_DELETE_USER transactions from the admin
    chain.forEach(block => {
        block.transactions.forEach(tx => {
            const sender = tx.sender ? tx.sender.toString().trim().replace(/^0x/i, '').toLowerCase() : null;
            if (tx.type === 'ADMIN_DELETE_USER' && sender === adminAddress) {
                deletedUsers.add(tx.receiver);
                console.log(`[DELETE] User ${tx.receiver.substring(0,8)}... marked as deleted by admin.`);
            }
        });
    });
    return deletedUsers;
}

class ProfileService {
    getProfileDirectory() {
        const chain = blockchainService.getChain();
        const deletedUsers = getDeletedUsers(chain);
        const { profiles: allProfiles } = _getAggregatedProfileData(chain);

        // Filter out the deleted users from the master list.
        const liveProfiles = {};
        for (const address in allProfiles) {
            if (!deletedUsers.has(address)) {
                liveProfiles[address] = allProfiles[address];
            }
        }
        return liveProfiles;
    }

    getSocialGraph() {
        const chain = blockchainService.getChain();
        const deletedUsers = getDeletedUsers(chain);
        const followers = {};
        const following = {};

        for (const block of chain) {
            for (const tx of block.transactions) {
                if (deletedUsers.has(tx.sender)) continue;

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
        const deletedUsers = getDeletedUsers(chain);

        if (deletedUsers.has(publicKey)) {
            return {
                publicKey: publicKey,
                username: "[Deleted User]",
                isDeleted: true,
                bio: "This user has been removed from the network.",
                avatarHash: "",
                bannerHash: "",
                balance: 0,
                followerCount: 0,
                followingCount: 0,
                posts: [],
                transactions: [],
            };
        }

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
        
        const { profiles: allProfiles } = _getAggregatedProfileData(chain);
        const baseProfile = allProfiles[publicKey] || {};

        let profile = {
            publicKey: publicKey,
            username: baseProfile.username || "ANON_PUNK",
            bio: "No customized bio logged to the ledger.",
            avatarHash: baseProfile.avatarHash || "",
            bannerHash: "",
            customCss: "",
            balance: blockchainService.calculateBalance(publicKey, chain),
            followerCount: 0,
            followingCount: 0,
            followers: [],
            following: [],
            tags: baseProfile.tags || [],
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
        const shareDistribution = {};
        profile._trackDetails = {};
        
        for (const block of chain) {
            for (const tx of block.transactions) {
                if (deletedUsers.has(tx.sender)) continue;

                if (tx.type === 'STREAM_COMPLETED') {
                    playCounts[tx.data.audioHash] = (playCounts[tx.data.audioHash] || 0) + 1;
                }
            }
        }

        const allCommissions = {};
        const marketData = this.getMarketData();
        const itemsList = marketData.items || [];
        profile.ownedItems = [];
        profile._trackDetails = {};

        // Trace the entire ledger chronologically to compute current state variables
        for (const block of chain) {
            for (const tx of block.transactions) {
                // Ignore transactions sent by a deleted user, but still process transactions *sent to* them (e.g. for balance calculations of others)
                const isSenderDeleted = deletedUsers.has(tx.sender);
                
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
                if (tx.type === 'CREATE_COMMISSION' && !isSenderDeleted) {
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
                if (tx.type === 'FULFILL_COMMISSION' && !isSenderDeleted) {
                    if (allCommissions[tx.data.commissionId] && tx.sender === allCommissions[tx.data.commissionId].creator) {
                        allCommissions[tx.data.commissionId].fulfilled = true;
                    }
                }

                if (tx.type === 'BUY_ITEM' && tx.sender === publicKey && !isSenderDeleted) {
                    const item = itemsList.find(i => i.id === tx.data.itemId);
                    if (item) profile.ownedItems.push(item);
                }
                if (tx.type === 'SONG_UPLOAD' && !isSenderDeleted) {
                    const assetHash = tx.data.audioHash || tx.data.imageHash || tx.data.videoHash || tx.data.fileHash;
                    if (!assetHash) continue;
                    shareDistribution[assetHash] = shareDistribution[assetHash] || {};
                    let rem = parseInt(tx.data.totalShares) || 100;
                    if (tx.data.collaborators) {
                        for (const c of tx.data.collaborators) {
                            const p = parseInt(c.percentage) || 0;
                            if (p > 0 && rem >= p) {
                                shareDistribution[assetHash][c.address] = (shareDistribution[assetHash][c.address] || 0) + p;
                                rem -= p;
                            }
                        }
                    }
                    if (rem > 0) shareDistribution[assetHash][tx.sender] = (shareDistribution[assetHash][tx.sender] || 0) + rem;

                    if (tx.type === 'SONG_UPLOAD') {
                        profile._trackDetails[assetHash] = { title: tx.data.trackTitle, creator: tx.sender, artist: tx.data.artist, offPlatformCollaborator: tx.data.offPlatformCollaborator, coverHash: tx.data.coverHash };
                    } else {
                        // For images/projects/videos, store as generic asset details under _trackDetails for display
                        profile._trackDetails[assetHash] = { title: tx.data.caption || tx.data.filename || 'Asset', creator: tx.sender, coverHash: tx.data.coverHash || null };
                    }
                }
                if (tx.type === 'EDIT_SONG_METADATA' && !isSenderDeleted) {
                    if (profile._trackDetails[tx.data.audioHash] && profile._trackDetails[tx.data.audioHash].creator === tx.sender) {
                        if (tx.data.title) profile._trackDetails[tx.data.audioHash].title = tx.data.title;
                        if (tx.data.artist) profile._trackDetails[tx.data.audioHash].artist = tx.data.artist;
                        if (tx.data.offPlatformCollaborator !== undefined) profile._trackDetails[tx.data.audioHash].offPlatformCollaborator = tx.data.offPlatformCollaborator;
                        if (tx.data.metadata !== undefined) profile._trackDetails[tx.data.audioHash].metadata = tx.data.metadata;
                    }
                }
                if (tx.type === 'BUY_SONG_SHARE' && !isSenderDeleted) {
                    const hash = tx.data.audioHash || tx.data.imageHash || tx.data.videoHash || tx.data.fileHash;
                    const buyer = tx.sender;
                    const seller = tx.receiver;
                    const count = parseInt(tx.data.shareCount) || 0;
                    if (shareDistribution[hash] && shareDistribution[hash][seller] >= count) {
                        shareDistribution[hash][seller] -= count;
                        if (!shareDistribution[hash][buyer]) shareDistribution[hash][buyer] = 0;
                        shareDistribution[hash][buyer] += count;
                    }
                }
                
                if (tx.type === 'REQUEST_SONG_SHARE' && !isSenderDeleted) {
                    const assetHash = tx.data.audioHash || tx.data.imageHash || tx.data.videoHash || tx.data.fileHash;
                    allShareRequests[block.hash] = {
                        id: block.hash,
                        assetHash: assetHash,
                        buyer: tx.sender,
                        seller: tx.receiver,
                        count: tx.data.shareCount,
                        price: tx.data.pricePerShare,
                        status: 'pending'
                    };
                }
                if (tx.type === 'ACCEPT_SHARE_REQUEST' && !isSenderDeleted && allShareRequests[tx.data.requestId] && allShareRequests[tx.data.requestId].seller === tx.sender) {
                    allShareRequests[tx.data.requestId].status = 'accepted';
                }
                if (tx.type === 'DECLINE_SHARE_REQUEST' && !isSenderDeleted && allShareRequests[tx.data.requestId] && allShareRequests[tx.data.requestId].seller === tx.sender) {
                    allShareRequests[tx.data.requestId].status = 'declined';
                }

                // 1. Process mutations belonging to this specific user profile
                if (tx.sender === publicKey && !isSenderDeleted) {
                    if (tx.type === 'PROFILE_UPDATE') {
                        profile.bio = tx.data.bio || profile.bio;
                        if (tx.data.bannerHash) profile.bannerHash = tx.data.bannerHash;
                        if (tx.data.playlistOrder) profile.playlistOrder = tx.data.playlistOrder;
                        if (tx.data.sectionImages) profile.sectionImages = tx.data.sectionImages;
                        if (tx.data.layoutOrder) profile.layoutOrder = tx.data.layoutOrder;
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
                                playCount: playCounts[tx.data.audioHash] || 0,
                                metadata: tx.data.metadata || ''
                            });
                    }
                        if (tx.type === 'IMAGE_POST' || tx.type === 'VIDEO_POST' || tx.type === 'PROJECT_FILE_POST') {
                            const assetHash = tx.data.imageHash || tx.data.videoHash || tx.data.fileHash;
                            profile.uploadedImages.push({
                                caption: tx.data.caption,
                                hash: assetHash,
                                timestamp: tx.timestamp,
                                transactionHash: block.hash,
                                metadata: tx.data.metadata || ''
                            });
                        }
                    if (tx.type === 'EDIT_SONG_METADATA') {
                        const idx = profile.uploadedTracks.findIndex(t => t.hash === tx.data.audioHash);
                        if (idx !== -1) {
                            if(tx.data.title) profile.uploadedTracks[idx].title = tx.data.title;
                            if(tx.data.artist) profile.uploadedTracks[idx].artist = tx.data.artist;
                            if(tx.data.offPlatformCollaborator !== undefined) profile.uploadedTracks[idx].offPlatformCollaborator = tx.data.offPlatformCollaborator;
                            if(tx.data.coverHash) profile.uploadedTracks[idx].coverHash = tx.data.coverHash;
                            if(tx.data.metadata !== undefined) profile.uploadedTracks[idx].metadata = tx.data.metadata;
                        }
                    }
                }

                // 2. Collect Shoutbox messages sent TO this specific profile wall
                if (tx.type === 'SHOUTBOX_POST' && tx.receiver === publicKey && !isSenderDeleted) {
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

        // --- Recommendation Algorithm ---
        // 1. Social Graph (friends-of-friends)
        const recommendedCounts = {};
        for (const followee of profile.following) {
            const followeeFollowing = graph.following[followee] || [];
            for (const f of followeeFollowing) {
                if (f !== publicKey && !profile.following.includes(f)) {
                    recommendedCounts[f] = (recommendedCounts[f] || 0) + 1; // Score for mutual connection
                }
            }
        }

        // 2. Tag Similarity
        const userTags = new Set(profile.tags || []);
        if (userTags.size > 0) {
            const allProfiles = this.getProfileDirectory();
            for (const otherPk in allProfiles) {
                if (otherPk === publicKey || profile.following.includes(otherPk)) continue;
                const otherUser = allProfiles[otherPk];
                const otherTags = new Set(otherUser.tags || []);
                const commonTags = [...userTags].filter(tag => otherTags.has(tag));
                if (commonTags.length > 0) {
                    recommendedCounts[otherPk] = (recommendedCounts[otherPk] || 0) + (commonTags.length * 2); // Higher score for shared tags
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
        const deletedUsers = getDeletedUsers(chain);

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
        const postMetadata = {};

        // Pass 1: Gather metric aggregates from the ledger
        for (const block of chain) {
            for (const tx of block.transactions) {
                if (deletedUsers.has(tx.sender)) continue;
                if (['SONG_UPLOAD', 'TEXT_POST', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST', 'STORY_POST', 'REPOST_POST'].includes(tx.type)) {
                    postOwners[block.hash] = tx.sender;
                    if (tx.data.metadata) {
                        postMetadata[block.hash] = tx.data.metadata;
                    }
                }
                if (tx.type === 'SONG_UPLOAD' || tx.type === 'IMAGE_POST' || tx.type === 'VIDEO_POST' || tx.type === 'PROJECT_FILE_POST') {
                    const assetHash = tx.data.audioHash || tx.data.imageHash || tx.data.videoHash || tx.data.fileHash;
                    if (!assetHash) continue;
                    if (tx.type === 'SONG_UPLOAD') {
                        trackMetadata[assetHash] = { title: tx.data.trackTitle, artist: tx.data.artist, offPlatformCollaborator: tx.data.offPlatformCollaborator, coverHash: tx.data.coverHash, creator: tx.sender };
                    } else {
                        trackMetadata[assetHash] = { title: tx.data.caption || tx.data.filename || 'Asset', creator: tx.sender, coverHash: tx.data.coverHash };
                    }
                    shareDistribution[assetHash] = shareDistribution[assetHash] || {};
                    let rem = parseInt(tx.data.totalShares) || 100;
                    if (tx.data.collaborators) {
                        for (const c of tx.data.collaborators) {
                            const p = parseInt(c.percentage) || 0;
                            if (p > 0 && rem >= p) {
                                shareDistribution[assetHash][c.address] = (shareDistribution[assetHash][c.address] || 0) + p;
                                rem -= p;
                            }
                        }
                    }
                    if (rem > 0) shareDistribution[assetHash][tx.sender] = (shareDistribution[assetHash][tx.sender] || 0) + rem;

                    playCounts[assetHash] = playCounts[assetHash] || 0;
                    if (tx.data.forStake) songListings[assetHash] = { available: parseInt(tx.data.sellPercentage)||0, price: parseFloat(tx.data.pricePerShare)||0, totalShares: parseInt(tx.data.totalShares)||100 };
                }
                if (tx.type === 'EDIT_SONG_METADATA') {
                    if (trackMetadata[tx.data.audioHash] && trackMetadata[tx.data.audioHash].creator === tx.sender) {
                        if (tx.data.title) trackMetadata[tx.data.audioHash].title = tx.data.title;
                        if (tx.data.artist) trackMetadata[tx.data.audioHash].artist = tx.data.artist;
                        if (tx.data.offPlatformCollaborator !== undefined) trackMetadata[tx.data.audioHash].offPlatformCollaborator = tx.data.offPlatformCollaborator;
                        if (tx.data.coverHash) trackMetadata[tx.data.audioHash].coverHash = tx.data.coverHash;
                        if (tx.data.metadata !== undefined) {
                            trackMetadata[tx.data.audioHash].metadata = tx.data.metadata;
                        }
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
                        audioTimestamp: tx.data.audioTimestamp,
                        timestamp: tx.timestamp
                    });
                }
                if (tx.type === 'DELETE_POST') {
                    // Security check: Only the original creator can delete their post
                    // or the reposter can delete their repost
                    if (postOwners[tx.data.txHash] === tx.sender) {
                        deletedPosts.add(tx.data.txHash);
                    }
                }
                if (tx.type === 'EDIT_POST_METADATA') {
                    if (postOwners[tx.data.txHash] === tx.sender) {
                        postMetadata[tx.data.txHash] = tx.data.metadata;
                    }
                }
            }
        }

        // Pass 2: Compile the feed
        for (const block of chain) {
            if (deletedPosts.has(block.hash)) continue; // Hide deleted blocks from the feed
            
            for (const tx of block.transactions) {
                if (deletedUsers.has(tx.sender)) continue;
                if (['SONG_UPLOAD', 'TEXT_POST', 'PROFILE_UPDATE', 'FOLLOW_USER', 'LIKE_POST', 'LIKE_IMAGE', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST', 'THEME_UPDATE', 'SHOUTBOX_POST', 'SET_TOP_8', 'STREAM_COMPLETED', 'BUY_SONG_SHARE', 'TRANSFER_COIN', 'REQUEST_SONG_SHARE', 'ACCEPT_SHARE_REQUEST', 'STORY_POST', 'PURCHASE_ZINE_RIGHTS', 'REPOST_POST'].includes(tx.type)) {
                    
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

                    if (postMetadata[block.hash]) {
                        feedItem.data.metadata = postMetadata[block.hash];
                    }

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

                    if (tx.type === 'SONG_UPLOAD' || tx.type === 'IMAGE_POST' || tx.type === 'VIDEO_POST' || tx.type === 'PROJECT_FILE_POST') {
                        const assetHash = tx.data.audioHash || tx.data.imageHash || tx.data.videoHash || tx.data.fileHash;
                        feedItem.playCount = playCounts[assetHash] || 0;
                        feedItem.shares = shareDistribution[assetHash] || {};
                        feedItem.listing = songListings[assetHash];
                        if (trackMetadata[assetHash]) {
                            feedItem.data.trackTitle = trackMetadata[assetHash].title;
                            feedItem.data.artist = trackMetadata[assetHash].artist;
                            feedItem.data.offPlatformCollaborator = trackMetadata[assetHash].offPlatformCollaborator;
                            feedItem.data.coverHash = trackMetadata[assetHash].coverHash;
                            if (trackMetadata[assetHash].metadata !== undefined) {
                                feedItem.data.metadata = trackMetadata[assetHash].metadata;
                            }
                        }
                    }

                    feedItems.push(feedItem);
                }
            }
        }

        const postMap = feedItems.reduce((map, item) => {
            // only map original posts
            if (['SONG_UPLOAD', 'TEXT_POST', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST'].includes(item.type)) {
                map[item.transactionHash] = item;
            }
            return map;
        }, {});

        const finalFeed = feedItems.map(item => {
            if (item.type === 'REPOST_POST') {
                const originalPost = postMap[item.data.originalTxHash];
                if (originalPost) {
                    // Create a new object that is the original post, but overridden with repost info
                    return {
                        ...originalPost, // The full, enriched original post object
                        repostCaption: item.data.caption,
                        isRepost: true,
                        reposter: item.sender, // The person who reposted
                        timestamp: item.timestamp, // The time of the repost
                        transactionHash: item.transactionHash, // The hash of the repost TX for likes/replies
                        likeCount: item.likeCount,
                        replies: item.replies,
                    };
                }
                return null; // Original post not found or was deleted, so filter this repost out
            }
            return item;
        }).filter(Boolean); // remove nulls

        const sortedFeed = finalFeed.sort((a, b) => b.timestamp - a.timestamp);
        feedCache = sortedFeed; // Store result in cache
        return sortedFeed;
    }

    getMarketData() {
        const chain = blockchainService.getChain();
        const deletedUsers = getDeletedUsers(chain);
        const bounties = {};
        const items = {};

        for (const block of chain) {
            for (const tx of block.transactions) {
                if (deletedUsers.has(tx.sender)) continue;
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
        const deletedUsers = getDeletedUsers(chain);
        const submissions = {};
        const votes = {};
        const trackDetails = {};

        for (const block of chain) {
            for (const tx of block.transactions) {
                if (deletedUsers.has(tx.sender)) continue;
                if (tx.type === 'SONG_UPLOAD') {
                    trackDetails[tx.data.audioHash] = { title: tx.data.trackTitle, artist: tx.data.artist, creator: tx.sender, coverHash: tx.data.coverHash };
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
                        originalHash: tx.data.originalHash || null,
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