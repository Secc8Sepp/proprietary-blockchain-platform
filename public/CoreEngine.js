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
            const usernameInput = document.getElementById('input-signup-username');
            const passwordInput = document.getElementById('input-signup-password');
            const confirmPasswordInput = document.getElementById('input-signup-password-confirm');
            const avatarFile = document.getElementById('input-signup-avatar').files[0];

            const username = usernameInput.value.trim();
            const password = passwordInput.value;
            const confirmPassword = confirmPasswordInput.value;

            if (!username || !password || !avatarFile) return alert("Username, password, and a profile picture are required.");
            if (password !== confirmPassword) return alert("Passwords do not match.");
            if (password.length < 8) return alert("Password must be at least 8 characters long.");

            const btn = document.getElementById('btn-signup');
            btn.innerText = "Uploading Avatar...";
            btn.disabled = true;
            
            const avatarHash = await window.uploadMediaAssetFile(avatarFile);
            if (!avatarHash) throw new Error("Avatar upload failed. Please try again.");

            btn.innerText = "Creating Account...";
            const res = await fetch('/api/auth/register', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            if (!res.ok) {
                const errBody = await res.json();
                throw new Error(errBody.error || `Server responded with status ${res.status}`);
            }

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
                btn.innerText = "Create Account";
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
            if (btn) { btn.innerText = "Create Account"; btn.disabled = false; }
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

    async handlePasswordLogin() {
        const usernameInput = document.getElementById('input-login-username');
        const passwordInput = document.getElementById('input-login-password');
        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password) return alert("Please enter your username and password.");

        try {
            const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            if (!res.ok) {
                const errBody = await res.json();
                throw new Error(errBody.error || "Login failed.");
            }
            this.userKeys = await res.json();
            this.unlockApplication(this.userKeys.publicKey);
        } catch (err) { alert("Login failed: " + err.message); }
    },
    handleKeyLogin() {
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

        // Unhide the global player now that user is logged in
        const playerBanner = document.getElementById('app-footer-banner');
        if (playerBanner) playerBanner.classList.remove('hidden');

        const avatar = document.getElementById('composer-avatar');
        if(avatar) avatar.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(publicKey)}&backgroundColor=0b0c10`;
        
        const shortKey = publicKey.length > 20 ? publicKey.substring(0, 10) + "..." + publicKey.slice(-5) : publicKey;
        const pubKeyDisplay = document.getElementById('ui-user-address');
        if(pubKeyDisplay) pubKeyDisplay.innerText = shortKey;
        
        if (window.socket) window.socket.emit('register_node', { address: publicKey });

        if (typeof window.subscribeToPush === 'function') window.subscribeToPush(publicKey);
        if (typeof window.syncFullChain === 'function') window.syncFullChain();
    },

    async sendSignedTransaction(type, receiver, data) {
        type = (type || '').toString().trim().toUpperCase();

        // 1. Define the exact data payload to be signed, with a fresh timestamp.
        // This object structure must match what the backend's `blockchainService.addTransaction`
        // reconstructs for verification.
        const msgData = {
            sender: this.userKeys.publicKey,
            receiver: receiver || '0x00',
            type,
            data,
            timestamp: Date.now()
        };

        // 2. Generate the signature. The backend verification process uses `JSON.stringify` on the payload,
        // so we MUST sign the stringified version of the exact same object here to ensure the hashes match.
        const sig = await window.generateClientSignature(this.userKeys.privateKey, JSON.stringify(msgData));
        const txFields = { ...msgData, signature: sig };
        
        const socialActions = ['PROFILE_UPDATE', 'THEME_UPDATE', 'SET_TOP_8', 'FOLLOW_USER', 'CREATE_PLAYLIST', 'ADD_TO_PLAYLIST', 'UPDATE_PLAYLIST_DETAILS', 'DELETE_PLAYLIST', 'REORDER_PLAYLIST_TRACKS', 'REPOST_POST', 'DELETE_POST', 'LIKE_SONG', 'UNLIKE_SONG'];
        const endpoint = socialActions.includes(type)
            ? '/api/social/action'
            : '/api/feed/interact';

        console.log(`[CoreEngine] Sending ${type} to ${endpoint}`, txFields);
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (!res.ok) {
            let body;
            try {
                body = await res.json();
            } catch (e) {
                body = { error: await res.text() };
            }
            throw new Error(body.error || `Request failed with status ${res.status}`);
        }
        
        if (window.MeshEngine && typeof window.MeshEngine.broadcastToMesh === 'function') {
            window.MeshEngine.broadcastToMesh('P2P_BLOCK', txFields);
        }
        return res;
    }
};