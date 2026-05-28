// ==========================================
// VOD SOCIAL ENGINE - VIBE OR DIE NETWORK (FULL UNIFIED)
// ==========================================

const socket = io();

// Core Application State
let currentView = 'feed';
let viewingUserPublicKey = ''; let eventsMap = null;

let feedTracks = [];
let eventsState = { isPlacing: false, currentFile: null, hashes: new Set(), mapMarkers: [] };
let marketDataCache = { items: [], bounties: [] };
let myCustomTheme = '';
let myFollowing = [];
let feedFilterMode = 'global';
let currentViewedProfile = null;
let swRegistration = null;
let localDB = null;
let editedTop8 = [];

document.addEventListener('DOMContentLoaded', () => { 
    window.networkProfiles = {}; window.zineArticles = []; window.hotOrNotData = [];
    initializeApplicationListeners(); 
    window.MeshEngine.init(socket);
    window.AudioEngine.init(socket);
    initLocalLedgerNode();
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => { swRegistration = reg; console.log('[PWA] Service Worker registered'); })
            .catch(err => console.error('[PWA] SW Registration failed', err));
    }
});

function initializeApplicationListeners() {
    console.log('[INIT] Wiring up event listeners...');
    
    // Identity & Auth Flow
    const signupBtn = document.getElementById('btn-signup');
    if(signupBtn) {
        signupBtn.addEventListener('click', () => window.CoreEngine.handleSignup());
        console.log('[INIT] ✓ Signup button wired');
    } else console.warn('[INIT] ✗ btn-signup not found');
    
    const loginBtn = document.getElementById('btn-login-submit');
    if(loginBtn) {
        loginBtn.addEventListener('click', () => window.CoreEngine.handleLogin());
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
        publishBtn.addEventListener('click', () => handlePublishPost(false));
        console.log('[INIT] ✓ Publish button wired');
    } else console.warn('[INIT] ✗ btn-publish-post not found');
    
    const storyBtn = document.getElementById('btn-publish-story');
    if(storyBtn) {
        storyBtn.addEventListener('click', () => handlePublishPost(true));
        console.log('[INIT] ✓ Story button wired');
    }
    
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
            if(viewingUserPublicKey !== window.CoreEngine.userKeys.publicKey) {
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
    document.addEventListener('mousemove', () => window.CoreEngine.resetIdleTimer());
    document.addEventListener('keypress', () => window.CoreEngine.resetIdleTimer());
    
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('input', handleChatTyping);
    }

    // Request initial data
    socket.emit('get_servers');
    socket.emit('get_zine_data');
    
    socket.on('profile_directory', (directory) => {
        window.networkProfiles = directory;
        renderNewUsers();
        
        if (currentView === 'feed') loadMainGlobalFeed();
        if (window.MeshEngine && window.MeshEngine.currentChatServer) {
            if (window.MeshEngine.currentChatServer === '@dms') renderDMList();
            else switchChannel(window.MeshEngine.currentChatServer, window.MeshEngine.currentChatChannel);
        }
    });
    console.log('[INIT] Event listeners initialized');
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

        let subscription;
        try {
            subscription = await swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: convertedVapidKey });
        } catch (err) {
            if (err.name === 'InvalidStateError') {
                console.log('[PWA] VAPID key changed (Server restarted). Unsubscribing old push token...');
                const oldSub = await swRegistration.pushManager.getSubscription();
                if (oldSub) await oldSub.unsubscribe();
                subscription = await swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: convertedVapidKey });
            } else throw err;
        }
        
        await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: publicKey, subscription }) });
        console.log('[PWA] Subscribed to Web Push notifications.');
    } catch (e) { console.error('[PWA] Push subscription failed', e); }
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

