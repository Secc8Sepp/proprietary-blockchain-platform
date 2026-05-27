// ==========================================
// VOD SOCIAL ENGINE - VIBE OR DIE NETWORK (FULL UNIFIED)
// ==========================================

const socket = io();

// Core Application State
let userKeys = { publicKey: '', privateKey: '' };
let currentView = 'feed';
let viewingUserPublicKey = ''; let eventsMap = null;

// Proof-Of-Listen Mining State Engine
let activeTrackHash = '';
let activeTrackArtist = '';
let listenTrackingInterval = null;
let feedTracks = [];
let playedTracks = new Set();
let currentChatChannel = null;
let currentChatServer = null;
let serversData = [];
let lastClientPing = 0;
let currentPresence = { status: 'online', activity: null };
let idleTimer = null;
let networkProfiles = {};
let dmHistory = {};
let myMeshId = null; let meshConnections = {}; let dataChannels = {};
let eventsState = { isPlacing: false, currentFile: null, hashes: new Set(), mapMarkers: [] };
let marketDataCache = { items: [], bounties: [] };
let myCustomTheme = '';
let socketIdToAddress = {};
let activeFeedTag = null;
let zineArticles = [];
let currentViewedProfile = null;
let currentPlaylistMode = 'global';
let hotOrNotData = [];
let swRegistration = null;
let localDB = null;

document.addEventListener('DOMContentLoaded', () => { 
    initializeApplicationListeners(); 
    initializeAudioPlayerEngine(); 
    initLocalLedgerNode();
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => { swRegistration = reg; console.log('[PWA] Service Worker registered'); })
            .catch(err => console.error('[PWA] SW Registration failed', err));
    }
});

function initializeApplicationListeners() {
    console.log('[INIT] Wiring up event listeners...');
    
    socket.on('connect', () => { myMeshId = socket.id; });

    // Identity & Auth Flow
    const signupBtn = document.getElementById('btn-signup');
    if(signupBtn) {
        signupBtn.addEventListener('click', handleSignup);
        console.log('[INIT] ✓ Signup button wired');
    } else console.warn('[INIT] ✗ btn-signup not found');
    
    const loginBtn = document.getElementById('btn-login-submit');
    if(loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
        console.log('[INIT] ✓ Login button wired');
    } else console.warn('[INIT] ✗ btn-login-submit not found');
    
    // Global Navigation & Search
    const searchInput = document.getElementById('search-input');
    if(searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if(e.key === 'Enter' && e.target.value.trim() !== '') {
                executeGlobalSearch(e.target.value.trim());
            }
        });
        console.log('[INIT] ✓ Search input wired');
    }

    // Unified Media Composer
    const publishBtn = document.getElementById('btn-publish-post');
    if(publishBtn) {
        publishBtn.addEventListener('click', handlePublishPost);
        console.log('[INIT] ✓ Publish button wired');
    } else console.warn('[INIT] ✗ btn-publish-post not found');
    
    const imgUpload = document.getElementById('composer-image-upload');
    if(imgUpload) imgUpload.addEventListener('change', updateComposerPreview);
    
    const audUpload = document.getElementById('composer-audio-upload');
    if(audUpload) audUpload.addEventListener('change', updateComposerPreview);
    
    const vidUpload = document.getElementById('composer-video-upload');
    if(vidUpload) vidUpload.addEventListener('change', updateComposerPreview);
    
    const zipUpload = document.getElementById('composer-zip-upload');
    if(zipUpload) zipUpload.addEventListener('change', updateComposerPreview);

    // Settings & Social Actions
    const updateProfileBtn = document.getElementById('btn-update-profile');
    if(updateProfileBtn) {
        updateProfileBtn.addEventListener('click', handleProfileUpdateSubmission);
        updateProfileBtn.addEventListener('click', saveInlineEdit);
        console.log('[INIT] ✓ Update profile button wired');
    } else console.warn('[INIT] ✗ btn-update-profile not found');

    const followBtn = document.getElementById('btn-profile-follow');
    if(followBtn) {
        followBtn.addEventListener('click', () => executeTargetFollow(viewingUserPublicKey));
        console.log('[INIT] ✓ Follow button wired');
    } else console.warn('[INIT] ✗ btn-profile-follow not found');

    // Profile Drag & Drop Logic
    let draggedSection = null;
    document.addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('profile-section') || e.target.classList.contains('playlist-item')) {
            if(viewingUserPublicKey !== userKeys.publicKey) {
                e.preventDefault();
                return;
            }
            draggedSection = e.target;
            e.target.classList.add('dragging');
            e.target.style.opacity = 0.5;
        }
    });
    document.addEventListener('dragend', (e) => {
        if (e.target.classList.contains('profile-section') || e.target.classList.contains('playlist-item')) {
            e.target.style.opacity = "";
            e.target.classList.remove('dragging');
            draggedSection = null;
        }
    });
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedSection) {
            if (draggedSection.classList.contains('profile-section')) {
                const container = e.target.closest('.profile-sortable');
                if (container) {
                    const afterElement = getDragAfterElement(container, e.clientY, '.profile-section:not(.dragging)');
                    if (afterElement == null) container.appendChild(draggedSection);
                    else container.insertBefore(draggedSection, afterElement);
                }
            } else if (draggedSection.classList.contains('playlist-item')) {
                const container = e.target.closest('#ui-profile-playlist');
                if (container) {
                    const afterElement = getDragAfterElement(container, e.clientY, '.playlist-item:not(.dragging)');
                    if (afterElement == null) container.appendChild(draggedSection);
                    else container.insertBefore(draggedSection, afterElement);
                }
            }
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (eventsState.isPlacing) {
            const p = document.getElementById('ui-flyer-cursor');
            if(p) { p.style.left = (e.clientX + 15) + 'px'; p.style.top = (e.clientY + 15) + 'px'; }
        }
    });

function getDragAfterElement(container, y, selector) {
    if (!container) return null;
    const draggableElements = [...container.querySelectorAll(selector)];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

    // Presence Idle Detection
    document.addEventListener('mousemove', resetIdleTimer);
    document.addEventListener('keypress', resetIdleTimer);
    
    // Discord Chat Socket Listeners
    socket.on('chat_history', (msgs) => {
        const chatLog = document.getElementById('ui-chat-log');
        if(chatLog) {
            msgs.forEach(msg => appendChatMessage(msg));
            chatLog.scrollTop = chatLog.scrollHeight;
        }
    });

    socket.on('new_message', (msg) => {
        appendChatMessage(msg);
        const chatLog = document.getElementById('ui-chat-log');
        if(chatLog) chatLog.scrollTop = chatLog.scrollHeight;
    });

    socket.on('chat_error', (data) => {
        const chatLog = document.getElementById('ui-chat-log');
        if(chatLog) {
            chatLog.innerHTML = `
                <div class="chat-msg">
                    <div class="chat-avatar" style="background: var(--danger); display: flex; align-items: center; justify-content: center; font-size: 16px;">🛑</div>
                    <div class="chat-content">
                        <div><span class="sender" style="color: var(--danger);">Network Enforcer</span></div>
                        <div style="color: var(--text-muted);">${escapeHtml(data.message)}</div>
                    </div>
                </div>
            `;
        }
        const input = document.getElementById('chat-input');
        if(input) { input.placeholder = 'Access Denied...'; input.disabled = true; }
    });

    socket.on('server_list', (servers) => {
        serversData = servers;
        renderServerList();
        if(servers.length > 0 && !currentChatServer) {
            switchServer(servers[0].id);
        }
    });

    socket.on('profile_directory', (dir) => {
        networkProfiles = dir;
        if(currentView === 'feed') loadMainGlobalFeed();
        renderServerList();
        if(currentChatServer === '@dms') renderDMList();
    });

    // Request new directory if someone on the chain changes their identity
    socket.on('blockchain_update', (payload) => {
        if(payload && payload.type === 'PROFILE_UPDATE') socket.emit('request_profile_directory');
        if(userKeys.publicKey) fetchUserProfile(userKeys.publicKey, true); 
        if(currentView === 'feed') loadMainGlobalFeed();
        if(currentView === 'profile' && viewingUserPublicKey) fetchUserProfile(viewingUserPublicKey, false);
    });

    socket.on('server_created', (server) => {
        serversData.push(server);
        renderServerList();
    });

    socket.on('channel_created', (data) => {
        const { serverId, channel } = data;
        const srv = serversData.find(s => s.id === serverId);
        if (srv) {
            srv.channels.push(channel);
            if (currentChatServer === serverId) {
                renderChannelList(srv);
            }
        }
    });
    
    socket.on('swarm_update', (nodes) => {
        const countHeader = document.getElementById('ui-online-count');
        const container = document.getElementById('ui-online-users');
        
        nodes.forEach(node => {
            if (node.socketId) socketIdToAddress[node.socketId] = node.address;
        });
        // Auto-connect WebRTC Data Channels to form the P2P Browser Mesh
        nodes.forEach(node => {
            if (node.socketId && myMeshId && node.socketId !== myMeshId) {
                if (myMeshId > node.socketId && !meshConnections[node.socketId]) connectToMeshNode(node.socketId);
            }
        });
        
        if (countHeader) countHeader.innerText = `Online in Swarm — ${nodes.length}`;
        if (container) {
            container.innerHTML = nodes.map(node => {
                const isMe = node.address === userKeys.publicKey;
                const displayName = isMe ? 'You' : resolveProfile(node.address).username;
                const color = isMe ? 'var(--primary)' : '#fff';
                const dotColor = node.status === 'idle' ? 'var(--warning)' : 'var(--success)';
                const activityHtml = node.activity ? `<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">🎧 ${escapeHtml(node.activity)}</div>` : '';
                return `
                    <div class="user-row" onclick="inspectTargetNode('${node.address}')">
                        <div class="user-info">
                            <img src="${getAvatarUrl(node.address)}" class="${isMe ? 'nft-avatar' : ''}">
                            <div style="display: flex; flex-direction: column;">
                                <span style="font-size: 14px; font-weight: bold; color: ${color};">${displayName}</span>
                                ${activityHtml}
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            ${!isMe ? `<span style="font-size: 14px; cursor: pointer;" onclick="event.stopPropagation(); sendDM('${node.address}')" title="Direct Message">✉️</span>` : ''}
                            <div class="status-dot" style="background: ${dotColor}; box-shadow: 0 0 5px ${dotColor};"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    });

    socket.on('zine_update', (articles) => {
        zineArticles = articles;
        renderZine();
    });

    socket.on('article_purchased', (data) => {
        alert("Curation Rights Acquired! Article added to your collection.");
        fetchUserProfile(userKeys.publicKey, true); // Refresh balance
    });

    // Request initial data
    socket.emit('get_servers');
    socket.emit('get_zine_data');
    console.log('[INIT] Event listeners initialized');
}

// ==========================================
// 1. AUTHENTICATION & IDENTITY
// ==========================================

function resolveProfile(address) {
    return networkProfiles[address] || { username: `Node_${address.substring(0,6)}`, avatarHash: '' };
}

function getAvatarUrl(address) {
    const p = resolveProfile(address);
    return p.avatarHash ? `/tracks/${p.avatarHash}` : `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(address)}&backgroundColor=1f2833`;
}

function setPresence(status, activity) {
    let changed = false;
    if (status !== undefined && currentPresence.status !== status) { currentPresence.status = status; changed = true; }
    if (activity !== undefined && currentPresence.activity !== activity) { currentPresence.activity = activity; changed = true; }
    if (changed && userKeys.publicKey) socket.emit('update_presence', currentPresence);
}

function resetIdleTimer() {
    setPresence('online');
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setPresence('idle'), 300000); // 5 minute idle limit
}

async function handleSignup() {
    try {
        const username = document.getElementById('input-signup-username').value.trim();
        const avatarFile = document.getElementById('input-signup-avatar').files[0];

        if (!username || !avatarFile) {
            return alert("A username and profile picture are required to mint an identity.");
        }

        const btn = document.getElementById('btn-signup');
        btn.innerText = "Uploading Avatar...";
        btn.disabled = true;
        
        const avatarHash = await uploadMediaAssetFile(avatarFile);
        if (!avatarHash) throw new Error("Avatar upload failed. Please try again.");

        btn.innerText = "Generating Keys...";
        const res = await fetch('/api/auth/keygen', { method: 'POST' });
        if (!res.ok) throw new Error("Server rejected keygen request.");
        
        userKeys = await res.json(); 
        
        btn.innerText = "Recording to Ledger...";
        const txFields = { 
            sender: userKeys.publicKey, 
            receiver: userKeys.publicKey, 
            type: 'PROFILE_UPDATE', 
            data: { username: username, bio: "Active on the Vibe or Die Network.", avatarHash: avatarHash }, 
            timestamp: Date.now() 
        };
        txFields.signature = await generateClientSignature(userKeys.privateKey, txFields);
        
        const actionRes = await fetch('/api/social/action', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(txFields) 
        });
        if (!actionRes.ok) throw new Error("Ledger rejected initial identity block.");

        promptKeyDownload(userKeys);
        unlockApplication(userKeys.publicKey);
    } catch (err) { 
        console.error(err);
        alert("Signup Error: " + err.message); 
        const btn = document.getElementById('btn-signup');
        btn.innerText = "Mint & Download Identity";
        btn.disabled = false;
    }
}

function promptKeyDownload(keys) {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(keys));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "vod_private_key.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    alert("CRITICAL: Your VOD Credentials have been downloaded. Keep this file safe.");
}

function handleLogin() {
    const keyStr = document.getElementById('input-login-key').value.trim();
    if (!keyStr) return alert("Please paste your key JSON string.");

    try {
        const parsed = JSON.parse(keyStr);
        if (parsed.publicKey && parsed.privateKey) {
            userKeys = parsed;
            unlockApplication(userKeys.publicKey);
        } else {
            throw new Error("Invalid format.");
        }
    } catch(err) {
        alert("Invalid Key format. Paste the entire content of your vod_private_key.json.");
    }
}

function unlockApplication(publicKey) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    
    const avatar = document.getElementById('composer-avatar');
    if(avatar) avatar.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(publicKey)}&backgroundColor=0b0c10`;
    
    const shortKey = publicKey.length > 20 ? publicKey.substring(0, 10) + "..." + publicKey.slice(-5) : publicKey;
    const pubKeyDisplay = document.getElementById('ui-user-address');
    if(pubKeyDisplay) pubKeyDisplay.innerText = shortKey;
    
    socket.emit('register_node', { address: publicKey });

    loadMainGlobalFeed();
    fetchUserProfile(publicKey, true); 
    subscribeToPush(publicKey);
    syncFullChain();
}

// ==========================================
// PWA & LOCAL NODE (INDEXEDDB) LOGIC
// ==========================================

async function subscribeToPush(publicKey) {
    if (!swRegistration) return;
    try {
        const res = await fetch('/api/push/vapidPublicKey');
        const { publicKey: vapidPublicKey } = await res.json();
        const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

        const subscription = await swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: convertedVapidKey });
        await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: publicKey, subscription }) });
        console.log('[PWA] Subscribed to Web Push notifications.');
    } catch (e) { console.error('[PWA] Push subscription failed', e); }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

function initLocalLedgerNode() {
    const req = indexedDB.open('VOD_Local_Node', 1);
    req.onupgradeneeded = (e) => { localDB = e.target.result; localDB.createObjectStore('blocks', { keyPath: 'hash' }); };
    req.onsuccess = (e) => { localDB = e.target.result; console.log('[NODE] Local Blockchain Node Ready'); };
}

async function syncFullChain() {
    if (!localDB) return;
    try {
        const res = await fetch('/api/network/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ peerUrl: null }) });
        const data = await res.json();
        if (data.chain) {
            const tx = localDB.transaction('blocks', 'readwrite');
            data.chain.forEach(block => tx.objectStore('blocks').put(block));
            console.log(`[NODE] Synced ${data.chain.length} blocks to local node storage.`);
        }
    } catch(e) {}
}

// ==========================================
// 2. MEDIA & CRYPTO ENGINE
// ==========================================

async function ensureCryptoEngine() {
    if (typeof window.elliptic !== 'undefined') return;
    return new Promise((resolve, reject) => {
        console.log("[SYSTEM] Dynamically injecting Elliptic Curve engine...");
        const script = document.createElement('script');
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/elliptic/6.5.4/elliptic.min.js";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load cryptography engine. Check your connection or ad-blocker."));
        document.head.appendChild(script);
    });
}

