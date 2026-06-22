const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();
const webpush = require('web-push');
const multer = require('multer');

const socialRoutes = require('./routes/social');
const feedRoutes = require('./routes/feed');
const authModule = require('./routes/auth');
const blockchainService = require('./services/blockchainService');
const profileService = require('./services/profileService');
const goalsService = require('./services/goalsService');
const cloutService = require('./services/cloutService');
const Wallet = require('./core/wallet');
const submissionsRoutes = require('./routes/submissions.js');


const app = express();
const server = http.createServer(app);
const cors = require('cors');
const io = new Server(server, { cors: { origin: '*' } });

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
    directMessages: [],
    dailyStreamNotifs: {} // Structure: { 'trackHash': { 'userAddress': 'YYYY-MM-DD' } }
};

if (fs.existsSync(CHAT_DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(CHAT_DB_FILE, 'utf8'));
        if (data.servers) {
            dbMemory.servers = data.servers;
            // Re-inject default server if it was accidentally deleted/corrupted
            if (!dbMemory.servers['vod-main']) {
                dbMemory.servers['vod-main'] = {
                    id: 'vod-main',
                    name: 'VOD Main Swarm',
                    owner: 'SYSTEM',
                    channels: {
                        'general': { id: 'general', name: 'general-scene', locked: false, messages: [] },
                        'beats': { id: 'beats', name: 'beat-ciphers', locked: false, messages: [] },
                        'whale': { id: 'whale', name: 'whale-lounge', locked: true, messages: [] }
                    }
                };
            }
        }
        if (data.directMessages) dbMemory.directMessages = data.directMessages;
        if (data.zineArticles) dbMemory.zineArticles = data.zineArticles;
        if (data.dailyStreamNotifs) dbMemory.dailyStreamNotifs = data.dailyStreamNotifs;
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

// Enable CORS for mobile application wrappers
app.use(cors());

// BEST PRACTICE: Serve static files before any other routes to ensure
// requests for images, CSS, etc., are handled first.
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: path.join(__dirname, 'tmp') });

// File Upload Route (for assets)
app.post('/api/upload', upload.single('asset'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    try {
        const fileBuffer = fs.readFileSync(req.file.path);
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        
        const ext = req.file.originalname ? path.extname(req.file.originalname).toLowerCase() : '';
        const finalName = hash + ext;
        const finalPath = path.join(IPFS_DIR, finalName);
        fs.renameSync(req.file.path, finalPath);

        res.json({ fileHash: finalName, hash: finalName });
    } catch (err) {
        console.error('File upload processing error:', err);
        // Clean up temp file if it exists
        if (fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkErr) {
                console.error('Failed to unlink temp file:', unlinkErr);
            }
        }
        res.status(500).json({ error: 'Failed to process file.' });
    }
});
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
app.set('dailyStreamNotifs', dbMemory.dailyStreamNotifs);

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

// ==========================================
// EMERGENCY AUTHENTICATION GATEWAY
// ==========================================
const AUTH_DB_FILE = path.join(__dirname, 'auth_db.json');
let authMemory = {};
if (fs.existsSync(AUTH_DB_FILE)) {
    try { authMemory = JSON.parse(fs.readFileSync(AUTH_DB_FILE, 'utf8')); } catch(e) {}
}

function safeWriteFile(filePath, dataObj) {
    const dataString = JSON.stringify(dataObj, null, 2);
    const tmpFile = filePath + '.tmp';
    try {
        fs.writeFileSync(tmpFile, dataString, 'utf8');
        try {
            fs.renameSync(tmpFile, filePath);
        } catch (e) {
            fs.writeFileSync(filePath, dataString, 'utf8');
            try { fs.unlinkSync(tmpFile); } catch (err) {}
        }
    } catch (err) {
        try {
            fs.writeFileSync(filePath, dataString, 'utf8');
        } catch (finalErr) {
            console.error(`[CRITICAL] Failed to write to ${filePath}:`, finalErr.message);
            throw finalErr; // Do not swallow critical persistence errors
        }
    }
}

const handleAuthRegistration = async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
        
        const normalizedUser = username.toLowerCase();
        if (authMemory[normalizedUser]) {
            return res.status(409).json({ error: 'Username is already taken.' });
        }

        const wallet = await Wallet.generateKeyPair();
        authMemory[normalizedUser] = {
            username,
            password, 
            publicKey: wallet.publicKey,
            privateKey: wallet.privateKey
        };
        safeWriteFile(AUTH_DB_FILE, authMemory);

        res.json({ publicKey: wallet.publicKey, privateKey: wallet.privateKey });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