async function handlePublishPost(isStory = false) {
    if (typeof isStory !== 'boolean') isStory = false;
    try {
        console.log('[PUBLISH] Starting post publish...');
        const textIn = document.getElementById('composer-text').value.trim();
        const audFile = document.getElementById('composer-audio-upload').files[0];
        const imgFile = document.getElementById('composer-image-upload').files[0];
        const vidFile = document.getElementById('composer-video-upload') ? document.getElementById('composer-video-upload').files[0] : null;
        const zipFile = document.getElementById('composer-zip-upload') ? document.getElementById('composer-zip-upload').files[0] : null;
        const btn = document.getElementById(isStory ? 'btn-publish-story' : 'btn-publish-post');

        if (isStory && !imgFile && !vidFile) return alert("Stories must include an image or short video.");
        if (!isStory && !textIn && !audFile && !imgFile && !vidFile && !zipFile) return alert("Please provide some content to broadcast.");
        if (!window.CoreEngine.userKeys.publicKey) return alert("You must login first.");

        btn.innerText = "Uploading...";
        btn.disabled = true;

        let type, data;
        // Determine post type and upload requisite files to IPFS node
        if (isStory) {
            if (imgFile) {
                const hash = await uploadMediaAssetFile(imgFile);
                type = 'STORY_POST';
                data = { caption: textIn, imageHash: hash };
            } else if (vidFile) {
                const hash = await uploadMediaAssetFile(vidFile);
                type = 'STORY_POST';
                data = { caption: textIn, videoHash: hash };
            }
        } else if (audFile) {
            const titleIn = document.getElementById('audio-meta-title').value.trim();
            if (!titleIn) throw new Error("Please provide a Track Title for the audio upload.");
            const hash = await uploadMediaAssetFile(audFile);
            
            let coverHash = null;
            const coverFile = document.getElementById('audio-cover-upload').files[0];
            if (coverFile) coverHash = await uploadMediaAssetFile(coverFile);
            
            const artist = document.getElementById('audio-meta-artist').value.trim();
            const offCollab = document.getElementById('audio-meta-off-collab').value.trim();
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
            data = { 
                caption: textIn, 
                trackTitle: titleIn, 
                artist: artist, 
                offPlatformCollaborator: offCollab, 
                audioHash: hash, 
                coverHash: coverHash, 
                metadata: genre, 
                forStake: forStake, 
                sellPercentage: sellPercentage, 
                pricePerShare: pricePerShare, 
                collaborators: collabs 
            };
        } else if (imgFile) {
            const hash = await uploadMediaAssetFile(imgFile);
            type = 'IMAGE_POST';
            data = { caption: textIn, imageHash: hash };
        } else if (vidFile) {
            const hash = await uploadMediaAssetFile(vidFile);
            type = 'VIDEO_POST';
            data = { caption: textIn, videoHash: hash, fileSize: vidFile.size };
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
                            socket.emit('publish_article', { title, body: textIn, price: parseFloat(price), author: window.CoreEngine.userKeys.publicKey });
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

        await window.CoreEngine.sendSignedTransaction(type, "0x00", data);
        detectMentionsAndEmit(textIn);
        
        console.log('[PUBLISH] ✓ Success!');
        alert("Block recorded successfully!");
        
        if (true) { // Cleanup UI
            document.getElementById('composer-text').value = '';
            document.getElementById('composer-audio-upload').value = '';
            document.getElementById('audio-meta-title').value = '';
            document.getElementById('audio-meta-off-collab').value = '';
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
        const btn = document.getElementById(isStory ? 'btn-publish-story' : 'btn-publish-post');
        if (btn) {
            btn.innerText = isStory ? "Deploy Story" : "Broadcast Block";
            btn.disabled = false;
        }
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

// ==========================================
// 4. RENDERING & UI NAVIGATION
// ==========================================

async function loadMainGlobalFeed() {
    try {
        const res = await fetch('/api/feed');
        const data = await res.json();
        feedTracks = data.filter(item => item.type === 'SONG_UPLOAD');

        // POPULATE SIDEBAR TRANSACTIONS GLOBALLY
        const sidebarTx = document.getElementById('ui-sidebar-tx-history');
        if (sidebarTx) {
            sidebarTx.innerHTML = data.slice(0, 30).map(tx => {
                const prof = resolveProfile(tx.sender);
                let action = tx.type;
                let color = 'var(--text-muted)';
                
                if (tx.type === 'SONG_UPLOAD') { action = 'Minted Track'; color = 'var(--primary)'; }
                else if (tx.type === 'IMAGE_POST') { action = 'Minted Image'; color = 'var(--primary)'; }
                else if (tx.type === 'PROFILE_UPDATE') { action = 'Updated Profile'; color = 'var(--warning)'; }
                else if (tx.type === 'STREAM_COMPLETED') { action = 'Mined $VOD'; color = 'var(--success)'; }
                else if (tx.type === 'FOLLOW_USER') { action = 'Locked Crew'; color = 'var(--primary)'; }
                else if (tx.type === 'TEXT_POST') { action = 'Broadcasted Status'; color = '#fff'; }
                else if (tx.type === 'LIKE_POST') { action = 'Liked Post'; color = 'var(--danger)'; }
                else if (tx.type === 'REPLY_POST') { action = 'Replied'; color = '#fff'; }

                return `<div style="display:flex; flex-direction: column; padding:8px; border-bottom:1px solid rgba(255,255,255,0.1); font-size:12px; cursor: pointer; transition: 0.2s;" onclick="inspectTargetNode('${tx.sender}')" onmouseover="this.style.background='rgba(102, 252, 241, 0.05)'" onmouseout="this.style.background='transparent'">
                    <div style="display:flex; justify-content:space-between;">
                        <span style="font-weight: bold; color: ${color};">${escapeHtml(prof.username)}</span>
                        <span style="color:var(--text-muted); font-size: 10px;">${new Date(tx.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <span style="color: var(--text-dark);">${action}</span>
                </div>`;
            }).join('');
        }
        
        const container = document.getElementById('feed-container');
        if(!container) return;
        
        const now = Date.now();
        const activeStories = data.filter(item => item.type === 'STORY_POST' && (now - item.timestamp <= 86400000));
        
        let storiesHtml = '';
        if (activeStories.length > 0) {
            const storiesByUser = {};
            activeStories.forEach(s => {
                if (!storiesByUser[s.sender]) storiesByUser[s.sender] = [];
                storiesByUser[s.sender].push(s);
            });
            
            storiesHtml = `<div class="stories-container" style="display: flex; gap: 15px; overflow-x: auto; padding-bottom: 15px; margin-bottom: 20px; border-bottom: 1px solid var(--border);">`;
            for (const sender in storiesByUser) {
                const profile = resolveProfile(sender);
                storiesHtml += `
                    <div class="story-avatar" onclick="openStoryModal('${sender}')" style="cursor: pointer; text-align: center; flex-shrink: 0;">
                        <img src="${getAvatarUrl(sender)}" style="width: 60px; height: 60px; border-radius: 50%; border: 3px solid var(--primary); padding: 2px; object-fit: cover;">
                        <div style="font-size: 11px; margin-top: 5px; color: #fff;">${escapeHtml(profile.username).substring(0,8)}</div>
                    </div>
                `;
            }
            storiesHtml += `</div>`;
            window.currentActiveStories = storiesByUser;
        }

        let filterHtml = `
            <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                <button id="btn-feed-global" class="secondary" style="${feedFilterMode === 'global' ? 'background: var(--primary); color: #000;' : ''}" onclick="feedFilterMode='global'; window.loadMainGlobalFeed();">Global Feed</button>
                <button id="btn-feed-following" class="secondary" style="${feedFilterMode === 'following' ? 'background: var(--primary); color: #000;' : ''}" onclick="feedFilterMode='following'; loadMainGlobalFeed();">Following</button>
            </div>
        `;
        if (window.GlobalTagEngine && window.GlobalTagEngine.activeFeedTag) {
            filterHtml += `<div style="padding: 10px; background: rgba(102, 252, 241, 0.1); color: var(--primary); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                <span>Filtering by Tag: <strong>${escapeHtml(window.GlobalTagEngine.activeFeedTag)}</strong></span>
                <button class="secondary" style="padding: 2px 8px; font-size: 11px;" onclick="window.GlobalTagEngine.filterFeedByTag(null); window.loadMainGlobalFeed();">Clear Filter</button>
            </div>`;
        }
        container.innerHTML = storiesHtml + filterHtml;
        
        // Filter out low-level system transactions from cluttering the main public feed
        const displayablePosts = data.filter(item => {
            if (item.type === 'IMAGE_POST' && item.data && item.data.isFlyer) return false; // Hide Flyers from Global Feed
            if (isNodeBlocked(item.sender)) return false;
            
            if (feedFilterMode === 'following') {
                if (item.sender !== window.CoreEngine.userKeys.publicKey && !myFollowing.includes(item.sender)) return false;
            }
            
            if (window.GlobalTagEngine && window.GlobalTagEngine.activeFeedTag) {
                if (item.type !== 'SONG_UPLOAD' || !item.data.metadata) return false;
                const tags = item.data.metadata.split(',').map(t => {
                    let s = t.trim().toLowerCase();
                    return s.startsWith('#') ? s : '#' + s;
                });
                if (!tags.includes(window.GlobalTagEngine.activeFeedTag.toLowerCase())) return false;
            }

            return ['SONG_UPLOAD', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST', 'TEXT_POST', 'SHOUTBOX_POST'].includes(item.type);
        });
        
        displayablePosts.forEach(item => {
            const postEl = document.createElement('div');
            postEl.className = 'card post';
            const timeStr = new Date(item.timestamp).toLocaleString();
            const roles = item.roles || [];
            const isOwner = item.sender === window.CoreEngine.userKeys.publicKey;
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
        if (item.data.offPlatformCollaborator) {
            displayArtist += ` ft. ${escapeHtml(item.data.offPlatformCollaborator)}`;
        }

        return `
            <div class="audio-block" style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; border: 1px solid rgba(69, 162, 158, 0.2);">
                ${item.data.caption ? `<div style="margin-bottom: 10px; color: #fff;">${parseMentions(item.data.caption)}</div>` : ''}
                <div style="display: flex; gap: 15px; margin-bottom: 10px;">
                    ${coverHtml}
                    <div>
                        <div style="font-size:18px; color: var(--primary); font-weight: bold;">🎵 ${escapeHtml(item.data.trackTitle)}</div>
                        <div style="font-size:12px; color:var(--text-muted); margin-bottom: 2px;">By ${displayArtist}</div>
                        ${item.data.metadata && window.GlobalTagEngine ? `<div style="font-size:12px; color:var(--text-muted);">${window.GlobalTagEngine.renderTags(item.data.metadata)}</div>` : ''}
                        <div style="font-size:12px; color: var(--text-muted);">
                            🎧 ${playCount} Streams • 💎 Network Mines 25,000 $VOD per stream
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button style="background:#66fcf1; color:#000; padding:8px 15px; flex: 1;" onclick="window.AudioEngine.playTrack('${escapeJsArg(item.data.trackTitle)}', '${item.data.audioHash}', '${item.sender}', '${escapeJsArg(displayArtist)}')">
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

function executeGlobalSearch(query) {
    if (window.GlobalTagEngine) {
        const tags = window.GlobalTagEngine.searchByTag(query);
        if (tags.length > 0) return window.GlobalTagEngine.filterFeedByTag(tags[0]);
    }
    const q = query.toLowerCase();
    
    let matches = [];
    for (let addr in networkProfiles) {
        const p = networkProfiles[addr];
        let score = 0;
        
        if (addr.toLowerCase() === q) score += 100;
        if (p.username.toLowerCase() === q) score += 50;
        else if (p.username.toLowerCase().includes(q)) score += 10;
        
        if (p.tags && p.tags.some(t => t.toLowerCase().includes(q))) score += 20;
        
        if (score > 0) matches.push({ address: addr, score, ...p });
    }
    matches.sort((a, b) => b.score - a.score);
    
    if (matches.length > 0) {
        if (matches.length === 1 || matches[0].score >= 50) return inspectTargetNode(matches[0].address);
        return window.showSearchResultsDialog(matches, query);
    }

    const track = feedTracks.find(t => (t.data.trackTitle && t.data.trackTitle.toLowerCase().includes(q)) || (t.data.artist && t.data.artist.toLowerCase().includes(q)));
    if (track && window.AudioEngine) return window.AudioEngine.playTrack(track.data.trackTitle, track.data.audioHash, track.sender, track.data.artist);
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
    switchTab('profile', profileTabItem, publicKey);
}

async function deletePost(txHash) {
    if (!confirm("Are you sure you want to delete this post?")) return;
    try {
        await window.CoreEngine.sendSignedTransaction('DELETE_POST', '0x00', { txHash });
        alert("Post deleted.");
        loadMainGlobalFeed();
        if (currentView === 'profile') fetchUserProfile(viewingUserPublicKey || window.CoreEngine.userKeys.publicKey, false);
    } catch (err) {
        alert("Failed to delete: " + err.message);
    }
}

async function requestSongShare(hash, seller) {
    if (seller === window.CoreEngine.userKeys.publicKey) return alert("You already own this track's equity.");
    const count = prompt("How many shares (percentage) do you want to request?");
    if (!count || isNaN(count)) return;
    const price = prompt(`What price per share in $VOD are you offering for these ${count}%?`);
    if (!price || isNaN(price)) return;
    
    try {
        await window.CoreEngine.sendSignedTransaction('REQUEST_SONG_SHARE', seller, { audioHash: hash, shareCount: parseInt(count), pricePerShare: parseFloat(price) });
        alert(`Stake Request sent to the creator for ${count}% at ${price} $VOD each!`);
        fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
    } catch(err) { alert(err.message); }
}

async function buySongShareDirect(hash, seller, price) {
    const count = prompt("How many available shares (percentage) do you want to buy?");
    if (!count || isNaN(count)) return;
    try {
        await window.CoreEngine.sendSignedTransaction('BUY_SONG_SHARE', seller, { audioHash: hash, shareCount: parseInt(count), pricePerShare: parseFloat(price) });
        alert(`Successfully purchased ${count}% stake!`);
        loadMainGlobalFeed();
        fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
    } catch(err) { alert(err.message); }
}

async function respondToStakeRequest(requestId, type) {
    if (!confirm(`Are you sure you want to ${type === 'ACCEPT_SHARE_REQUEST' ? 'accept' : 'decline'} this request?`)) return;
    try {
        await window.CoreEngine.sendSignedTransaction(type, '0x00', { requestId });
        alert("Request processed successfully.");
        fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
    } catch(err) { alert(err.message); }
}

window.showSearchResultsDialog = function(matches, query) {
    let modal = document.getElementById('search-results-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'search-results-modal';
        modal.className = 'modal hidden';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="color: var(--primary); margin: 0;">Search Results</h3>
                    <button class="secondary" onclick="document.getElementById('search-results-modal').classList.add('hidden')">✖</button>
                </div>
                <div id="search-results-list" style="display: flex; flex-direction: column; gap: 10px; max-height: 60vh; overflow-y: auto;"></div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    const list = document.getElementById('search-results-list');
    list.innerHTML = `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">Showing network results for "${escapeHtml(query)}"</div>` + 
    matches.map(m => `
        <div style="display:flex; align-items:center; gap:10px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; transition: 0.2s;" onclick="document.getElementById('search-results-modal').classList.add('hidden'); inspectTargetNode('${m.address}')" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='transparent'">
            <img src="${getAvatarUrl(m.address)}" style="width: 40px; height: 40px; border-radius: 50%;">
            <div style="display: flex; flex-direction: column;">
                <span style="font-size: 14px; font-weight: bold; color: #fff;">${escapeHtml(m.username)}</span>
                ${m.tags && m.tags.length > 0 ? `<span style="font-size: 10px; color: var(--primary);">Tags: ${m.tags.join(', ')}</span>` : ''}
            </div>
        </div>
    `).join('');
    
    modal.classList.remove('hidden');
}

window.showConnectionsModal = function(friendsList, followersList) {
    let modal = document.getElementById('search-results-modal');
    const users = friendsList.map(addr => ({ address: addr, ...resolveProfile(addr) }));
    // Reuse the search modal UI for friends
    showSearchResultsDialog(users, "Crew Connections");
}

async function promptEditSong(audioHash) {
    if (!window.CoreEngine.userKeys.publicKey) return;
    const newTitle = prompt("Enter new track title:");
    const newArtist = prompt("Enter artist name:");
    const newOffCollab = prompt("Enter off-platform collaborator (optional):");
    if (!newTitle && !newArtist && !newOffCollab) return;

    try {
        let data = { audioHash: audioHash };
        if (newTitle) data.title = newTitle;
        if (newArtist) data.artist = newArtist;
        if (newOffCollab) data.offPlatformCollaborator = newOffCollab;
        await window.CoreEngine.sendSignedTransaction('EDIT_SONG_METADATA', '0x00', data);
        alert("Metadata updated!"); fetchUserProfile(window.CoreEngine.userKeys.publicKey, false); loadMainGlobalFeed();
    } catch(err) { alert("Failed to edit: " + err.message); }
}

function switchTab(tabName, element, targetKey = null) {
    currentView = tabName;
    const container = document.querySelector('.container');
    if (container) container.classList.remove('chat-mode'); // Auto-close fullscreen chat when navigating

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

    if (tabName === 'events') {
        container.classList.add('flyer-mode');
    } else {
        container.classList.remove('flyer-mode');
    }
    if (tabName === 'events') { loadEvents(); setTimeout(initEventsMap, 600); }
    if (tabName === 'profile') {
        // Reset to display mode when navigating to a profile
        const displayMode = document.getElementById('profile-display-mode');
        const editMode = document.getElementById('profile-edit-mode');
        const btnAvatar = document.getElementById('btn-edit-avatar');
        const btnBanner = document.getElementById('btn-edit-banner');
        const toggleBtn = document.getElementById('btn-toggle-edit');
        if (displayMode) displayMode.classList.remove('hidden');
        if (editMode) editMode.classList.add('hidden');
        if (btnAvatar) btnAvatar.classList.add('hidden');
        if (btnBanner) btnBanner.classList.add('hidden');
        if (toggleBtn) toggleBtn.classList.remove('hidden');

        if (targetKey && typeof targetKey === 'string') {
            viewingUserPublicKey = targetKey;
            fetchUserProfile(targetKey, false);
        } else {
            viewingUserPublicKey = window.CoreEngine.userKeys.publicKey; // Instantly snap state to the current user
            fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
        }
    }
    if (tabName === 'market') window.loadMarketplace();
    if (tabName === 'zine') renderZine();
    if (tabName === 'hotornot') window.BattleEngines.loadHotOrNot();
    if (tabName === 'feed') window.loadMainGlobalFeed();
}

function renderServerList() {
    const list = document.getElementById('ui-server-list');
    if (!list) return;
    
    const dmActive = window.MeshEngine.currentChatServer === '@dms' ? 'active' : '';
    const dmBtn = `<div class="server-icon ${dmActive}" onclick="switchServer('@dms')" title="Direct Messages" style="background: var(--primary); color: #000;">💬</div>`;
    const addBtnHTML = `<div class="server-icon" onclick="promptCreateServer()" style="background: rgba(102, 252, 241, 0.1); color: var(--text-muted); font-size: 24px;" title="Create Server">+</div>`;
    
    let html = '';
    window.MeshEngine.serversData.forEach(srv => {
        const isActive = srv.id === window.MeshEngine.currentChatServer ? 'active' : '';
        const seed = encodeURIComponent(srv.id);
        html += `<div class="server-icon ${isActive}" onclick="switchServer('${srv.id}')" title="${escapeHtml(srv.name)}">
            <img src="https://api.dicebear.com/7.x/identicon/svg?seed=${seed}&backgroundColor=1f2833">
        </div>`;
    });
    
    list.innerHTML = dmBtn + html + addBtnHTML;
}

function switchServer(serverId) {
    const voiceBtn = document.querySelector('span[onclick="joinActiveVoiceChannel()"]');
    const addChBtn = document.querySelector('span[onclick="promptCreateChannel()"]');
    const newDmBtn = document.getElementById('btn-new-dm');

    if (serverId === '@dms') {
        window.MeshEngine.currentChatServer = '@dms';
        renderServerList();
        document.getElementById('ui-active-server-name').innerHTML = `💬 Direct Messages`;
        
        if(voiceBtn) voiceBtn.style.display = 'none';
        if(addChBtn) addChBtn.style.display = 'none';
        if(newDmBtn) newDmBtn.style.display = 'inline-block';
        
        renderDMList();
        const firstDm = Object.keys(window.MeshEngine.dmHistory)[0];
        if (firstDm) switchDMChannel(firstDm);
        else {
            window.MeshEngine.currentChatChannel = null;
            document.getElementById('ui-chat-log').innerHTML = '<div style="padding:15px; color:var(--text-muted);">No active conversations. Start a DM from the Swarm or Profile.</div>';
            document.getElementById('chat-input').disabled = true;
            document.getElementById('chat-input').placeholder = "No conversation selected...";
        }
        return;
    }

    window.MeshEngine.currentChatServer = serverId;
    renderServerList();
    
    if(voiceBtn) voiceBtn.style.display = 'inline-block';
    if(addChBtn) addChBtn.style.display = 'inline-block';
    if(newDmBtn) newDmBtn.style.display = 'none';

    const srv = window.MeshEngine.serversData.find(s => s.id === serverId);
    if (!srv) return;
    
    document.getElementById('ui-active-server-name').innerText = srv.name;
    renderChannelList(srv);
    
    if (srv.channels && srv.channels.length > 0) {
        switchChannel(srv.id, srv.channels[0].id);
    } else {
        window.MeshEngine.currentChatChannel = null;
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
        const isActive = ch.id === window.MeshEngine.currentChatChannel ? 'active' : '';
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
    for (const addr of Object.keys(window.MeshEngine.dmHistory)) {
        const isActive = addr === window.MeshEngine.currentChatChannel ? 'active' : '';
        const prof = resolveProfile(addr);
        html += `<div class="channel-tab ${isActive}" onclick="switchDMChannel('${addr}')" style="display:flex; align-items:center; gap:8px;">
            <img src="${getAvatarUrl(addr)}" style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover;">
            <span>${escapeHtml(prof.username)}</span>
        </div>`;
    }
    list.innerHTML = html;
}

function switchDMChannel(address) {
    window.MeshEngine.currentChatServer = '@dms';
    window.MeshEngine.currentChatChannel = address;
    renderDMList();
    
    const prof = resolveProfile(address);
    
    document.getElementById('ui-active-server-name').innerHTML = `
        <span style="display:inline-flex; align-items:center; gap:10px;">
            <img src="${getAvatarUrl(address)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">
            <span>@ ${escapeHtml(prof.username)}</span>
        </span>
    `;
    
    const chatLog = document.getElementById('ui-chat-log');
    chatLog.innerHTML = `<div class="chat-msg"><div class="chat-content"><div style="color: var(--primary);">Secure DM channel started with ${escapeHtml(prof.username)}.</div></div></div>`;
    
    (window.MeshEngine.dmHistory[address] || []).forEach(msg => appendChatMessage(msg));
    chatLog.scrollTop = chatLog.scrollHeight;
    
    const input = document.getElementById('chat-input');
    input.placeholder = `Message @${escapeHtml(prof.username)}...`;
    input.disabled = false;
}

function switchChannel(serverId, channelId) {
    window.MeshEngine.currentChatServer = serverId;
    window.MeshEngine.currentChatChannel = channelId;
    
    const srv = window.MeshEngine.serversData.find(s => s.id === serverId);
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
    
    socket.emit('join_channel', { serverId, channelId, address: window.CoreEngine.userKeys.publicKey || 'anonymous' });
}

function handleChatEnter(e) {
    if (e.key === 'Enter' && e.target.value.trim() !== '') {
        if(!window.CoreEngine.userKeys.publicKey) return alert("Please unlock your identity to chat.");
        if(!window.MeshEngine.currentChatServer || !window.MeshEngine.currentChatChannel) return;
        
        const text = e.target.value.trim();
        const time = Date.now();

        if (window.MeshEngine.currentChatServer === '@dms') {
            socket.emit('send_direct_message', { to: window.MeshEngine.currentChatChannel, text });
            window.MeshEngine.broadcastToMesh('P2P_CHAT', { sender: window.CoreEngine.userKeys.publicKey, to: window.MeshEngine.currentChatChannel, text, time });
        } else {
            socket.emit('send_message', { serverId: window.MeshEngine.currentChatServer, channelId: window.MeshEngine.currentChatChannel, address: window.CoreEngine.userKeys.publicKey, text });
            window.MeshEngine.broadcastToMesh('P2P_CHAT', { serverId: window.MeshEngine.currentChatServer, channelId: window.MeshEngine.currentChatChannel, sender: window.CoreEngine.userKeys.publicKey, text, time });
        }
        detectMentionsAndEmit(text);
        e.target.value = '';
    }
}

let typingTimer = null;
function handleChatTyping() {
    if (!window.CoreEngine.userKeys.publicKey || !window.MeshEngine.currentChatServer || !window.MeshEngine.currentChatChannel) return;
    if (!typingTimer) {
        socket.emit('user_typing', { serverId: window.MeshEngine.currentChatServer, channelId: window.MeshEngine.currentChatChannel, sender: window.CoreEngine.userKeys.publicKey });
        typingTimer = setTimeout(() => {
            typingTimer = null;
        }, 1500);
    }
}

function promptCreateServer() {
    if(!window.CoreEngine.userKeys.publicKey) return alert("Please unlock your identity to create a server.");
    const serverName = prompt("Enter new Server Name:");
    if (serverName && serverName.trim()) {
        socket.emit('create_server', { serverName: serverName.trim(), address: window.CoreEngine.userKeys.publicKey });
    }
}

function promptCreateChannel() {
    if(!window.CoreEngine.userKeys.publicKey) return alert("Please unlock your identity to create a channel.");
    if(!window.MeshEngine.currentChatServer) return alert("Please select a server first.");
    const channelName = prompt("Enter new Channel Name:");
    if (channelName && channelName.trim()) {
        const isLocked = confirm("Make this a Token-Gated Backroom? (Requires 10,000 $VOD to enter)");
        const safeName = channelName.trim().replace(/[\s#]/g, '-').toLowerCase();
        socket.emit('create_channel', { serverId: window.MeshEngine.currentChatServer, channelName: safeName, address: window.CoreEngine.userKeys.publicKey, locked: isLocked });
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
        await window.CoreEngine.sendSignedTransaction('DELETE_POST', '0x00', { txHash });
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
        await window.CoreEngine.sendSignedTransaction('IMAGE_POST', "0x00", { imageHash: hash, isFlyer: true, localHash: eventsState.currentFile.localHash, x, y, rotation: rot, lat, lng });
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
    const isMe = msg.sender === window.CoreEngine.userKeys.publicKey;
    const senderName = isMe ? 'You' : resolveProfile(msg.sender).username;
    const timeStr = new Date(msg.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    let readReceiptHtml = '';
    if (window.MeshEngine.currentChatServer === '@dms' && isMe) {
        readReceiptHtml = msg.read ? `<span class="read-receipt" style="color: var(--primary); font-size: 10px;"> ✓✓</span>` : `<span class="read-receipt" style="color: var(--text-muted); font-size: 10px;"> ✓</span>`;
    }

    el.innerHTML = `
        <div class="chat-avatar" style="background: url('${getAvatarUrl(msg.sender)}'); background-size: cover; border-radius: 50%; cursor: pointer;" onclick="inspectTargetNode('${msg.sender}')"></div>
        <div class="chat-content" style="width: 100%;">
            <div style="display:flex; justify-content:space-between; align-items: center;">
                <div>
                    <span class="sender" style="cursor:pointer;" onclick="inspectTargetNode('${msg.sender}')">${senderName}</span>
                    ${renderBadges(msg.roles || [])}
                    <span class="time">${timeStr}${readReceiptHtml}</span>
                </div>
                <span class="chat-react-trigger" onclick="sendReaction('${msgId}')" title="Add Reaction">➕😀</span>
            </div>
            <div style="color: #fff; margin-top: 4px;">${parseMentions(msg.text)}</div>
            <div id="reactions_${msgId}" style="display:flex; gap: 5px; font-size: 14px; margin-top: 6px;">
                ${(msg.reactions || []).map(emoji => `<span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 8px; border: 1px solid var(--border);">${escapeHtml(emoji)}</span>`).join('')}
            </div>
        </div>
    `;
    
    const typingIndicators = chatLog.querySelectorAll('.typing-indicator');
    if (typingIndicators.length > 0) {
        chatLog.insertBefore(el, typingIndicators[0]);
    } else {
        chatLog.appendChild(el);
    }
}

function playProfileTrack(index) {
    if (!currentViewedProfile || !currentViewedProfile.uploadedTracks) return;
    const tracks = currentViewedProfile.uploadedTracks.slice().sort((a,b) => b.timestamp - a.timestamp);
    const track = tracks[index];
    let artistName = track.artist || currentViewedProfile.username;
    if (track.offPlatformCollaborator) artistName += ` ft. ${track.offPlatformCollaborator}`;
    
    if (track) {
        const select = document.getElementById('playlist-selector');
        if (select) { select.value = 'profile'; window.AudioEngine.changePlaylistContext('profile'); }
        window.AudioEngine.playTrack(track.title, track.hash, currentViewedProfile.publicKey, artistName);
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

function renderEditedTop8() {
    const list = document.getElementById('top8-selected-list');
    if (!list) return;
    list.innerHTML = editedTop8.map(addr => {
        const prof = resolveProfile(addr);
        return `<div style="background: rgba(102, 252, 241, 0.1); border: 1px solid var(--primary); padding: 4px 8px; border-radius: 999px; font-size: 11px; display: flex; align-items: center; gap: 5px; color: #fff;">
            <img src="${getAvatarUrl(addr)}" style="width:16px; height:16px; border-radius:50%; object-fit: cover;">
            ${escapeHtml(prof.username)}
            <span style="cursor: pointer; color: var(--danger); font-weight: bold; margin-left: 4px;" onclick="removeTop8User('${addr}')">✕</span>
        </div>`;
    }).join('');
}

function handleTop8Search() {
    const q = document.getElementById('top8-search-input').value.trim().toLowerCase();
    const resDiv = document.getElementById('top8-search-results');
    if (!q) { resDiv.innerHTML = ''; return; }
    
    let matches = [];
    for (let addr in networkProfiles) {
        if (addr === window.CoreEngine.userKeys.publicKey || editedTop8.includes(addr)) continue;
        if (networkProfiles[addr].username.toLowerCase().includes(q)) {
            matches.push({ address: addr, ...networkProfiles[addr] });
        }
    }
    
    resDiv.innerHTML = matches.slice(0, 5).map(m => `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.4);">
            <div style="display: flex; align-items: center; gap: 8px;">
                <img src="${getAvatarUrl(m.address)}" style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover;">
                <span style="font-size: 12px; color: #fff;">${escapeHtml(m.username)}</span>
            </div>
            <button type="button" class="secondary" style="padding: 2px 8px; font-size: 10px; margin: 0;" onclick="addTop8User('${m.address}')">+ Add</button>
        </div>
    `).join('');
}

function addTop8User(address) {
    if (editedTop8.length >= 8) return alert("You can only have 8 people in your Top 8!");
    if (!editedTop8.includes(address)) editedTop8.push(address);
    document.getElementById('top8-search-input').value = '';
    document.getElementById('top8-search-results').innerHTML = '';
    renderEditedTop8();
}

function removeTop8User(address) {
    editedTop8 = editedTop8.filter(a => a !== address);
    renderEditedTop8();
}

async function fetchUserProfile(publicKey, isNavUpdateOnly) {
    try {
        const response = await fetch(`/api/social/profile?publicKey=${encodeURIComponent(publicKey)}`);
        const profile = await response.json();
        
        if(profile.publicKey === window.CoreEngine.userKeys.publicKey) {
            const balDisp = document.getElementById('ui-balance-display');
            if(balDisp) balDisp.innerText = profile.balance.toLocaleString();
        }

        // Always update the composer avatar if it's our profile
        if (profile.publicKey === window.CoreEngine.userKeys.publicKey) {
            const adminPanel = document.getElementById('ui-admin-panel');
            if (adminPanel) {
                if (profile.isAdmin) adminPanel.classList.remove('hidden');
                else adminPanel.classList.add('hidden');
            }

            myCustomTheme = profile.customCss || '';
            
            // Immediately apply personal theme if browsing global views
            if (currentView !== 'profile' || viewingUserPublicKey === window.CoreEngine.userKeys.publicKey || !viewingUserPublicKey) {
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
            setVal('input-edit-tags', profile.tags ? profile.tags.join(', ') : "");
            editedTop8 = profile.top8 ? [...profile.top8] : [];
            myFollowing = profile.following || [];
            renderEditedTop8();

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
            toggleBtn.style.display = viewingUserPublicKey === window.CoreEngine.userKeys.publicKey ? 'block' : 'none';
        }

        const messageBtn = document.getElementById('btn-profile-message');
        if (messageBtn) {
            messageBtn.style.display = viewingUserPublicKey === window.CoreEngine.userKeys.publicKey ? 'none' : 'block';
        }

        const followBtn = document.getElementById('btn-profile-follow');
        if (followBtn) {
            if (viewingUserPublicKey === window.CoreEngine.userKeys.publicKey) {
                followBtn.style.display = 'none';
            } else {
                followBtn.style.display = 'block';
                if (profile.followers && profile.followers.includes(window.CoreEngine.userKeys.publicKey)) {
                    followBtn.innerText = "Crew Locked 🤝";
                    followBtn.disabled = true;
                } else {
                    followBtn.innerText = "Lock In Crew";
                    followBtn.disabled = false;
                }
            }
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
            
            window.currentProfileCrew = profile.following || [];
            window.currentProfileFans = profile.followers || [];

            if (viewingUserPublicKey !== window.CoreEngine.userKeys.publicKey) {
                const isMutual = profile.following.includes(window.CoreEngine.userKeys.publicKey);
                if (isMutual) {
                    html += `<div style="background: rgba(31, 188, 115, 0.1); border: 1px solid var(--success); color: var(--success); padding: 10px; border-radius: 8px; font-size: 12px; margin-bottom: 10px; text-align: center;">🤝 You and ${profile.username} are mutuals!</div>`;
                }
            }

            html += `<div style="margin-bottom: 15px; display: flex; gap: 5px; flex-wrap: wrap;">`;
            if (profile.uploadedTracks && profile.uploadedTracks.length > 0) {
                html += `<span style="background: var(--primary); color: #000; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">🎧 Artist</span>`;
            }
            if (profile.tags && profile.tags.length > 0) {
                profile.tags.forEach(t => {
                    html += `<span style="background: rgba(102, 252, 241, 0.1); border: 1px solid var(--primary); color: var(--primary); padding: 3px 8px; border-radius: 4px; font-size: 11px;">#${escapeHtml(t)}</span>`;
                });
            }
            html += `</div>`;

            let friends = window.currentProfileCrew;
            html += `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px; text-transform: uppercase; font-weight: bold; display: flex; justify-content: space-between;">
                <span>Crew Connections (${friends.length})</span>
                ${friends.length > 8 ? `<span style="cursor:pointer; color:var(--primary);" onclick="window.showConnectionsModal(window.currentProfileCrew, window.currentProfileFans)">View All</span>` : ''}
            </div><div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px;">`;
            
            friends.slice(0, 8).forEach(key => {
                html += `<div style="display:flex; flex-direction:column; align-items:center; cursor: pointer; width: 60px;" onclick="inspectTargetNode('${key}')">
                        <img src="${getAvatarUrl(key)}" style="width: 40px; height: 40px; border-radius: 50%; border: 2px solid ${profile.followers.includes(key) ? 'var(--success)' : 'transparent'};">
                        <div style="font-size: 10px; color: #fff; margin-top: 4px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;">${resolveProfile(key).username}</div>
                    </div>`;
            });
            if (friends.length === 0) html += `<div style="color: var(--text-muted); font-size: 12px;">No crew connections yet.</div>`;
            html += `</div>`;

            if (profile.recommended && profile.recommended.length > 0) {
                html += `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px; text-transform: uppercase; font-weight: bold;">Suggested Connections</div>`;
                html += profile.recommended.map(key => `
                    <div style="display:flex; align-items:center; gap:10px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; transition: 0.2s; margin-bottom: 5px;" onclick="inspectTargetNode('${rec.key}')" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='transparent'">
                        <img src="${getAvatarUrl(rec.key)}" style="width: 30px; height: 30px; border-radius: 50%;">
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 13px; font-weight: bold; color: #fff;">${resolveProfile(rec.key).username}</span>
                            <span style="font-size: 10px; color: var(--text-muted);">${rec.mutuals} mutual connections</span>
                        </div>
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
        const historyContainers = [document.getElementById('ui-tx-history')];
        historyContainers.forEach(historyContainer => {
            if (historyContainer) {
                const txListToRender = profile.transactions;
                historyContainer.innerHTML = txListToRender.map(tx => {
                let isSender = tx.sender === window.CoreEngine.userKeys.publicKey;
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
                const isCreator = c.creator === window.CoreEngine.userKeys.publicKey;
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
        if (stakeReqContainer && profile.publicKey === window.CoreEngine.userKeys.publicKey) {
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
                    const isOwner = item.sender === window.CoreEngine.userKeys.publicKey;
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
                                    ${renderThreadedReplies(item.replies, 0, item.transactionHash)}
                                    ${renderThreadedReplies(item.replies, 0, item.transactionHash)}
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
                    <div class="playlist-item" data-hash="${track.hash}" draggable="${viewingUserPublicKey === window.CoreEngine.userKeys.publicKey ? 'true' : 'false'}" style="background: rgba(0,0,0,0.8); border: 1px solid var(--border); padding: 12px; border-radius: 8px; display: flex; align-items: center; gap: 15px; margin-bottom: 5px;">
                        ${viewingUserPublicKey === window.CoreEngine.userKeys.publicKey ? '<div style="cursor:grab; font-size:16px;">☰</div>' : ''}
                        <div class="anthem-play-btn" style="width:30px; height:30px; font-size:14px;" onclick="playProfileTrack(${idx})">▶</div>
                        <div style="flex: 1;">
                            <div style="font-size: 14px; font-weight: bold; color: #fff;">${escapeHtml(track.title)}</div>
                            <div style="font-size: 11px; color: var(--text-muted);">${track.playCount || 0} Streams</div>
                        </div>
                        ${viewingUserPublicKey === window.CoreEngine.userKeys.publicKey ? `<button class="secondary" style="padding: 4px 8px; font-size: 10px;" onclick="promptEditSong('${track.hash}')">Edit</button>` : ''}
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

function renderNewUsers() {
    const container = document.getElementById('ui-new-users');
    if (!container || !window.networkProfiles) return;
    
    const users = Object.entries(window.networkProfiles).map(([addr, prof]) => ({
        address: addr,
        ...prof
    })).sort((a, b) => (b.joined || 0) - (a.joined || 0));
    
    container.innerHTML = users.map(user => {
        const onlineNode = window.MeshEngine.onlineNodes ? window.MeshEngine.onlineNodes.find(n => n.address === user.address) : null;
        const isOnline = onlineNode && onlineNode.status === 'online';
        const dotColor = isOnline ? 'var(--success)' : (onlineNode && onlineNode.status === 'idle' ? 'var(--warning)' : 'transparent');
        const dotHtml = dotColor !== 'transparent' ? `<div class="status-dot" style="background: ${dotColor}; box-shadow: 0 0 5px ${dotColor};"></div>` : '';
        
        return `<div class="user-row" onclick="inspectTargetNode('${user.address}')">
            <div class="user-info">
                <img src="${getAvatarUrl(user.address)}">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 14px; font-weight: bold; color: #fff;">${escapeHtml(user.username)}</span>
                    <span style="font-size: 10px; color: var(--text-muted);">Joined ${new Date(user.joined || Date.now()).toLocaleDateString()}</span>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                ${dotHtml}
            </div>
        </div>`;
    }).join('');
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
        const titleInput = document.getElementById('audio-meta-title');
        if (titleInput && !titleInput.value) titleInput.value = audFile.name.replace(/\.[^/.]+$/, "");
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
    const tagsInputEl = document.getElementById('input-edit-tags');
    const tagsIn = tagsInputEl ? tagsInputEl.value.trim() : "";
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
        
        let profileData = {};
        if(userIn) profileData.username = userIn;
        profileData.bio = bioIn; // Included unconditionally so users can clear their bio
        if(tagsInputEl) profileData.tags = tagsIn.split(',').map(t => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(t => t);
        if(finalAvatarHash) profileData.avatarHash = finalAvatarHash;
        if(finalBannerHash) profileData.bannerHash = finalBannerHash;
        if(finalSectionBgHash) profileData.sectionImages = finalSectionBgHash;
        if(playlistOrder) profileData.playlistOrder = playlistOrder;
        profileData.layoutOrder = layoutOrder;
        
        if(Object.keys(profileData).length > 0) {
            await window.CoreEngine.sendSignedTransaction('PROFILE_UPDATE', window.CoreEngine.userKeys.publicKey, profileData);
        }

        await window.CoreEngine.sendSignedTransaction('THEME_UPDATE', window.CoreEngine.userKeys.publicKey, { customCss: cssIn });
        myCustomTheme = cssIn;
        document.getElementById('ui-dynamic-user-theme').innerHTML = cssIn; 

        await window.CoreEngine.sendSignedTransaction('SET_TOP_8', window.CoreEngine.userKeys.publicKey, { top8Keys: editedTop8 });
        
        alert("Identity and Theme blocks successfully deployed to the ledger.");
        document.getElementById('input-edit-avatar').value = '';
        document.getElementById('input-edit-banner').value = '';
        fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
        toggleInlineEdit();
    } catch (err) { alert("Update failed: " + err.message); }
}

window.executeTargetFollow = async function(targetPeerPublicKey, isReply = false) {
    if(!targetPeerPublicKey) return;
    if (window.CoreEngine.userKeys.publicKey === targetPeerPublicKey) return alert("Cannot connect to your own node.");
    try {
        await window.CoreEngine.sendSignedTransaction('FOLLOW_USER', targetPeerPublicKey, {});
        
        if (!isReply && socket) {
            socket.emit('send_crew_request', { target: targetPeerPublicKey, from: window.CoreEngine.userKeys.publicKey });
        }
        
        alert("Crew connection established.");
        
        // Refresh profiles to immediately update the button UI and feed priorities
        fetchUserProfile(targetPeerPublicKey, false);
        fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);
    } catch (err) { alert(err.message); }
}

async function createCommission() {
    const recipient = document.getElementById('input-comm-recipient').value.trim();
    const amount = document.getElementById('input-comm-amount').value.trim();
    const terms = document.getElementById('input-comm-terms').value.trim();
    
    if(!recipient || !amount || !terms) return alert("Recipient, amount, and terms are required to start an escrow contract.");
    if(recipient === window.CoreEngine.userKeys.publicKey) return alert("You cannot commission yourself.");
    
    try {
        await window.CoreEngine.sendSignedTransaction('CREATE_COMMISSION', recipient, { amount: parseFloat(amount), terms: terms });
        
        alert(`Escrow Successful: Locked ${amount} $VOD in a smart contract.`);
        document.getElementById('input-comm-amount').value = ''; document.getElementById('input-comm-terms').value = '';
        fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
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
            await window.CoreEngine.sendSignedTransaction('FULFILL_COMMISSION', '0x00', { commissionId: commId, assetHash: hash });
            alert("Commission fulfilled! Escrow funds have been successfully released to your wallet.");
            
            const activeComms = currentViewedProfile ? currentViewedProfile.activeCommissions : [];
            const c = activeComms.find(x => x.id === commId);
            if(c) socket.emit('trigger_push', { target: c.buyer, payload: { title: 'Commission Fulfilled! 📦', body: `${resolveProfile(window.CoreEngine.userKeys.publicKey).username} uploaded the asset for your escrow.` } });

            fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
        } catch(err) { alert("Fulfillment failed: " + err.message); }
    };
    input.click();
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
        await window.CoreEngine.sendSignedTransaction('LIST_ITEM', '0x00', { title: title, itemType: itemType, price: parseFloat(price), assetHash: hash });
        alert("Asset listed in the Marketplace!"); 
        document.getElementById('sell-title-input').value = '';
        document.getElementById('sell-price-input').value = '';
        fileInput.value = '';
        window.loadMarketplace(); 
        fetchUserProfile(window.CoreEngine.userKeys.publicKey, false); 
        window.switchMarketTab('buy');
    } catch(err) { alert("Listing failed: " + err.message); }
}

async function buyDigitalItem(itemId, price, seller) {
    if (seller === window.CoreEngine.userKeys.publicKey) return alert("You cannot buy your own item.");
    if (!confirm(`Purchase this asset for ${price} $VOD?`)) return;
    try {
        await window.CoreEngine.sendSignedTransaction('BUY_ITEM', seller, { itemId, price });
        alert("Purchase successful! You can now view this asset in your Wallet.");
        window.loadMarketplace();
        fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
    } catch(err) { alert("Purchase failed: " + err.message); }
}

async function createOpenBounty() {
    const amount = prompt("How much $VOD are you locking up for this bounty?");
    if (!amount || isNaN(parseFloat(amount))) return;
    const desc = prompt("Describe what you want (e.g., 'Need a 16-bar verse for this track'):");
    if (!desc) return;
    try {
        await window.CoreEngine.sendSignedTransaction('CREATE_BOUNTY', '0x00', { amount: parseFloat(amount), description: desc });
        alert("Bounty posted securely to the ledger!");
        window.loadMarketplace();
        fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
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
            await window.CoreEngine.sendSignedTransaction('SUBMIT_BOUNTY', '0x00', { bountyId, message, assetHash: hash });
            alert("Submission received by the smart contract!"); window.loadMarketplace();
        } catch(err) { alert("Submission failed: " + err.message); }
    };
    input.click();
}

async function awardBounty(bountyId, winnerAddress) {
    if(!confirm(`Award this bounty to Node_${winnerAddress.substring(0,6)}? The funds will be released to their wallet permanently.`)) return;
    try {
        await window.CoreEngine.sendSignedTransaction('AWARD_BOUNTY', '0x00', { bountyId, winner: winnerAddress });
        alert("Bounty awarded successfully!");
        window.loadMarketplace();
    } catch(err) { alert("Award failed: " + err.message); }
}

// ==========================================
// 8. WEBRTC VOICE & DIRECT MESSAGING (DISCORD GAP)
// ==========================================

let localVoiceStream;
let peerConnections = {};
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

async function joinActiveVoiceChannel() {
    if(!window.MeshEngine.currentChatServer || !window.MeshEngine.currentChatChannel) return alert("Select a text channel first to join its linked Voice Room.");
    try {
        localVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        socket.emit('webrtc_join_voice', { serverId: window.MeshEngine.currentChatServer, channelId: window.MeshEngine.currentChatChannel, address: window.CoreEngine.userKeys.publicKey });
        document.getElementById('ui-active-server-name').innerText += " (🎙️ Voice Connected)";
    } catch (err) { 
        console.error("Mic access denied:", err);
        alert("Microphone access is required to join Voice Channels."); 
    }
}

window.webrtcUserJoined = async (data) => {
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
};

window.webrtcOffer = async (data) => {
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
};

window.webrtcAnswer = async (data) => {
    if (peerConnections[data.sender]) {
        await peerConnections[data.sender].setRemoteDescription(data.sdp);
    }
    try {
        if (peerConnections[data.sender]) await peerConnections[data.sender].setRemoteDescription(data.sdp);
    } catch(e) { console.warn("WebRTC Answer Error:", e.message); }
};

window.webrtcIceCandidate = async (data) => {
    if (peerConnections[data.sender]) {
        await peerConnections[data.sender].addIceCandidate(data.candidate);
    }
    try {
        if (peerConnections[data.sender] && peerConnections[data.sender].remoteDescription) {
            await peerConnections[data.sender].addIceCandidate(data.candidate);
        }
    } catch(e) { console.warn("WebRTC ICE Error:", e.message); }
};

// ==========================================
// P2P DATA MESH (DECENTRALIZED BROWSER NODES)
// ==========================================

function connectToMeshNode(targetSocketId) {
    if (isNodeBlocked(window.MeshEngine.socketIdToAddress[targetSocketId])) return;
    const pc = new RTCPeerConnection(rtcConfig);
    window.MeshEngine.meshConnections[targetSocketId] = pc;
    const dc = pc.createDataChannel('vod_data_mesh');
    window.MeshEngine.dataChannels[targetSocketId] = dc;
    
    setupDataChannel(dc, targetSocketId);

    pc.onicecandidate = e => {
        if(e.candidate) socket.emit('mesh_ice_candidate', { target: targetSocketId, candidate: e.candidate });
    };

    pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socket.emit('mesh_offer', { target: targetSocketId, sdp: pc.localDescription });
    });
}

window.meshOffer = async (data) => {
    if (isNodeBlocked(window.MeshEngine.socketIdToAddress[data.sender])) return;
    const pc = new RTCPeerConnection(rtcConfig);
    window.MeshEngine.meshConnections[data.sender] = pc;

    pc.ondatachannel = event => {
        window.MeshEngine.dataChannels[data.sender] = event.channel;
        setupDataChannel(event.channel, data.sender);
    };

    pc.onicecandidate = e => {
        if(e.candidate) socket.emit('mesh_ice_candidate', { target: data.sender, candidate: e.candidate });
    };

    await pc.setRemoteDescription(data.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('mesh_answer', { target: data.sender, sdp: pc.localDescription });
};

window.meshAnswer = async (data) => {
    if (isNodeBlocked(window.MeshEngine.socketIdToAddress[data.sender])) return;
    if (window.MeshEngine.meshConnections[data.sender]) await window.MeshEngine.meshConnections[data.sender].setRemoteDescription(data.sdp);
    try {
        if (window.MeshEngine.meshConnections[data.sender]) await window.MeshEngine.meshConnections[data.sender].setRemoteDescription(data.sdp);
    } catch(e) { console.warn("Mesh Answer Error:", e.message); }
};

window.meshIceCandidate = async (data) => {
    if (isNodeBlocked(window.MeshEngine.socketIdToAddress[data.sender])) return;
    if (window.MeshEngine.meshConnections[data.sender]) await window.MeshEngine.meshConnections[data.sender].addIceCandidate(data.candidate);
    try {
        if (window.MeshEngine.meshConnections[data.sender] && window.MeshEngine.meshConnections[data.sender].remoteDescription) {
            await window.MeshEngine.meshConnections[data.sender].addIceCandidate(data.candidate);
        }
    } catch(e) { console.warn("Mesh ICE Error:", e.message); }
};

function setupDataChannel(dc, id) {
    dc.onopen = () => console.log(`🌐 [P2P MESH] Connected directly to browser node: ${id}`);
    dc.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'P2P_CHAT') {
            console.log('✉️ [P2P MESH] Incoming direct chat message received!');
            const payload = msg.payload;
            
            if (payload.to) {
                 // DM P2P
                 if (!window.MeshEngine.dmHistory[payload.sender]) window.MeshEngine.dmHistory[payload.sender] = [];
                 const exists = window.MeshEngine.dmHistory[payload.sender].find(m => m.time === payload.time);
                 if (!exists) {
                     window.MeshEngine.dmHistory[payload.sender].push(payload);
                     if (window.MeshEngine.currentChatServer === '@dms' && window.MeshEngine.currentChatChannel === payload.sender) appendChatMessage(payload);
                     else {
                         const badge = document.getElementById('ui-inbox-badge');
                         if (badge) { badge.innerText = parseInt(badge.innerText) + 1; badge.classList.remove('hidden'); }
                     }
                     if (window.MeshEngine.currentChatServer === '@dms') renderDMList();
                 }
            } else {
                // Server Channel Chat P2P
                if (window.MeshEngine.currentChatServer === payload.serverId && window.MeshEngine.currentChatChannel === payload.channelId) {
                    const chatLog = document.getElementById('ui-chat-log');
                    if (!chatLog.innerHTML.includes(payload.time + '_' + payload.sender.substring(0, 5))) {
                        appendChatMessage(payload);
                    }
                }
            }
        } else if (msg.type === 'P2P_BLOCK') {
            console.log('📦 [P2P MESH] Intercepted new block directly from peer!');
            if(msg.payload.type === 'PROFILE_UPDATE') socket.emit('request_profile_directory');
        if(localDB && msg.payload.hash) {
            localDB.transaction('blocks', 'readwrite').objectStore('blocks').put(msg.payload);
        }
            if(window.CoreEngine.userKeys.publicKey) fetchUserProfile(window.CoreEngine.userKeys.publicKey, true); 
            if(currentView === 'feed') loadMainGlobalFeed();
        }
    };
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
    if (!window.CoreEngine.userKeys.publicKey) return alert("Must be logged in to send DMs.");
    if (targetAddress === window.CoreEngine.userKeys.publicKey) return alert("You cannot DM yourself.");
    if (!window.MeshEngine.dmHistory[targetAddress]) window.MeshEngine.dmHistory[targetAddress] = [];
    switchServer('@dms');
    switchDMChannel(targetAddress);
    document.getElementById('chat-input').focus();
}

window.handleDirectMessage = (msg) => {
    const otherAddr = msg.sender === window.CoreEngine.userKeys.publicKey ? msg.to : msg.sender;
    if (!window.MeshEngine.dmHistory[otherAddr]) window.MeshEngine.dmHistory[otherAddr] = [];
    msg.roles = msg.roles || [];

    const exists = window.MeshEngine.dmHistory[otherAddr].find(m => m.time === msg.time && m.sender === msg.sender);
    if (!exists) {
        window.MeshEngine.dmHistory[otherAddr].push(msg);
    }

    if (window.MeshEngine.currentChatServer === '@dms' && window.MeshEngine.currentChatChannel === otherAddr) {
        if (!exists) {
            appendChatMessage(msg);
            const chatLog = document.getElementById('ui-chat-log');
            chatLog.scrollTop = chatLog.scrollHeight;
        }
        if (msg.sender !== window.CoreEngine.userKeys.publicKey) {
            socket.emit('message_read', { to: msg.sender, time: msg.time });
        }
    } else {
        if (!exists) {
            const badge = document.getElementById('ui-inbox-badge');
            if (badge && msg.sender !== window.CoreEngine.userKeys.publicKey) { 
                badge.innerText = parseInt(badge.innerText) + 1; 
                badge.classList.remove('hidden'); 
            }
        }
    }
    if (window.MeshEngine.currentChatServer === '@dms') renderDMList();
};

function sendReaction(msgId) {
    const emoji = prompt("Enter an emoji to react with:");
    if (emoji && window.MeshEngine.currentChatServer && window.MeshEngine.currentChatChannel) {
        socket.emit('add_message_reaction', { serverId: window.MeshEngine.currentChatServer, channelId: window.MeshEngine.currentChatChannel, msgId, emoji });
    }
}

window.handleNewReaction = (data) => {
    const reactionContainer = document.getElementById(`reactions_${data.msgId}`);
    if (reactionContainer) {
        reactionContainer.innerHTML += `<span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 8px; border: 1px solid var(--border);">${escapeHtml(data.emoji)}</span>`;
    }
};

// ==========================================
// 9. NEW SOCIAL FEATURES (Badges, Mentions, Modals)
// ==========================================

function detectMentionsAndEmit(text) {
    if (!text) return;
    const mentions = text.match(/@([a-zA-Z0-9_]+)/g);
    if (mentions) {
        mentions.forEach(m => {
            const username = m.substring(1).toLowerCase();
            let targetAddr = null;
            for (const addr in networkProfiles) {
                if (networkProfiles[addr].username.toLowerCase() === username) {
                    targetAddr = addr; break;
                }
            }
            if (targetAddr) socket.emit('notify_mention', { target: targetAddr, from: window.CoreEngine.userKeys.publicKey });
        });
    }
}

window.handleMentionNotification = (data) => {
    const badge = document.getElementById('ui-notif-badge');
    if (badge) {
        badge.innerText = parseInt(badge.innerText) + 1;
        badge.classList.remove('hidden');
    }
};

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
        socket.emit('like_post', { txHash, address: window.CoreEngine.userKeys.publicKey });
    }

    try {
        await window.CoreEngine.sendSignedTransaction('LIKE_POST', receiver || '0x00', { txHash: txHash });
    } catch (err) {
        console.error("Like block failed:", err);
    }
}

function toggleReplyBox(txHash) {
    const box = document.getElementById(`reply-box-${txHash}`);
    if (box) box.style.display = box.style.display === 'block' ? 'none' : 'block';
}

async function submitReply(txHash, receiver, parentReplyId = null) {
    const boxId = parentReplyId ? `reply-box-${parentReplyId}` : `reply-box-${txHash}`;
    const box = document.getElementById(boxId);
    if (!box) return;
    const text = box.querySelector('textarea').value;
    if (!text.trim()) return;
    
    detectMentionsAndEmit(text);
    
    box.querySelector('textarea').value = '';
    socket.emit('reply_post', { txHash, address: window.CoreEngine.userKeys.publicKey, text: text.trim(), parentReplyId });

    try {
        const replyId = Date.now() + '_' + window.CoreEngine.userKeys.publicKey.substring(0, 10);
        await window.CoreEngine.sendSignedTransaction('REPLY_POST', receiver || '0x00', { txHash: txHash, text: text.trim(), parentReplyId, replyId });
    } catch (err) {
        console.error("Reply block failed:", err);
    }
}

function renderThreadedReplies(repliesArray, depthLevel, txHash) {
    if (!repliesArray || repliesArray.length === 0) return '';
    const marginLeft = depthLevel > 0 ? 20 : 0;
    const borderLeft = depthLevel > 0 ? '2px solid rgba(69, 162, 158, 0.3)' : 'none';
    
    return repliesArray.map(r => `
        <div style="font-size: 13px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 8px; margin-left: ${marginLeft}px; border-left: ${borderLeft}; margin-top: 5px;">
            <strong>${resolveProfile(r.sender).username}:</strong> ${parseMentions(r.text)}
            <div style="margin-top: 5px;">
                <button class="interaction-btn" style="font-size: 10px;" onclick="toggleReplyBox('${r.id}')">💬 Reply</button>
            </div>
            <div class="reply-box" id="reply-box-${r.id}" style="margin-top: 5px;">
                <textarea placeholder="Write a reply..."></textarea>
                <button style="padding: 5px 15px; font-size: 11px;" onclick="submitReply('${txHash}', '${r.sender}', '${r.id}')">Post Reply</button>
            </div>
            ${r.replies && r.replies.length > 0 ? renderThreadedReplies(r.replies, depthLevel + 1, txHash) : ''}
        </div>
    `).join('');
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
    if(!window.CoreEngine.userKeys.publicKey) return alert("Identity required.");

    socket.emit('publish_article', { title, body, price: parseFloat(price), author: window.CoreEngine.userKeys.publicKey });

    document.getElementById('zine-publish-title').value = '';
    document.getElementById('zine-publish-body').value = '';
    alert("Masterpiece published to the swarm!");
    switchZineSubTab('market');
}

function renderZine() {
    const marketContainer = document.getElementById('ui-zine-articles');
    const ownedContainer = document.getElementById('ui-zine-owned');
    if(!marketContainer || !ownedContainer) return;

    const myAddr = window.CoreEngine.userKeys.publicKey;
    
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
    if(!window.CoreEngine.userKeys.publicKey) return alert("Please login.");
    socket.emit('purchase_article_rights', articleId);
}

function likeArticle(articleId) {
    if (!window.CoreEngine.userKeys.publicKey) return alert("Must be logged in to like.");
    socket.emit('like_article', articleId);
}

async function tipArticle(articleId, author) {
    if (!window.CoreEngine.userKeys.publicKey) return alert("Must be logged in to tip.");
    if (author === window.CoreEngine.userKeys.publicKey) return alert("You cannot tip your own article.");
    const amount = prompt("How much $VOD would you like to tip the author?");
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return;
    
    try {
        await window.CoreEngine.sendSignedTransaction('TRANSFER_COIN', author, { amount: parseFloat(amount) });
        
        socket.emit('trigger_push', { target: author, payload: { title: 'Tip Received! 💸', body: `You received ${amount} $VOD from ${resolveProfile(window.CoreEngine.userKeys.publicKey).username} for your Zine Article!` } });

        alert(`Successfully tipped ${amount} $VOD to the author!`);
    } catch (err) { alert("Tip failed: " + err.message); }
}

// ==========================================
// STORIES ENGINE LOGIC
// ==========================================

window.currentStoryIndex = 0;
window.currentStoryUser = '';

function openStoryModal(sender) {
    if (!window.currentActiveStories || !window.currentActiveStories[sender]) return;
    window.currentStoryUser = sender;
    window.currentStoryIndex = 0;
    renderStoryModal();
    document.getElementById('story-modal').classList.remove('hidden');
}

function renderStoryModal() {
    const stories = window.currentActiveStories[window.currentStoryUser];
    if (!stories || window.currentStoryIndex >= stories.length) {
        closeStoryModal();
        return;
    }
    
    const story = stories[window.currentStoryIndex];
    const modalContent = document.getElementById('story-modal-content');
    
    let mediaHtml = '';
    if (story.data.imageHash) {
        mediaHtml = `<img src="/tracks/${story.data.imageHash}" style="max-width: 100%; max-height: 70vh; border-radius: 8px; object-fit: contain;">`;
    } else if (story.data.videoHash) {
        mediaHtml = `<video src="/tracks/${story.data.videoHash}" autoplay controls style="max-width: 100%; max-height: 70vh; border-radius: 8px; object-fit: contain;"></video>`;
    }
    
    modalContent.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding: 15px; border-bottom: 1px solid var(--border);">
            <div style="display: flex; align-items: center; gap: 10px; cursor: pointer;" onclick="inspectTargetNode('${story.sender}'); closeStoryModal();">
                <img src="${getAvatarUrl(story.sender)}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
                <strong style="color: #fff;">${resolveProfile(story.sender).username}</strong>
                <span style="font-size: 11px; color: var(--text-muted);">${new Date(story.timestamp).toLocaleString()}</span>
            </div>
            <button class="secondary" style="padding: 4px 10px; border-radius: 6px; width: auto;" onclick="closeStoryModal()">✖</button>
        </div>
        <div style="text-align: center; position: relative; padding: 0 15px;" onclick="nextStory()">
            ${mediaHtml}
            ${story.data.caption ? `<div style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: #fff; padding: 10px 20px; border-radius: 8px; width: 80%; pointer-events: none;">${escapeHtml(story.data.caption)}</div>` : ''}
        </div>
        <div style="text-align: center; padding: 15px; font-size: 12px; color: var(--text-muted);">Click media for next story (${window.currentStoryIndex + 1}/${stories.length})</div>
    `;
}

function nextStory() {
    window.currentStoryIndex++;
    renderStoryModal();
}

function closeStoryModal() {
    document.getElementById('story-modal').classList.add('hidden');
    const modalContent = document.getElementById('story-modal-content');
    modalContent.innerHTML = ''; 
}

function toggleDMPane() {
    switchServer('@dms');
    resetInboxBadge();
    const container = document.querySelector('.container');
    if (container) {
        container.classList.add('chat-mode');
    }
}

function promptNewDM() {
    const username = prompt("Enter the exact username of the person you want to message:");
    if (!username) return;
    
    let targetAddr = null;
    for (const [addr, profile] of Object.entries(networkProfiles)) {
        if (profile.username.toLowerCase() === username.toLowerCase()) {
            targetAddr = addr;
            break;
        }
    }
    
    if (targetAddr) {
        sendDM(targetAddr);
    } else {
        alert("User not found on the network.");
    }
}