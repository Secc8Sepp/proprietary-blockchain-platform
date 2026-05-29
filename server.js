const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const webpush = require('web-push');

const socialRoutes = require('./routes/social');
const feedRoutes = require('./routes/feed');
const blockchainService = require('./services/blockchainService');
const profileService = require('./services/profileService');


const app = express();
const server = http.createServer(app);
const io = new Server(server);

const CHAT_DB_FILE = path.join(__dirname, 'chat_db.json');

// Temporary Memory for Chat & Mining Sessions
const dbMemory = {
    servers: {
        'vod-main': {
            id: 'vod-main',
            name: 'VOD Main Swarm',
            owner: 'SYSTEM',
            channels: {
                'general': { id: 'general', name: 'general-scene', locked: false, messages: [] },
                'beats': { id: 'beats', name: 'beat-ciphers', locked: false, messages: [] },
                'whale': { id: 'whale', name: 'whale-lounge', locked: true, messages: [] }
            }
        }
    },
    l2eSessions: {},
    connectedNodes: {},
    zineArticles: [],
    directMessages: []
};

if (fs.existsSync(CHAT_DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(CHAT_DB_FILE, 'utf8'));
        if (data.servers) dbMemory.servers = data.servers;
        if (data.directMessages) dbMemory.directMessages = data.directMessages;
        if (data.zineArticles) dbMemory.zineArticles = data.zineArticles;
    } catch (e) {
        console.error('Error loading DB file:', e);
    }
}

const IPFS_DIR = path.join(__dirname, 'mock_ipfs');
if (!fs.existsSync(IPFS_DIR)) {
    fs.mkdirSync(IPFS_DIR);
}
const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR);
}


app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// BEST PRACTICE: Serve static files before any other routes to ensure
// requests for images, CSS, etc., are handled first.
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// WEB PUSH API SETUP
// ==========================================
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn("⚠️ VAPID keys not found in environment variables. Push notifications will be disabled. Run 'npx web-push generate-vapid-keys' to create them.");
} else {
    webpush.setVapidDetails('mailto:admin@vod.network', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}
const pushSubscriptions = {};

app.get('/api/push/vapidPublicKey', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});
app.post('/api/push/subscribe', (req, res) => {
    const body = req.body || {};
    const { address, subscription } = body;
    if (!address || !subscription) return res.status(400).json({ error: 'Missing push data' });
    if (!pushSubscriptions[address]) pushSubscriptions[address] = [];
    pushSubscriptions[address].push(subscription);
    res.status(201).json({});
});

app.get('/api/config/maps', (req, res) => {
    // Expose the public Google Maps API key to the frontend
    res.json({ apiKey: process.env.GOOGLE_MAPS_API_KEY });
});

function sendPushNotification(address, payload) {
    const subs = pushSubscriptions[address] || [];
    subs.forEach(sub => webpush.sendNotification(sub, JSON.stringify(payload)).catch(e => console.error('Push Error:', e)));
}

app.set('sendPushNotification', sendPushNotification);
app.set('getProfileDirectory', () => profileService.getProfileDirectory());
app.set('connectedNodes', dbMemory.connectedNodes);

// ==========================================
// SYSTEM DIAGNOSTIC TOOL (For Server Debugging)
// ==========================================
app.get('/api/debug/system', (req, res) => {
    const ledgerPath = path.join(__dirname, 'ledger-data', 'chain.json');
    let chainStatus = "Not Found";
    let chainLength = 0;
    if (fs.existsSync(ledgerPath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
            chainStatus = "Valid JSON";
            chainLength = parsed.length;
        } catch (e) {
            chainStatus = "INVALID JSON ERROR: " + e.message;
        }
    }
    res.json({ appRoot: __dirname, expectedChainPath: ledgerPath, chainStatus, chainLength });
});

// 1. API ROUTES
app.use('/api/social', socialRoutes);
app.use('/api/feed', feedRoutes);
try {
    app.use('/api/tools', require('./routes/tools'));
} catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
        console.warn("⚠️  './routes/tools.js' not found, skipping. AI Stem Splitter will be disabled.");
    } else { throw e; }
}

app.get('/api/social/hotornot', (req, res) => {
    res.json(require('./services/profileService').getHotOrNotEngine());
});