// NOTE: This function requires the 'elliptic' library for secp256k1 signing,
// which matches the backend key generation.
async function generateClientSignature(privateKeyHex, messageObject) {
    await ensureCryptoEngine();
    const EC = window.elliptic.ec;
    const ec = new EC('secp256k1');

    // Create key object from private key hex
    const key = ec.keyFromPrivate(privateKeyHex);

    // The backend verifier expects to verify the SHA256 hash of the message
    const msgStr = JSON.stringify(messageObject);

    // Use Web Crypto API to hash the message
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(msgStr));

    // Convert buffer to array of bytes
    const hashArray = Array.from(new Uint8Array(hashBuffer));

    // Sign the hash and return signature in DER format as a hex string
    const signature = key.sign(hashArray);
    return signature.toDER('hex');
}

async function uploadMediaAssetFile(fileObject) {
    if (!fileObject) return null;
    const formData = new FormData();
    formData.append('mediaAsset', fileObject);
    
    const response = await fetch('/api/feed/upload-file', { method: 'POST', body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Upload failed.");
    return result.fileHash;
}

/**
 * Core utility to wrap data, sign it with the private key, and broadcast to the ledger.
 */
async function sendSignedTransaction(type, receiver, data) {
    if (!userKeys.publicKey || !userKeys.privateKey) throw new Error("Identity locked.");
    
    const msgToSign = {
        sender: userKeys.publicKey,
        receiver: receiver || "0x00",
        type: type,
        data: data,
        timestamp: Date.now()
    };

    const signature = await generateClientSignature(userKeys.privateKey, msgToSign);
    const tx = { ...msgToSign, signature };

    const res = await fetch('/api/feed/interact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tx)
    });

    if (!res.ok) throw new Error((await res.json()).error || "Ledger rejected transaction.");
    
    if (localDB) localDB.transaction('blocks', 'readwrite').objectStore('blocks').put(tx); // Optimistic local store

    broadcastToMesh('P2P_BLOCK', tx);
    return tx;
}

async function handlePublishPost() {
    try {
        console.log('[PUBLISH] Starting post publish...');
        const textIn = document.getElementById('composer-text').value.trim();
        const audFile = document.getElementById('composer-audio-upload').files[0];
        const imgFile = document.getElementById('composer-image-upload').files[0];
        const vidFile = document.getElementById('composer-video-upload') ? document.getElementById('composer-video-upload').files[0] : null;
        const zipFile = document.getElementById('composer-zip-upload') ? document.getElementById('composer-zip-upload').files[0] : null;
        const btn = document.getElementById('btn-publish-post');

        if (!textIn && !audFile && !imgFile && !vidFile && !zipFile) return alert("Please provide some content to broadcast.");
        if (!userKeys.publicKey) return alert("You must login first.");

        btn.innerText = "Uploading...";
        btn.disabled = true;

        let type, data;
        // Determine post type and upload requisite files to IPFS node
        if (audFile) {
            if (!textIn) throw new Error("Please provide a Track Title for the audio upload.");
            const hash = await uploadMediaAssetFile(audFile);
            
            let coverHash = null;
            const coverFile = document.getElementById('audio-cover-upload').files[0];
            if (coverFile) coverHash = await uploadMediaAssetFile(coverFile);
            
            const artist = document.getElementById('audio-meta-artist').value.trim();
            const collabs = [];
            document.querySelectorAll('.collab-row').forEach(row => {
                const addr = row.querySelector('.collab-address').value.trim();
                const pct = parseInt(row.querySelector('.collab-percent').value);
                if (addr && pct > 0) collabs.push({ address: addr, percentage: pct });
            });

            const genre = document.getElementById('audio-meta-genre').value.trim();
            const forStake = document.getElementById('audio-stake-checkbox').checked;
            let sellPercentage = 0; let pricePerShare = 0;
            if (forStake) {
                sellPercentage = parseInt(document.getElementById('audio-stake-percent').value) || 0;
                pricePerShare = parseFloat(document.getElementById('audio-stake-price').value) || 0;
            }
            
            type = 'SONG_UPLOAD';
            data = { trackTitle: textIn, artist, audioHash: hash, coverHash, metadata: genre, forStake, sellPercentage, pricePerShare, collaborators: collabs };
        } else if (imgFile) {
            const hash = await uploadMediaAssetFile(imgFile);
            type = 'IMAGE_POST';
            data = { caption: textIn, imageHash: hash };
        } else if (vidFile) {
            const hash = await uploadMediaAssetFile(vidFile);
            type = 'VIDEO_POST';
            data = { caption: textIn, videoHash: hash };
        } else if (zipFile) {
            const hash = await uploadMediaAssetFile(zipFile);
            type = 'PROJECT_FILE_POST';
            data = { caption: textIn, fileHash: hash, filename: zipFile.name };
        } else {
            if (textIn.length > 200) {
                if (confirm("This is a long post! Would you like to publish it as a Zine Article instead?")) {
                    const title = prompt("Enter a title for your article:");
                    if (title) {
                        const price = prompt("Enter a curation price in $VOD for others to publish this:", "5000");
                        if (price && !isNaN(price)) {
                            socket.emit('publish_article', { title, body: textIn, price: parseFloat(price), author: userKeys.publicKey });
                            alert("Masterpiece published to the swarm as an Article!");
                            document.getElementById('composer-text').value = '';
                            switchTab('zine');
                            return;
                        }
                    }
                }
            }
            type = 'TEXT_POST';
            data = { content: textIn };
        }

        await sendSignedTransaction(type, "0x00", data);
        detectMentionsAndEmit(textIn);
        
        console.log('[PUBLISH] ✓ Success!');
        alert("Block recorded successfully!");
        
        if (true) { // Cleanup UI
            document.getElementById('composer-text').value = '';
            document.getElementById('composer-audio-upload').value = '';
            document.getElementById('composer-image-upload').value = '';
            if (document.getElementById('composer-video-upload')) document.getElementById('composer-video-upload').value = '';
            if (document.getElementById('composer-zip-upload')) document.getElementById('composer-zip-upload').value = '';
            updateComposerPreview();
            loadMainGlobalFeed();
        } else {
            const err = await res.json();
            console.error('[PUBLISH] ✗ Server error:', err);
            alert("Ledger Rejected: " + err.error);
        }
    } catch (err) { 
        console.error('[PUBLISH] ✗ Exception:', err);
        alert("Transaction Failed: " + err.message); 
    } finally {
        document.getElementById('btn-publish-post').innerText = "Broadcast Block";
        document.getElementById('btn-publish-post').disabled = false;
    }
}

function addCollaboratorField() {
    const list = document.getElementById('collaborator-list');
    const id = Date.now();
    const div = document.createElement('div');
    div.id = 'collab-' + id;
    div.className = 'collab-row';
    div.style = 'display:flex; gap:10px; margin-bottom: 5px;';
    div.innerHTML = `
        <input placeholder="Public Key" class="collab-address" style="margin:0; flex: 2; padding: 6px;" />
        <input type="number" placeholder="%" class="collab-percent" style="margin:0; flex: 1; padding: 6px;" max="100" min="1" />
        <button class="secondary" style="padding: 0 10px;" onclick="document.getElementById('collab-${id}').remove()">X</button>
    `;
    list.appendChild(div);
}

// ==========================================
// 3. MINING & AUDIO ENGINE
// ==========================================

function changePlaylistContext(mode) {
    currentPlaylistMode = mode;
    console.log(`[PLAYER] Playlist context changed to: ${mode}`);
}

function initializeAudioPlayerEngine() {
    const player = document.getElementById('global-audio-player');
    const volSlider = document.getElementById('volume-slider');
    const muteBtn = document.getElementById('btn-mute');

    if(!player) return;

    // Volume Persistence
    if (volSlider) {
        const savedVol = localStorage.getItem('vod_volume');
        if (savedVol !== null) { player.volume = savedVol; volSlider.value = savedVol; }
        
        volSlider.addEventListener('input', (e) => {
            player.volume = e.target.value;
            localStorage.setItem('vod_volume', e.target.value);
            if(player.volume > 0) { player.muted = false; if(muteBtn) muteBtn.innerText = '🔊'; }
        });
    }
    
    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            player.muted = !player.muted;
            muteBtn.innerText = player.muted ? '🔇' : '🔊';
        });
    }

    player.addEventListener('play', () => {
        if (!activeTrackHash || !userKeys.publicKey) return;
        if (listenTrackingInterval) clearInterval(listenTrackingInterval);
        
        const now = Date.now();
        if (now - lastClientPing > 5000) {
            socket.emit('l2e_ping', { address: userKeys.publicKey, trackHash: activeTrackHash });
            lastClientPing = now;
        }

        listenTrackingInterval = setInterval(() => {
            if (!player.paused && !player.muted) {
                socket.emit('l2e_ping', { address: userKeys.publicKey, trackHash: activeTrackHash });
                lastClientPing = Date.now();
            }
        }, 5000); // Server expects 5s pings
    });
    
    player.addEventListener('pause', () => stopPlaybackTrackingLoop(false));
    player.addEventListener('ended', () => {
        stopPlaybackTrackingLoop(true);
        playNextTrackAdvanced();
    });

    socket.on('l2e_status', (data) => {
        let indicator = document.getElementById('l2e-status-tracker');
        if (indicator) {
            if (data.error) {
                indicator.innerHTML = `⚠️ ${data.error}`;
                indicator.style.color = 'var(--danger)';
            } else {
                indicator.innerHTML = `🎧 Mining $VOD... (${data.pings}/${data.max})`;
                indicator.style.color = 'var(--primary)';
            }
        }
    });

    socket.on('l2e_reward', (data) => {
        let indicator = document.getElementById('l2e-status-tracker');
        if (indicator) {
            indicator.innerHTML = `💎 Proof-of-Listen Minted!`;
            indicator.style.color = 'var(--success)';
            
            // Broadcast the actual transaction to the ledger
            triggerProofOfListenMint();
        }
    });
}

function stopPlaybackTrackingLoop(resetCounter) {
    if (listenTrackingInterval) { clearInterval(listenTrackingInterval); listenTrackingInterval = null; }
    let indicator = document.getElementById('l2e-status-tracker');
    if(indicator) {
        indicator.innerHTML = `⏸️ Mining paused.`;
        indicator.style.color = 'var(--text-muted)';
    }
    setPresence(undefined, null);
}

async function triggerProofOfListenMint() {
    const msgToSign = { 
        sender: userKeys.publicKey, 
        receiver: activeTrackArtist, 
        type: 'STREAM_COMPLETED', 
        data: { audioHash: activeTrackHash }, 
        timestamp: Date.now() 
    };
    try {
        const signature = await generateClientSignature(userKeys.privateKey, msgToSign);
        const txFields = { ...msgToSign, signature };
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        
        if (res.ok) {
            // Refresh the UI to reflect your newly mined $VOD balance!
            fetchUserProfile(userKeys.publicKey, true);
            loadMainGlobalFeed();
        } else {
            console.error("Ledger rejected mining block:", await res.json());
        }
    } catch(err) { console.error("Mining rejected:", err); }
}

function playTrack(title, audioHash, artistPublicKey, artistName) {
    stopPlaybackTrackingLoop(true);
    activeTrackHash = audioHash; 
    activeTrackArtist = artistPublicKey;
    playedTracks.add(audioHash);
    
    setPresence(undefined, 'Listening: ' + title);

    const player = document.getElementById('global-audio-player');
    player.src = `/tracks/${audioHash}`;
    
    player.play().catch(error => {
        console.error("Playback error:", error);
        alert("Streaming Error: Track not found on network.");
    });
    
    // Update Global Player UI
    const titleEl = document.getElementById('global-track-title');
    if (titleEl) titleEl.innerText = title;
    
    const artistLink = document.getElementById('global-track-artist-link');
    if (artistLink) {
        artistLink.innerText = artistName ? artistName : resolveProfile(artistPublicKey).username;
        artistLink.onclick = () => inspectTargetNode(artistPublicKey);
    }

    const artEl = document.getElementById('global-track-art');
    if (artEl) {
        artEl.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(artistPublicKey)}&backgroundColor=1f2833`;
    }
    
    if(document.getElementById('input-market-hash')) document.getElementById('input-market-hash').value = audioHash;
    if(document.getElementById('input-market-seller')) document.getElementById('input-market-seller').value = artistPublicKey;
}

function playNextTrackAdvanced() {
    let pool = [];
    
    if (currentPlaylistMode === 'profile' && currentViewedProfile && currentViewedProfile.uploadedTracks) {
        pool = currentViewedProfile.uploadedTracks.map(t => ({
            title: t.title,
            artist: t.artist,
            audioHash: t.hash,
            sender: currentViewedProfile.publicKey,
            timestamp: t.timestamp
        }));
    }

    if (pool.length === 0) {
        pool = feedTracks.map(t => ({
            title: t.data.trackTitle,
            artist: t.data.artist,
            audioHash: t.data.audioHash,
            sender: t.sender,
            timestamp: t.timestamp
        }));
    }
    
    // 1. Filter out tracks we have already played
    let unplayedTracks = pool.filter(t => !playedTracks.has(t.audioHash));
    
    // 2. If all tracks played, clear history to loop
    if (unplayedTracks.length === 0) {
        playedTracks.clear();
        unplayedTracks = [...pool];
    }
    
    // 3. Advanced Algorithm: Prioritize by recency + listen history logic
    unplayedTracks.sort((a, b) => b.timestamp - a.timestamp);
    let poolSize = Math.max(1, Math.floor(unplayedTracks.length * 0.5));
    
    // 4. Select a random track from the optimized pool
    let nextTrackIndex = Math.floor(Math.random() * poolSize);
    let nextTrack = unplayedTracks[nextTrackIndex];
    
    if (nextTrack) {
        playTrack(nextTrack.title, nextTrack.audioHash, nextTrack.sender, nextTrack.artist || resolveProfile(nextTrack.sender).username);
    }
}

// ==========================================
// 4. RENDERING & UI NAVIGATION
// ==========================================

async function loadMainGlobalFeed() {
    try {
        const res = await fetch('/api/feed');
        const data = await res.json();
        feedTracks = data.filter(item => item.type === 'SONG_UPLOAD');
        
        const container = document.getElementById('feed-container');
        if(!container) return;
        
        let filterHtml = '';
        if (activeFeedTag) {
            filterHtml = `<div style="padding: 10px; background: rgba(102, 252, 241, 0.1); color: var(--primary); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                <span>Filtering by Tag: <strong>${escapeHtml(activeFeedTag)}</strong></span>
                <button class="secondary" style="padding: 2px 8px; font-size: 11px;" onclick="activeFeedTag=null; loadMainGlobalFeed();">Clear Filter</button>
            </div>`;
        }
        container.innerHTML = filterHtml;
        
        // Filter out low-level system transactions from cluttering the main public feed
        const displayablePosts = data.filter(item => {
            if (item.type === 'IMAGE_POST' && item.data && item.data.isFlyer) return false; // Hide Flyers from Global Feed
            if (isNodeBlocked(item.sender)) return false;
            
            if (activeFeedTag) {
                if (item.type !== 'SONG_UPLOAD' || !item.data.metadata) return false;
                const tags = item.data.metadata.split(',').map(t => {
                    let s = t.trim().toLowerCase();
                    return s.startsWith('#') ? s : '#' + s;
                });
                if (!tags.includes(activeFeedTag.toLowerCase())) return false;
            }

            return ['SONG_UPLOAD', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST', 'TEXT_POST', 'SHOUTBOX_POST'].includes(item.type);
        });
        
        displayablePosts.forEach(item => {
            const postEl = document.createElement('div');
            postEl.className = 'card post';
            const timeStr = new Date(item.timestamp).toLocaleString();
            const roles = item.roles || [];
            const isOwner = item.sender === userKeys.publicKey;
            const deleteBtn = isOwner ? `<button class="interaction-btn" onclick="deletePost('${item.transactionHash}')">🗑️ Delete</button>` : '';
            postEl.innerHTML = `
                <div class="post-avatar" onclick="inspectTargetNode('${item.sender}')" style="cursor:pointer;"><img src="${getAvatarUrl(item.sender)}"></div>
                <div style="flex: 1;">
                    <div class="post-header">
                        <span class="post-name" onclick="inspectTargetNode('${item.sender}')">${resolveProfile(item.sender).username}</span>
                        ${renderBadges(roles)}
                        <span class="post-meta" style="margin-left:auto;">${item.sender.substring(0,10)}... • ${timeStr}</span>
                        ${!isOwner ? `<button class="secondary" style="padding: 2px 5px; font-size: 10px; margin-left: 10px;" onclick="toggleBlockNode('${item.sender}')">Block</button>` : ''}
                    </div>
                    ${renderPostContent(item)}
                    <div class="post-interactions">
                        <button class="interaction-btn" onclick="toggleLike('${item.transactionHash}', '${item.sender}')">🔥 <span id="like-count-${item.transactionHash}">${item.likeCount || 0}</span></button>
                        <button class="interaction-btn" onclick="toggleReplyBox('${item.transactionHash}')">💬 Reply</button>
                        ${deleteBtn}
                    </div>
                    <div class="reply-box" id="reply-box-${item.transactionHash}">
                        <textarea placeholder="Write a reply..."></textarea>
                        <button style="padding: 5px 15px; font-size: 11px;" onclick="submitReply('${item.transactionHash}', '${item.sender}')">Post Reply</button>
                        <div id="replies-list-${item.transactionHash}" style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                            ${(item.replies || []).map(r => `<div style="font-size: 13px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 8px;"><strong>${resolveProfile(r.sender).username}:</strong> ${parseMentions(r.text)}</div>`).join('')}
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(postEl);
        });
    } catch (err) { console.error("Feed error:", err); }
}

