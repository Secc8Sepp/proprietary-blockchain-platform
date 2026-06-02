window.CoreEngine = {
    userKeys: { publicKey: '', privateKey: '' },
    currentPresence: { status: 'online', activity: null },
    idleTimer: null,

    async parseResponseJsonOrText(response) {
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (err) {
            return { error: text.trim() || `Server responded with status ${response.status}` };
        }
    },

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
            const referrerInput = document.getElementById('input-signup-referrer');
            const avatarInput = document.getElementById('input-signup-avatar');

            if (!usernameInput || !passwordInput || !confirmPasswordInput) {
                return alert("Signup form is not properly initialized.");
            }

            const avatarFile = avatarInput ? avatarInput.files[0] : null;
            const username = usernameInput.value.trim();
            const password = passwordInput.value;
            const confirmPassword = confirmPasswordInput.value;
            const referrerUsername = referrerInput ? referrerInput.value.trim() : '';
            if (!username || !password || !avatarFile) return alert("Username, password, and a profile picture are required.");
            if (password !== confirmPassword) return alert("Passwords do not match.");
            if (password.length < 8) return alert("Password must be at least 8 characters long.");
            
            let referrerPublicKey = null;
            if (referrerUsername) {
                if (!window.networkProfiles) return alert("Network is still syncing, please wait a moment.");
                const profileEntry = Object.entries(window.networkProfiles).find(([addr, prof]) => prof.username.toLowerCase() === referrerUsername.toLowerCase());
                if (profileEntry) {
                    referrerPublicKey = profileEntry[0];
                } else {
                    return alert("Referral username not found. Check the spelling or leave it blank.");
                }
            }

            const btn = document.getElementById('btn-signup');
            if (btn) {
                btn.innerText = "Uploading Avatar...";
                btn.disabled = true;
            }

            const avatarHash = await uploadMediaAssetFile(avatarFile);
            if (!avatarHash) throw new Error("Avatar upload failed. Please try again.");
            
            if (btn) {
                btn.innerText = "Creating Account...";
            }
            const res = await fetch('/api/auth/register', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const contentType = res.headers.get("content-type");
            if (!res.ok) {
                if (contentType && contentType.includes("application/json")) {
                    const errBody = await res.json();
                    throw new Error(errBody.error || `Server responded with status ${res.status}`);
                } else {
                    throw new Error(`Server Error (${res.status}): Registration endpoint failed or is missing.`);
                }
            }

            if (contentType && contentType.includes("application/json")) {
                this.userKeys = await res.json();
            } else {
                throw new Error("Invalid server response. Expected JSON but received HTML/Text.");
            }
            
            // Immediately record the profile to ledger and unlock application
            const profileData = { username: username, bio: "Active on the Vibe or Die Network.", avatarHash: avatarHash };
            if (referrerPublicKey) {
                profileData.referrer = referrerPublicKey;
            }

            await this.sendSignedTransaction('PROFILE_UPDATE', this.userKeys.publicKey, profileData);
            this.unlockApplication(this.userKeys.publicKey);
        } catch (err) { 
            console.error(err); alert("Signup Error: " + err.message); 
            const btn = document.getElementById('btn-signup');
            if (btn) { btn.innerText = "Create Account"; btn.disabled = false; }
        }
    },

    async handlePasswordLogin() {
        const usernameInput = document.getElementById('input-login-username');
        const passwordInput = document.getElementById('input-login-password');

        if (!usernameInput || !passwordInput) return alert("Login form not found.");

        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password) return alert("Please enter your username and password.");

        try {
            const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            const contentType = res.headers.get("content-type");
            
            if (!res.ok) {
                if (contentType && contentType.includes("application/json")) {
                    const errBody = await res.json();
                    throw new Error(errBody.error || "Login failed.");
                } else {
                    throw new Error(`Server Error (${res.status}): Login endpoint failed or is missing.`);
                }
            }
            
            if (contentType && contentType.includes("application/json")) {
                this.userKeys = await res.json();
            } else {
                throw new Error("Invalid server response. Expected JSON but received HTML/Text.");
            }
            this.unlockApplication(this.userKeys.publicKey);
        } catch (err) { alert("Login failed: " + err.message); }
    },
    handleKeyLogin() {
        const keyInput = document.getElementById('input-login-key');
        if (!keyInput) return alert("Login key input not found.");
        const keyStr = keyInput.value.trim();
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
        if (typeof window.loadCloutStatus === 'function') window.loadCloutStatus();

        if (typeof window.fetchUserProfile === 'function') window.fetchUserProfile(publicKey, false);
        if (typeof window.loadMainGlobalFeed === 'function' && window.currentView === 'feed') window.loadMainGlobalFeed();
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