app.post('/api/auth/register', handleAuthRegistration);
app.post('/api/auth/signup', handleAuthRegistration);

app.post('/api/auth/login', (req, res, next) => {
    try {
        const { username, password } = req.body;
        const normalizedUser = (username || '').toLowerCase();
        const user = authMemory[normalizedUser];
        
        if (user) {
            if (user.password !== password) return res.status(401).json({ error: 'Invalid password.' });
            return res.json({ publicKey: user.publicKey, privateKey: user.privateKey });
        }
        next(); // Fallback to authModule if user not in emergency DB
    } catch (e) {
        next(e);
    }
});

app.post('/api/auth/sign', async (req, res) => {
    try {
        const { privateKeyHex, dataString } = req.body;
        if (!privateKeyHex || !dataString) return res.status(400).json({ error: 'Missing key or data.' });
        
        const signature = await Wallet.signData(privateKeyHex, dataString);
        res.json({ signature });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

if (authModule) {
    const originalDelete = authModule.deleteUserCredential;
    authModule.deleteUserCredential = (address) => {
        if (typeof originalDelete === 'function') originalDelete(address);
        const userKey = Object.keys(authMemory).find(k => authMemory[k].publicKey === address);
        if (userKey) {
            delete authMemory[userKey];
            safeWriteFile(AUTH_DB_FILE, authMemory);
        }
    };
}

// 1. API ROUTES
app.use('/api/social', socialRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/auth', authModule.router);
app.use('/api/radio', submissionsRoutes);

const toolsRoutes = require('./routes/tools');
app.use('/api/tools', toolsRoutes);

app.get('/api/social/clout', (req, res) => {
    try {
        const profiles = profileService.getProfileDirectory();
        const chain = blockchainService.getChain();
        
        const userStatsMap = {};
        for (const addr in profiles) {
            userStatsMap[addr] = {
                friends: (profiles[addr].followers?.length || 0) + (profiles[addr].following?.length || 0),
                assets: (profiles[addr].uploadedTracks?.length || 0) + (profiles[addr].uploadedImages?.length || 0) + (profiles[addr].ownedItems?.length || 0),
                shares: 0,
                comments: 0,
                likes: 0,
                plays: 0,
                last_active_date: 0,
                historical_rank: profiles[addr].historical_rank || 0
            };
        }
        
        for (const block of chain) {
            if (!block.transactions || !Array.isArray(block.transactions)) continue;
            for (const tx of block.transactions) {
                const sender = tx.sender;
                if (!userStatsMap[sender]) continue;
                
                userStatsMap[sender].last_active_date = Math.max(userStatsMap[sender].last_active_date, tx.timestamp);
                
                if (tx.type === 'LIKE_POST' || tx.type === 'LIKE_IMAGE' || tx.type === 'LIKE_SONG') userStatsMap[sender].likes++;
                if (tx.type === 'REPLY_POST') userStatsMap[sender].comments++;
                if (tx.type === 'STREAM_COMPLETED') userStatsMap[sender].plays++;
                if (tx.type === 'BUY_SONG_SHARE' || tx.type === 'REQUEST_SONG_SHARE') userStatsMap[sender].shares++;
            }
        }
        
        const usersArray = Object.keys(userStatsMap).map(addr => {
            const stats = userStatsMap[addr];
            let daysInactive = stats.last_active_date > 0 ? (Date.now() - stats.last_active_date) / (1000 * 60 * 60 * 24) : 30;
            if (daysInactive < 0) daysInactive = 0;
            const liveClout = cloutService.calculateLiveClout(stats, daysInactive);
            return {
                address: addr,
                liveClout,
                historical_rank: stats.historical_rank
            };
        });
        
        const rankedUsers = cloutService.generateFeedRanks(usersArray);
        res.json(rankedUsers);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/social/hotornot', (req, res) => {
    res.json(require('./services/profileService').getHotOrNotEngine());
});

app.get('/api/social/goals', (req, res) => {
    const { publicKey } = req.query;
    if (!publicKey) return res.status(400).json({ error: 'publicKey is required.' });
    
    res.json(goalsService.getUserGoals(publicKey));
});

app.get('/api/social/events', (req, res) => {
    res.json(profileService.getEventCalendar());
});

app.post('/api/events/scan-flyer', express.json(), async (req, res) => {
    const { imageHash } = req.body;
    try {
        const filePath = path.join(IPFS_DIR, imageHash);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Image not found." });
        }

        if (!process.env.GEMINI_API_KEY) {
            console.warn("⚠️ GEMINI_API_KEY not found in .env. Falling back to mock data.");
            return res.json({
                title: "Underground Swarm Rave",
                date: new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0],
                time: "11:00 PM",
                location: "Warehouse District"
            });
        }

        const imageBuffer = fs.readFileSync(filePath);
        const base64Image = imageBuffer.toString('base64');
        
        // Simple magic byte check for mime type
        const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47;
        const mimeType = isPng ? 'image/png' : 'image/jpeg';

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "Extract the event details from this flyer. Return ONLY a valid JSON object with the exact keys: 'title', 'date', 'time', 'location'. Do not use markdown. If a piece of data is missing, use 'TBD'." },
                        { inline_data: { mime_type: mimeType, data: base64Image } }
                    ]
                }],
                generationConfig: { response_mime_type: "application/json" }
            })
        });

        if (!response.ok) throw new Error(`Gemini API Error: ${await response.text()}`);

        const aiData = await response.json();
        const parsedData = JSON.parse(aiData.candidates[0].content.parts[0].text);

        res.json({
            title: parsedData.title || "Untitled Event",
            date: parsedData.date || "TBD",
            time: parsedData.time || "TBD",
            location: parsedData.location || "TBD"
        });
    } catch (err) {
        console.error("AI Scan Error:", err);
        // Fallback so it doesn't break the user's upload flow if the AI gets confused
        res.json({ title: "Untitled Event", date: "TBD", time: "TBD", location: "TBD" });
    }
});