// 2. THE STORAGE ROUTE 
app.get('/tracks/:filename', (req, res, next) => {
    const filename = req.params.filename;
    if (!filename || filename.includes('..') || filename.includes('/')) {
        return res.status(400).send('Invalid filename');
    }
    const filePath = path.join(IPFS_DIR, filename);
    if (fs.existsSync(filePath)) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Accept-Ranges', 'bytes');
        return res.sendFile(filePath);
    }
    const peers = req.app.get('peers') || [];
    if (peers.length > 0) {
        return res.redirect(`${peers[0]}/tracks/${filename}`);
    }
    res.status(404).send('Asset missing from swarm');
});

// 3. STATIC ASSETS
app.use('/tmp', express.static(path.join(__dirname, 'tmp')));

// 4. FALLBACK
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.set('socketio', io);

// ==========================================
// P2P FULL NODE SYNC (Backend Mesh)
// ==========================================
const defaultPeers = []; // Localhost standalone mode
const PEERS = process.env.PEERS ? process.env.PEERS.split(',') : defaultPeers;
app.set('peers', PEERS);

app.post('/api/network/register', (req, res) => {
    const body = req.body || {};
    const { peerUrl } = body;
    if (peerUrl && !PEERS.includes(peerUrl)) {
        PEERS.push(peerUrl);
        console.log(`🔗 New Full Node connected to swarm: ${peerUrl}`);
    }
    res.json({ success: true, chain: blockchainService.getChain() });
});

app.post('/api/network/block', (req, res) => {
    const body = req.body || {};
    const { block } = body;
    if (!block) return res.status(400).send('No block provided');
    const currentChain = blockchainService.getChain();
    const latestBlock = currentChain.length > 0 ? currentChain[currentChain.length - 1] : { index: -1 };
    if (block && block.index > latestBlock.index) {
        currentChain.push(block);
        blockchainService.saveChain(currentChain);
        
        // Incrementally update the profile cache instead of rebuilding from scratch
        if (block.transactions && block.transactions.length > 0) {
            block.transactions.forEach(tx => {
                if (tx.type === 'PROFILE_UPDATE' || tx.type === 'ADMIN_DELETE_USER') profileService.getProfileDirectory(); // This will invalidate and rebuild the cache if needed
                
                extractAndSyncHashes(tx);
            });

            io.emit('blockchain_update', { type: block.transactions[0].type, transaction: block.transactions[0] });
        } else {
            io.emit('blockchain_update', { type: 'SYSTEM_SYNC' });
        }
        console.log(`📦 Synced P2P Block from network: ${block.hash}`);
    }
    res.send('ok');
});

// ==========================================
// ATOMIC STATE MUTATORS
// ==========================================

/**
 * Safely finds and increments the like count for a Zine article.
 * This is a synchronous, atomic operation within Node's event loop.
 * @param {string} articleId The ID of the article to like.
 * @returns {object|null} The updated article object or null if not found.
 */
function incrementArticleLike(articleId) {
    if (!articleId) return null;
    const article = dbMemory.zineArticles.find(a => a.id === articleId);
    if (article) {
        // This read-modify-write operation is atomic for a single event loop tick.
        article.likes = (article.likes || 0) + 1;
        return article;
    }
    return null;
}

function addReactionToMessage(serverId, channelId, msgId, emoji) {
    const msg = dbMemory.servers[serverId]?.channels[channelId]?.messages.find(m => (m.time + '_' + (m.sender || '').substring(0, 5)) === msgId);
    if (!msg) return false;
    if (!msg.reactions) msg.reactions = [];
    msg.reactions.push(emoji);
    return true;
}

/**
 * Scrubs all data related to a deleted user from the in-memory database
 * and disconnects their active sockets.
 * @param {string} deletedUserAddress The public key of the user to purge.
 */