function renderPostContent(item) {
    if(item.type === 'SONG_UPLOAD') {
        const playCount = item.playCount || 0;
        
        let sharesHtml = '';
        if (item.shares) {
            sharesHtml = `<div style="font-size: 11px; margin-top: 15px; color: var(--text-muted); border-top: 1px solid rgba(69, 162, 158, 0.2); padding-top: 10px;"><strong>Shareholders:</strong> `;
            const shareHolders = Object.entries(item.shares).filter(([_, count]) => count > 0);
            sharesHtml += shareHolders.map(([addr, count]) => {
                const name = resolveProfile(addr).username;
                return `<span onclick="inspectTargetNode('${addr}')" style="cursor:pointer; color:var(--primary);">${name} (${count}%)</span>`;
            }).join(' • ');
            sharesHtml += `</div>`;
        }

        let listingHtml = '';
        if (item.listing && item.listing.available > 0) {
            listingHtml = `
                <button class="secondary" style="padding:8px 15px; font-size: 12px;" onclick="buySongShareDirect('${item.data.audioHash}', '${item.sender}', ${item.listing.price})">
                    🛒 Buy Stake (${item.listing.available}% avail @ ${item.listing.price} VOD)
                </button>
            `;
        }
        let coverHtml = item.data.coverHash ? `<img src="/tracks/${item.data.coverHash}" style="width: 60px; height: 60px; border-radius: 6px; object-fit: cover;">` : '';
        let displayArtist = item.data.artist ? escapeHtml(item.data.artist) : resolveProfile(item.sender).username;

        return `
            <div class="audio-block" style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; border: 1px solid rgba(69, 162, 158, 0.2);">
                <div style="display: flex; gap: 15px; margin-bottom: 10px;">
                    ${coverHtml}
                    <div>
                        <div style="font-size:18px; color: var(--primary); font-weight: bold;">🎵 ${escapeHtml(item.data.trackTitle)}</div>
                        <div style="font-size:12px; color:var(--text-muted); margin-bottom: 2px;">By ${displayArtist}</div>
                        ${item.data.metadata ? `<div style="font-size:12px; color:var(--text-muted);">${renderTags(item.data.metadata)}</div>` : ''}
                        <div style="font-size:12px; color: var(--text-muted);">
                            🎧 ${playCount} Streams • 💎 Network Mines 25,000 $VOD per stream
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button style="background:#66fcf1; color:#000; padding:8px 15px; flex: 1;" onclick="playTrack('${escapeJsArg(item.data.trackTitle)}', '${item.data.audioHash}', '${item.sender}', '${escapeJsArg(displayArtist)}')">
                        ▶ Play Track
                    </button>
                    ${listingHtml}
                    <button class="secondary" style="padding:8px 15px; font-size: 12px;" onclick="requestSongShare('${item.data.audioHash}', '${item.sender}')">
                        📈 Request Stake
                    </button>
                </div>
                ${sharesHtml}
            </div>
        `;
    } else if (item.type === 'IMAGE_POST') {
        return `
            <div class="post-body">
                ${item.data.caption ? `<div style="margin-bottom: 10px;">${escapeHtml(item.data.caption)}</div>` : ''}
                <img src="/tracks/${item.data.imageHash}" style="max-width: 100%; border-radius: 8px; border: 1px solid var(--border); margin-top: 10px;">
            </div>
        `;
    } else if (item.type === 'VIDEO_POST') {
        return `
            <div class="post-body">
                ${item.data.caption ? `<div style="margin-bottom: 10px;">${escapeHtml(item.data.caption)}</div>` : ''}
                <video src="/tracks/${item.data.videoHash}" controls style="max-width: 100%; border-radius: 8px; border: 1px solid var(--border); margin-top: 10px;"></video>
            </div>
        `;
    } else if (item.type === 'PROJECT_FILE_POST') {
        return `
            <div class="post-body">
                ${item.data.caption ? `<div style="margin-bottom: 10px;">${escapeHtml(item.data.caption)}</div>` : ''}
                <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--primary); padding: 15px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                    <div>
                        <strong style="color: var(--primary);">📦 Project File / Stems</strong>
                        <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(item.data.filename || "Archive.zip")}</div>
                    </div>
                    <button onclick="window.open('/tracks/${item.data.fileHash}', '_blank')">Download</button>
                </div>
            </div>
        `;
    } else if (item.type === 'TEXT_POST') {
        return `<div class="post-body">${parseMentions(item.data.content)}</div>`;
    } else if (item.type === 'PROFILE_UPDATE') {
        return `<div class="post-body" style="color: var(--primary); font-style: italic;">Deployed a new Node Identity to the swarm.</div>`;
    } else if (item.type === 'THEME_UPDATE') {
        return `<div class="post-body" style="color: var(--primary); font-style: italic;">Upgraded their custom MySpace theme CSS.</div>`;
    } else if (item.type === 'SHOUTBOX_POST') {
        return `<div class="post-body" style="color: var(--text-muted);">📢 Shouted out Node_${item.receiver.substring(0,6)}: <span style="color:#fff;">"${escapeHtml(item.data.message)}"</span></div>`;
    } else if (item.type === 'SET_TOP_8') {
        return `<div class="post-body" style="color: var(--warning); font-style: italic;">Locked in a new Top 8 Crew.</div>`;
    } else if (item.type === 'STREAM_COMPLETED') {
        return `<div class="post-body" style="color: var(--success); font-style: italic;">🎧 Mined a new block by streaming a track! (+5,000 $VOD)</div>`;
    } else if (item.type === 'BUY_SONG_SHARE') {
        return `<div class="post-body" style="color: var(--success); font-style: italic;">📈 Acquired ${item.data.shareCount} shares of a track on the open market!</div>`;
    } else if (item.type === 'REQUEST_SONG_SHARE') {
        return `<div class="post-body" style="color: var(--primary); font-style: italic;">📬 Sent a request to acquire a ${item.data.shareCount}% stake in a track for ${item.data.pricePerShare} $VOD each.</div>`;
    }
    return `<div class="post-body" style="opacity: 0.5;">System Broadcast: ${item.type}</div>`;
}

// ==========================================
// UI NAVIGATION & UTILITIES
// ==========================================

function toggleBlockNode(publicKey) {
    let blocks = JSON.parse(localStorage.getItem('vod_blocked_nodes') || '[]');
    if (blocks.includes(publicKey)) {
        blocks = blocks.filter(k => k !== publicKey);
        alert("Node unblocked.");
    } else {
        blocks.push(publicKey);
        alert("Node blocked. Their data will be dropped.");
    }
    localStorage.setItem('vod_blocked_nodes', JSON.stringify(blocks));
    if(currentView === 'feed') loadMainGlobalFeed();
}

function isNodeBlocked(publicKey) {
    if (!publicKey) return false;
    let blocks = JSON.parse(localStorage.getItem('vod_blocked_nodes') || '[]');
    return blocks.includes(publicKey);
}

function renderTags(metadata) {
    if (!metadata) return '';
    return metadata.split(',').map(tag => {
        let t = tag.trim();
        if (!t) return '';
        if (!t.startsWith('#')) t = '#' + t;
        return `<span style="color:var(--primary); cursor:pointer; margin-right: 5px;" onclick="filterFeedByTag('${escapeJsArg(t)}')">${escapeHtml(t)}</span>`;
    }).join('');
}

function filterFeedByTag(tag) {
    activeFeedTag = tag;
    switchTab('feed', document.querySelector('.side-nav-item')); 
    loadMainGlobalFeed();
}

function executeGlobalSearch(query) {
    const q = query.toLowerCase();
    for (let addr in networkProfiles) {
        if (addr.toLowerCase() === q || networkProfiles[addr].username.toLowerCase().includes(q)) return inspectTargetNode(addr);
    }
    const track = feedTracks.find(t => (t.data.trackTitle && t.data.trackTitle.toLowerCase().includes(q)) || (t.data.artist && t.data.artist.toLowerCase().includes(q)));
    if (track) return playTrack(track.data.trackTitle, track.data.audioHash, track.sender, track.data.artist);
    const article = zineArticles.find(a => (a.title && a.title.toLowerCase().includes(q)) || (a.body && a.body.toLowerCase().includes(q)));
    if (article) return switchTab('zine');
    if (marketDataCache && marketDataCache.items) {
        const item = marketDataCache.items.find(i => i.title && i.title.toLowerCase().includes(q));
        if (item) {
            switchTab('market', document.getElementById('nav-market-tab'));
            switchMarketTab('buy');
            document.getElementById('buy-search-filter').value = query;
            renderMarketplace();
            return;
        }
    }
    alert("No results found for: " + query);
}

function inspectTargetNode(publicKey) {
    if (!publicKey) return;
    const profileTabItem = Array.from(document.querySelectorAll('.side-nav-item')).find(el => el.innerText.toLowerCase().includes('profile') || el.innerText.includes('Profile'));
    switchTab('profile', profileTabItem);
    fetchUserProfile(publicKey, false);
}

async function deletePost(txHash) {
    if (!confirm("Are you sure you want to delete this post?")) return;
    try {
        const msgData = {
            sender: userKeys.publicKey,
            receiver: '0x00',
            type: 'DELETE_POST',
            data: { txHash },
            timestamp: Date.now()
        };
        const sig = await generateClientSignature(userKeys.privateKey, msgData);
        const txFields = { ...msgData, signature: sig };
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (res.ok) {
            alert("Post deleted.");
            loadMainGlobalFeed();
            if (currentView === 'profile') fetchUserProfile(viewingUserPublicKey || userKeys.publicKey, false);
        } else {
            throw new Error((await res.json()).error);
        }
    } catch (err) {
        alert("Failed to delete: " + err.message);
    }
}

async function requestSongShare(hash, seller) {
    if (seller === userKeys.publicKey) return alert("You already own this track's equity.");
    const count = prompt("How many shares (percentage) do you want to request?");
    if (!count || isNaN(count)) return;
    const price = prompt(`What price per share in $VOD are you offering for these ${count}%?`);
    if (!price || isNaN(price)) return;
    
    try {
        const msgData = { sender: userKeys.publicKey, receiver: seller, type: 'REQUEST_SONG_SHARE', data: { audioHash: hash, shareCount: parseInt(count), pricePerShare: parseFloat(price) }, timestamp: Date.now() };
        const sig = await generateClientSignature(userKeys.privateKey, msgData);
        const txFields = { ...msgData, signature: sig };
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (!res.ok) throw new Error((await res.json()).error);
        alert(`Stake Request sent to the creator for ${count}% at ${price} $VOD each!`);
        fetchUserProfile(userKeys.publicKey, false);
    } catch(err) { alert(err.message); }
}

async function buySongShareDirect(hash, seller, price) {
    const count = prompt("How many available shares (percentage) do you want to buy?");
    if (!count || isNaN(count)) return;
    try {
        const msgData = { sender: userKeys.publicKey, receiver: seller, type: 'BUY_SONG_SHARE', data: { audioHash: hash, shareCount: parseInt(count), pricePerShare: parseFloat(price) }, timestamp: Date.now() };
        const sig = await generateClientSignature(userKeys.privateKey, msgData);
        const txFields = { ...msgData, signature: sig };
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (!res.ok) throw new Error((await res.json()).error);
        alert(`Successfully purchased ${count}% stake!`);
        loadMainGlobalFeed();
        fetchUserProfile(userKeys.publicKey, false);
    } catch(err) { alert(err.message); }
}

async function respondToStakeRequest(requestId, type) {
    if (!confirm(`Are you sure you want to ${type === 'ACCEPT_SHARE_REQUEST' ? 'accept' : 'decline'} this request?`)) return;
    try {
        const msgData = { sender: userKeys.publicKey, receiver: '0x00', type: type, data: { requestId }, timestamp: Date.now() };
        const sig = await generateClientSignature(userKeys.privateKey, msgData);
        const txFields = { ...msgData, signature: sig };
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (!res.ok) throw new Error((await res.json()).error);
        alert("Request processed successfully.");
        fetchUserProfile(userKeys.publicKey, false);
    } catch(err) { alert(err.message); }
}

async function promptEditSong(audioHash) {
    if (!userKeys.publicKey) return;
    const newTitle = prompt("Enter new track title:");
    const newArtist = prompt("Enter artist name:");
    if (!newTitle && !newArtist) return;

    try {
        const msgData = { 
            sender: userKeys.publicKey, receiver: '0x00', type: 'EDIT_SONG_METADATA', 
            data: { audioHash: audioHash }, 
            timestamp: Date.now() 
        };
        if (newTitle) msgData.data.title = newTitle;
        if (newArtist) msgData.data.artist = newArtist;

        const sig = await generateClientSignature(userKeys.privateKey, msgData);
        const txFields = { ...msgData, signature: sig };
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (!res.ok) throw new Error((await res.json()).error);
        alert("Metadata updated!"); fetchUserProfile(userKeys.publicKey, false); loadMainGlobalFeed();
    } catch(err) { alert("Failed to edit: " + err.message); }
}

function switchTab(tabName, element) {
    currentView = tabName;
    document.getElementById('view-feed').classList.add('hidden');
    document.getElementById('view-profile').classList.add('hidden');
    const walletView = document.getElementById('view-wallet');
    if (walletView) walletView.classList.add('hidden');
    document.getElementById('view-zine').classList.add('hidden');
    const views = ['wallet', 'market', 'events', 'zine', 'hotornot'];
    views.forEach(v => {
        const el = document.getElementById('view-' + v);
        if (el) el.classList.add('hidden');
    });
    
    document.querySelectorAll('.side-nav-item').forEach(i => i.classList.remove('active'));

    document.getElementById('view-' + tabName).classList.remove('hidden');
    if(element) element.classList.add('active');

    // Revert to personal theme when leaving someone else's profile
    if (tabName !== 'profile') {
        const dynamicStyle = document.getElementById('ui-dynamic-user-theme');
        if (dynamicStyle) dynamicStyle.innerHTML = myCustomTheme;
        viewingUserPublicKey = '';
    }

    const container = document.querySelector('.container');
    if (tabName === 'events') {
        container.classList.add('flyer-mode');
    } else {
        container.classList.remove('flyer-mode');
    }
    if (tabName === 'events') { loadEvents(); setTimeout(initEventsMap, 600); }
    if (tabName === 'profile') fetchUserProfile(userKeys.publicKey, false);
    if (tabName === 'market') loadMarketplace();
    if (tabName === 'zine') renderZine();
    if (tabName === 'hotornot') loadHotOrNot();
}