app.get('/api/feed/discover', (req, res) => {
    const { publicKey } = req.query;
    const { feed: feedItems } = profileService.getFeedEngine();

    // Filter for recent public song uploads
    let discoverItems = feedItems.filter(item =>
        item.type === 'SONG_UPLOAD' &&
        !item.isRepost &&
        (!publicKey || item.sender !== publicKey) // Exclude user's own tracks if logged in
    );

    // Simple randomization for now
    discoverItems.sort(() => 0.5 - Math.random());

    // Add a limit to avoid sending a huge payload
    res.json(discoverItems.slice(0, 50));
});


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
// API 404 CATCH-ALL
// ==========================================
app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
});

// ==========================================
// GLOBAL API ERROR HANDLER
// ==========================================
app.use('/api', (err, req, res, next) => {
    console.error(`[API Error] ${req.method} ${req.path}:`, err);
    // Ensure we always return JSON for API routes, preventing HTML error pages
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Malformed JSON payload.' });
    }
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
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

// 3. FALLBACK
app.get('*', (req, res) => {
    // Set headers to prevent caching of the main index.html file.
    // This ensures the browser always fetches the latest version, which will have updated
    // links to versioned assets like JS and CSS files.
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.set('socketio', io);

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

    // 4. Purge from password-based auth system
    authModule.deleteUserCredential(deletedUserAddress);

    saveDBMemory(); // Persist the cleanup
    profileService.getProfileDirectory(); // Invalidate and rebuild profile cache to reflect deletion
    console.log(`[PURGE] Completed data purge for ${deletedUserAddress.substring(0,8)}...`);
}

// ==========================================
// 5. WEBSOCKETS (Chat & Anti-Cheat Mining)
// ==========================================

function saveDBMemory() {
    safeWriteFile(CHAT_DB_FILE, {
        servers: dbMemory.servers,
        directMessages: dbMemory.directMessages,
        zineArticles: dbMemory.zineArticles,
        dailyStreamNotifs: dbMemory.dailyStreamNotifs
    });
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

    socket.on('get_initial_data', () => {
        const senderNode = dbMemory.connectedNodes[socket.id];
        const address = senderNode ? senderNode.address : null;

        const serverList = Object.values(dbMemory.servers)
            .filter(srv => srv && (!srv.isPrivate || srv.owner === address || (srv.allowedUsers && srv.allowedUsers.includes(address))))
            .map(srv => ({
                id: srv.id,
                name: srv.name,
                owner: srv.owner,
                isPrivate: srv.isPrivate,
                channels: Object.values(srv.channels || {}).map(ch => ({ id: ch.id, name: ch.name, locked: ch.locked }))
            }));
        socket.emit('server_list', serverList);
        socket.emit('profile_directory', profileService.getProfileDirectory());
    });

    socket.on('register_node', (data) => {
        if (!data || !data.address) return;
        dbMemory.connectedNodes[socket.id] = { address: data.address, status: 'online', activity: null };
        
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

    socket.on('create_server', (data) => {
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode || !senderNode.address) return console.error(`[SECURITY] 'create_server' from unauthenticated socket ${socket.id}`);

        if (!data || !data.serverName) return;
        const { serverName, isPrivate } = data;
        const serverId = 'srv_' + Date.now() + Math.floor(Math.random()*1000);
        const generalChannelId = 'ch_' + Date.now();
        dbMemory.servers[serverId] = {
            id: serverId,
            name: serverName,
            owner: senderNode.address,
            isPrivate: !!isPrivate,
            allowedUsers: [senderNode.address],
            channels: {}
        };
        dbMemory.servers[serverId].channels[generalChannelId] = { id: generalChannelId, name: 'general', locked: false, messages: [] };
        saveDBMemory();
        
        const srvPayload = {
            id: serverId,
            name: serverName,
            owner: senderNode.address,
            isPrivate: !!isPrivate,
            channels: [{ id: generalChannelId, name: 'general', locked: false }]
        };

        if (isPrivate) {
            socket.emit('server_created', srvPayload);
        } else {
            io.emit('server_created', srvPayload);
        }
    });

    socket.on('delete_server', (serverId) => {
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode) return;
        const server = dbMemory.servers[serverId];
        if (server && server.owner === senderNode.address) {
            delete dbMemory.servers[serverId];
            saveDBMemory();
            io.emit('server_deleted', serverId);
        }
    });

    socket.on('invite_to_server', (data) => {
        const { serverId, targetAddress } = data;
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode) return;
        const server = dbMemory.servers[serverId];
        if (server && server.owner === senderNode.address) {
            if (!server.allowedUsers) server.allowedUsers = [];
            if (!server.allowedUsers.includes(targetAddress)) {
                server.allowedUsers.push(targetAddress);
                saveDBMemory();
            }
            const targetSocketId = Object.keys(dbMemory.connectedNodes).find(
                id => dbMemory.connectedNodes[id].address === targetAddress
            );
            if (targetSocketId) {
                io.to(targetSocketId).emit('server_created', {
                    id: server.id,
                    name: server.name,
                    owner: server.owner,
                    isPrivate: server.isPrivate,
                    channels: Object.values(server.channels).map(ch => ({ id: ch.id, name: ch.name, locked: ch.locked }))
                });
            }
        }
    });

    socket.on('kick_from_server', (data) => {
        const { serverId, targetAddress } = data;
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode) return;
        const server = dbMemory.servers[serverId];
        if (server && server.owner === senderNode.address) {
            if (server.allowedUsers) {
                server.allowedUsers = server.allowedUsers.filter(a => a !== targetAddress);
                saveDBMemory();
            }
            const targetSocketId = Object.keys(dbMemory.connectedNodes).find(
                id => dbMemory.connectedNodes[id].address === targetAddress
            );
            if (targetSocketId) {
                io.to(targetSocketId).emit('server_deleted', serverId);
            }
        }
    });

    socket.on('create_channel', (data) => {
        if (!data || !data.serverId || !data.channelName || !data.address) return;
        const { serverId, channelName, address, locked } = data;
        if (dbMemory.servers[serverId]) {
            const channelId = 'ch_' + Date.now() + Math.floor(Math.random()*1000);
            if (!dbMemory.servers[serverId].channels) dbMemory.servers[serverId].channels = {};
            dbMemory.servers[serverId].channels[channelId] = { id: channelId, name: channelName, locked: !!locked, messages: [] };
            saveDBMemory();
            io.emit('channel_created', { serverId, channel: { id: channelId, name: channelName, locked: !!locked } });
        }
    });

    socket.on('join_channel', (data) => {
        const senderNode = dbMemory.connectedNodes[socket.id];
        const address = senderNode ? senderNode.address : null;

        if (!data || !data.serverId || !data.channelId) return;
        const { serverId, channelId } = data;
        
        const server = dbMemory.servers[serverId];
        if (server && server.channels && server.channels[channelId]) {
            if (server.isPrivate && server.owner !== address && !(server.allowedUsers && server.allowedUsers.includes(address))) {
                return socket.emit('chat_error', { message: 'Access Denied: You are not invited to this private server.' });
            }

            const channel = server.channels[channelId];
            
            // --- 3.2 Token-Gated Backrooms ---
            if (channel.locked) {
                if (!address) {
                    return socket.emit('chat_error', { message: 'Access Denied: You must be logged in to enter a token-gated backroom.' });
                }
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

        socket.emit('chat_history', (channel.messages || []).slice(-50));
        }
    });

    socket.on('send_message', (data) => {
        const senderNode = dbMemory.connectedNodes[socket.id];
        if (!senderNode || !senderNode.address) return socket.emit('chat_error', { message: 'You must be logged in to send messages.' });

        if (!data || !data.serverId || !data.channelId || typeof data.text === 'undefined') return;
        const { serverId, channelId, text } = data;
        const server = dbMemory.servers[serverId];
        if (server && server.channels && server.channels[channelId]) {
            if (server.isPrivate && server.owner !== senderNode.address && !(server.allowedUsers && server.allowedUsers.includes(senderNode.address))) {
                return;
            }

            const chain = blockchainService.getChain();
            const adminAddress = blockchainService.getAdminAddress(chain);
            const balance = blockchainService.calculateBalance(senderNode.address, chain);
            const roles = [];
            if (senderNode.address === adminAddress) roles.push('admin');
            if (balance >= 10000) roles.push('whale');
            const msg = { sender: senderNode.address, text, time: Date.now(), roles };
            if (!server.channels[channelId].messages) server.channels[channelId].messages = [];
            server.channels[channelId].messages.push(msg);
        if (server.channels[channelId].messages.length > 500) server.channels[channelId].messages.shift();
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
        if (dbMemory.directMessages.length > 2000) dbMemory.directMessages.shift(); // Cap DM history size
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

// Bootstrap initial connections to other Dedicated Servers/PCs
function bootstrapSwarm() {
    if (PEERS.length === 0) {
        console.log("🌐 No peers configured. Running in standalone mode.");
        return Promise.resolve();
    }

    console.log("🌐 Bootstrapping to global Swarm...");
    const bootstrapPromises = PEERS.map(peerUrl => {
        if (globalThis.fetch) {
            return fetch(`${peerUrl}/api/network/register`, {
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
                // Log error but don't prevent startup.
                console.error(`[P2P] Bootstrap failed for peer ${peerUrl}:`, e.message);
            });
        }
        return Promise.resolve();
    });
    return Promise.all(bootstrapPromises);
}

async function startServer() {
    console.log('🚀 VOD ENGINE INITIALIZING...');

    // 1. Wait for the blockchain to sync with peers before doing anything else.
    await bootstrapSwarm();
    console.log('✅ Swarm bootstrap complete.');

    // 2. Listen for new blocks and actively forward them to the cloud/PC
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
                goalsService.processTransaction(tx);
                if (tx.type === 'GOAL_REWARD') {
                    io.emit('blockchain_update', { type: tx.type, transaction: tx });
                }
                if (tx.type === 'PURCHASE_ZINE_RIGHTS' && tx.data) {
                    const article = dbMemory.zineArticles.find(a => a.id === tx.data.articleId);
                    if (article && !article.ownersList.includes(tx.sender)) {
                        article.ownersList.push(tx.sender);
                        saveDBMemory();
                        io.emit('zine_update', dbMemory.zineArticles);
                        console.log(`📰 Article Rights Updated via Ledger: ${article.title} by ${tx.sender}`);
                    }
                } else if (tx.type === 'ADMIN_DELETE_USER' && tx.receiver) {
                    purgeDeletedUserData(tx.receiver);
                }
            });
        }
    });

    // 3. Only now, after all backend init is done, open the server to connections.
    server.listen(PORT, () => {
        console.log(`🚀 VOD ENGINE ONLINE: http://localhost:${PORT}`);
    });
}

goalsService.initCron();
startServer();