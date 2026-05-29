window.CoreEngine = {
    userKeys: { publicKey: '', privateKey: '' },
    currentPresence: { status: 'online', activity: null },
    idleTimer: null,

    setPresence(status, activity, trackDetails) {
        let changed = false;
        if (status !== undefined && this.currentPresence.status !== status) { this.currentPresence.status = status; changed = true; }
        if (activity !== undefined && this.currentPresence.activity !== activity) { this.currentPresence.activity = activity; changed = true; }
        if (trackDetails !== undefined) { this.currentPresence.track = trackDetails; changed = true; }
        else if (activity === null) { this.currentPresence.track = null; changed = true; }
        if (changed && this.userKeys.publicKey && window.socket) window.socket.emit('update_presence', this.currentPresence);
    },

    resetIdleTimer() {
        this.setPresence('online');
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.setPresence('idle'), 300000); // 5 minute idle limit
    },

    async handleSignup() {
        try {
            const username = document.getElementById('input-signup-username').value.trim();
            const avatarFile = document.getElementById('input-signup-avatar').files[0];

            if (!username || !avatarFile) return alert("A username and profile picture are required to mint an identity.");

            const btn = document.getElementById('btn-signup');
            btn.innerText = "Uploading Avatar...";
            btn.disabled = true;
            
            const avatarHash = await window.uploadMediaAssetFile(avatarFile);
            if (!avatarHash) throw new Error("Avatar upload failed. Please try again.");

            btn.innerText = "Generating Keys...";
            const res = await fetch('/api/auth/keygen', { method: 'POST' });
            if (!res.ok) throw new Error("Server rejected keygen request.");
            
            this.userKeys = await res.json(); 
            
            // The profile is now created *after* the user confirms they saved their key.
            const onKeySavedCallback = async () => {
                const modalSubmitBtn = document.getElementById('form-modal-submit');
                try {
                    if (modalSubmitBtn) {
                        modalSubmitBtn.innerText = 'RECORDING TO LEDGER...';
                        modalSubmitBtn.disabled = true;
                    }

                    await this.sendSignedTransaction('PROFILE_UPDATE', this.userKeys.publicKey, { username: username, bio: "Active on the Vibe or Die Network.", avatarHash: avatarHash });
                    
                    if (window.toggleModal) window.toggleModal('form-modal');
                    this.unlockApplication(this.userKeys.publicKey);

                } catch (e) {
                    alert('Failed to record profile to ledger: ' + e.message);
                    if (modalSubmitBtn) {
                        modalSubmitBtn.innerText = 'I Have Saved My Key. Continue →';
                        modalSubmitBtn.disabled = false;
                    }
                }
            };

            if (typeof window.showKeyModal === 'function') {
                // Reset button before showing modal, in case user closes it by clicking the overlay.
                btn.innerText = "Mint & Download Identity";
                btn.disabled = false;
                window.showKeyModal(this.userKeys, onKeySavedCallback);
            } else {
                this.promptKeyDownload(this.userKeys);
                // If modal function isn't present, we must still create the profile and unlock.
                await this.sendSignedTransaction('PROFILE_UPDATE', this.userKeys.publicKey, { username: username, bio: "Active on the Vibe or Die Network.", avatarHash: avatarHash });
                this.unlockApplication(this.userKeys.publicKey);
            }
        } catch (err) { 
            console.error(err); alert("Signup Error: " + err.message); 
            const btn = document.getElementById('btn-signup');
            if (btn) { btn.innerText = "Mint & Download Identity"; btn.disabled = false; }
        }
    },

    promptKeyDownload(keys) {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(keys));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "vod_private_key.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        alert("CRITICAL: Your VOD Credentials have been downloaded. Keep this file safe.");
    },

    handleLogin() {
        const keyStr = document.getElementById('input-login-key').value.trim();
        if (!keyStr) return alert("Please paste your key JSON string.");
        try {
            const parsed = JSON.parse(keyStr);
            if (parsed.publicKey && parsed.privateKey) {
                this.userKeys = parsed;
                this.unlockApplication(this.userKeys.publicKey);
            } else throw new Error("Invalid format.");
        } catch(err) { alert("Invalid Key format. Paste the entire content of your vod_private_key.json."); }
    },

    unlockApplication(publicKey) {
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        
        const avatar = document.getElementById('composer-avatar');
        if(avatar) avatar.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(publicKey)}&backgroundColor=0b0c10`;
        
        const shortKey = publicKey.length > 20 ? publicKey.substring(0, 10) + "..." + publicKey.slice(-5) : publicKey;
        const pubKeyDisplay = document.getElementById('ui-user-address');
        if(pubKeyDisplay) pubKeyDisplay.innerText = shortKey;
        
        if (window.socket) window.socket.emit('register_node', { address: publicKey });

        if (typeof window.loadMainGlobalFeed === 'function') window.loadMainGlobalFeed();
        if (typeof window.fetchUserProfile === 'function') window.fetchUserProfile(publicKey, true); 
        if (typeof window.subscribeToPush === 'function') window.subscribeToPush(publicKey);
        if (typeof window.syncFullChain === 'function') window.syncFullChain();
    },

    async sendSignedTransaction(type, receiver, data) {
        const msgData = { sender: this.userKeys.publicKey, receiver: receiver || '0x00', type, data, timestamp: Date.now() };
        const sig = await window.generateClientSignature(this.userKeys.privateKey, msgData);
        const txFields = { ...msgData, signature: sig };
        const endpoint = ['PROFILE_UPDATE', 'THEME_UPDATE', 'SET_TOP_8', 'FOLLOW_USER', 'ADMIN_DELETE_USER'].includes(type) ? '/api/social/action' : '/api/feed/interact';
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (!res.ok) throw new Error((await res.json()).error);
        
        if (window.MeshEngine && typeof window.MeshEngine.broadcastToMesh === 'function') {
            window.MeshEngine.broadcastToMesh('P2P_BLOCK', txFields);
        }
        return res;
    }
};