function renderServerList() {
    const list = document.getElementById('ui-server-list');
    if (!list) return;
    
    const dmActive = currentChatServer === '@dms' ? 'active' : '';
    const dmBtn = `<div class="server-icon ${dmActive}" onclick="switchServer('@dms')" title="Direct Messages" style="background: var(--primary); color: #000;">💬</div>`;
    const addBtnHTML = `<div class="server-icon" onclick="promptCreateServer()" style="background: rgba(102, 252, 241, 0.1); color: var(--text-muted); font-size: 24px;" title="Create Server">+</div>`;
    
    let html = '';
    serversData.forEach(srv => {
        const isActive = srv.id === currentChatServer ? 'active' : '';
        const seed = encodeURIComponent(srv.id);
        html += `<div class="server-icon ${isActive}" onclick="switchServer('${srv.id}')" title="${escapeHtml(srv.name)}">
            <img src="https://api.dicebear.com/7.x/identicon/svg?seed=${seed}&backgroundColor=1f2833">
        </div>`;
    });
    
    list.innerHTML = dmBtn + html + addBtnHTML;
}

function switchServer(serverId) {
    if (serverId === '@dms') {
        currentChatServer = '@dms';
        renderServerList();
        document.getElementById('ui-active-server-name').innerText = "💬 Direct Messages";
        
        const voiceBtn = document.querySelector('span[onclick="joinActiveVoiceChannel()"]');
        if(voiceBtn) voiceBtn.style.display = 'none';
        const addChBtn = document.querySelector('span[onclick="promptCreateChannel()"]');
        if(addChBtn) addChBtn.style.display = 'none';
        
        renderDMList();
        const firstDm = Object.keys(dmHistory)[0];
        if (firstDm) switchDMChannel(firstDm);
        else {
            currentChatChannel = null;
            document.getElementById('ui-chat-log').innerHTML = '<div style="padding:15px; color:var(--text-muted);">No active conversations. Start a DM from the Swarm or Profile.</div>';
            document.getElementById('chat-input').disabled = true;
            document.getElementById('chat-input').placeholder = "No conversation selected...";
        }
        return;
    }

    currentChatServer = serverId;
    renderServerList();
    
    const voiceBtn = document.querySelector('span[onclick="joinActiveVoiceChannel()"]');
    if(voiceBtn) voiceBtn.style.display = 'inline-block';
    const addChBtn = document.querySelector('span[onclick="promptCreateChannel()"]');
    if(addChBtn) addChBtn.style.display = 'inline-block';

    const srv = serversData.find(s => s.id === serverId);
    if (!srv) return;
    
    document.getElementById('ui-active-server-name').innerText = srv.name;
    renderChannelList(srv);
    
    if (srv.channels && srv.channels.length > 0) {
        switchChannel(srv.id, srv.channels[0].id);
    } else {
        currentChatChannel = null;
        document.getElementById('ui-channel-list').innerHTML = '';
        document.getElementById('ui-chat-log').innerHTML = '';
        const input = document.getElementById('chat-input');
        input.placeholder = 'No channels available...';
        input.disabled = true;
    }
}

function renderChannelList(srv) {
    const list = document.getElementById('ui-channel-list');
    if (!list) return;
    
    let html = '';
    srv.channels.forEach(ch => {
        const isActive = ch.id === currentChatChannel ? 'active' : '';
        const icon = ch.locked ? '🔒' : '#';
        const classNames = `channel-tab ${isActive} ${ch.locked ? 'locked' : ''}`;
        html += `<div class="${classNames}" onclick="switchChannel('${srv.id}', '${ch.id}')">
            ${icon} ${escapeHtml(ch.name)}
        </div>`;
    });
    list.innerHTML = html;
}

function renderDMList() {
    const list = document.getElementById('ui-channel-list');
    if (!list) return;
    let html = '';
    for (const addr of Object.keys(dmHistory)) {
        const isActive = addr === currentChatChannel ? 'active' : '';
        html += `<div class="channel-tab ${isActive}" onclick="switchDMChannel('${addr}')">@ ${resolveProfile(addr).username}</div>`;
    }
    list.innerHTML = html;
}

function switchDMChannel(address) {
    currentChatServer = '@dms';
    currentChatChannel = address;
    renderDMList();
    document.getElementById('ui-active-server-name').innerText = "@ " + resolveProfile(address).username;
    
    const chatLog = document.getElementById('ui-chat-log');
    chatLog.innerHTML = `<div class="chat-msg"><div class="chat-content"><div style="color: var(--primary);">Secure DM channel started with ${resolveProfile(address).username}.</div></div></div>`;
    
    (dmHistory[address] || []).forEach(msg => appendChatMessage(msg));
    chatLog.scrollTop = chatLog.scrollHeight;
    
    const input = document.getElementById('chat-input');
    input.placeholder = `Message @${resolveProfile(address).username}...`;
    input.disabled = false;
}

function switchChannel(serverId, channelId) {
    currentChatServer = serverId;
    currentChatChannel = channelId;
    
    const srv = serversData.find(s => s.id === serverId);
    if (!srv) return;
    
    renderChannelList(srv); 
    
    const ch = srv.channels.find(c => c.id === channelId);
    if (!ch) return;
    
    const chatLog = document.getElementById('ui-chat-log');
    chatLog.innerHTML = `
        <div class="chat-msg">
            <div class="chat-avatar"></div>
            <div class="chat-content">
                <div><span class="sender">System</span></div>
                <div style="color: var(--success);">Welcome to #${escapeHtml(ch.name)}. Messages are end-to-end encrypted.</div>
            </div>
        </div>
    `;
    const input = document.getElementById('chat-input');
    input.placeholder = `Message #${ch.name}...`;
    input.disabled = false;
    
    socket.emit('join_channel', { serverId, channelId, address: userKeys.publicKey || 'anonymous' });
}

function handleChatEnter(e) {
    if (e.key === 'Enter' && e.target.value.trim() !== '') {
        if(!userKeys.publicKey) return alert("Please unlock your identity to chat.");
        if(!currentChatServer || !currentChatChannel) return;
        
        const text = e.target.value.trim();
        const time = Date.now();

        if (currentChatServer === '@dms') {
            socket.emit('send_direct_message', { to: currentChatChannel, text });
            broadcastToMesh('P2P_CHAT', { sender: userKeys.publicKey, to: currentChatChannel, text, time });
        } else {
            socket.emit('send_message', { serverId: currentChatServer, channelId: currentChatChannel, address: userKeys.publicKey, text });
            broadcastToMesh('P2P_CHAT', { serverId: currentChatServer, channelId: currentChatChannel, sender: userKeys.publicKey, text, time });
        }
        detectMentionsAndEmit(text);
        e.target.value = '';
    }
}

function promptCreateServer() {
    if(!userKeys.publicKey) return alert("Please unlock your identity to create a server.");
    const serverName = prompt("Enter new Server Name:");
    if (serverName && serverName.trim()) {
        socket.emit('create_server', { serverName: serverName.trim(), address: userKeys.publicKey });
    }
}

function promptCreateChannel() {
    if(!userKeys.publicKey) return alert("Please unlock your identity to create a channel.");
    if(!currentChatServer) return alert("Please select a server first.");
    const channelName = prompt("Enter new Channel Name:");
    if (channelName && channelName.trim()) {
        const isLocked = confirm("Make this a Token-Gated Backroom? (Requires 10,000 $VOD to enter)");
        const safeName = channelName.trim().replace(/[\s#]/g, '-').toLowerCase();
        socket.emit('create_channel', { serverId: currentChatServer, channelName: safeName, address: userKeys.publicKey, locked: isLocked });
    }
}

async function loadEvents() {
    const board = document.getElementById('ui-bulletin-board');
    if(!board) return;
    
    const loadingText = document.getElementById('board-loading-text');
    if (loadingText) loadingText.style.display = 'block';
    
    const selectedDate = document.getElementById('event-date-picker').value;
    
    try {
        const res = await fetch('/api/feed');
        const data = await res.json();
        
        // Filter by isFlyer AND selected date
        const eventPosts = data.filter(item => {
            if (item.type !== 'IMAGE_POST' || !item.data || !item.data.isFlyer) return false;
            const itemDate = new Date(item.timestamp).toISOString().split('T')[0];
            return itemDate === selectedDate;
        });
        
        if (typeof postedFlyerHashes !== 'undefined') postedFlyerHashes.clear();
        eventsState.hashes.clear();
        
        eventsState.mapMarkers.forEach(m => m.setMap(null));
        eventsState.mapMarkers = [];
        
        Array.from(board.children).forEach(child => {
            if (child.id !== 'board-loading-text') child.remove();
        });
        
        if(eventPosts.length === 0) {
            if (loadingText) {
                loadingText.innerText = `No events found for ${selectedDate}. Click the board to pin a flyer!`;
                loadingText.style.display = 'block';
            }
            return;
        }
        if (loadingText) loadingText.style.display = 'none';

        let imagesToLoad = eventPosts.length;

        // Ascending so newest renders on top
        eventPosts.sort((a, b) => a.timestamp - b.timestamp).forEach(item => {
            if (typeof postedFlyerHashes !== 'undefined' && item.data.localHash) postedFlyerHashes.add(item.data.localHash);
            if (item.data.localHash) eventsState.hashes.add(item.data.localHash);
            
            const x = item.data.x || 50;
            const y = item.data.y || 50;
            const rotation = item.data.rotation || 0;
            
            const flyerEl = document.createElement('div');
            flyerEl.className = 'bulletin-flyer';
            flyerEl.dataset.txhash = item.transactionHash;
            flyerEl.dataset.sender = item.sender;
            flyerEl.style.left = `calc(${x}% - 60px)`; 
            flyerEl.style.top = `calc(${y}% - 60px)`; 
            flyerEl.style.transform = `rotate(${rotation}deg)`;
            
            flyerEl.innerHTML = `
                <img src="/tracks/${item.data.imageHash}" draggable="false">
                <div class="flyer-meta-tag">@${resolveProfile(item.sender).username}</div>
            `;
            board.appendChild(flyerEl);

            if (eventsMap && item.data.lat && item.data.lng) {
                const marker = new google.maps.Marker({
                    position: { lat: item.data.lat, lng: item.data.lng },
                    map: eventsMap,
                    title: `@${resolveProfile(item.sender).username}`
                });
                eventsState.mapMarkers.push(marker);
            }

            const img = flyerEl.querySelector('img');
            img.onload = img.onerror = () => { imagesToLoad--; if (imagesToLoad <= 0) cleanUpCoveredFlyers(); };
        });
    } catch(e) {
        if (loadingText) loadingText.innerText = "Failed to load Events from ledger.";
    }
}

function initEventsMap() {
    if (eventsMap) return;
    if (!window.google || !window.google.maps) {
        console.log('[SYSTEM] Waiting for Google Maps library...');
        setTimeout(initEventsMap, 500);
        return;
    }

    const mapDiv = document.getElementById('events-3d-map');
    
    // Get user location for a personalized landscape background
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            setupMap({ lat: position.coords.latitude, lng: position.coords.longitude });
        }, () => setupMap({ lat: 40.7128, lng: -74.0060 }));
    } else {
        setupMap({ lat: 40.7128, lng: -74.0060 });
    }

    function setupMap(center) {
        eventsMap = new google.maps.Map(mapDiv, {
            center: center,
            zoom: 18,
            tilt: 60,
            heading: 0,
            mapTypeId: 'hybrid', // Real landscape satellite view
            disableDefaultUI: true,
            gestureHandling: 'none' // Map stays locked as background landscape
        });
    }
}

function cleanUpCoveredFlyers() {
    const flyers = Array.from(document.querySelectorAll('.bulletin-flyer'));
    let removed = 0;
    flyers.forEach(flyer => {
        const rect = flyer.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        let isCovered = true;
        const stepX = rect.width / 5;
        const stepY = rect.height / 5;
        
        // Check a 4x4 coordinate grid across the surface of the flyer
        for (let x = 1; x <= 4; x++) {
            for (let y = 1; y <= 4; y++) {
                const topEl = document.elementFromPoint(rect.left + (stepX * x), rect.top + (stepY * y));
                const coveringFlyer = topEl ? topEl.closest('.bulletin-flyer') : null;
                
                // If point hits nothing, our flyer, or something that IS NOT another flyer (like UI)
                if (!coveringFlyer || coveringFlyer === flyer) {
                    isCovered = false;
                    break;
                }
            }
            if (!isCovered) break;
        }
        
        if (isCovered) { 
            const txHash = flyer.dataset.txhash;
            const sender = flyer.dataset.sender;
            flyer.remove(); 
            removed++; 
            if (txHash && sender === userKeys.publicKey) silentDeletePost(txHash);
        }
    });
    if (removed > 0) console.log(`[FLYER WALL] Deleted ${removed} completely buried flyers to save space.`);
}

async function silentDeletePost(txHash) {
    try {
        const msgData = { sender: userKeys.publicKey, receiver: '0x00', type: 'DELETE_POST', data: { txHash }, timestamp: Date.now() };
        const sig = await generateClientSignature(userKeys.privateKey, msgData);
        const txFields = { ...msgData, signature: sig };
        await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
    } catch (err) {}
}

async function handleFlyerSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    console.log('[FLYER] File selected:', file.name);

    // Generate SHA-256 hash of file content to prevent duplicates BEFORE upload
    const buffer = await file.arrayBuffer();
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    if (eventsState.hashes.has(fileHash)) {
        alert("This exact flyer has already been pinned to the board!");
        e.target.value = '';
        return;
    }

    eventsState.currentFile = file;
    eventsState.currentFile.localHash = fileHash;
    eventsState.isPlacing = true;

    const preview = document.getElementById('ui-flyer-cursor');
    if (preview) {
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
    }
    document.body.style.cursor = 'crosshair';
}

async function handleBulletinBoardClick(e) {
    if (!eventsState.isPlacing || !eventsState.currentFile) {
        // If no file is selected, trigger the upload dialog to help users "add events"
        const input = document.getElementById('flyer-upload-input');
        if (input) input.click();
        return;
    }
    console.log('[FLYER] Board clicked. Posting flyer...');
    
    const board = document.getElementById('ui-bulletin-board');
    const rect = board.getBoundingClientRect();
    
    const x = ((e.clientX - rect.left) / rect.width) * 100; const y = ((e.clientY - rect.top) / rect.height) * 100;
    const rot = (Math.random() * 30) - 15;

    let lat = 40.7128, lng = -74.0060;
    if (eventsMap && eventsMap.getCenter()) {
        lat = eventsMap.getCenter().lat() + (Math.random() - 0.5) * 0.005;
        lng = eventsMap.getCenter().lng() + (Math.random() - 0.5) * 0.005;
    }

    eventsState.isPlacing = false; document.body.style.cursor = 'default'; document.getElementById('ui-flyer-cursor').style.display = 'none';
    try {
        const hash = await uploadMediaAssetFile(eventsState.currentFile);
        await sendSignedTransaction('IMAGE_POST', "0x00", { imageHash: hash, isFlyer: true, localHash: eventsState.currentFile.localHash, x, y, rotation: rot, lat, lng });
        loadEvents();
    } catch (err) { alert(err.message); }
    eventsState.currentFile = null;
}

