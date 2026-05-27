const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');

const authRoutes = require('./routes/auth');
const socialRoutes = require('./routes/social');
const feedRoutes = require('./routes/feed');
const blockchainService = require('./services/blockchainService');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const IPFS_DIR = path.join(process.cwd(), 'mock_ipfs');
if (!fs.existsSync(IPFS_DIR)) {
    fs.mkdirSync(IPFS_DIR);
}

// ==========================================
// WEB PUSH API SETUP
// ==========================================
const vapidKeys = webpush.generateVAPIDKeys();
webpush.setVapidDetails('mailto:admin@vod.network', vapidKeys.publicKey, vapidKeys.privateKey);
const pushSubscriptions = {};

app.get('/api/push/vapidPublicKey', (req, res) => res.json({ publicKey: vapidKeys.publicKey }));
app.post('/api/push/subscribe', (req, res) => {
    const { address, subscription } = req.body;
    if (!pushSubscriptions[address]) pushSubscriptions[address] = [];
    pushSubscriptions[address].push(subscription);
    res.status(201).json({});
});

function sendPushNotification(address, payload) {
    const subs = pushSubscriptions[address] || [];
    subs.forEach(sub => webpush.sendNotification(sub, JSON.stringify(payload)).catch(e => console.error('Push Error:', e)));
}

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// 1. API ROUTES
app.use('/api/auth', authRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/feed', feedRoutes);

app.get('/api/social/hotornot', (req, res) => {
    res.json(require('./services/profileService').getHotOrNotEngine());
});

// 2. THE STORAGE ROUTE 
app.use('/tracks/:filename', (req, res, next) => {
    const filePath = path.join(IPFS_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
        return res.sendFile(filePath, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    const peers = req.app.get('peers') || [];
    if (peers.length > 0) {
        return res.redirect(`${peers[0]}/tracks/${req.params.filename}`);
    }
    res.status(404).send('Asset missing from swarm');
});

// 3. STATIC ASSETS
app.use(express.static(path.join(__dirname, 'public')));

// 4. FALLBACK
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.set('socketio', io);

// ==========================================
// P2P FULL NODE SYNC (Backend Mesh)
// ==========================================
const defaultPeers = ['https://vod-net.onrender.com']; // The main gateway node
const PEERS = process.env.PEERS ? process.env.PEERS.split(',') : defaultPeers;
app.set('peers', PEERS);

app.post('/api/network/register', (req, res) => {
    const { peerUrl } = req.body;
    if (peerUrl && !PEERS.includes(peerUrl)) {
        PEERS.push(peerUrl);
        console.log(`🔗 New Full Node connected to swarm: ${peerUrl}`);
    }
    res.json({ success: true, chain: blockchainService.getChain() });
});

app.post('/api/network/block', (req, res) => {
    const { block } = req.body;
    const currentChain = blockchainService.getChain();
    const latestBlock = currentChain[currentChain.length - 1];
    if (block && block.index > latestBlock.index) {
        currentChain.push(block);
        blockchainService.saveChain(currentChain);
        
        // Incrementally update the profile cache instead of rebuilding from scratch
        block.transactions.forEach(tx => {
            if (tx.type === 'PROFILE_UPDATE') updateProfileCache(tx);
            
            extractAndSyncHashes(tx);
        });

        io.emit('blockchain_update', { type: block.transactions[0].type, transaction: block.transactions[0] });
        console.log(`📦 Synced P2P Block from network: ${block.hash}`);
    }
    res.send('ok');
});

// ==========================================
// 5. WEBSOCKETS (Chat & Anti-Cheat Mining)
// ==========================================

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
    zineArticles: []
};

let profileCache = null;
function getProfileDirectory() {
    if (profileCache) return profileCache;
    // Initial build only happens once or on reset
    profileCache = {}; 
    blockchainService.getChain().forEach(block => {
        block.transactions.forEach(tx => {
            if (tx.type === 'PROFILE_UPDATE') updateProfileCache(tx);
        });
    });
    return profileCache;
}

function updateProfileCache(tx) {
    if (!profileCache) profileCache = {};
    if (!profileCache[tx.sender]) profileCache[tx.sender] = { username: `Node_${tx.sender.substring(0,6)}`, avatarHash: '' };
    if (tx.data.username) profileCache[tx.sender].username = tx.data.username;
    if (tx.data.avatarHash) profileCache[tx.sender].avatarHash = tx.data.avatarHash;
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
        dbMemory.connectedNodes[socket.id] = { address: data.address, status: 'online', activity: null };
        socket.emit('profile_directory', getProfileDirectory());
        socket.emit('zine_update', dbMemory.zineArticles);
        broadcastSwarmUpdate();
    });
    
    socket.on('get_zine_data', () => {
        socket.emit('zine_update', dbMemory.zineArticles);
    });

    socket.on('publish_article', (data) => {
        const article = {
            id: 'art_' + Date.now(),
            title: data.title,
            body: data.body,
            price: data.price,
            author: data.author,
            ownersList: [],
            likes: 0,
            timestamp: Date.now()
        };
        dbMemory.zineArticles.push(article);
        io.emit('zine_update', dbMemory.zineArticles);
    });

    socket.on('like_article', (articleId) => {
        const article = dbMemory.zineArticles.find(a => a.id === articleId);
        if (article) {
            article.likes = (article.likes || 0) + 1;
            io.emit('zine_update', dbMemory.zineArticles);
        }
    });

    socket.on('purchase_article_rights', (articleId) => {
        const buyerNode = dbMemory.connectedNodes[socket.id];
        if (!buyerNode) return;

        const article = dbMemory.zineArticles.find(a => a.id === articleId);
        if (!article) return;

        const chain = blockchainService.getChain();
        const balance = blockchainService.calculateBalance(buyerNode.address, chain);

        if (balance < article.price) {
            return socket.emit('chat_error', { 
                message: `Transaction Denied: Insufficient $VOD. Balance: ${balance.toFixed(0)}, Required: ${article.price}` 
            });
        }

        // 1. Credit Author & Deduct Buyer via Ledger Transaction
        const tx = {
            sender: buyerNode.address,
            receiver: article.author,
            type: 'PURCHASE_ZINE_RIGHTS',
            data: { articleId: article.id, title: article.title },
            amount: article.price,
            timestamp: Date.now()
        };

        // Simulate adding to blockchain state (reusing existing sync logic)
        const latestBlock = chain[chain.length - 1];
        const newBlock = {
            index: latestBlock.index + 1,
            timestamp: Date.now(),
            transactions: [tx],
            prevHash: latestBlock.hash,
            hash: 'p2p_' + Math.random().toString(36).substring(7)
        };
        chain.push(newBlock);
        blockchainService.saveChain(chain);

        // 2. Update In-Memory Rights
        article.ownersList.push(buyerNode.address);
        
        io.emit('zine_update', dbMemory.zineArticles);
        socket.emit('article_purchased', { articleId });
        console.log(`📰 Article Rights Purchased: ${article.title} by ${buyerNode.address}`);
    });

    socket.on('request_profile_directory', () => {
        socket.emit('profile_directory', getProfileDirectory());
    });

    socket.on('update_presence', (data) => {
        const node = dbMemory.connectedNodes[socket.id];
        if (node) {
            if (data.status !== undefined) node.status = data.status;
            if (data.activity !== undefined) node.activity = data.activity;
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
        const { serverName, address } = data;
        const serverId = 'srv_' + Date.now() + Math.floor(Math.random()*1000);
        const generalChannelId = 'ch_' + Date.now();
        dbMemory.servers[serverId] = {
            id: serverId,
            name: serverName,
            owner: address,
            channels: {}
        };
        dbMemory.servers[serverId].channels[generalChannelId] = { id: generalChannelId, name: 'general', locked: false, messages: [] };
        
        io.emit('server_created', {
            id: serverId,
            name: serverName,
            channels: [{ id: generalChannelId, name: 'general', locked: false }]
        });
    });

    socket.on('create_channel', (data) => {
        const { serverId, channelName, address, locked } = data;
        if (dbMemory.servers[serverId]) {
            const channelId = 'ch_' + Date.now() + Math.floor(Math.random()*1000);
            dbMemory.servers[serverId].channels[channelId] = { id: channelId, name: channelName, locked: !!locked, messages: [] };
            io.emit('channel_created', { serverId, channel: { id: channelId, name: channelName, locked: !!locked } });
        }
    });

    socket.on('join_channel', (data) => {
        const { serverId, channelId, address } = data;
        
        const server = dbMemory.servers[serverId];
        if (server && server.channels[channelId]) {
            const channel = server.channels[channelId];
            
            // --- 3.2 Token-Gated Backrooms ---
            if (channel.locked) {
                const chain = blockchainService.getChain();
                const adminAddress = blockchainService.getAdminAddress(chain);
                
                if (address !== adminAddress) {
                    const balance = blockchainService.calculateBalance(address, chain);
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
        const { serverId, channelId, address, text } = data;
        const server = dbMemory.servers[serverId];
        if (server && server.channels[channelId]) {
            const chain = blockchainService.getChain();
            const adminAddress = blockchainService.getAdminAddress(chain);
            const balance = blockchainService.calculateBalance(address, chain);
            const roles = [];
            if (address === adminAddress) roles.push('admin');
            if (balance >= 10000) roles.push('whale');
            const msg = { sender: address, text, time: Date.now(), roles };
            server.channels[channelId].messages.push(msg);
            io.to(`${serverId}_${channelId}`).emit('new_message', msg);
        }
    });

    socket.on('trigger_push', (data) => {
        sendPushNotification(data.target, data.payload);
    });

    socket.on('user_typing', (data) => {
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
        sendPushNotification(data.to, { title: 'New Secure DM 💬', body: `Message from Node_${senderNode.address.substring(0,6)}` });
        
        if (targetSocketId) {
            io.to(targetSocketId).emit('direct_message', msgPayload);
        }
        // Echo back to sender
        socket.emit('direct_message', msgPayload);
    });

    socket.on('add_message_reaction', (data) => {
        const { serverId, channelId, msgId, emoji } = data;
        io.to(`${serverId}_${channelId}`).emit('new_reaction', { msgId, emoji });
    });

    // --- NOTIFICATIONS, LIKES & CREW REQUESTS ---
    socket.on('notify_mention', (data) => {
        const { target, from } = data;
        const targetSocketId = Object.keys(dbMemory.connectedNodes).find(
            id => dbMemory.connectedNodes[id].address === target
        );
        if (targetSocketId) {
            io.to(targetSocketId).emit('mention_notification', { from });
        }
    });

    socket.on('send_crew_request', (data) => {
        const { target, from } = data;
        const targetSocketId = Object.keys(dbMemory.connectedNodes).find(
            id => dbMemory.connectedNodes[id].address === target
        );
        if (targetSocketId) {
            io.to(targetSocketId).emit('crew_request_received', { from });
        }
    });

    socket.on('like_post', (data) => {
        socket.broadcast.emit('post_liked', data);
    });

    socket.on('reply_post', (data) => {
        socket.broadcast.emit('post_replied', data);
    });

    // --- WEBRTC VOICE CHANNELS ---
    socket.on('webrtc_join_voice', (data) => {
        const voiceRoom = `voice_${data.serverId}_${data.channelId}`;
        socket.join(voiceRoom);
        // Notify others in the voice room to initiate P2P offer
        socket.to(voiceRoom).emit('webrtc_user_joined', { socketId: socket.id, address: data.address });
    });
    socket.on('webrtc_offer', (data) => { io.to(data.target).emit('webrtc_offer', { sdp: data.sdp, sender: socket.id }); });
    socket.on('webrtc_answer', (data) => { io.to(data.target).emit('webrtc_answer', { sdp: data.sdp, sender: socket.id }); });
    socket.on('webrtc_ice_candidate', (data) => { io.to(data.target).emit('webrtc_ice_candidate', { candidate: data.candidate, sender: socket.id }); });

    // --- WEBRTC BROWSER DATA MESH SIGNALING ---
    socket.on('mesh_offer', (data) => { io.to(data.target).emit('mesh_offer', { sdp: data.sdp, sender: socket.id }); });
    socket.on('mesh_answer', (data) => { io.to(data.target).emit('mesh_answer', { sdp: data.sdp, sender: socket.id }); });
    socket.on('mesh_ice_candidate', (data) => { io.to(data.target).emit('mesh_ice_candidate', { candidate: data.candidate, sender: socket.id }); });

    // --- SECURE LISTEN-TO-EARN ENGINE ---
    socket.on('l2e_ping', (data) => {
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
                            profileCache = null; // Clear the blank memory cache
                            io.emit('blockchain_update', { type: 'SYSTEM_SYNC' }); // Tell browsers to refresh!
                            data.chain.forEach(block => block.transactions.forEach(extractAndSyncHashes));
                        }
                    }).catch(e => {
                        console.log(`⚠️ Peer offline: ${peerUrl} - Retrying in 30s...`);
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
                }).catch(e => {});
            }
        });
        block.transactions.forEach(extractAndSyncHashes);
    });
});

async function extractAndSyncHashes(tx) {
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
                } catch (err) {}
            }
        }
    }
}