function purgeDeletedUserData(deletedUserAddress) {
    if (!deletedUserAddress) return;
    console.log(`[PURGE] Executing data purge for deleted user: ${deletedUserAddress.substring(0,8)}...`);

    // 1. Disconnect active sockets for the user
    for (const socketId in dbMemory.connectedNodes) {
        if (dbMemory.connectedNodes[socketId].address === deletedUserAddress) {
            const targetSocket = io.sockets.sockets.get(socketId);
            if (targetSocket) {
                targetSocket.emit('force_logout', { message: 'Your account has been deleted by an administrator.' });
                targetSocket.disconnect(true);
                console.log(`[PURGE] Disconnected active socket ${socketId} for deleted user.`);
            }
        }
    }

    // 2. Purge from in-memory chat servers and messages
    for (const serverId in dbMemory.servers) {
        const server = dbMemory.servers[serverId];
        for (const channelId in server.channels) {
            server.channels[channelId].messages = server.channels[channelId].messages.filter(msg => msg.sender !== deletedUserAddress);
        }
    }

    // 3. Purge from direct messages and zine articles
    dbMemory.directMessages = (dbMemory.directMessages || []).filter(msg => msg.sender !== deletedUserAddress && msg.to !== deletedUserAddress);
    dbMemory.zineArticles = (dbMemory.zineArticles || []).filter(art => art.author !== deletedUserAddress);
    dbMemory.zineArticles.forEach(art => { art.ownersList = art.ownersList.filter(owner => owner !== deletedUserAddress); });

    saveDBMemory(); // Persist the cleanup
    profileService.getProfileDirectory(); // Invalidate and rebuild profile cache to reflect deletion
    console.log(`[PURGE] Completed data purge for ${deletedUserAddress.substring(0,8)}...`);
}

// ==========================================
// 5. WEBSOCKETS (Chat & Anti-Cheat Mining)
// ==========================================

function saveDBMemory() {
    try {
        fs.writeFileSync(CHAT_DB_FILE, JSON.stringify({
            servers: dbMemory.servers,
            directMessages: dbMemory.directMessages,
            zineArticles: dbMemory.zineArticles
        }, null, 2));
    } catch (e) { console.error('Error saving DB file:', e); }
}

function broadcastSwarmUpdate() {
    const uniqueNodes = {};
    for (const id in dbMemory.connectedNodes) {
        const node = dbMemory.connectedNodes[id];
        // Group by address, prioritize 'online' status if multiple tabs are open
        if (!uniqueNodes[node.address] || node.status === 'online') {
            uniqueNodes[node.address] = { ...node, socketId: id }; // Expose socket ID for P2P routing
        }
    }
    io.emit('swarm_update', Object.values(uniqueNodes));
}