function appendChatMessage(msg) {
    const chatLog = document.getElementById('ui-chat-log');
    if(!chatLog) return;
    
    const el = document.createElement('div');
    el.className = 'chat-msg';
    const msgId = msg.time + '_' + msg.sender.substring(0, 5); // Unique ID for reactions
    el.id = 'msg_' + msgId;
    const isMe = msg.sender === userKeys.publicKey;
    const senderName = isMe ? 'You' : resolveProfile(msg.sender).username;
    const timeStr = new Date(msg.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    el.innerHTML = `
        <div class="chat-avatar" style="background: url('${getAvatarUrl(msg.sender)}'); background-size: cover; border-radius: 50%; cursor: pointer;" onclick="inspectTargetNode('${msg.sender}')"></div>
        <div class="chat-content" style="width: 100%;">
            <div style="display:flex; justify-content:space-between; align-items: center;">
                <div>
                    <span class="sender" style="cursor:pointer;" onclick="inspectTargetNode('${msg.sender}')">${senderName}</span>
                    ${renderBadges(msg.roles || [])}
                    <span class="time">${timeStr}</span>
                </div>
                <span class="chat-react-trigger" onclick="sendReaction('${msgId}')" title="Add Reaction">➕😀</span>
            </div>
            <div style="color: #fff; margin-top: 4px;">${parseMentions(msg.text)}</div>
            <div id="reactions_${msgId}" style="display:flex; gap: 5px; font-size: 14px; margin-top: 6px;"></div>
        </div>
    `;
    chatLog.appendChild(el);
}

function playProfileTrack(index) {
    if (!currentViewedProfile || !currentViewedProfile.uploadedTracks) return;
    const tracks = currentViewedProfile.uploadedTracks.slice().sort((a,b) => b.timestamp - a.timestamp);
    const track = tracks[index];
    const artistName = track.artist || currentViewedProfile.username;
    if (track) {
        const select = document.getElementById('playlist-selector');
        if (select) { select.value = 'profile'; currentPlaylistMode = 'profile'; }
        playTrack(track.title, track.hash, currentViewedProfile.publicKey, artistName);
    }
}

function toggleInlineEdit() {
    const displayMode = document.getElementById('profile-display-mode');
    const editMode = document.getElementById('profile-edit-mode');
    const btnAvatar = document.getElementById('btn-edit-avatar');
    const btnBanner = document.getElementById('btn-edit-banner');
    const toggleBtn = document.getElementById('btn-toggle-edit');

    displayMode.classList.toggle('hidden');
    editMode.classList.toggle('hidden');
    btnAvatar.classList.toggle('hidden');
    btnBanner.classList.toggle('hidden');
    toggleBtn.classList.toggle('hidden');
}

async function fetchUserProfile(publicKey, isNavUpdateOnly) {
    try {
        const response = await fetch(`/api/social/profile?publicKey=${encodeURIComponent(publicKey)}`);
        const profile = await response.json();
        
        if(profile.publicKey === userKeys.publicKey) {
            const balDisp = document.getElementById('ui-balance-display');
            if(balDisp) balDisp.innerText = profile.balance.toLocaleString();
        }

        // Always update the composer avatar if it's our profile
        if (profile.publicKey === userKeys.publicKey) {
            const adminPanel = document.getElementById('ui-admin-panel');
            if (adminPanel) {
                if (profile.isAdmin) adminPanel.classList.remove('hidden');
                else adminPanel.classList.add('hidden');
            }

            myCustomTheme = profile.customCss || '';
            
            // Immediately apply personal theme if browsing global views
            if (currentView !== 'profile' || viewingUserPublicKey === userKeys.publicKey || !viewingUserPublicKey) {
                const dynamicStyle = document.getElementById('ui-dynamic-user-theme');
                if (dynamicStyle) dynamicStyle.innerHTML = myCustomTheme;
            }

            const composerAvatar = document.getElementById('composer-avatar');
            if (composerAvatar) {
                composerAvatar.src = profile.avatarHash ? `/tracks/${profile.avatarHash}` : `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(profile.publicKey)}&backgroundColor=0b0c10`;
            }

            // Populate Settings Form Fields
            const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
            setVal('input-edit-username', profile.username || "");
            setVal('input-edit-bio', profile.bio || "");
            setVal('input-edit-top8', (profile.top8 || []).join(', '));

            if (profile.customCss) {
                const pMatch = profile.customCss.match(/--primary:\s*(#[0-9a-fA-F]{6})/i);
                if (pMatch) setVal('input-color-primary', pMatch[1]);

                const bgMatch = profile.customCss.match(/--bg-body:\s*(#[0-9a-fA-F]{6})/i);
                if (bgMatch) setVal('input-color-bg', bgMatch[1]);

                const cardMatch = profile.customCss.match(/--bg-card:\s*(#[0-9a-fA-F]{6})/i);
                if (cardMatch) setVal('input-color-card', cardMatch[1]);

                const rawCssMatch = profile.customCss.split('/* --- CUSTOM CSS --- */');
                if (rawCssMatch.length > 1) {
                    setVal('input-edit-css', rawCssMatch[1].trim());
                } else {
                    setVal('input-edit-css', profile.customCss.replace(/:root\s*{[^}]*}/, '').trim());
                }
            }
        }

        if(isNavUpdateOnly) return;

        viewingUserPublicKey = profile.publicKey;
        currentViewedProfile = profile;

        const toggleBtn = document.getElementById('btn-toggle-edit');
        if (toggleBtn) {
            toggleBtn.style.display = viewingUserPublicKey === userKeys.publicKey ? 'block' : 'none';
        }
        
        // Update Profile UI Elements
        const elements = {
            'ui-profile-view-name': profile.username,
            'ui-profile-view-address': profile.publicKey,
            'ui-profile-view-bio': profile.bio,
            'ui-profile-view-balance': profile.balance.toLocaleString()
        };
        
        for (let id in elements) {
            let el = document.getElementById(id);
            if(el) el.innerText = elements[id];
        }

        const avatar = document.getElementById('ui-profile-view-avatar');
        if(avatar) {
            if (profile.avatarHash) {
                avatar.src = `/tracks/${profile.avatarHash}`;
            } else {
                avatar.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(profile.publicKey)}`;
            }
        }

        const cover = document.getElementById('ui-profile-cover');
        if (cover) {
            let galleryImages = [];
            if (profile.uploadedImages) galleryImages.push(...profile.uploadedImages.map(img => img.hash));
            if (profile.ownedItems) galleryImages.push(...profile.ownedItems.map(item => item.assetHash));
            
            if (galleryImages.length > 0) {
                const maxImages = Math.min(galleryImages.length, 5);
                const step = 100 / (maxImages > 1 ? maxImages - 1 : 1);
                const bgImages = []; const bgPositions = []; const bgSizes = [];
                for(let i = 0; i < maxImages; i++) {
                    bgImages.push(`url('/tracks/${galleryImages[i]}')`);
                    bgPositions.push(`${maxImages === 1 ? '50%' : (i * step) + '%'} center`);
                    bgSizes.push(`${100 / maxImages}% 100%`);
                }
                cover.style.backgroundImage = bgImages.join(', ');
                cover.style.backgroundPosition = bgPositions.join(', ');
                cover.style.backgroundSize = bgSizes.join(', ');
                cover.style.backgroundRepeat = Array(maxImages).fill('no-repeat').join(', ');
            } else if (profile.bannerHash) {
                cover.style.background = `url('/tracks/${profile.bannerHash}') center/cover`;
            } else {
                cover.style.background = `linear-gradient(135deg, #1d4e89 0%, var(--primary) 100%)`;
            }
        }

        // Populate Top 8
        const top8Container = document.getElementById('ui-profile-top8');
        if (top8Container) {
            top8Container.innerHTML = '';
            if (profile.top8 && profile.top8.length > 0) {
                profile.top8.forEach((key) => {
                    top8Container.innerHTML += `
                        <div class="top8-item" onclick="inspectTargetNode('${key}')">
                            <img class="top8-avatar" src="${getAvatarUrl(key)}" alt="Top8">
                            <div class="top8-name">${resolveProfile(key).username}</div>
                        </div>
                    `;
                });
            } else {
                top8Container.innerHTML = `<div style="grid-column: span 4; color: var(--text-muted); font-size: 13px;">No crew members locked in yet.</div>`;
            }
        }

        // Populate Mutuals & Recommended
        const recContainer = document.getElementById('ui-profile-recommended');
        if (recContainer) {
            let html = '';
            if (viewingUserPublicKey !== userKeys.publicKey) {
                const isMutual = profile.following.includes(userKeys.publicKey);
                if (isMutual) {
                    html += `<div style="background: rgba(31, 188, 115, 0.1); border: 1px solid var(--success); color: var(--success); padding: 10px; border-radius: 8px; font-size: 12px; margin-bottom: 10px; text-align: center;">🤝 You and ${profile.username} are mutuals!</div>`;
                }
            }

            if (profile.recommended && profile.recommended.length > 0) {
                html += `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px; text-transform: uppercase; font-weight: bold;">Suggested Connections</div>`;
                html += profile.recommended.map(key => `
                    <div style="display:flex; align-items:center; gap:10px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; transition: 0.2s;" onclick="inspectTargetNode('${key}')" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='transparent'">
                        <img src="${getAvatarUrl(key)}" style="width: 30px; height: 30px; border-radius: 50%;">
                        <div style="font-size: 13px; font-weight: bold; color: #fff;">${resolveProfile(key).username}</div>
                        <div style="margin-left: auto; font-size: 10px; color: var(--primary);">+ Add</div>
                    </div>
                `).join('');
            } else {
                html += `<div style="color: var(--text-muted); font-size: 12px;">No network data to suggest connections.</div>`;
            }
            recContainer.innerHTML = html;
        }

        // Populate Shoutbox
        const shoutboxContainer = document.getElementById('ui-profile-shoutbox');
        if (shoutboxContainer) {
            shoutboxContainer.innerHTML = '';
            if (profile.shoutbox && profile.shoutbox.length > 0) {
                // Sort descending by timestamp
                const sortedShouts = profile.shoutbox.slice().sort((a, b) => b.timestamp - a.timestamp);
                sortedShouts.forEach(msg => {
                    shoutboxContainer.innerHTML += `
                        <div style="border-bottom: 1px solid rgba(69, 162, 158, 0.2); padding-bottom: 10px; display:flex; gap:10px;">
                            <img src="${getAvatarUrl(msg.sender)}" style="width:40px; height:40px; border-radius:8px; cursor:pointer;" onclick="inspectTargetNode('${msg.sender}')">
                            <div style="flex:1;">
                                <div style="font-size: 12px; font-weight:bold; color: var(--primary); cursor: pointer;" onclick="inspectTargetNode('${msg.sender}')">${resolveProfile(msg.sender).username} <span style="color: var(--text-muted); float:right;">${new Date(msg.timestamp).toLocaleString()}</span></div>
                                <div style="font-size: 13px; margin-top: 4px; color: #fff;">${escapeHtml(msg.message)}</div>
                            </div>
                        </div>
                    `;
                });
            } else {
                shoutboxContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">No shouts yet. Be the first!</div>`;
            }
        }

        // Render Transaction History
        const historyContainers = [document.getElementById('ui-tx-history'), document.getElementById('ui-sidebar-tx-history')];
        historyContainers.forEach(historyContainer => {
            if (historyContainer) {
                if (historyContainer.id === 'ui-sidebar-tx-history' && profile.publicKey !== userKeys.publicKey) return; // Only show personal tx in sidebar
                const txListToRender = profile.transactions;
                historyContainer.innerHTML = txListToRender.map(tx => {
                let isSender = tx.sender === userKeys.publicKey;
                let sign = isSender ? '-' : '+';
                let color = isSender ? 'var(--warning)' : 'var(--success)';
                let amount = tx.amount;

                // Handle implicit amounts defined by the smart contract
                if (tx.type === 'STREAM_COMPLETED') { 
                    if (isSender) { amount = 5000; sign = '+'; color = 'var(--success)'; }
                    else { amount = 'Royalties'; sign = '+'; color = 'var(--success)'; }
                } else if (tx.type === 'SONG_UPLOAD' && isSender) { amount = 50000; sign = '-'; color = 'var(--warning)'; }
                else if (tx.type === 'IMAGE_POST' && isSender) { amount = 5000; sign = '-'; color = 'var(--warning)'; }
                else if (tx.type === 'LIST_ITEM' && isSender) { amount = 500; sign = '-'; color = 'var(--warning)'; }
                else if (tx.type === 'LIKE_IMAGE' || tx.type === 'LIKE_POST') {
                    if (isSender) { amount = 500; sign = '+'; color = 'var(--success)'; }
                    else { amount = 2000; sign = '+'; color = 'var(--success)'; }
                }

                let amtDisplay = '';
                if (amount !== undefined && amount !== null) {
                    const formattedAmt = typeof amount === 'number' ? amount.toLocaleString() : amount;
                    amtDisplay = `<span style="color: ${color}; font-weight: bold;">${sign}${formattedAmt} VOD</span>`;
                }
                
                return `<div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid rgba(255,255,255,0.1); font-size:12px;">
                    <span><strong>${tx.type}</strong> | ${new Date(tx.timestamp).toLocaleString()}</span>
                    ${amtDisplay}
                </div>`;
                }).join('') || '<div style="color:var(--text-muted); font-size:12px;">No transactions yet.</div>';
            }
        });

        // Render Escrow Commissions
        const commContainer = document.getElementById('ui-active-commissions');
        if (commContainer) {
            commContainer.innerHTML = profile.activeCommissions.map(c => {
                const isCreator = c.creator === userKeys.publicKey;
                const actionBtn = isCreator ? `<button style="padding: 4px 10px; font-size: 11px; background:var(--success); color:#fff;" onclick="fulfillCommission('${c.id}')">Upload Asset to Fulfill</button>` : `<span style="font-size: 11px; color: var(--warning);">Awaiting Delivery</span>`;
                return `<div style="background: rgba(102, 252, 241, 0.05); border: 1px solid var(--border); padding: 12px; border-radius: 8px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
                        <strong style="color: var(--primary);">${c.amount} $VOD Escrow</strong>
                        ${actionBtn}
                    </div>
                    <div style="font-size: 12px; color: #fff; margin-bottom: 5px;"><strong>Terms:</strong> ${escapeHtml(c.terms)}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">Buyer: ${resolveProfile(c.buyer).username} | Creator: ${resolveProfile(c.creator).username}</div>
                </div>`;
            }).join('') || '<div style="color:var(--text-muted); font-size:12px;">No active commissions.</div>';
        }

        // Render Incoming Stake Requests
        const stakeReqContainer = document.getElementById('ui-wallet-stake-requests');
        if (stakeReqContainer && profile.publicKey === userKeys.publicKey) {
            if (profile.shareRequestsReceived && profile.shareRequestsReceived.length > 0) {
                stakeReqContainer.innerHTML = profile.shareRequestsReceived.map(r => `
                    <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--primary); padding: 12px; border-radius: 8px;">
                        <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
                            <strong style="color: var(--primary);">Request for ${r.count}% stake</strong>
                            <div>
                                <button style="padding: 4px 10px; font-size: 11px; background:var(--success); color:#fff; cursor:pointer;" onclick="respondToStakeRequest('${r.id}', 'ACCEPT_SHARE_REQUEST')">Accept</button>
                                <button style="padding: 4px 10px; font-size: 11px; background:var(--danger); color:#fff; cursor:pointer;" onclick="respondToStakeRequest('${r.id}', 'DECLINE_SHARE_REQUEST')">Decline</button>
                            </div>
                        </div>
                        <div style="font-size: 12px; color: #fff;">Buyer: ${resolveProfile(r.buyer).username} is offering ${r.price} $VOD per share (Total: ${r.count * r.price} $VOD)</div>
                    </div>
                `).join('');
            } else {
                stakeReqContainer.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">No incoming stake requests.</div>';
            }
        }

        // Render Profile Bounties
        const profileBountiesContainer = document.getElementById('ui-profile-commissions');
        if (profileBountiesContainer) {
            profileBountiesContainer.innerHTML = profile.bounties.map(b => {
                const statusBadge = b.awarded ? `<span style="color: var(--warning); font-size: 11px;">Awarded</span>` : `<span style="color: var(--success); font-size: 11px;">Open</span>`;
                return `
                <div style="background: rgba(102, 252, 241, 0.05); border: 1px solid rgba(102, 252, 241, 0.2); padding: 15px; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 5px;">
                        <div>
                            <div style="font-size: 14px; font-weight: bold; color: #fff;">${b.amount} $VOD Bounty</div>
                            <div style="font-size: 13px; color: #ccc;">${escapeHtml(b.description)}</div>
                        </div>
                        ${statusBadge}
                    </div>
                </div>`;
            }).join('') || '<div style="color:var(--text-muted); font-size: 13px;">No open commissions.</div>';
        }

        // Render Profile Posts (Mini-Feed)
        const profileFeedContainer = document.getElementById('ui-profile-feed');
        if (profileFeedContainer) {
            profileFeedContainer.innerHTML = '';
            
            const allowedProfileFeedTypes = ['SONG_UPLOAD', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST', 'TEXT_POST', 'SHOUTBOX_POST'];
            const displayablePosts = profile.posts ? profile.posts.filter(p => allowedProfileFeedTypes.includes(p.type) && !(p.type === 'IMAGE_POST' && p.data && p.data.isFlyer)) : [];
            
            if (displayablePosts.length > 0) {
                displayablePosts.forEach(item => {
                    const postEl = document.createElement('div');
                    postEl.className = 'post';
                    postEl.style.padding = "15px 0";
                    const timeStr = new Date(item.timestamp).toLocaleString();
                    const roles = item.roles || [];
                    const isOwner = item.sender === userKeys.publicKey;
                    const deleteBtn = isOwner ? `<button class="interaction-btn" onclick="deletePost('${item.transactionHash}')">🗑️ Delete</button>` : '';
                    postEl.innerHTML = `
                        <div class="post-avatar" onclick="inspectTargetNode('${item.sender}')" style="cursor:pointer;"><img src="${getAvatarUrl(item.sender)}"></div>
                        <div style="flex: 1;">
                            <div class="post-header">
                                <span class="post-name" onclick="inspectTargetNode('${item.sender}')">${resolveProfile(item.sender).username}</span>
                                ${renderBadges(roles)}
                                <span class="post-meta" style="margin-left:auto;">${item.sender.substring(0,10)}... • ${timeStr}</span>
                            </div>
                            ${renderPostContent(item)}
                            <div class="post-interactions">
                                <button class="interaction-btn" onclick="toggleLike('${item.transactionHash}', '${item.sender}')">🔥 <span id="like-count-${item.transactionHash}">${item.likeCount || 0}</span></button>
                                <button class="interaction-btn" onclick="toggleReplyBox('${item.transactionHash}')">💬 Reply</button>
                                ${deleteBtn}
                            </div>
                            <div class="reply-box" id="reply-box-${item.transactionHash}">
                                <textarea placeholder="Write a reply..."></textarea>
                                <button style="padding: 5px 15px; font-size: 11px;" onclick="submitReply('${item.transactionHash}', '${item.sender}')">Post Reply</button>
                                <div id="replies-list-${item.transactionHash}" style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                                    ${(item.replies || []).map(r => `<div style="font-size: 13px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 8px;"><strong>${resolveProfile(r.sender).username}:</strong> ${parseMentions(r.text)}</div>`).join('')}
                                </div>
                            </div>
                        </div>
                    `;
                    profileFeedContainer.appendChild(postEl);
                });
            } else {
                profileFeedContainer.innerHTML = '<div style="color:var(--text-muted); font-size: 13px;">No posts on the ledger yet.</div>';
            }
        }

        // Render Profile Playlist
        const playlistContainer = document.getElementById('ui-profile-playlist');
        if (playlistContainer) {
            if (profile.uploadedTracks && profile.uploadedTracks.length > 0) {
                let sortedTracks = profile.uploadedTracks.slice().sort((a,b) => b.timestamp - a.timestamp);
                if (profile.playlistOrder) {
                    sortedTracks.sort((a, b) => {
                        const idxA = profile.playlistOrder.indexOf(a.hash);
                        const idxB = profile.playlistOrder.indexOf(b.hash);
                        if (idxA === -1 && idxB === -1) return b.timestamp - a.timestamp;
                        if (idxA === -1) return 1;
                        if (idxB === -1) return -1;
                        return idxA - idxB;
                    });
                }
                playlistContainer.innerHTML = sortedTracks.map((track, idx) => `
                    <div class="playlist-item" data-hash="${track.hash}" draggable="${viewingUserPublicKey === userKeys.publicKey ? 'true' : 'false'}" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border); padding: 12px; border-radius: 8px; display: flex; align-items: center; gap: 15px; margin-bottom: 5px;">
                        ${viewingUserPublicKey === userKeys.publicKey ? '<div style="cursor:grab; font-size:16px;">☰</div>' : ''}
                        <div class="anthem-play-btn" style="width:30px; height:30px; font-size:14px;" onclick="playProfileTrack(${idx})">▶</div>
                        <div style="flex: 1;">
                            <div style="font-size: 14px; font-weight: bold; color: #fff;">${escapeHtml(track.title)}</div>
                            <div style="font-size: 11px; color: var(--text-muted);">${track.playCount || 0} Streams</div>
                        </div>
                        ${viewingUserPublicKey === userKeys.publicKey ? `<button class="secondary" style="padding: 4px 8px; font-size: 10px;" onclick="promptEditSong('${track.hash}')">Edit</button>` : ''}
                    </div>
                `).join('');
            } else {
                playlistContainer.innerHTML = '<div style="color:var(--text-muted); font-size: 13px;">No tracks uploaded yet.</div>';
            }
        }

        // Render Gallery
        const galleryContainer = document.getElementById('ui-profile-gallery');
        if (galleryContainer) {
            let galleryHtml = '';
            if (profile.uploadedImages) profile.uploadedImages.forEach(img => { galleryHtml += `<div style="position:relative; cursor:pointer;" onclick="window.open('/tracks/${img.hash}', '_blank')"><img src="/tracks/${img.hash}" style="width:100%; height:100px; object-fit:cover; border-radius:8px; border:1px solid var(--border);"><div style="position:absolute; bottom:0; left:0; width:100%; background:rgba(0,0,0,0.7); font-size:10px; color:#fff; padding:2px; text-align:center;">Uploaded</div></div>`; });
            if (profile.ownedItems) profile.ownedItems.forEach(item => { galleryHtml += `<div style="position:relative; cursor:pointer;" onclick="window.open('/tracks/${item.assetHash}', '_blank')"><img src="/tracks/${item.assetHash}" style="width:100%; height:100px; object-fit:cover; border-radius:8px; border:1px solid var(--warning);"><div style="position:absolute; bottom:0; left:0; width:100%; background:rgba(255,170,0,0.7); font-size:10px; color:#fff; font-weight:bold; padding:2px; text-align:center;">Owned Asset</div></div>`; });
            galleryContainer.innerHTML = galleryHtml || '<div style="color:var(--text-muted); font-size: 12px; grid-column: span 2;">No visual assets to display.</div>';
        }

        // Render VST Portfolio
        const vstContainer = document.getElementById('ui-profile-vst');
        if (vstContainer) {
            if (profile.ownedShares && profile.ownedShares.length > 0) {
                vstContainer.innerHTML = profile.ownedShares.map(vst => `
                    <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 8px; border-left: 3px solid var(--warning);">
                        <div style="font-size: 13px; font-weight:bold; color: #fff;">${escapeHtml(vst.title)}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">Creator: Node_${vst.creator.substring(0,6)} • Owned: ${vst.shares}%</div>
                    </div>
                `).join('');
            } else {
                vstContainer.innerHTML = '<div style="color:var(--text-muted); font-size: 12px;">No fractional track shares owned.</div>';
            }
        }
        
        // Apply Section Images
        const profileCards = document.querySelectorAll('#view-profile .profile-section');
        if (profile.sectionImages) {
            profileCards.forEach(card => {
                card.style.backgroundImage = `url('/tracks/${profile.sectionImages}')`;
                card.style.backgroundSize = 'cover';
                card.style.backgroundPosition = 'center';
            });
        } else {
            profileCards.forEach(card => { card.style.backgroundImage = 'none'; });
        }
        
        if (profile.layoutOrder) {
            const leftCol = document.getElementById('profile-col-left');
            const rightCol = document.getElementById('profile-col-right');
            if (profile.layoutOrder.left && leftCol) profile.layoutOrder.left.forEach(id => { const el = document.getElementById(id); if (el) leftCol.appendChild(el); });
            if (profile.layoutOrder.right && rightCol) profile.layoutOrder.right.forEach(id => { const el = document.getElementById(id); if (el) rightCol.appendChild(el); });
        }

        // Render Custom CSS
        const dynamicStyle = document.getElementById('ui-dynamic-user-theme');
        if (dynamicStyle) {
            dynamicStyle.innerHTML = profile.customCss || '';
        }

    } catch (err) { console.error("Profile Fetch Error:", err); }
}

// ==========================================
// 5. UTILITIES
// ==========================================


function updateComposerPreview() {
    const audFile = document.getElementById('composer-audio-upload').files[0];
    const imgFile = document.getElementById('composer-image-upload').files[0];
    const vidFile = document.getElementById('composer-video-upload') ? document.getElementById('composer-video-upload').files[0] : null;
    const zipFile = document.getElementById('composer-zip-upload') ? document.getElementById('composer-zip-upload').files[0] : null;
    const preview = document.getElementById('composer-preview-area');
    const audioMeta = document.getElementById('composer-audio-meta');
    if(!preview) return;
    
    if(audFile) {
        preview.style.display = 'block';
        preview.innerText = `🎵 Ready: ${audFile.name}`;
        if(audioMeta) audioMeta.style.display = 'block';
    } else if (imgFile) {
        preview.style.display = 'block';
        preview.innerText = `🖼️ Ready: ${imgFile.name}`;
        if(audioMeta) audioMeta.style.display = 'none';
    } else if (vidFile) {
        preview.style.display = 'block';
        preview.innerText = `🎥 Ready: ${vidFile.name}`;
        if(audioMeta) audioMeta.style.display = 'none';
    } else if (zipFile) {
        preview.style.display = 'block';
        preview.innerText = `📦 Ready: ${zipFile.name}`;
        if(audioMeta) audioMeta.style.display = 'none';
    } else {
        preview.style.display = 'none';
        if(audioMeta) audioMeta.style.display = 'none';
    }
}
// ==========================================
// 6. NODE SETTINGS & BLOCKCHAIN DEPLOYMENTS
// ==========================================

async function saveInlineEdit() {
    const userIn = document.getElementById('input-edit-username').value.trim();
    const bioIn = document.getElementById('input-edit-bio').value.trim();
    const top8In = document.getElementById('input-edit-top8').value.trim();
    const avatarInput = document.getElementById('input-edit-avatar');
    const bannerInput = document.getElementById('input-edit-banner');
    const sectionBgInput = document.getElementById('input-section-bg');

    const colorPrimary = document.getElementById('input-color-primary').value;
    const colorBg = document.getElementById('input-color-bg').value;
    const colorCard = document.getElementById('input-color-card').value;
    const rawCSS = document.getElementById('input-edit-css').value.trim();

    const dangerousKeywords = /(position|z-index|url\(|transform|opacity|pointer-events|import)/gi;
    if (dangerousKeywords.test(rawCSS)) {
        return alert("SECURITY WARNING: Your custom CSS contained prohibited layout properties and was blocked.");
    }

    const cssIn = `:root { --primary: ${colorPrimary}; --bg-body: ${colorBg}; --bg-card: ${colorCard}; } /* --- CUSTOM CSS --- */\n${rawCSS}`;

    try {
        let finalAvatarHash = "";
        let finalBannerHash = "";
        if (avatarInput.files[0]) finalAvatarHash = await uploadMediaAssetFile(avatarInput.files[0]);
        if (bannerInput.files[0]) finalBannerHash = await uploadMediaAssetFile(bannerInput.files[0]);
        
        let finalSectionBgHash = "";
        if (sectionBgInput && sectionBgInput.files[0]) finalSectionBgHash = await uploadMediaAssetFile(sectionBgInput.files[0]);
        
        const playlistItems = document.querySelectorAll('.playlist-item');
        let playlistOrder = null;
        if (playlistItems.length > 0) playlistOrder = Array.from(playlistItems).map(item => item.dataset.hash);
        
        const layoutOrder = {
            left: Array.from(document.getElementById('profile-col-left').children).map(c => c.id),
            right: Array.from(document.getElementById('profile-col-right').children).map(c => c.id)
        };
        
        let msgData = { sender: userKeys.publicKey, receiver: userKeys.publicKey, type: 'PROFILE_UPDATE', data: {}, timestamp: Date.now() };
        if(userIn) msgData.data.username = userIn;
        if(bioIn) msgData.data.bio = bioIn;
        if(finalAvatarHash) msgData.data.avatarHash = finalAvatarHash;
        if(finalBannerHash) msgData.data.bannerHash = finalBannerHash;
        if(finalSectionBgHash) msgData.data.sectionImages = finalSectionBgHash;
        if(playlistOrder) msgData.data.playlistOrder = playlistOrder;
        msgData.data.layoutOrder = layoutOrder;
        
        if(Object.keys(msgData.data).length > 0) {
            const sig = await generateClientSignature(userKeys.privateKey, msgData);
            const txFields = { ...msgData, signature: sig };
            await fetch('/api/social/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        }

        let cssMsg = { sender: userKeys.publicKey, receiver: userKeys.publicKey, type: 'THEME_UPDATE', data: { customCss: cssIn }, timestamp: Date.now() };
        const cssSig = await generateClientSignature(userKeys.privateKey, cssMsg);
        let cssTx = { ...cssMsg, signature: cssSig };
        await fetch('/api/social/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cssTx) });
        myCustomTheme = cssIn;
        document.getElementById('ui-dynamic-user-theme').innerHTML = cssIn; 

        if(top8In || top8In === "") {
            let keys = top8In.split(',').map(k => k.trim()).filter(k => k !== "");
            let top8Msg = { sender: userKeys.publicKey, receiver: userKeys.publicKey, type: 'SET_TOP_8', data: { top8Keys: keys }, timestamp: Date.now() };
            const top8Sig = await generateClientSignature(userKeys.privateKey, top8Msg);
            let top8Tx = { ...top8Msg, signature: top8Sig };
            await fetch('/api/social/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(top8Tx) });
        }
        
        alert("Identity and Theme blocks successfully deployed to the ledger.");
        document.getElementById('input-edit-avatar').value = '';
        document.getElementById('input-edit-banner').value = '';
        fetchUserProfile(userKeys.publicKey, false);
        toggleInlineEdit();
    } catch (err) { alert("Update failed: " + err.message); }
}

async function executeTargetFollow(targetPeerPublicKey) {
    if(!targetPeerPublicKey) return;
    if (userKeys.publicKey === targetPeerPublicKey) return alert("Cannot connect to your own node.");
    
    const msgData = { 
        sender: userKeys.publicKey, 
        receiver: targetPeerPublicKey, 
        type: 'FOLLOW_USER', 
        data: {}, 
        timestamp: Date.now() 
    };
    try {
        const sig = await generateClientSignature(userKeys.privateKey, msgData);
        const txFields = { ...msgData, signature: sig };
        await fetch('/api/social/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        alert("Crew connection established.");
    } catch (err) { alert(err.message); }
}

async function createCommission() {
    const recipient = document.getElementById('input-comm-recipient').value.trim();
    const amount = document.getElementById('input-comm-amount').value.trim();
    const terms = document.getElementById('input-comm-terms').value.trim();
    
    if(!recipient || !amount || !terms) return alert("Recipient, amount, and terms are required to start an escrow contract.");
    if(recipient === userKeys.publicKey) return alert("You cannot commission yourself.");
    
    try {
        const msgData = { 
            sender: userKeys.publicKey, receiver: recipient, type: 'CREATE_COMMISSION', 
            data: { amount: parseFloat(amount), terms: terms }, 
            timestamp: Date.now() 
        };
        const sig = await generateClientSignature(userKeys.privateKey, msgData);
        const txFields = { ...msgData, signature: sig };
        
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if(!res.ok) throw new Error((await res.json()).error);
        
        alert(`Escrow Successful: Locked ${amount} $VOD in a smart contract.`);
        document.getElementById('input-comm-amount').value = ''; document.getElementById('input-comm-terms').value = '';
        fetchUserProfile(userKeys.publicKey, false);
    } catch (err) { alert("Escrow failed: " + err.message); }
}

function fulfillCommission(commId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const hash = await uploadMediaAssetFile(file);
            const msgData = { sender: userKeys.publicKey, receiver: '0x00', type: 'FULFILL_COMMISSION', data: { commissionId: commId, assetHash: hash }, timestamp: Date.now() };
            const sig = await generateClientSignature(userKeys.privateKey, msgData);
            const txFields = { ...msgData, signature: sig };
            const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
            if (res.ok) {
                alert("Commission fulfilled! Escrow funds have been successfully released to your wallet.");
                
                const activeComms = currentViewedProfile ? currentViewedProfile.activeCommissions : [];
                const c = activeComms.find(x => x.id === commId);
                if(c) socket.emit('trigger_push', { target: c.buyer, payload: { title: 'Commission Fulfilled! 📦', body: `${resolveProfile(userKeys.publicKey).username} uploaded the asset for your escrow.` } });

                fetchUserProfile(userKeys.publicKey, false);
            }
        } catch(err) { alert("Fulfillment failed: " + err.message); }
    };
    input.click();
}

// ==========================================
// DIGITAL MARKETPLACE & BOUNTIES
// ==========================================

async function loadMarketplace() {
    try {
        const res = await fetch('/api/social/market');
        marketDataCache = await res.json();
        renderMarketplace();
    } catch (e) { console.error("Market error:", e); }
}

function switchMarketTab(tabName) {
    document.getElementById('market-sec-commission').classList.add('hidden');
    document.getElementById('market-sec-buy').classList.add('hidden');
    document.getElementById('market-sec-sell').classList.add('hidden');
    
    document.getElementById('tab-btn-commission').className = 'secondary';
    document.getElementById('tab-btn-buy').className = 'secondary';
    document.getElementById('tab-btn-sell').className = 'secondary';
    
    document.getElementById('tab-btn-commission').style = 'padding: 10px 20px;';
    document.getElementById('tab-btn-buy').style = 'padding: 10px 20px;';
    document.getElementById('tab-btn-sell').style = 'padding: 10px 20px;';

    document.getElementById(`market-sec-${tabName}`).classList.remove('hidden');
    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    activeBtn.className = '';
    activeBtn.style.background = 'var(--primary)';
    activeBtn.style.color = '#000';
    activeBtn.style.padding = '10px 20px;';
}

function renderMarketplace() {
    // --- 1. Render Buy Tab ---
    const buySearch = document.getElementById('buy-search-filter').value.toLowerCase();
    const buySort = document.getElementById('buy-sort-filter').value;
    let items = [...marketDataCache.items];
    
    if (buySearch) items = items.filter(i => i.title.toLowerCase().includes(buySearch) || resolveProfile(i.seller).username.toLowerCase().includes(buySearch));
    
    if (buySort === 'newest') items.sort((a,b) => b.timestamp - a.timestamp);
    else if (buySort === 'price-low') items.sort((a,b) => a.price - b.price);
    else if (buySort === 'price-high') items.sort((a,b) => b.price - a.price);
    else if (buySort === 'popular') items.sort((a,b) => b.sales - a.sales);
        
    const itemsContainer = document.getElementById('ui-market-items');
    if (itemsContainer) {
        itemsContainer.innerHTML = items.map(item => `
            <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--border); padding: 15px; border-radius: 8px;">
                <div style="font-size: 12px; color: var(--warning); font-weight: bold; margin-bottom: 4px; text-transform: uppercase;">${item.itemType || 'Digital Asset'}</div>
                <div style="font-size: 16px; font-weight: bold; color: var(--primary); margin-bottom: 5px;">${escapeHtml(item.title)}</div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">Seller: <span style="cursor:pointer;" onclick="inspectTargetNode('${item.seller}')">${resolveProfile(item.seller).username}</span> | Sales: ${item.sales}</div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong style="color: var(--success);">${item.price} $VOD</strong>
                    <button style="padding: 5px 12px; font-size: 11px;" onclick="buyDigitalItem('${item.id}', '${item.price}', '${item.seller}')">Buy & Download</button>
                </div>
            </div>
        `).join('') || '<div style="color:var(--text-muted); grid-column: span 2;">No digital goods found matching criteria.</div>';
    }

    // --- 2. Render Commissions Tab ---
    const commOrder = document.getElementById('comm-order-filter').value;
    const commSort = document.getElementById('comm-sort-filter').value;
    let bounties = [...marketDataCache.bounties];
    
    if (commSort === 'newest') bounties.sort((a,b) => b.timestamp - a.timestamp);
    else if (commSort === 'oldest') bounties.sort((a,b) => a.timestamp - b.timestamp);
    else if (commSort === 'highest') bounties.sort((a,b) => b.amount - a.amount);

    let myBounties = bounties.filter(b => b.creator === userKeys.publicKey);
    let otherBounties = bounties.filter(b => b.creator !== userKeys.publicKey);
    let finalBounties = commOrder === 'yours-first' ? [...myBounties, ...otherBounties] : [...otherBounties, ...myBounties];

    const bountiesContainer = document.getElementById('ui-market-bounties');
    if (bountiesContainer) {
        bountiesContainer.innerHTML = finalBounties.map(b => {
            let subsHtml = b.submissions.map(s => `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 8px; border-radius: 4px; margin-top: 5px;">
                    <div style="font-size: 12px;"><strong style="color: var(--primary); cursor: pointer;" onclick="inspectTargetNode('${s.sender}')">${resolveProfile(s.sender).username}:</strong> ${escapeHtml(s.message)}</div>
                    <div style="display: flex; gap: 8px;">
                        <button class="secondary" style="padding: 2px 8px; font-size: 10px;" onclick="window.open('/tracks/${s.assetHash}', '_blank')">Preview</button>
                        ${b.creator === userKeys.publicKey && !b.awarded ? `<button style="padding: 2px 8px; font-size: 10px; background: var(--success); color: #fff;" onclick="awardBounty('${b.id}', '${s.sender}')">Award Winner</button>` : ''}
                    </div>
                </div>
            `).join('');
            
            const statusBadge = b.awarded ? `<span style="color: var(--warning); font-size: 11px; border: 1px solid var(--warning); padding: 2px 6px; border-radius: 4px;">Awarded to ${resolveProfile(b.winner).username}</span>` : `<span style="color: var(--success); font-size: 11px; border: 1px solid var(--success); padding: 2px 6px; border-radius: 4px;">Open</span>`;
            const submitBtn = !b.awarded ? `<button style="padding: 5px 12px; font-size: 11px;" onclick="submitToBounty('${b.id}')">Submit Entry</button>` : '';
            const yoursLabel = b.creator === userKeys.publicKey ? `<span style="background: var(--myspace-blue); color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-left: 10px;">Your Bounty</span>` : '';

            return `
            <div style="background: rgba(102, 252, 241, 0.05); border: 1px solid rgba(102, 252, 241, 0.2); padding: 15px; border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                    <div>
                        <div style="font-size: 16px; font-weight: bold; color: #fff; margin-bottom: 4px;">${b.amount} $VOD Bounty ${yoursLabel}</div>
                        <div style="font-size: 12px; color: var(--text-muted); cursor:pointer;" onclick="inspectTargetNode('${b.creator}')">Posted by ${resolveProfile(b.creator).username}</div>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 10px;">
                        ${statusBadge}
                        ${submitBtn}
                    </div>
                </div>
                <div style="font-size: 14px; color: #ccc; margin-bottom: 15px;">${escapeHtml(b.description)}</div>
                ${subsHtml ? `<div style="border-top: 1px solid var(--border); padding-top: 10px; margin-top: 10px;"><strong style="font-size: 12px; color: var(--text-muted);">Submissions:</strong>${subsHtml}</div>` : ''}
            </div>`;
        }).join('') || '<div style="color:var(--text-muted);">No open bounties found matching criteria.</div>';
    }
}

async function executeSellItem() {
    const title = document.getElementById('sell-title-input').value.trim();
    const price = document.getElementById('sell-price-input').value.trim();
    const itemType = document.getElementById('sell-type-input').value;
    const fileInput = document.getElementById('sell-file-input');
    
    if (!title) return alert("Please enter a title.");
    if (!price || isNaN(parseFloat(price))) return alert("Please enter a valid price.");
    if (!fileInput.files[0]) return alert("Please upload an asset file.");

    try {
        const hash = await uploadMediaAssetFile(fileInput.files[0]);
        const msgData = { sender: userKeys.publicKey, receiver: '0x00', type: 'LIST_ITEM', data: { title: title, itemType: itemType, price: parseFloat(price), assetHash: hash }, timestamp: Date.now() };
        const txFields = { ...msgData, signature: await generateClientSignature(userKeys.privateKey, msgData) };
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (res.ok) { 
            alert("Asset listed in the Marketplace!"); 
            document.getElementById('sell-title-input').value = '';
            document.getElementById('sell-price-input').value = '';
            fileInput.value = '';
            loadMarketplace(); 
            fetchUserProfile(userKeys.publicKey, false); 
            switchMarketTab('buy');
        } else throw new Error((await res.json()).error);
    } catch(err) { alert("Listing failed: " + err.message); }
}

async function buyDigitalItem(itemId, price, seller) {
    if (seller === userKeys.publicKey) return alert("You cannot buy your own item.");
    if (!confirm(`Purchase this asset for ${price} $VOD?`)) return;
    try {
        const msgData = { sender: userKeys.publicKey, receiver: seller, type: 'BUY_ITEM', data: { itemId, price }, timestamp: Date.now() };
        const txFields = { ...msgData, signature: await generateClientSignature(userKeys.privateKey, msgData) };
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (!res.ok) throw new Error((await res.json()).error);
        alert("Purchase successful! You can now view this asset in your Wallet.");
        loadMarketplace();
        fetchUserProfile(userKeys.publicKey, false);
    } catch(err) { alert("Purchase failed: " + err.message); }
}

async function createOpenBounty() {
    const amount = prompt("How much $VOD are you locking up for this bounty?");
    if (!amount || isNaN(parseFloat(amount))) return;
    const desc = prompt("Describe what you want (e.g., 'Need a 16-bar verse for this track'):");
    if (!desc) return;
    try {
        const msgData = { sender: userKeys.publicKey, receiver: '0x00', type: 'CREATE_BOUNTY', data: { amount: parseFloat(amount), description: desc }, timestamp: Date.now() };
        const txFields = { ...msgData, signature: await generateClientSignature(userKeys.privateKey, msgData) };
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (!res.ok) throw new Error((await res.json()).error);
        alert("Bounty posted securely to the ledger!");
        loadMarketplace();
        fetchUserProfile(userKeys.publicKey, false);
    } catch(err) { alert("Bounty failed: " + err.message); }
}

function submitToBounty(bountyId) {
    const message = prompt("Add a note with your submission:");
    if (!message) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const hash = await uploadMediaAssetFile(file);
            const msgData = { sender: userKeys.publicKey, receiver: '0x00', type: 'SUBMIT_BOUNTY', data: { bountyId, message, assetHash: hash }, timestamp: Date.now() };
            const txFields = { ...msgData, signature: await generateClientSignature(userKeys.privateKey, msgData) };
            const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
            if (res.ok) { alert("Submission received by the smart contract!"); loadMarketplace(); }
        } catch(err) { alert("Submission failed: " + err.message); }
    };
    input.click();
}

async function awardBounty(bountyId, winnerAddress) {
    if(!confirm(`Award this bounty to Node_${winnerAddress.substring(0,6)}? The funds will be released to their wallet permanently.`)) return;
    try {
        const msgData = { sender: userKeys.publicKey, receiver: '0x00', type: 'AWARD_BOUNTY', data: { bountyId, winner: winnerAddress }, timestamp: Date.now() };
        const txFields = { ...msgData, signature: await generateClientSignature(userKeys.privateKey, msgData) };
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (!res.ok) throw new Error((await res.json()).error);
        alert("Bounty awarded successfully!");
        loadMarketplace();
    } catch(err) { alert("Award failed: " + err.message); }
}

async function loadHotOrNot() {
    try {
        const res = await fetch('/api/social/hotornot');
        hotOrNotData = await res.json();
        populateHotOrNotDropdown();
        renderHotOrNot();
    } catch(err) { console.error("HotOrNot Error:", err); }
}

async function populateHotOrNotDropdown() {
    const select = document.getElementById('hotornot-submit-select');
    if (!select) return;
    if (!userKeys.publicKey) {
        select.innerHTML = '<option value="">Login to submit</option>';
        return;
    }
    try {
        const response = await fetch(`/api/social/profile?publicKey=${encodeURIComponent(userKeys.publicKey)}`);
        const profile = await response.json();
        const myTracks = profile.uploadedTracks || [];
        if (myTracks.length === 0) {
            select.innerHTML = '<option value="">No tracks uploaded</option>';
        } else {
            select.innerHTML = '<option value="">Select your track...</option>' + 
                myTracks.map(t => `<option value="${t.hash}">${escapeHtml(t.title)}</option>`).join('');
        }
    } catch(e) {
        select.innerHTML = '<option value="">Error loading tracks</option>';
    }
}

function renderHotOrNot() {
    const filter = document.getElementById('hotornot-filter').value;
    const container = document.getElementById('ui-hotornot-content');
    if (!container) return;

    let items = [...hotOrNotData];
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    
    if (filter === 'weekly') {
        items = items.filter(i => (now - i.timestamp) < oneWeek).sort((a,b) => b.upvotes - a.upvotes);
    } else if (filter === 'alltime') {
        items.sort((a,b) => b.upvotes - a.upvotes);
    } else if (filter === 'new') {
        items.sort((a,b) => b.timestamp - a.timestamp);
    } else if (filter === 'vote') {
        items = items.filter(i => !i.votes[userKeys.publicKey]).sort(() => Math.random() - 0.5).slice(0, 1);
    }

    if (items.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);">No songs found in this category.</div>';
        return;
    }

    container.innerHTML = items.map(item => {
        let voteHtml = '';
        if (filter === 'vote') {
            voteHtml = `
                <div style="display: flex; gap: 15px; margin-top: 15px;">
                    <button style="flex:1; background: var(--danger); color: #fff;" onclick="castHotOrNotVote('${item.id}', '${item.submitter}', 1, '${item.audioHash}')">🔥 HOT</button>
                    <button class="secondary" style="flex:1; border-color: var(--danger); color: var(--danger);" onclick="castHotOrNotVote('${item.id}', '${item.submitter}', -1, '${item.audioHash}')">🧊 NOT</button>
                </div>
            `;
        } else {
            voteHtml = `<div style="font-size:12px; color:var(--text-muted); margin-top: 10px;">🔥 ${item.upvotes} Hot | 🧊 ${item.downvotes} Not</div>`;
        }

        let displayArtist = item.trackDetails.artist ? escapeHtml(item.trackDetails.artist) : resolveProfile(item.submitter).username;
        let coverHtml = item.trackDetails.coverHash ? `<img src="/tracks/${item.trackDetails.coverHash}" style="width: 80px; height: 80px; border-radius: 6px; object-fit: cover;">` : `<div style="width:80px; height:80px; border-radius:6px; background:var(--bg-darker); display:flex; align-items:center; justify-content:center; border:1px solid var(--border);">🎵</div>`;

        return `
            <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--danger); padding: 15px; border-radius: 8px;">
                <div style="display: flex; gap: 15px;">
                    ${coverHtml}
                    <div style="flex:1;">
                        <div style="font-size: 18px; font-weight: bold; color: #fff;">${escapeHtml(item.trackDetails.title)}</div>
                        <div style="font-size: 12px; color: var(--primary); margin-bottom: 5px;">By ${displayArtist}</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">Submitted by @${resolveProfile(item.submitter).username}</div>
                        <button style="padding: 5px 15px; font-size: 12px; background: var(--danger); color: #fff;" onclick="playTrack('${escapeJsArg(item.trackDetails.title)}', '${item.audioHash}', '${item.submitter}', '${escapeJsArg(displayArtist)}')">▶ Play Track</button>
                    </div>
                </div>
                ${voteHtml}
            </div>
        `;
    }).join('');
}

async function castHotOrNotVote(submissionId, submitter, vote, audioHash) {
    if (!userKeys.publicKey) return alert("Must be logged in to vote.");
    try {
        const msgData = { sender: userKeys.publicKey, receiver: submitter, type: 'VOTE_HOT_OR_NOT', data: { submissionId, vote, audioHash }, timestamp: Date.now() };
        const txFields = { ...msgData, signature: await generateClientSignature(userKeys.privateKey, msgData) };
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (!res.ok) throw new Error((await res.json()).error);
        alert(`Voted! You mined 100 $VOD.`);
        fetchUserProfile(userKeys.publicKey, true); 
        loadHotOrNot();
    } catch(err) { alert("Vote failed: " + err.message); }
}

async function submitHotOrNotFromDropdown() {
    if (!userKeys.publicKey) return alert("Must be logged in.");
    const select = document.getElementById('hotornot-submit-select');
    const audioHash = select.value;
    if (!audioHash) return alert("Please select a valid track to submit.");

    try {
        const msgData = { sender: userKeys.publicKey, receiver: '0x00', type: 'SUBMIT_HOT_OR_NOT', data: { audioHash: audioHash }, timestamp: Date.now() };
        const txFields = { ...msgData, signature: await generateClientSignature(userKeys.privateKey, msgData) };
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (!res.ok) throw new Error((await res.json()).error);
        alert("Track submitted to Hot or Not!");
        loadHotOrNot();
    } catch(err) { alert("Submission failed: " + err.message); }
}

// HTML Escaper for standard display
function escapeHtml(str) {
    if (!str) return '';
    return str.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// BUG FIX 2: Specialized JS Escaper for inline onclick functions
function escapeJsArg(str) {
    if(!str) return '';
    return str.toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

// ==========================================
// 8. WEBRTC VOICE & DIRECT MESSAGING (DISCORD GAP)
// ==========================================

let localVoiceStream;
let peerConnections = {};
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

async function joinActiveVoiceChannel() {
    if(!currentChatServer || !currentChatChannel) return alert("Select a text channel first to join its linked Voice Room.");
    try {
        localVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        socket.emit('webrtc_join_voice', { serverId: currentChatServer, channelId: currentChatChannel, address: userKeys.publicKey });
        document.getElementById('ui-active-server-name').innerText += " (🎙️ Voice Connected)";
    } catch (err) { 
        console.error("Mic access denied:", err);
        alert("Microphone access is required to join Voice Channels."); 
    }
}

socket.on('webrtc_user_joined', async (data) => {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[data.socketId] = pc;
    localVoiceStream.getTracks().forEach(track => pc.addTrack(track, localVoiceStream));

    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('webrtc_ice_candidate', { target: data.socketId, candidate: event.candidate });
        }
    };
    pc.ontrack = event => { playRemoteVoiceStream(event.streams[0], data.socketId); };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc_offer', { target: data.socketId, sdp: pc.localDescription });
});

socket.on('webrtc_offer', async (data) => {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[data.sender] = pc;
    localVoiceStream.getTracks().forEach(track => pc.addTrack(track, localVoiceStream));

    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('webrtc_ice_candidate', { target: data.sender, candidate: event.candidate });
        }
    };
    pc.ontrack = event => { playRemoteVoiceStream(event.streams[0], data.sender); };

    await pc.setRemoteDescription(data.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc_answer', { target: data.sender, sdp: pc.localDescription });
});

socket.on('webrtc_answer', async (data) => {
    if (peerConnections[data.sender]) {
        await peerConnections[data.sender].setRemoteDescription(data.sdp);
    }
});

socket.on('webrtc_ice_candidate', async (data) => {
    if (peerConnections[data.sender]) {
        await peerConnections[data.sender].addIceCandidate(data.candidate);
    }
});

// ==========================================
// P2P DATA MESH (DECENTRALIZED BROWSER NODES)
// ==========================================

function connectToMeshNode(targetSocketId) {
    if (isNodeBlocked(socketIdToAddress[targetSocketId])) return;
    const pc = new RTCPeerConnection(rtcConfig);
    meshConnections[targetSocketId] = pc;
    const dc = pc.createDataChannel('vod_data_mesh');
    dataChannels[targetSocketId] = dc;
    
    setupDataChannel(dc, targetSocketId);

    pc.onicecandidate = e => {
        if(e.candidate) socket.emit('mesh_ice_candidate', { target: targetSocketId, candidate: e.candidate });
    };

    pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socket.emit('mesh_offer', { target: targetSocketId, sdp: pc.localDescription });
    });
}

socket.on('mesh_offer', async (data) => {
    if (isNodeBlocked(socketIdToAddress[data.sender])) return;
    const pc = new RTCPeerConnection(rtcConfig);
    meshConnections[data.sender] = pc;

    pc.ondatachannel = event => {
        dataChannels[data.sender] = event.channel;
        setupDataChannel(event.channel, data.sender);
    };

    pc.onicecandidate = e => {
        if(e.candidate) socket.emit('mesh_ice_candidate', { target: data.sender, candidate: e.candidate });
    };

    await pc.setRemoteDescription(data.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('mesh_answer', { target: data.sender, sdp: pc.localDescription });
});

socket.on('mesh_answer', async (data) => {
    if (isNodeBlocked(socketIdToAddress[data.sender])) return;
    if (meshConnections[data.sender]) await meshConnections[data.sender].setRemoteDescription(data.sdp);
});

socket.on('mesh_ice_candidate', async (data) => {
    if (isNodeBlocked(socketIdToAddress[data.sender])) return;
    if (meshConnections[data.sender]) await meshConnections[data.sender].addIceCandidate(data.candidate);
});

function setupDataChannel(dc, id) {
    dc.onopen = () => console.log(`🌐 [P2P MESH] Connected directly to browser node: ${id}`);
    dc.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'P2P_CHAT') {
            console.log('✉️ [P2P MESH] Incoming direct chat message received!');
            const payload = msg.payload;
            
            if (payload.to) {
                 // DM P2P
                 if (!dmHistory[payload.sender]) dmHistory[payload.sender] = [];
                 const exists = dmHistory[payload.sender].find(m => m.time === payload.time);
                 if (!exists) {
                     dmHistory[payload.sender].push(payload);
                     if (currentChatServer === '@dms' && currentChatChannel === payload.sender) appendChatMessage(payload);
                     else {
                         const badge = document.getElementById('ui-inbox-badge');
                         if (badge) { badge.innerText = parseInt(badge.innerText) + 1; badge.classList.remove('hidden'); }
                     }
                     if (currentChatServer === '@dms') renderDMList();
                 }
            } else {
                // Server Channel Chat P2P
                if (currentChatServer === payload.serverId && currentChatChannel === payload.channelId) {
                    const chatLog = document.getElementById('ui-chat-log');
                    if (!chatLog.innerHTML.includes(payload.time + '_' + payload.sender.substring(0, 5))) {
                        appendChatMessage(payload);
                    }
                }
            }
        } else if (msg.type === 'P2P_BLOCK') {
            console.log('📦 [P2P MESH] Intercepted new block directly from peer!');
            if(msg.payload.type === 'PROFILE_UPDATE') socket.emit('request_profile_directory');
            if(localDB) localDB.transaction('blocks', 'readwrite').objectStore('blocks').put(msg.payload);
            if(userKeys.publicKey) fetchUserProfile(userKeys.publicKey, true); 
            if(currentView === 'feed') loadMainGlobalFeed();
        }
    };
}

function broadcastToMesh(type, payload) {
    const dataStr = JSON.stringify({ type, payload });
    Object.values(dataChannels).forEach(dc => {
        if (dc.readyState === 'open') dc.send(dataStr);
    });
}

function playRemoteVoiceStream(stream, id) {
    let audio = document.getElementById('remote_audio_' + id);
    if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'remote_audio_' + id;
        audio.autoplay = true;
        document.getElementById('voice-container').appendChild(audio);
    }
    audio.srcObject = stream;
}

function sendDM(targetAddress) {
    if (!userKeys.publicKey) return alert("Must be logged in to send DMs.");
    if (targetAddress === userKeys.publicKey) return alert("You cannot DM yourself.");
    if (!dmHistory[targetAddress]) dmHistory[targetAddress] = [];
    switchServer('@dms');
    switchDMChannel(targetAddress);
    document.getElementById('chat-input').focus();
}

socket.on('direct_message', (msg) => {
    const otherAddr = msg.sender === userKeys.publicKey ? msg.to : msg.sender;
    if (!dmHistory[otherAddr]) dmHistory[otherAddr] = [];
    msg.roles = msg.roles || [];
    dmHistory[otherAddr].push(msg);

    if (currentChatServer === '@dms' && currentChatChannel === otherAddr) {
        appendChatMessage(msg);
        const chatLog = document.getElementById('ui-chat-log');
        chatLog.scrollTop = chatLog.scrollHeight;
    } else {
        const badge = document.getElementById('ui-inbox-badge');
        if (badge && msg.sender !== userKeys.publicKey) { 
            badge.innerText = parseInt(badge.innerText) + 1; 
            badge.classList.remove('hidden'); 
        }
    }
    if (currentChatServer === '@dms') renderDMList();
});

function sendReaction(msgId) {
    const emoji = prompt("Enter an emoji to react with:");
    if (emoji && currentChatServer && currentChatChannel) {
        socket.emit('add_message_reaction', { serverId: currentChatServer, channelId: currentChatChannel, msgId, emoji });
    }
}

socket.on('new_reaction', (data) => {
    const reactionContainer = document.getElementById(`reactions_${data.msgId}`);
    if (reactionContainer) {
        reactionContainer.innerHTML += `<span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 8px; border: 1px solid var(--border);">${escapeHtml(data.emoji)}</span>`;
    }
});

// ==========================================
// 9. NEW SOCIAL FEATURES (Badges, Mentions, Modals)
// ==========================================

function renderBadges(roles) {
    if (!roles || !roles.length) return '';
    const badgeMap = { 'admin': '🛠️ Admin', 'artist': '🎵 Artist', 'whale': '🐋 Whale' };
    return roles.map(r => `<span class="user-badge" title="${r}">${badgeMap[r] || '✨'}</span>`).join('');
}

function parseMentions(text) {
    if (!text) return '';
    const escaped = escapeHtml(text);
    return escaped.replace(/@([a-zA-Z0-9_]+)/g, (match, p1) => {
        return `<span class="mention" onclick="inspectTargetNode('${p1}')">${match}</span>`;
    });
}

function detectMentionsAndEmit(text) {
    if (!text) return;
    const mentions = text.match(/@([a-zA-Z0-9_]+)/g);
    if (mentions) {
        mentions.forEach(m => {
            socket.emit('notify_mention', { target: m.substring(1), from: userKeys.publicKey });
        });
    }
}

socket.on('mention_notification', (data) => {
    const badge = document.getElementById('ui-notif-badge');
    if (badge) {
        badge.innerText = parseInt(badge.innerText) + 1;
        badge.classList.remove('hidden');
    }
});

function resetNotifBadge() {
    const badge = document.getElementById('ui-notif-badge');
    if (badge) {
        badge.innerText = "0";
        badge.classList.add('hidden');
    }
}

function resetInboxBadge() {
    const badge = document.getElementById('ui-inbox-badge');
    if (badge) {
        badge.innerText = "0";
        badge.classList.add('hidden');
    }
}

function toggleModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.toggle('hidden');
}

async function toggleLike(txHash, receiver) {
    const countEl = document.getElementById(`like-count-${txHash}`);
    if (countEl) {
        countEl.innerText = parseInt(countEl.innerText) + 1;
        socket.emit('like_post', { txHash, address: userKeys.publicKey });
    }

    try {
        const msgData = { 
            sender: userKeys.publicKey, 
            receiver: receiver || '0x00', 
            type: 'LIKE_POST', 
            data: { txHash: txHash }, 
            timestamp: Date.now() 
        };
        const sig = await generateClientSignature(userKeys.privateKey, msgData);
        const txFields = { ...msgData, signature: sig };
        await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
    } catch (err) {
        console.error("Like block failed:", err);
    }
}

function toggleReplyBox(txHash) {
    const box = document.getElementById(`reply-box-${txHash}`);
    if (box) box.style.display = box.style.display === 'block' ? 'none' : 'block';
}

async function submitReply(txHash, receiver) {
    const box = document.getElementById(`reply-box-${txHash}`);
    const text = box.querySelector('textarea').value;
    if (!text.trim()) return;
    
    detectMentionsAndEmit(text);
    
    const list = document.getElementById(`replies-list-${txHash}`);
    list.innerHTML += `<div style="font-size: 13px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 8px;"><strong>${resolveProfile(userKeys.publicKey).username}:</strong> ${parseMentions(text)}</div>`;
    box.querySelector('textarea').value = '';
    socket.emit('reply_post', { txHash, address: userKeys.publicKey, text: text.trim() });

    try {
        const msgData = { 
            sender: userKeys.publicKey, 
            receiver: receiver || '0x00', 
            type: 'REPLY_POST', 
            data: { txHash: txHash, text: text.trim() }, 
            timestamp: Date.now() 
        };
        const sig = await generateClientSignature(userKeys.privateKey, msgData);
        const txFields = { ...msgData, signature: sig };
        await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
    } catch (err) {
        console.error("Reply block failed:", err);
    }
}

// ==========================================
// ZINE ENGINE LOGIC
// ==========================================

function switchZineSubTab(tab) {
    document.querySelectorAll('.zine-sub-view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('#view-zine .secondary').forEach(b => {
        b.style.background = 'rgba(102, 252, 241, 0.1)';
        b.style.color = 'var(--primary)';
    });
    
    document.getElementById(`zine-${tab}`).classList.remove('hidden');
    const btn = document.getElementById(`zine-btn-${tab}`);
    btn.style.background = 'var(--primary)';
    btn.style.color = '#000';
    
    renderZine();
}

async function handlePublishArticle() {
    const title = document.getElementById('zine-publish-title').value.trim();
    const body = document.getElementById('zine-publish-body').value.trim();
    const price = document.getElementById('zine-publish-price').value.trim();

    if(!title || !body || !price) return alert("Title, body, and price are required to publish.");
    if(!userKeys.publicKey) return alert("Identity required.");

    socket.emit('publish_article', { title, body, price: parseFloat(price), author: userKeys.publicKey });

    document.getElementById('zine-publish-title').value = '';
    document.getElementById('zine-publish-body').value = '';
    alert("Masterpiece published to the swarm!");
    switchZineSubTab('market');
}

function renderZine() {
    const marketContainer = document.getElementById('ui-zine-articles');
    const ownedContainer = document.getElementById('ui-zine-owned');
    if(!marketContainer || !ownedContainer) return;

    const myAddr = userKeys.publicKey;
    
    marketContainer.innerHTML = zineArticles.map(art => {
        const isOwner = art.ownersList.includes(myAddr) || art.author === myAddr;
        const buyBtn = isOwner 
            ? `<button class="secondary" disabled style="width:100%; opacity:0.5;">Rights Owned</button>` 
            : `<button style="width:100%;" onclick="purchaseArticleRights('${art.id}')">Buy Curation Rights: ${art.price} $VOD</button>`;

        return `
            <div class="article-card">
                <div class="article-meta">Writer: ${resolveProfile(art.author).username}</div>
                <div style="font-size: 18px; font-weight: bold; color: #fff; margin-top: 5px;">${escapeHtml(art.title)}</div>
                <div class="article-snippet">${escapeHtml(art.body)}</div>
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <button class="interaction-btn" onclick="likeArticle('${art.id}')">❤️ ${art.likes || 0}</button>
                    <button class="interaction-btn" onclick="tipArticle('${art.id}', '${art.author}')">💸 Tip $VOD</button>
                </div>
                ${buyBtn}
            </div>
        `;
    }).join('') || '<div style="color:var(--text-muted);">No articles found in the marketplace.</div>';

    const ownedArticles = zineArticles.filter(art => art.ownersList.includes(myAddr) || art.author === myAddr);
    ownedContainer.innerHTML = ownedArticles.map(art => `
        <div class="article-card" style="border-color: var(--success);">
            <div class="article-meta" style="color: var(--success);">Featured Content</div>
            <div style="font-size: 18px; font-weight: bold; color: #fff; margin-top: 5px;">${escapeHtml(art.title)}</div>
            <div class="article-snippet" style="color: #eee;">${escapeHtml(art.body)}</div>
        </div>
    `).join('') || '<div style="color:var(--text-muted);">Acquire rights in the marketplace to see articles here.</div>';
}

function purchaseArticleRights(articleId) {
    if(!userKeys.publicKey) return alert("Please login.");
    socket.emit('purchase_article_rights', articleId);
}

function likeArticle(articleId) {
    if (!userKeys.publicKey) return alert("Must be logged in to like.");
    socket.emit('like_article', articleId);
}

async function tipArticle(articleId, author) {
    if (!userKeys.publicKey) return alert("Must be logged in to tip.");
    if (author === userKeys.publicKey) return alert("You cannot tip your own article.");
    const amount = prompt("How much $VOD would you like to tip the author?");
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return;
    
    try {
        const msgData = { 
            sender: userKeys.publicKey, 
            receiver: author, 
            type: 'TRANSFER_COIN', 
            data: { amount: parseFloat(amount) }, 
            timestamp: Date.now() 
        };
        const sig = await generateClientSignature(userKeys.privateKey, msgData);
        const txFields = { ...msgData, signature: sig };
        
        const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if(!res.ok) throw new Error((await res.json()).error);
        
        socket.emit('trigger_push', { target: author, payload: { title: 'Tip Received! 💸', body: `You received ${amount} $VOD from ${resolveProfile(userKeys.publicKey).username} for your Zine Article!` } });

        alert(`Successfully tipped ${amount} $VOD to the author!`);
    } catch (err) { alert("Tip failed: " + err.message); }
}