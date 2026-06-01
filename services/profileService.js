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
                if (tx.data) {
                    if (tx.data.username !== undefined) profiles[tx.sender].username = tx.data.username;
                    if (tx.data.avatarHash) profiles[tx.sender].avatarHash = tx.data.avatarHash;
                    if (tx.data.tags) profiles[tx.sender].tags = tx.data.tags;
                    if (tx.data.referrer) profiles[tx.sender].referrer = tx.data.referrer;
                }
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
            referrer: baseProfile.referrer || null,
            tags: baseProfile.tags || [],
            recommended: [],
            uploadedTracks: [],
            uploadedImages: [],
            top8: [],
            shoutbox: [],
            transactions: [],
            activeCommissions: [],
            playlists: []
        };

        const { feed: allFeedItems, profiles: liveProfiles } = this.getFeedEngine();
        const { items: marketItems, bounties: marketBounties } = this.getMarketData();

        // Trace the entire ledger chronologically to compute current state variables
        // This loop is now only for state that is NOT part of the feed engine (e.g., profile settings, non-post transactions)
        for (const block of chain) {
            for (const tx of block.transactions) {
                // Populate Personal Transaction History
                if (tx.sender === publicKey || tx.receiver === publicKey) {
                    let txAmt = (tx.data && tx.data.amount) ? tx.data.amount : null;
                    if (tx.type === 'BUY_SONG_SHARE' && tx.data) txAmt = (parseInt(tx.data.shareCount) || 0) * (parseFloat(tx.data.pricePerShare) || 0);
                    if (tx.type === 'BUY_ITEM' && tx.data) txAmt = parseFloat(tx.data.price) || 0;

                    profile.transactions.unshift({ 
                        type: tx.type, 
                        sender: tx.sender, 
                        receiver: tx.receiver, 
                        amount: txAmt, 
                        timestamp: tx.timestamp,
                        hash: block.hash
                    });
                }

                // 1. Process mutations belonging to this specific user profile
                if (tx.sender === publicKey && !deletedUsers.has(tx.sender)) {
                    if (tx.type === 'PROFILE_UPDATE') {
                        profile.bio = tx.data.bio || profile.bio;
                        if (tx.data.bannerHash) profile.bannerHash = tx.data.bannerHash;
                        if (tx.data.sectionImages) profile.sectionImages = tx.data.sectionImages;
                        if (tx.data.layoutOrder) profile.layoutOrder = tx.data.layoutOrder;
                        // Allow toggling privacy of main artist playlist
                        // This logic is now handled in the playlist aggregation step below
                    }
                    if (tx.type === 'THEME_UPDATE') {
                        profile.customCss = tx.data.customCss || "";
                    }
                    if (tx.type === 'SET_TOP_8') {
                        profile.top8 = Array.isArray(tx.data.top8Keys) ? tx.data.top8Keys : [];
                    }
                }

                // 2. Collect Shoutbox messages sent TO this specific profile wall
                if (tx.type === 'SHOUTBOX_POST' && tx.receiver === publicKey && !deletedUsers.has(tx.sender) && tx.data) {
                    profile.shoutbox.push({
                        sender: tx.sender,
                        message: tx.data.message,
                        timestamp: tx.timestamp
                    });
                }
            }
        }

        // --- DATA DERIVATION FROM FEED ENGINE ---
        profile.posts = allFeedItems.filter(item => 
            (item.sender === publicKey || item.reposter === publicKey) && 
            !(item.type === 'IMAGE_POST' && item.data && item.data.isFlyer)
        );

        profile.uploadedTracks = profile.posts
            .filter(p => p.type === 'SONG_UPLOAD' && p.sender === publicKey && !p.isRepost)
            .map(p => ({
                title: p.data.trackTitle,
                artist: p.data.artist,
                offPlatformCollaborator: p.data.offPlatformCollaborator,
                hash: p.data.audioHash,
                coverHash: p.data.coverHash || null,
                timestamp: p.timestamp,
                playCount: p.playCount || 0,
                metadata: p.data.metadata || ''
            }));

        profile.uploadedImages = profile.posts
            .filter(p => (p.type === 'IMAGE_POST' || p.type === 'VIDEO_POST' || p.type === 'PROJECT_FILE_POST') && p.sender === publicKey && !p.isRepost)
            .map(p => ({
                caption: p.data.caption,
                hash: p.data.imageHash || p.data.videoHash || p.data.fileHash,
                timestamp: p.timestamp,
                transactionHash: p.transactionHash,
                metadata: p.data.metadata || ''
            }));

        profile.ownedItems = [];
        const ownedItemTransactions = profile.transactions.filter(tx => tx.type === 'BUY_ITEM' && tx.sender === publicKey);
        for (const tx of ownedItemTransactions) {
            const item = marketItems.find(i => i.id === tx.data.itemId);
            if (item) profile.ownedItems.push(item);
        }

        profile.ownedShares = [];
        const trackMapForShares = allFeedItems.reduce((map, item) => {
            if (item.type === 'SONG_UPLOAD') {
                map[item.data.audioHash] = item;
            }
            return map;
        }, {});

        for (const hash in trackMapForShares) {
            const track = trackMapForShares[hash];
            if (track.shares && track.shares[publicKey] > 0 && track.sender !== publicKey) {
                profile.ownedShares.push({
                    audioHash: hash,
                    title: track.data.trackTitle,
                    creator: track.sender,
                    shares: track.shares[publicKey]
                });
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

        profile.bounties = marketBounties.filter(b => b.creator === publicKey);

        // --- PLAYLISTS ---
        const { userLikes, userReposts, allPlaylists } = this._aggregatePlaylistData(chain, publicKey);

        // Create "Tracks You Like" auto-playlist
        const likedTracksPlaylist = {
            id: `liked-tracks-${publicKey}`,
            user_id: publicKey,
            title: "Tracks You Like",
            type: 'listener',
            is_public: false, // Likes are private by default
            track_order: Array.from(userLikes), // userLikes is a Set of songIds (audioHashes)
            created_at: profile.joined,
            isAutoPlaylist: true
        };
        allPlaylists[likedTracksPlaylist.id] = likedTracksPlaylist;

        // Create "My Reposts" auto-playlist
        const repostedTrackHashes = userReposts.map(repost => allFeedItems.find(p => p.transactionHash === repost.originalTxHash))
            .filter(post => post && post.type === 'SONG_UPLOAD')
            .map(post => post.data.audioHash);

        const repostsPlaylist = {
            id: `reposts-${publicKey}`,
            user_id: publicKey,
            title: "My Reposts",
            type: 'listener',
            is_public: true, // Reposts are public
            track_order: repostedTrackHashes,
            created_at: profile.joined,
            isAutoPlaylist: true
        };
        allPlaylists[repostsPlaylist.id] = repostsPlaylist;

        // --- Final Playlist Enrichment ---
        const trackMap = allFeedItems.reduce((map, item) => {
            if (item.type === 'SONG_UPLOAD') {
                map[item.data.audioHash] = item;
            }
            return map;
        }, {});

        const finalPlaylists = [];
        for (const playlistId in allPlaylists) {
            const playlist = allPlaylists[playlistId];
            // Only filter out private playlists if the user ID doesn't match the profile being viewed.
            // This allows users to see their own private playlists.
            if (!playlist.is_public && playlist.user_id !== publicKey) {
                continue;
            }

            // Enrich with full track objects
            playlist.tracks = playlist.track_order
                .map(hash => trackMap[hash])
                .filter(Boolean); // Filter out deleted/invalid tracks
            delete playlist.track_order; // Clean up intermediate data
            finalPlaylists.push(playlist);
        }

        profile.playlists = finalPlaylists.sort((a,b) => (b.updated_at || b.created_at) - (a.updated_at || a.created_at));

        const adminAddress = blockchainService.getAdminAddress(chain);
        profile.isAdmin = (publicKey === adminAddress);

        profile.activeCommissions = this._getActiveCommissionsForUser(chain, publicKey);

        fullProfileCache.set(publicKey, profile); // Store result in cache
        return profile;
    }

    getFeedEngine() {
        const chain = blockchainService.getChain();

        // Return from cache if available and chain hasn't changed
        if (feedCache && chain.length === lastFeedCacheChainLength) {
            return feedCache; // This will now be an object { feed, profiles }
        }
        const deletedUsers = getDeletedUsers(chain);

        const feedItems = []; // Recompute if not cached
        lastFeedCacheChainLength = chain.length;
        
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
                    if (tx.data && tx.data.metadata) {
                        postMetadata[block.hash] = tx.data.metadata;
                    }
                }
                if (tx.data && (tx.type === 'SONG_UPLOAD' || tx.type === 'IMAGE_POST' || tx.type === 'VIDEO_POST' || tx.type === 'PROJECT_FILE_POST')) {
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
                if (tx.type === 'LIST_SONG_STAKE' && tx.data) {
                    if (shareDistribution[tx.data.audioHash] && shareDistribution[tx.data.audioHash][tx.sender] >= parseInt(tx.data.sellPercentage)) {
                         let totalTrackShares = 100;
                         if (shareDistribution[tx.data.audioHash]) {
                             totalTrackShares = Object.values(shareDistribution[tx.data.audioHash]).reduce((a,b)=>a+b, 0);
                         }
                        songListings[tx.data.audioHash] = {
                            available: parseInt(tx.data.sellPercentage) || 0,
                            price: parseFloat(tx.data.pricePerShare) || 0,
                            totalShares: totalTrackShares
                        };
                    }
                }
                if (tx.type === 'EDIT_SONG_METADATA' && tx.data) {
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
                if (tx.type === 'STREAM_COMPLETED' && tx.data) {
                    playCounts[tx.data.audioHash] = (playCounts[tx.data.audioHash] || 0) + 1;
                }
                if (tx.type === 'BUY_SONG_SHARE' && tx.data) {
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
                if (tx.type === 'LIKE_POST' && tx.data) {
                    likeCounts[tx.data.txHash] = (likeCounts[tx.data.txHash] || 0) + 1;
                }
                if (tx.type === 'REPLY_POST' && tx.data) {
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
                if (tx.type === 'DELETE_POST' && tx.data) {
                    // Security check: Only the original creator can delete their post
                    // or the reposter can delete their repost
                    if (postOwners[tx.data.txHash] === tx.sender) {
                        deletedPosts.add(tx.data.txHash);
                    }
                }
                if (tx.type === 'EDIT_POST_METADATA' && tx.data) {
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
                if (['SONG_UPLOAD', 'TEXT_POST', 'PROFILE_UPDATE', 'FOLLOW_USER', 'LIKE_POST', 'LIKE_IMAGE', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST', 'THEME_UPDATE', 'SHOUTBOX_POST', 'SET_TOP_8', 'STREAM_COMPLETED', 'BUY_SONG_SHARE', 'TRANSFER_COIN', 'REQUEST_SONG_SHARE', 'ACCEPT_SHARE_REQUEST', 'STORY_POST', 'PURCHASE_ZINE_RIGHTS', 'REPOST_POST', 'LIST_SONG_STAKE', 'GOAL_REWARD'].includes(tx.type)) {
                    
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
                        data: tx.data ? { ...tx.data } : {},
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
            if (item.type === 'REPOST_POST' && item.data) {
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
        
        // Bundle the profile directory with the feed to prevent client-side race conditions
        const profiles = this.getProfileDirectory();
        feedCache = { feed: sortedFeed, profiles: profiles }; // Store result in cache
        return feedCache;
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
                        sales: 0,
                        key: tx.data.key,
                        bpm: tx.data.bpm,
                        timestamp: tx.timestamp
                    };
                }
                if (tx.type === 'BUY_ITEM') {
                    if (items[tx.data.itemId]) items[tx.data.itemId].sales += 1;
                }
                if (tx.type === 'EDIT_ITEM') {
                    if (items[tx.data.itemId] && items[tx.data.itemId].seller === tx.sender) {
                        if (tx.data.title) items[tx.data.itemId].title = tx.data.title;
                        if (tx.data.price) items[tx.data.itemId].price = tx.data.price;
                        if (tx.data.key !== undefined) items[tx.data.itemId].key = tx.data.key;
                        if (tx.data.bpm !== undefined) items[tx.data.itemId].bpm = tx.data.bpm;
                    }
                }
            }
        }
        return {
            bounties: Object.values(bounties).sort((a,b) => b.timestamp - a.timestamp),
            items: Object.values(items).sort((a,b) => b.timestamp - a.timestamp)
        };
    }

    _getActiveCommissionsForUser(chain, publicKey) {
        const allCommissions = {};
        for (const block of chain) {
            for (const tx of block.transactions) {
                if (tx.type === 'CREATE_COMMISSION' && tx.data) {
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
                if (tx.type === 'FULFILL_COMMISSION' && tx.data) {
                    if (allCommissions[tx.data.commissionId] && tx.sender === allCommissions[tx.data.commissionId].creator) {
                        allCommissions[tx.data.commissionId].fulfilled = true;
                    }
                }
            }
        }
        return Object.values(allCommissions)
            .filter(c => !c.fulfilled && (c.buyer === publicKey || c.creator === publicKey))
            .sort((a,b) => b.timestamp - a.timestamp);
    }

    _aggregatePlaylistData(chain, publicKey) {
        const userLikes = new Set();
        const userReposts = [];
        const allPlaylists = {};

        const artistPlaylistId = `artist-playlist-${publicKey}`;
        allPlaylists[artistPlaylistId] = {
            id: artistPlaylistId,
            user_id: publicKey,
            title: "Uploaded Tracks",
            type: 'artist',
            is_public: true,
            track_order: [],
            isAutoPlaylist: true,
        };

        for (const block of chain) {
            for (const tx of block.transactions) {
                if (tx.sender === publicKey) {
                    if (tx.type === 'LIKE_SONG') userLikes.add(tx.data.songId);
                    if (tx.type === 'UNLIKE_SONG') userLikes.delete(tx.data.songId);
                    if (tx.type === 'REPOST_POST') userReposts.push({ originalTxHash: tx.data.originalTxHash });
                    if (tx.type === 'SONG_UPLOAD') allPlaylists[artistPlaylistId].track_order.push(tx.data.audioHash);

                    if (tx.type === 'CREATE_PLAYLIST' && tx.data) {
                        allPlaylists[block.hash] = {
                            id: block.hash, user_id: tx.sender, title: tx.data.title, type: tx.data.type || 'listener',
                            is_public: tx.data.isPublic, track_order: tx.data.initialTrackHash ? [tx.data.initialTrackHash] : [],
                            created_at: tx.timestamp, updated_at: tx.timestamp
                        };
                    }
                    if (tx.type === 'ADD_TO_PLAYLIST') {
                        const p = allPlaylists[tx.data.playlistId];
                        if (p && !p.track_order.includes(tx.data.trackHash)) { p.track_order.push(tx.data.trackHash); p.updated_at = tx.timestamp; }
                    }
                    if (tx.type === 'UPDATE_PLAYLIST_DETAILS') {
                        const p = allPlaylists[tx.data.playlistId];
                        if (p) { if (tx.data.title) p.title = tx.data.title; if (typeof tx.data.isPublic === 'boolean') p.is_public = tx.data.isPublic; p.updated_at = tx.timestamp; }
                    }
                    if (tx.type === 'DELETE_PLAYLIST') delete allPlaylists[tx.data.playlistId];
                    if (tx.type === 'REORDER_PLAYLIST_TRACKS' && Array.isArray(tx.data.trackOrder)) {
                        const p = allPlaylists[tx.data.playlistId]; if (p) p.track_order = tx.data.trackOrder;
                    }
                }
            }
        }
        return { userLikes, userReposts, allPlaylists };
    }

    getEventCalendar() {
        const chain = blockchainService.getChain();
        const deletedUsers = getDeletedUsers(chain);
        const events = [];

        for (const block of chain) {
            for (const tx of block.transactions) {
                if (deletedUsers.has(tx.sender)) continue;
                if (tx.type === 'IMAGE_POST' && tx.data && tx.data.isFlyer && tx.data.eventDetails) {
                    events.push({
                        id: block.hash,
                        sender: tx.sender,
                        title: tx.data.eventDetails.title || 'Untitled Event',
                        date: tx.data.eventDetails.date || 'TBD',
                        time: tx.data.eventDetails.time || 'TBD',
                        location: tx.data.eventDetails.location || 'TBD',
                        flyerHash: tx.data.imageHash,
                        timestamp: tx.timestamp
                    });
                }
            }
        }
        
        return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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

    getCirculatingSupply() {
        const chain = blockchainService.getChain();
        const deletedUsers = getDeletedUsers(chain);

        let totalMinted = 0;
        let totalBurned = 0;
        const referrals = {};

        // 1. Calculate initial airdrops from all non-deleted profiles
        const liveProfiles = this.getProfileDirectory();
        const profileCount = Object.keys(liveProfiles).length;
        totalMinted += profileCount * 100000;

        // Transaction Fees (Burns)
        const fees = {
            'SONG_UPLOAD': 50000,
            'IMAGE_POST': 5000,
            'PROJECT_FILE_POST': 15000,
            'LIST_ITEM': 500,
        };

        for (const block of chain) {
            for (const tx of block.transactions) {
                if (deletedUsers.has(tx.sender)) continue;
                
                if (tx.type === 'PROFILE_UPDATE' && tx.data && tx.data.referrer && !referrals[tx.sender]) {
                    referrals[tx.sender] = tx.data.referrer;
                }

                // --- Mints (excluding airdrops) ---
                if (tx.type === 'STREAM_COMPLETED') {
                    totalMinted += 5000; // Listener reward
                    totalMinted += 20000; // Creator/Shareholder pool
                    if (referrals[tx.sender]) totalMinted += 100;
                }
                if (tx.type === 'LIKE_POST' || tx.type === 'LIKE_IMAGE') {
                    totalMinted += 500; // Liker reward
                    totalMinted += 2000; // Creator reward
                }
                if (tx.type === 'VOTE_HOT_OR_NOT') {
                    totalMinted += 100; // Voter reward
                    if (tx.data.vote === 1) {
                        totalMinted += 500; // Submitter reward for upvote
                    }
                }
                if (tx.type === 'ADMIN_MINT') {
                    totalMinted += parseFloat(tx.data.amount) || 0;
                }
                if (tx.type === 'GOAL_REWARD') {
                    totalMinted += parseFloat(tx.data.amount) || 0;
                }
                
                if (tx.type === 'BUY_ITEM' && tx.data && tx.data.price) {
                    if (referrals[tx.sender]) totalMinted += (parseFloat(tx.data.price) || 0) * 0.02;
                }
                if (tx.type === 'BUY_SONG_SHARE' && tx.data) {
                    if (referrals[tx.sender]) totalMinted += (parseInt(tx.data.shareCount) || 0) * (parseFloat(tx.data.pricePerShare) || 0) * 0.02;
                }
                if (tx.type === 'PURCHASE_ZINE_RIGHTS' && tx.data && tx.data.price) {
                    if (referrals[tx.sender]) totalMinted += (parseFloat(tx.data.price) || 0) * 0.02;
                }

                // --- Burns ---
                if (fees[tx.type]) {
                    totalBurned += fees[tx.type];
                }
                if (tx.type === 'VIDEO_POST' && tx.data.fileSize) {
                    const baseFee = 5000000;
                    const sizeFee = (tx.data.fileSize / 1024) * 100; // 100 $VOD per KB
                    totalBurned += (baseFee + sizeFee);
                }
                if (tx.type === 'BUY_ITEM' && tx.data.price) {
                    const tax = (parseFloat(tx.data.price) || 0) * 0.05; // 5% marketplace tax
                    totalBurned += tax;
                }
            }
        }

        return {
            totalMinted,
            totalBurned,
            circulatingSupply: totalMinted - totalBurned
        };
    }
}

module.exports = new ProfileService();