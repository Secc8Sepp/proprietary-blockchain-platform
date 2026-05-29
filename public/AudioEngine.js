window.AudioEngine = {
    activeTrackHash: '',
    activeTrackArtist: '',
    listenTrackingInterval: null,
    playedTracks: new Set(),
    currentPlaylistMode: 'global',
    lastClientPing: 0,
    isPreviewMode: false,
    socket: null,

    init(socket) {
        this.socket = socket;
        this.initializeAudioPlayerEngine();
    },

    changePlaylistContext(mode) {
        this.currentPlaylistMode = mode;
        console.log(`[PLAYER] Playlist context changed to: ${mode}`);
    },

    initializeAudioPlayerEngine() {
        const player = document.getElementById('global-audio-player');
        const volSlider = document.getElementById('volume-slider');
        const muteBtn = document.getElementById('btn-mute');
        if(!player) return;

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
            if (!this.activeTrackHash || !window.CoreEngine.userKeys.publicKey) return;
            if (this.listenTrackingInterval) clearInterval(this.listenTrackingInterval);
            
            const now = Date.now();
            if (now - this.lastClientPing > 5000) {
                this.socket.emit('l2e_ping', { address: window.CoreEngine.userKeys.publicKey, trackHash: this.activeTrackHash });
                this.lastClientPing = now;
            }

            this.listenTrackingInterval = setInterval(() => {
                if (!player.paused && !player.muted) {
                    this.socket.emit('l2e_ping', { address: window.CoreEngine.userKeys.publicKey, trackHash: this.activeTrackHash });
                    this.lastClientPing = Date.now();
                }
            }, 5000);
        });
        
        player.addEventListener('pause', () => this.stopPlaybackTrackingLoop(false));
        player.addEventListener('ended', () => {
            this.stopPlaybackTrackingLoop(true);
            if (this.isPreviewMode) {
                this.isPreviewMode = false; // It ended before 30s, reset.
                return; // Don't play next track in preview mode.
            }
            this.playNextTrackAdvanced();
        });

        this.socket.on('l2e_status', (data) => {
            let indicator = document.getElementById('l2e-status-tracker');
            if (indicator) {
                if (data.error) {
                    indicator.innerHTML = `⚠️ ${data.error}`; indicator.style.color = 'var(--danger)';
                } else {
                    indicator.innerHTML = `🎧 Mining $VOD... (${data.pings}/${data.max})`; indicator.style.color = 'var(--primary)';
                }
            }
        });

        this.socket.on('l2e_reward', (data) => {
            let indicator = document.getElementById('l2e-status-tracker');
            if (indicator) {
                indicator.innerHTML = `💎 Proof-of-Listen Minted!`; indicator.style.color = 'var(--success)';
                this.triggerProofOfListenMint();
            }
        });
    },

    stopPlaybackTrackingLoop(resetCounter) {
        if (this.listenTrackingInterval) { clearInterval(this.listenTrackingInterval); this.listenTrackingInterval = null; }
        let indicator = document.getElementById('l2e-status-tracker');
        if(indicator) { indicator.innerHTML = `⏸️ Mining paused.`; indicator.style.color = 'var(--text-muted)'; }
        if (window.CoreEngine) window.CoreEngine.setPresence(undefined, null, null);
    },


    async triggerProofOfListenMint() {
        try {
            await window.CoreEngine.sendSignedTransaction('STREAM_COMPLETED', this.activeTrackArtist, { audioHash: this.activeTrackHash });
            if (typeof window.fetchUserProfile === 'function') window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);
        } catch(err) { console.error("Mining rejected:", err); }
    },

    playTrack(title, audioHash, artistPublicKey, artistName, isPreview = false) {
        this.stopPlaybackTrackingLoop(true);
        this.activeTrackHash = audioHash; 
        this.activeTrackArtist = artistPublicKey;
        this.playedTracks.add(audioHash);
        this.isPreviewMode = isPreview;
        
        if (window.CoreEngine) window.CoreEngine.setPresence(undefined, 'Listening to Track', { title, hash: audioHash, creator: artistPublicKey, artistName });

        const player = document.getElementById('global-audio-player');
        player.src = `/tracks/${encodeURIComponent(audioHash)}`;
        player.play().catch(error => { console.error("Playback error:", error); alert("Streaming Error: Track not found on network."); });
        
        const titleEl = document.getElementById('global-track-title');
        if (titleEl) titleEl.innerText = title;
        
        const artistLink = document.getElementById('global-track-artist-link');
        if (artistLink) {
            artistLink.innerText = artistName ? artistName : window.resolveProfile(artistPublicKey).username;
            artistLink.onclick = () => window.inspectTargetNode(artistPublicKey);
        }

        const artEl = document.getElementById('global-track-art');
        if (artEl) artEl.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(artistPublicKey)}&backgroundColor=1f2833`;
        
        if(document.getElementById('input-market-hash')) document.getElementById('input-market-hash').value = audioHash;
        if(document.getElementById('input-market-seller')) document.getElementById('input-market-seller').value = artistPublicKey;
    },

    playNextTrackAdvanced() {
        let pool = [];
        if (this.currentPlaylistMode === 'profile' && window.currentViewedProfile && window.currentViewedProfile.uploadedTracks) {
            pool = window.currentViewedProfile.uploadedTracks.map(t => ({ title: t.title, artist: t.artist, offPlatformCollaborator: t.offPlatformCollaborator, audioHash: t.hash, sender: window.currentViewedProfile.publicKey, timestamp: t.timestamp }));
        }
        if (pool.length === 0 && window.feedTracks) {
            pool = window.feedTracks.map(t => ({ title: t.data.trackTitle, artist: t.data.artist, offPlatformCollaborator: t.data.offPlatformCollaborator, audioHash: t.data.audioHash, sender: t.sender, timestamp: t.timestamp }));
        }
        let unplayedTracks = pool.filter(t => !this.playedTracks.has(t.audioHash));
        if (unplayedTracks.length === 0) { this.playedTracks.clear(); unplayedTracks = [...pool]; }
        unplayedTracks.sort((a, b) => b.timestamp - a.timestamp);
        let poolSize = Math.max(1, Math.floor(unplayedTracks.length * 0.5));
        let nextTrack = unplayedTracks[Math.floor(Math.random() * poolSize)];
        
        if (nextTrack) {
            let artistName = nextTrack.artist || window.resolveProfile(nextTrack.sender).username;
            if (nextTrack.offPlatformCollaborator) artistName += ` ft. ${nextTrack.offPlatformCollaborator}`;
            this.playTrack(nextTrack.title, nextTrack.audioHash, nextTrack.sender, artistName);
        }
    }
};