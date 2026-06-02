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

    async generateClientSignature(privateKeyHex, dataString) {
        try {
            if (window.elliptic) {
                const ec = new window.elliptic.ec('secp256k1');
                let cleanHex = privateKeyHex.trim().replace(/^0x/i, '');
                
                // Extract 32-byte raw private key from DER encoding if present
                if (cleanHex.length > 64) {
                    const match = cleanHex.match(/0420([a-fA-F0-9]{64})/);
                    if (match) {
                        cleanHex = match[1];
                    } else if (cleanHex.startsWith('30740201010420')) {
                        cleanHex = cleanHex.substring(14, 14 + 64);
                    }
                }
                const key = ec.keyFromPrivate(cleanHex, 'hex');
                
                const encoder = new TextEncoder();
                const dataBytes = encoder.encode(dataString);
                const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBytes);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                
                const signature = key.sign(hashArray);
                
                const rHex = signature.r.toString(16).padStart(64, '0');
                const sHex = signature.s.toString(16).padStart(64, '0');
                return rHex + sHex;
            }
            throw new Error("Elliptic library not found, falling back to gateway...");
        } catch (error) {
            console.warn("[CoreEngine Crypto] Local signature fallback:", error.message);
            const res = await fetch('/api/auth/sign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ privateKeyHex, dataString })
            });
            
            const contentType = res.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const body = await res.json();
                if (body.signature) return body.signature;
                throw new Error(body.error || "Server signature synchronization failed.");
            } else {
                throw new Error("Server returned HTML instead of JSON for signature endpoint.");
            }
        }
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
            const res = await fetch('/api/auth/signup', { 
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

        const msgData = {
            sender: this.userKeys.publicKey,
            receiver: receiver || '0x00',
            type,
            data,
            timestamp: Date.now()
        };

        const sig = await this.generateClientSignature(this.userKeys.privateKey, JSON.stringify(msgData));
        const txFields = { ...msgData, signature: sig };
        
        const socialActions = ['PROFILE_UPDATE', 'THEME_UPDATE', 'SET_TOP_8', 'FOLLOW_USER', 'CREATE_PLAYLIST', 'ADD_TO_PLAYLIST', 'UPDATE_PLAYLIST_DETAILS', 'DELETE_PLAYLIST', 'REORDER_PLAYLIST_TRACKS', 'REPOST_POST', 'DELETE_POST', 'LIKE_SONG', 'UNLIKE_SONG'];
        const endpoint = socialActions.includes(type)
            ? '/api/social/action'
            : '/api/feed/interact';

        console.log(`[CoreEngine] Sending ${type} to ${endpoint}`, txFields);
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txFields) });
        if (!res.ok) {
            const contentType = res.headers.get("content-type");
            if (contentType && contentType.includes("text/html")) {
                throw new Error(`Server Error (${res.status}): Endpoint might be missing or broken.`);
            }

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

window.generateClientSignature = window.CoreEngine.generateClientSignature.bind(window.CoreEngine);