io.on('connection', (socket) => {
    console.log(`📡 New Node Connected: ${socket.id}`);

    socket.on('register_node', (data) => {
        if (!data || !data.address) return;
        dbMemory.connectedNodes[socket.id] = { address: data.address, status: 'online', activity: null };
        socket.emit('profile_directory', profileService.getProfileDirectory());
        socket.emit('zine_update', dbMemory.zineArticles);
        
        // Sync offline / historical DMs securely to the registered node
        if (dbMemory.directMessages) {
            const myDMs = dbMemory.directMessages.filter(m => m.sender === data.address || m.to === data.address);
            myDMs.forEach(msg => socket.emit('direct_message', msg));
        }
        
        broadcastSwarmUpdate();
    });
    
    socket.on('get_zine_data', () => {
        socket.emit('zine_update', dbMemory.zineArticles);
    });

    socket.on('publish_article', (data) => {
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode || !senderNode.address) return console.error(`[SECURITY] 'publish_article' from unauthenticated socket ${socket.id}`);

        if (!data || !data.title || !data.body || !data.price) return;
        const article = {
            id: 'art_' + Date.now(),
            title: data.title,
            body: data.body,
            price: data.price,
            author: senderNode.address,
            tags: data.tags || '',
            ownersList: [],
            likes: 0,
            timestamp: Date.now()
        };
        dbMemory.zineArticles.push(article);
        saveDBMemory();
        io.emit('zine_update', dbMemory.zineArticles);
    });

    socket.on('like_article', (articleId) => {
        const article = incrementArticleLike(articleId);
        if (article) {
            saveDBMemory();
            io.emit('zine_update', dbMemory.zineArticles);

            // --- NOTIFICATION ---
            const likerNode = dbMemory.connectedNodes[socket.id];
            if (likerNode && article.author !== likerNode.address) {
                const likerProfile = profileService.getProfileDirectory()[likerNode.address] || { username: `Node_${likerNode.address.substring(0,6)}` };
                sendPushNotification(article.author, {
                    title: 'Zine Article Liked ❤️',
                    body: `${likerProfile.username} liked your article: "${(article.title || '').substring(0, 40)}..."`
                });
            }
        }
    });

    socket.on('request_profile_directory', () => {
        socket.emit('profile_directory', profileService.getProfileDirectory());
    });

    socket.on('update_presence', (data) => {
        if (!data) return;
        const node = dbMemory.connectedNodes[socket.id];
        if (node) {
            if (data.status !== undefined) node.status = data.status;
            if (data.activity !== undefined) node.activity = data.activity;
            if (data.track !== undefined) node.track = data.track;
            broadcastSwarmUpdate();
        }
    });

    // --- DISCORD CHAT MODULE ---
    socket.on('get_servers', () => {
        const serverList = Object.values(dbMemory.servers).map(srv => ({
            id: srv.id,
            name: srv.name,
            channels: Object.values(srv.channels).map(ch => ({ id: ch.id, name: ch.name, locked: ch.locked }))
        }));
        socket.emit('server_list', serverList);
    });

    socket.on('create_server', (data) => {
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode || !senderNode.address) return console.error(`[SECURITY] 'create_server' from unauthenticated socket ${socket.id}`);

        if (!data || !data.serverName) return;
        const { serverName } = data;
        const serverId = 'srv_' + Date.now() + Math.floor(Math.random()*1000);
        const generalChannelId = 'ch_' + Date.now();
        dbMemory.servers[serverId] = {
            id: serverId,
            name: serverName,
            owner: senderNode.address,
            channels: {}
        };
        dbMemory.servers[serverId].channels[generalChannelId] = { id: generalChannelId, name: 'general', locked: false, messages: [] };
        saveDBMemory();
        
        io.emit('server_created', {
            id: serverId,
            name: serverName,
            channels: [{ id: generalChannelId, name: 'general', locked: false }]
        });
    });

    socket.on('create_channel', (data) => {
        if (!data || !data.serverId || !data.channelName || !data.address) return;
        const { serverId, channelName, address, locked } = data;
        if (dbMemory.servers[serverId]) {
            const channelId = 'ch_' + Date.now() + Math.floor(Math.random()*1000);
            dbMemory.servers[serverId].channels[channelId] = { id: channelId, name: channelName, locked: !!locked, messages: [] };
            saveDBMemory();
            io.emit('channel_created', { serverId, channel: { id: channelId, name: channelName, locked: !!locked } });
        }
    });

    socket.on('join_channel', (data) => {
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode || !senderNode.address) return console.error(`[SECURITY] 'join_channel' from unauthenticated socket ${socket.id}`);

        if (!data || !data.serverId || !data.channelId) return;
        const { serverId, channelId } = data;
        
        const server = dbMemory.servers[serverId];
        if (server && server.channels[channelId]) {
            const channel = server.channels[channelId];
            
            // --- 3.2 Token-Gated Backrooms ---
            if (channel.locked) {
                const chain = blockchainService.getChain();
                const adminAddress = blockchainService.getAdminAddress(chain);
                
                if (senderNode.address !== adminAddress) {
                    const balance = blockchainService.calculateBalance(senderNode.address, chain);
                    if (balance < 10000) {
                        return socket.emit('chat_error', { 
                            message: `Access Denied: The #${channel.name} Backroom requires 10,000 $VOD. Your balance: ${balance.toFixed(0)}` 
                        });
                    }
                }
            }

        // Unjoin previous channels
        for (const room of socket.rooms) {
            if (room !== socket.id) socket.leave(room);
        }
        
        const roomName = `${serverId}_${channelId}`;
        socket.join(roomName);

        socket.emit('chat_history', channel.messages.slice(-50));
        }
    });

    socket.on('send_message', (data) => {
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode || !senderNode.address) return console.error(`[SECURITY] 'send_message' from unauthenticated socket ${socket.id}`);

        if (!data || !data.serverId || !data.channelId || typeof data.text === 'undefined') return;
        const { serverId, channelId, text } = data;
        const server = dbMemory.servers[serverId];
        if (server && server.channels[channelId]) {
            const chain = blockchainService.getChain();
            const adminAddress = blockchainService.getAdminAddress(chain);
            const balance = blockchainService.calculateBalance(senderNode.address, chain);
            const roles = [];
            if (senderNode.address === adminAddress) roles.push('admin');
            if (balance >= 10000) roles.push('whale');
            const msg = { sender: senderNode.address, text, time: Date.now(), roles };
            server.channels[channelId].messages.push(msg);
            saveDBMemory();
            io.to(`${serverId}_${channelId}`).emit('new_message', msg);
        }
    });

    socket.on('user_typing', (data) => {
        if (!data || !data.serverId || !data.channelId) return;
        const { serverId, channelId, sender } = data;
        if (serverId === '@dms') {
            const targetSocketId = Object.keys(dbMemory.connectedNodes).find(
                id => dbMemory.connectedNodes[id].address === channelId
            );
            if (targetSocketId) {
                io.to(targetSocketId).emit('user_typing', { serverId: '@dms', channelId: sender, sender });
            }
        } else {
            socket.to(`${serverId}_${channelId}`).emit('user_typing', data);
        }
    });

    socket.on('message_read', (data) => {
        if (!data || !data.to || !data.time) return;
        const { to, time } = data;
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode) return;
        const targetSocketId = Object.keys(dbMemory.connectedNodes).find(
            id => dbMemory.connectedNodes[id].address === to
        );
        if (targetSocketId) {
            io.to(targetSocketId).emit('message_read', { from: senderNode.address, time });
        }
    });

    // --- 1-ON-1 DIRECT MESSAGING & REACTIONS ---
    socket.on('send_direct_message', (data) => {
        if (!data || !data.to || typeof data.text === 'undefined') return;
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode) return;
        
        const chain = blockchainService.getChain();
        const adminAddress = blockchainService.getAdminAddress(chain);
        const balance = blockchainService.calculateBalance(senderNode.address, chain);
        const roles = [];
        if (senderNode.address === adminAddress) roles.push('admin');
        if (balance >= 10000) roles.push('whale');

        // Find target socket by wallet address
        const targetSocketId = Object.keys(dbMemory.connectedNodes).find(
            id => dbMemory.connectedNodes[id].address === data.to
        );
        
        const msgPayload = { sender: senderNode.address, text: data.text, time: Date.now(), to: data.to, roles };
        
        // Store securely on backend to prevent message loss on refresh
        if (!dbMemory.directMessages) dbMemory.directMessages = [];
        dbMemory.directMessages.push(msgPayload);
        saveDBMemory();

        sendPushNotification(data.to, { title: 'New Secure DM 💬', body: `Message from Node_${senderNode.address.substring(0,6)}` });
        
        if (targetSocketId) {
            io.to(targetSocketId).emit('direct_message', msgPayload);
        }
        // Echo back to sender
        socket.emit('direct_message', msgPayload);
    });

    socket.on('add_message_reaction', (data) => {
        if (!data || !data.serverId || !data.channelId || !data.msgId || !data.emoji) return;
        const { serverId, channelId, msgId, emoji } = data;
        
        if (addReactionToMessage(serverId, channelId, msgId, emoji)) {
            saveDBMemory();
            io.to(`${serverId}_${channelId}`).emit('new_reaction', { msgId, emoji });
        }
    });

    // --- NOTIFICATIONS, LIKES & CREW REQUESTS ---
    socket.on('notify_mention', (data) => {
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode || !senderNode.address) return console.error(`[SECURITY] 'notify_mention' from unauthenticated socket ${socket.id}`);

        if (!data || !data.target) {
            return; // Invalid data, ignore.
        }
        const { target } = data;
        const fromProfile = profileService.getProfileDirectory()[senderNode.address] || { username: `Node_${senderNode.address.substring(0,6)}` };
        const payload = {
            title: 'You were mentioned! 💬',
            body: `${fromProfile.username} mentioned you in a post.`
        };
        // Send web push for background users
        sendPushNotification(target, payload);
        // Send socket event for active users
        const targetSocketId = Object.keys(dbMemory.connectedNodes).find(id => dbMemory.connectedNodes[id].address === target);
        if (targetSocketId) io.to(targetSocketId).emit('new_notification', payload);
    });

    socket.on('send_crew_request', (data) => {
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode || !senderNode.address) return console.error(`[SECURITY] 'send_crew_request' from unauthenticated socket ${socket.id}`);

        if (!data || !data.target) {
            return; // Invalid data, ignore.
        }
        const { target } = data;
        const targetSocketId = Object.keys(dbMemory.connectedNodes).find(
            id => dbMemory.connectedNodes[id].address === target
        );
        if (targetSocketId) {
            io.to(targetSocketId).emit('crew_request_received', { from: senderNode.address });
        }
        const fromProfile = profileService.getProfileDirectory()[senderNode.address] || { username: `Node_${senderNode.address.substring(0,6)}` };
        sendPushNotification(target, {
            title: 'New Crew Request 🤝',
            body: `${fromProfile.username} wants to lock in with you!`
        });
    });

    socket.on('like_post', (data) => {
        if (!data || !data.txHash) return;
        socket.broadcast.emit('post_liked', data);
    });

    socket.on('reply_post', (data) => {
        if (!data || !data.txHash || typeof data.text === 'undefined') return;
        socket.broadcast.emit('post_replied', data);
    });

    // --- WEBRTC VOICE CHANNELS ---
    socket.on('webrtc_join_voice', (data) => {
        if (!data || !data.serverId || !data.channelId || !data.address) return;
        const voiceRoom = `voice_${data.serverId}_${data.channelId}`;
        socket.join(voiceRoom);
        // Notify others in the voice room to initiate P2P offer
        socket.to(voiceRoom).emit('webrtc_user_joined', { socketId: socket.id, address: data.address });
    });
    socket.on('webrtc_offer', (data) => {
        if (data && data.target) io.to(data.target).emit('webrtc_offer', { sdp: data.sdp, sender: socket.id });
    });
    socket.on('webrtc_answer', (data) => {
        if (data && data.target) io.to(data.target).emit('webrtc_answer', { sdp: data.sdp, sender: socket.id });
    });
    socket.on('webrtc_ice_candidate', (data) => {
        if (data && data.target) io.to(data.target).emit('webrtc_ice_candidate', { candidate: data.candidate, sender: socket.id });
    });

    // --- WEBRTC BROWSER DATA MESH SIGNALING ---
    socket.on('mesh_offer', (data) => {
        if (data && data.target) io.to(data.target).emit('mesh_offer', { sdp: data.sdp, sender: socket.id });
    });
    socket.on('mesh_answer', (data) => {
        if (data && data.target) io.to(data.target).emit('mesh_answer', { sdp: data.sdp, sender: socket.id });
    });
    socket.on('mesh_ice_candidate', (data) => {
        if (data && data.target) io.to(data.target).emit('mesh_ice_candidate', { candidate: data.candidate, sender: socket.id });
    });

    // --- SECURE LISTEN-TO-EARN ENGINE ---
    socket.on('l2e_ping', (data) => {
        if (!data || !data.address || !data.trackHash) return;
        const { address, trackHash } = data;
        const now = Date.now();
        let session = dbMemory.l2eSessions[socket.id];

        // 1. Initialize session if new song
        if (!session || session.activeTrack !== trackHash) {
            dbMemory.l2eSessions[socket.id] = { activeTrack: trackHash, pings: 1, lastPingTime: now };
            return socket.emit('l2e_status', { pings: 1, max: 6 });
        }

        // 2. Anti-Cheat: Ensure pings aren't happening faster than 5 seconds
        if (now - session.lastPingTime < 4500) { // 500ms grace period for network lag
            return socket.emit('l2e_status', { error: "Validation failed. Speedhacking detected." });
        }

        session.pings += 1;
        session.lastPingTime = now;

        // 3. Reward logic: 6 pings (30 seconds) = Trigger Reward
        if (session.pings >= 6) {
            session.pings = 0; // Reset for next payout
            
            // NOTE: In your real app, you will need to update the balance in your database here!
            // Example: updateDatabaseBalance(address, 50);
            
            socket.emit('l2e_reward', { newBalance: "Balance Updated (+50)", reward: 50 });
        } else {
            socket.emit('l2e_status', { pings: session.pings, max: 6 });
        }
    });

    socket.on('disconnect', () => {
        delete dbMemory.l2eSessions[socket.id]; // Clean up mining sessions
        if (dbMemory.connectedNodes[socket.id]) {
            delete dbMemory.connectedNodes[socket.id];
            broadcastSwarmUpdate();
        }
        console.log(`🔌 Node Disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 VOD ENGINE ONLINE: http://localhost:${PORT}`);
    
    // Bootstrap initial connections to other Dedicated Servers/PCs
    function bootstrapSwarm() {
        if (PEERS.length > 0) {
            console.log("🌐 Bootstrapping to global Swarm...");
            PEERS.forEach(peerUrl => {
                if (globalThis.fetch) {
                    fetch(`${peerUrl}/api/network/register`, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'ngrok-skip-browser-warning': 'true'
                        },
                        body: JSON.stringify({ peerUrl: `http://localhost:${PORT}` })
                    }).then(res => res.json()).then(data => {
                        if (data.chain && data.chain.length > blockchainService.getChain().length) {
                            console.log(`📥 Downloaded larger ledger from ${peerUrl}`);
                            blockchainService.saveChain(data.chain);
                            profileService.getProfileDirectory(); // Invalidate cache
                            io.emit('blockchain_update', { type: 'SYSTEM_SYNC' }); // Tell browsers to refresh!
                            data.chain.forEach(block => {
                                if (block.transactions && Array.isArray(block.transactions)) {
                                    block.transactions.forEach(extractAndSyncHashes);
                                }
                            });
                        }
                    }).catch(e => { // NOSONAR
                        console.error(`[P2P] Bootstrap failed for peer ${peerUrl}:`, e.message, `- Retrying in 30s...`);
                        setTimeout(bootstrapSwarm, 30000);
                    });
                }
            });
        }
    }
    bootstrapSwarm();

    // Listen for new blocks and actively forward them to the cloud/PC
    blockchainService.on('new_block', (block) => {
        PEERS.forEach(peerUrl => {
            if (globalThis.fetch) {
                fetch(`${peerUrl}/api/network/block`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
                    body: JSON.stringify({ block })
                }).catch(e => {
                    console.error(`[P2P] Failed to broadcast block to peer ${peerUrl}:`, e.message);
                });
            }
        });
        if (block.transactions && block.transactions.length > 0) {
            block.transactions.forEach(extractAndSyncHashes);

            // Update in-memory state based on new transactions
            block.transactions.forEach(tx => {
                if (tx.type === 'PURCHASE_ZINE_RIGHTS' && tx.data) {
                    const article = dbMemory.zineArticles.find(a => a.id === tx.data.articleId);
                    if (article && !article.ownersList.includes(tx.sender)) {
                        article.ownersList.push(tx.sender);
                        saveDBMemory();
                        io.emit('zine_update', dbMemory.zineArticles); // Notify all clients of the ownership change
                        console.log(`📰 Article Rights Updated via Ledger: ${article.title} by ${tx.sender}`);
                    }
                } else if (tx.type === 'ADMIN_DELETE_USER' && tx.receiver) {
                    // Trigger the purge of the user's data from the in-memory database
                    purgeDeletedUserData(tx.receiver);
                    }
            });
        }
    });
});

async function extractAndSyncHashes(tx) {
    try {
        if (!tx.data) return;
        const hashes = [tx.data.audioHash, tx.data.imageHash, tx.data.videoHash, tx.data.fileHash, tx.data.avatarHash, tx.data.bannerHash, tx.data.coverHash, tx.data.sectionImages].filter(Boolean);
        
        for (const hash of hashes) {
            const filePath = path.join(IPFS_DIR, hash);
            if (!fs.existsSync(filePath)) {
                for (const peer of PEERS) {
                    try {
                        const response = await fetch(`${peer}/tracks/${hash}`, {
                            headers: {
                                'ngrok-skip-browser-warning': 'true'
                            }
                        });
                        if (response.ok) {
                            console.log(`📥 Swarm Sync: Downloaded missing asset ${hash} from ${peer}`);
                            const buffer = await response.arrayBuffer();
                            fs.writeFileSync(filePath, Buffer.from(buffer));
                            break; 
                        }
                    } catch (err) {
                        console.error(`[P2P] Asset sync failed for ${hash} from peer ${peer}:`, err.message);
                    }
                }
            }
        }
    } catch (err) {
        console.error("Swarm Sync Error:", err);
    }
}