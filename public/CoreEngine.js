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

    // Native WebCrypto implementation to handle raw 32-byte hash inputs flawlessly
    async generateClientSignature(privateKeyHex, dataString) {
        try {
            const cleanHex = privateKeyHex.trim().replace(/^0x/i, '');
            const rawKeyBytes = new Uint8Array(cleanHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            
            // Format the scalar base64url string to satisfy browser constraints
            const dBase64Url = btoa(String.fromCharCode(...rawKeyBytes))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=/g, '');

            // Import raw string into a browser crypto module key object
            const tempKey = await window.crypto.subtle.importKey(
                "jwk",
                {
                    kty: "EC",
                    crv: "P-256",
                    d: dBase64Url
                },
                { name: "ECDSA", namedCurve: "P-256" },
                true,
                ["sign"]
            );

            // Export to let the browser compute the missing public key x/y spatial coordinates natively
            const fullJwk = await window.crypto.subtle.exportKey("jwk", tempKey);

            // Re-import the fully hydrated JWK mapping
            const signingKey = await window.crypto.subtle.importKey(
                "jwk",
                fullJwk,
                { name: "ECDSA", namedCurve: "P-256" },
                false,
                ["sign"]
            );

            const encoder = new TextEncoder();
            const dataBytes = encoder.encode(dataString);

            const signatureBuffer = await window.crypto.subtle.sign(
                { name: "ECDSA", hash: { name: "SHA-256" } },
                signingKey,
                dataBytes
            );

            return Array.from(new Uint8Array(signatureBuffer))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        } catch (error) {
            console.error("[CoreEngine Crypto] Local signature generation failed:", error.message);
            throw new Error("Local signature matrix processing failed: " + error.message);
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
        } catch(err) { alert("Invalid Key format. Paste the entire content