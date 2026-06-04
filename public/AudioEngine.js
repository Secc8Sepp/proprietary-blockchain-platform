window.AudioEngine = {
    activeTrackHash: '',
    activeTrackArtist: '',
    listenTrackingInterval: null,
    playedTracks: new Set(), // For 'play next' logic
    playedTracksForTx: new Set(), // For '1 play = 1 tx' logic
    currentPlaylistMode: 'global', // 'global', 'profile', 'queue'
    currentQueue: [],
    currentQueueIndex: -1,
    lastClientPing: 0,
    isPreviewMode: false,
    socket: null,
    audioCtx: null,
    mediaSource: null,
    limiter: null,

    init(socket) {
        this.socket = socket;
        this.initializeAudioPlayerEngine();
    },

    changePlaylistContext(mode) {
        this.currentPlaylistMode = mode;
        console.log(`[PLAYER] Playlist context changed to: ${mode}`);
    },

    playQueue(tracks, startIndex = 0) {
        if (!tracks || tracks.length === 0) return;
        this.currentQueue = tracks;
        this.currentQueueIndex = startIndex;
        this.changePlaylistContext('queue');

        const trackToPlay = this.currentQueue[this.currentQueueIndex];
        if (trackToPlay) {
        // Handle both full feed items (with .data) and simplified track objects (without .data)
        const isFeedItem = !!trackToPlay.data; 
        const title = isFeedItem ? trackToPlay.data.trackTitle : trackToPlay.title;
        const audioHash = isFeedItem ? trackToPlay.data.audioHash : trackToPlay.hash;
        const sender = isFeedItem ? trackToPlay.sender : (trackToPlay.creator || window.viewingUserPublicKey);
        let artistName = (isFeedItem ? trackToPlay.data.artist : trackToPlay.artist) || window.resolveProfile(sender).username;
        const offCollab = isFeedItem ? trackToPlay.data.offPlatformCollaborator : trackToPlay.offPlatformCollaborator;
        if (offCollab) artistName += ` ft. ${offCollab}`;
        const coverHash = isFeedItem ? trackToPlay.data.coverHash : trackToPlay.coverHash;

        if (!title || !audioHash || !sender) {
            console.error("Could not play track from queue, missing critical data:", trackToPlay);
            return;
        }

        this.playTrack(title, audioHash, sender, artistName, coverHash);
        }
    },

    initializeAudioPlayerEngine() {
        const player = document.getElementById('global-audio-player');
        const volSlider = document.getElementById('volume-slider');
        const muteBtn = document.getElementById('btn-mute');
        if(!player) return;

        if (volSlider) {
            const savedVol = localStorage.getItem('vod_volume');
            if (savedVol !== null) { 
                player.volume = savedVol; volSlider.value = savedVol; 
            } else {
                player.volume = 0.7; volSlider.value = 0.7; // Tame default volume
            }
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

        player.addEventListener('timeupdate', () => {
            document.dispatchEvent(new CustomEvent('vod-global-timeupdate', { detail: { 
                audioHash: this.activeTrackHash,
                currentTime: player.currentTime,
                duration: player.duration
            }}));
        });

        player.addEventListener('play', () => {
            // Broadcast that the global player is playing this track
            document.dispatchEvent(new CustomEvent('vod-global-play', { detail: { audioHash: this.activeTrackHash } }));

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
        
        player.addEventListener('pause', () => {
            this.stopPlaybackTrackingLoop(false);
            // Broadcast that the global player has paused
            document.dispatchEvent(new CustomEvent('vod-global-pause', { detail: { audioHash: this.activeTrackHash } }));
        });
        player.addEventListener('ended', () => {
            this.stopPlaybackTrackingLoop(true);
            // Broadcast that the track ended (which is a form of pause for the UI)
            document.dispatchEvent(new CustomEvent('vod-global-ended', { detail: { audioHash: this.activeTrackHash } }));

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
                indicator.innerHTML = `💎 Mining reward received!`; indicator.style.color = 'var(--success)';
            }
            // After receiving a reward, silently refresh the user's profile to update their balance display.
            if (window.CoreEngine && window.CoreEngine.userKeys.publicKey && typeof window.fetchUserProfile === 'function') {
                window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);
            }
        });
    },

    stopPlaybackTrackingLoop(resetCounter) {
        if (this.listenTrackingInterval) { clearInterval(this.listenTrackingInterval); this.listenTrackingInterval = null; }
        let indicator = document.getElementById('l2e-status-tracker');
        if(indicator) { indicator.innerHTML = `⏸️ Mining paused.`; indicator.style.color = 'var(--text-muted)'; }
        if (window.CoreEngine) window.CoreEngine.setPresence(undefined, null, null);
    },

    setupWebAudio(player) {
        if (this.audioCtx) {
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
            return;
        }
        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            
            // Allow CORS audio processing if tracks are hosted externally
            player.crossOrigin = "anonymous";
            
            this.mediaSource = this.audioCtx.createMediaElementSource(player);
            
            // Dynamics Compressor to act as a Brickwall Limiter for hot tracks
            this.limiter = this.audioCtx.createDynamicsCompressor();
            this.limiter.threshold.value = -3.0; // Clamp peaks slightly below 0dBFS
            this.limiter.knee.value = 0.0;
            this.limiter.ratio.value = 20.0; // Aggressive limiting to squash clipping
            this.limiter.attack.value = 0.002;
            this.limiter.release.value = 0.100;
            
            // Final safety gain reduction
            const outGain = this.audioCtx.createGain();
            outGain.gain.value = 0.9;
            
            this.mediaSource.connect(this.limiter);
            this.limiter.connect(outGain);
            outGain.connect(this.audioCtx.destination);
            
            console.log("[AUDIO ENGINE] Web Audio Limiter initialized to tame hot uploads.");
        } catch (err) {
            console.warn("[AUDIO ENGINE] Web Audio routing failed:", err);
        }
    },

    async triggerProofOfListenMint(trackHash, trackArtist) {
        if (!trackHash || !trackArtist) return;
        try {
            await window.CoreEngine.sendSignedTransaction('STREAM_COMPLETED', trackArtist, { audioHash: trackHash });
            if (typeof window.fetchUserProfile === 'function') window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);
        } catch(err) { console.error("Mining rejected:", err); }
    },

    playTrack(title, audioHash, artistPublicKey, artistName, coverHash, isPreview = false) {
        const player = document.getElementById('global-audio-player');
        
        // Initialize Web Audio Limiter on first user interaction
        this.setupWebAudio(player);

        // If this track is already the active one, just toggle play/pause.
        if (this.activeTrackHash === audioHash && player.src.includes(audioHash)) {
            if (player.paused) {
                player.play();
            } else {
                player.pause();
            }
            return; // Done.
        }

        // Send a "play" transaction only once per track per session to avoid spam.
        if (!this.playedTracksForTx.has(audioHash) && !isPreview) {
            this.triggerProofOfListenMint(audioHash, artistPublicKey);
            this.playedTracksForTx.add(audioHash);
        }

        this.stopPlaybackTrackingLoop(true);
        this.activeTrackHash = audioHash; 
        this.activeTrackArtist = artistPublicKey;
        this.playedTracks.add(audioHash);
        this.isPreviewMode = isPreview;
        
        if (window.CoreEngine) window.CoreEngine.setPresence(undefined, 'Listening to Track', { title, hash: audioHash, creator: artistPublicKey, artistName });

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
        const artworkUrl = coverHash ? `/tracks/${coverHash}` : getAvatarUrl(artistPublicKey);
        if (artEl) artEl.src = artworkUrl;
        
        if(document.getElementById('input-market-hash')) document.getElementById('input-market-hash').value = audioHash;
        if(document.getElementById('input-market-seller')) document.getElementById('input-market-seller').value = artistPublicKey;

        // NEW: Media Session API Integration for background playback control
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: title,
                artist: artistName,
                album: 'VOD Social',
                artwork: [
                    { src: artworkUrl, sizes: '96x96', type: 'image/png' },
                    { src: artworkUrl, sizes: '128x128', type: 'image/png' },
                    { src: artworkUrl, sizes: '192x192', type: 'image/png' },
                    { src: artworkUrl, sizes: '256x256', type: 'image/png' },
                    { src: artworkUrl, sizes: '384x384', type: 'image/png' },
                    { src: artworkUrl, sizes: '512x512', type: 'image/png' },
                ]
            });

            navigator.mediaSession.setActionHandler('play', () => player.play());
            navigator.mediaSession.setActionHandler('pause', () => player.pause());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.playNextTrackAdvanced());
            // We don't have a 'previous track' function yet, so we won't set it.
            navigator.mediaSession.setActionHandler('previoustrack', null);
        }
    },

    playNextTrackAdvanced() {
        // Priority 1: Service the custom queue if it's active
        if (this.currentPlaylistMode === 'queue' && this.currentQueue.length > 0) {
            this.currentQueueIndex++;
            if (this.currentQueueIndex < this.currentQueue.length) {
                const nextTrack = this.currentQueue[this.currentQueueIndex];
                let artistName = nextTrack.data.artist || window.resolveProfile(nextTrack.sender).username;
                if (nextTrack.data.offPlatformCollaborator) artistName += ` ft. ${nextTrack.data.offPlatformCollaborator}`;
                this.playTrack(nextTrack.data.trackTitle, nextTrack.data.audioHash, nextTrack.sender, artistName, nextTrack.data.coverHash);
                return; // Exit here, we've played from the queue
            } else {
                // Queue finished, fall back to global discovery mode
                this.currentQueue = [];
                this.currentQueueIndex = -1;
                this.changePlaylistContext('global');
            }
        }
        let pool = [];
        if (this.currentPlaylistMode === 'profile' && window.currentViewedProfile && window.currentViewedProfile.uploadedTracks) {
            pool = window.currentViewedProfile.uploadedTracks.map(t => ({ title: t.title, artist: t.artist, offPlatformCollaborator: t.offPlatformCollaborator, audioHash: t.hash, coverHash: t.coverHash, sender: window.currentViewedProfile.publicKey, timestamp: t.timestamp }));
        }
        if (pool.length === 0 && window.feedTracks) {
            pool = window.feedTracks.map(t => ({ title: t.data.trackTitle, artist: t.data.artist, offPlatformCollaborator: t.data.offPlatformCollaborator, audioHash: t.data.audioHash, coverHash: t.data.coverHash, sender: t.sender, timestamp: t.timestamp }));
        }
        let unplayedTracks = pool.filter(t => !this.playedTracks.has(t.audioHash));
        if (unplayedTracks.length === 0) { this.playedTracks.clear(); unplayedTracks = [...pool]; }
        unplayedTracks.sort((a, b) => b.timestamp - a.timestamp);
        let poolSize = Math.max(1, Math.floor(unplayedTracks.length * 0.5));
        let nextTrack = unplayedTracks[Math.floor(Math.random() * poolSize)];
        
        if (nextTrack) {
            let artistName = nextTrack.artist || window.resolveProfile(nextTrack.sender).username;
            if (nextTrack.offPlatformCollaborator) artistName += ` ft. ${nextTrack.offPlatformCollaborator}`;
            this.playTrack(nextTrack.title, nextTrack.audioHash, nextTrack.sender, artistName, nextTrack.coverHash);
        }
    }
};