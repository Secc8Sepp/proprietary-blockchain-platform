window.MeshEngine = {
    socket: null,
    myMeshId: null, 
    meshConnections: {}, 
    dataChannels: {},
    serversData: [],
    currentChatServer: null,
    currentChatChannel: null,
    dmHistory: {},
    socketIdToAddress: {},
    onlineNodes: [],

    init(socket) {
        this.socket = socket;
        window.socket = socket; 
        
        socket.on('connect', () => { this.myMeshId = socket.id; });
        
        socket.on('chat_history', (msgs) => {
            const chatLog = document.getElementById('ui-chat-log');
            if(chatLog) { msgs.forEach(msg => window.appendChatMessage(msg)); chatLog.scrollTop = chatLog.scrollHeight; }
        });

        socket.on('new_message', (msg) => {
            window.appendChatMessage(msg);
            const chatLog = document.getElementById('ui-chat-log');
            if(chatLog) chatLog.scrollTop = chatLog.scrollHeight;
        });

        socket.on('chat_error', (data) => {
            const chatLog = document.getElementById('ui-chat-log');
            if(chatLog) chatLog.innerHTML = `<div class="chat-msg"><div class="chat-avatar" style="background: var(--danger); display: flex; align-items: center; justify-content: center; font-size: 16px;">🛑</div><div class="chat-content"><div><span class="sender" style="color: var(--danger);">Network Enforcer</span></div><div style="color: var(--text-muted);">${window.escapeHtml(data.message)}</div></div></div>`;
            const input = document.getElementById('chat-input');
            if(input) { input.placeholder = 'Access Denied...'; input.disabled = true; }
        });

        socket.on('server_list', (servers) => {
            this.serversData = servers;
            window.renderServerList();
            if(servers.length > 0 && !this.currentChatServer) window.switchServer(servers[0].id);
        });

        socket.on('profile_directory', (dir) => {
            window.networkProfiles = dir;
            if(window.currentView === 'feed') window.loadMainGlobalFeed();
            window.renderServerList();
            if(this.currentChatServer === '@dms') window.renderDMList();
            if(typeof window.renderNewUsers === 'function') window.renderNewUsers();
        });

        socket.on('blockchain_update', (payload) => {
            if(payload && payload.type === 'PROFILE_UPDATE') socket.emit('request_profile_directory');
            if(window.CoreEngine.userKeys.publicKey) window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true); 
            if(window.currentView === 'feed') window.loadMainGlobalFeed();
            if(window.currentView === 'profile' && window.viewingUserPublicKey) window.fetchUserProfile(window.viewingUserPublicKey, false);
            
            // CROSS-ENGINE COMMUNICATION
            if(window.GlobalTagEngine) window.GlobalTagEngine.syncTags(payload);
        });

        socket.on('server_created', (server) => {
            this.serversData.push(server);
            window.renderServerList();
        });

        socket.on('channel_created', (data) => {
            const { serverId, channel } = data;
            const srv = this.serversData.find(s => s.id === serverId);
            if (srv) {
                srv.channels.push(channel);
                if (this.currentChatServer === serverId) window.renderChannelList(srv);
            }
        });

        socket.on('crew_request_received', (data) => {
            if (!window.pendingCrewRequests) window.pendingCrewRequests = [];
            // Avoid duplicates
            if (window.pendingCrewRequests.find(r => r.from === data.from)) return;

            window.pendingCrewRequests.push({ from: data.from });
            
            const badge = document.getElementById('ui-requests-badge');
            if (badge) {
                badge.innerText = window.pendingCrewRequests.length;
                badge.classList.remove('hidden');
            }

            if (typeof window.renderCrewRequests === 'function') {
                window.renderCrewRequests();
            }
            
            const username = window.resolveProfile(data.from).username;
            alert(`🤝 ${username} sent you a crew request! Check your notifications.`);
        });

        socket.on('user_typing', (data) => {
            if (data.serverId !== this.currentChatServer || data.channelId !== this.currentChatChannel) return;
            if (data.sender === window.CoreEngine.userKeys.publicKey) return;
            const chatLog = document.getElementById('ui-chat-log');
            if (!chatLog) return;
            let indicator = document.getElementById(`typing_${data.sender}`);
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = `typing_${data.sender}`;
                indicator.className = 'chat-msg typing-indicator';
                indicator.style = 'color: var(--text-muted); font-style: italic; font-size: 12px; padding: 5px 10px;';
                indicator.innerText = `${window.resolveProfile(data.sender).username} is typing...`;
                chatLog.appendChild(indicator);
                chatLog.scrollTop = chatLog.scrollHeight;
            }
            clearTimeout(indicator.timeout);
            indicator.timeout = setTimeout(() => { indicator.remove(); }, 2000);
        });

        socket.on('message_read', (data) => {
            const { from, time } = data;
            if (this.dmHistory[from]) {
                const msg = this.dmHistory[from].find(m => m.time === time && m.sender === window.CoreEngine.userKeys.publicKey);
                if (msg) {
                    msg.read = true;
                    const msgEl = document.getElementById(`msg_${msg.time}_${msg.sender.substring(0, 5)}`);
                    if (msgEl) {
                        const readReceipt = msgEl.querySelector('.read-receipt');
                        if (readReceipt) { readReceipt.innerText = ' ✓✓'; readReceipt.style.color = 'var(--primary)'; }
                    }
                }
            }
        });

        socket.on('swarm_update', (nodes) => {
            const countHeader = document.getElementById('ui-online-count');
            const container = document.getElementById('ui-online-users');
            nodes.forEach(node => { if (node.socketId) this.socketIdToAddress[node.socketId] = node.address; });
            this.onlineNodes = nodes;
            
            nodes.forEach(node => {
                if (node.socketId && this.myMeshId && node.socketId !== this.myMeshId) {
                    if (this.myMeshId > node.socketId && !this.meshConnections[node.socketId]) window.connectToMeshNode(node.socketId);
                }
            });
            
            if (countHeader) countHeader.innerText = `Online in Swarm — ${nodes.length}`;
            if (container) {
                container.innerHTML = nodes.map(node => {
                    const isMe = node.address === window.CoreEngine.userKeys.publicKey;
                    const displayName = isMe ? 'You' : window.resolveProfile(node.address).username;
                    const color = isMe ? 'var(--primary)' : '#fff';
                    const dotColor = node.status === 'idle' ? 'var(--warning)' : 'var(--success)';
                    
                    let activityHtml = '';
                    if (node.track) {
                        const trackArtist = node.track.artist || node.track.artistName || 'Unknown Artist';
                        activityHtml = `<div style="font-size: 10px; color: var(--primary); margin-top: 4px; cursor: pointer;" onclick="event.stopPropagation(); window.AudioEngine.playTrack('${window.escapeJsArg(node.track.title)}', '${node.track.hash}', '${node.track.creator}', '${window.escapeJsArg(trackArtist)}')">🎧 ${window.escapeHtml(node.track.title)}<br><span style="color:var(--text-muted)">by ${window.escapeHtml(trackArtist)}</span></div>`;
                    } else if (node.activity) {
                        activityHtml = `<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">🎧 ${window.escapeHtml(node.activity)}</div>`;
                    }
                    return `<div class="user-row" onclick="window.inspectTargetNode('${node.address}')">
                        <div class="user-info">
                            <img src="${window.getAvatarUrl(node.address)}" class="${isMe ? 'nft-avatar' : ''}">
                            <div style="display: flex; flex-direction: column;"><span style="font-size: 14px; font-weight: bold; color: ${color};">${displayName}</span>${activityHtml}</div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            ${!isMe ? `<span style="font-size: 14px; cursor: pointer;" onclick="event.stopPropagation(); window.sendDM('${node.address}')" title="Direct Message">✉️</span>` : ''}
                            <div class="status-dot" style="background: ${dotColor}; box-shadow: 0 0 5px ${dotColor};"></div>
                        </div>
                    </div>`;
                }).join('');
            }
            if(typeof window.renderNewUsers === 'function') window.renderNewUsers();
        });

        socket.on('zine_update', (articles) => {
            window.zineArticles = articles;
            if(window.renderZine) window.renderZine();
        });

        socket.on('article_purchased', (data) => {
            alert("Curation Rights Acquired! Article added to your collection.");
            if(window.CoreEngine.userKeys.publicKey) window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);
        });
    },

    broadcastToMesh(type, payload) {
        const dataStr = JSON.stringify({ type, payload });
        Object.values(window.dataChannels || {}).forEach(dc => {
            if (dc.readyState === 'open') dc.send(dataStr);
        });
    }
};