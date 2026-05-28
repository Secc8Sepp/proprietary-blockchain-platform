window.ActionEngine = {
    init(socket) {
        this.socket = socket;
        console.log('[INIT] Action Engine ready.');
    },

    async handlePublishPost(isStory = false) {
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
                const forStake = document.getElementById('image-stake-checkbox') ? document.getElementById('image-stake-checkbox').checked : false;
                let sellPercentage = 0; let pricePerShare = 0; let totalShares = 100;
                if (forStake) {
                    sellPercentage = parseInt(document.getElementById('image-stake-percent').value) || 0;
                    pricePerShare = parseFloat(document.getElementById('image-stake-price').value) || 0;
                    totalShares = parseInt(document.getElementById('image-total-shares').value) || 100;
                }
                type = 'IMAGE_POST';
                data = { caption: textIn, imageHash: hash, forStake, sellPercentage, pricePerShare, totalShares };
            } else if (vidFile) {
                const hash = await uploadMediaAssetFile(vidFile);
                const forStake = document.getElementById('video-stake-checkbox') ? document.getElementById('video-stake-checkbox').checked : false;
                let sellPercentage = 0; let pricePerShare = 0; let totalShares = 100;
                if (forStake) {
                    sellPercentage = parseInt(document.getElementById('video-stake-percent').value) || 0;
                    pricePerShare = parseFloat(document.getElementById('video-stake-price').value) || 0;
                    totalShares = parseInt(document.getElementById('video-total-shares').value) || 100;
                }
                type = 'VIDEO_POST';
                data = { caption: textIn, videoHash: hash, fileSize: vidFile.size, forStake, sellPercentage, pricePerShare, totalShares };
            } else if (zipFile) {
                const hash = await uploadMediaAssetFile(zipFile);
                const forStake = document.getElementById('file-stake-checkbox') ? document.getElementById('file-stake-checkbox').checked : false;
                let sellPercentage = 0; let pricePerShare = 0; let totalShares = 100;
                if (forStake) {
                    sellPercentage = parseInt(document.getElementById('file-stake-percent').value) || 0;
                    pricePerShare = parseFloat(document.getElementById('file-stake-price').value) || 0;
                    totalShares = parseInt(document.getElementById('file-total-shares').value) || 100;
                }
                type = 'PROJECT_FILE_POST';
                data = { caption: textIn, fileHash: hash, filename: zipFile.name, forStake, sellPercentage, pricePerShare, totalShares };
            } else {
                if (textIn.length > 200) {
                    if (confirm("This is a long post! Would you like to publish it as a Zine Article instead?")) {
                        this.promptPublishZineArticle(textIn);
                        btn.innerText = isStory ? "Deploy Story" : "Broadcast Block";
                        btn.disabled = false;
                        return; // Stop further processing as a regular post
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
    },

    addCollaboratorField() {
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
    },

    promptPublishZineArticle(bodyText) {
        const modalTitle = document.getElementById('form-modal-title');
        const modalBody = document.getElementById('form-modal-body');
        
        modalTitle.innerText = 'Publish as Zine Article';
        modalBody.innerHTML = `
            <p style="font-size: 13px; color: var(--text-muted);">Your post is quite long. Publishing it as a Zine Article allows you to give it a title and set a price for others to curate and feature it.</p>
            <label>Article Title</label>
            <input id="form-input-zine-title" type="text" placeholder="Title of your masterpiece...">
            <label>Curation Price ($VOD)</label>
            <input id="form-input-zine-price" type="number" value="5000">
            <button id="form-modal-submit" style="width: 100%; margin-top: 10px;">Publish Article</button>
        `;

        const submitBtn = document.getElementById('form-modal-submit');
        submitBtn.onclick = () => {
            const title = document.getElementById('form-input-zine-title').value;
            const price = document.getElementById('form-input-zine-price').value;

            if (!title.trim()) return alert("Please enter a title for your article.");
            if (!price || isNaN(price) || price < 0) return alert("Please enter a valid, non-negative price.");

            this.socket.emit('publish_article', { title, body: bodyText, price: parseFloat(price), author: window.CoreEngine.userKeys.publicKey });
            alert("Masterpiece published to the swarm as an Article!");
            
            toggleModal('form-modal');
            document.getElementById('composer-text').value = '';
            updateComposerPreview();
            switchTab('zine');
        };

        toggleModal('form-modal');
    },

    async deletePost(txHash) {
        if (!confirm("Are you sure you want to delete this post?")) return;
        try {
            await window.CoreEngine.sendSignedTransaction('DELETE_POST', '0x00', { txHash });
            alert("Post deleted.");
            loadMainGlobalFeed();
            if (currentView === 'profile') fetchUserProfile(viewingUserPublicKey || window.CoreEngine.userKeys.publicKey, false);
        } catch (err) {
            alert("Failed to delete: " + err.message);
        }
    },

    async silentDeletePost(txHash) {
        try {
            await window.CoreEngine.sendSignedTransaction('DELETE_POST', '0x00', { txHash });
        } catch (err) {}
    },

    requestSongShare(hash, seller) {
        if (seller === window.CoreEngine.userKeys.publicKey) return alert("You already own this track's equity.");

        const modalTitle = document.getElementById('form-modal-title');
        const modalBody = document.getElementById('form-modal-body');
        
        modalTitle.innerText = 'Request Track Stake';
        modalBody.innerHTML = `
            <p style="font-size: 13px; color: var(--text-muted);">Make an offer to the creator to acquire a percentage of their track's streaming royalties.</p>
            <label>Shares to Request (%)</label>
            <input id="form-input-share-count" type="number" placeholder="e.g., 10" min="1" max="100" style="margin-bottom: 15px;">
            <label>Offer Price per Share ($VOD)</label>
            <input id="form-input-share-price" type="number" placeholder="e.g., 5000" style="margin-bottom: 15px;">
            <button id="form-modal-submit" style="width: 100%;">Send Stake Request</button>
        `;

        const submitBtn = document.getElementById('form-modal-submit');
        submitBtn.onclick = async () => {
            const count = document.getElementById('form-input-share-count').value;
            const price = document.getElementById('form-input-share-price').value;

            if (!count || isNaN(count) || count <= 0) return alert("Please enter a valid percentage to request.");
            if (!price || isNaN(price) || price <= 0) return alert("Please enter a valid price to offer.");

            try {
                await window.CoreEngine.sendSignedTransaction('REQUEST_SONG_SHARE', seller, { audioHash: hash, shareCount: parseInt(count), pricePerShare: parseFloat(price) });
                alert(`Stake Request sent to the creator for ${count}% at ${price} $VOD each!`);
                toggleModal('form-modal');
                fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
            } catch(err) { alert(err.message); }
        };

        toggleModal('form-modal');
    },

    async buySongShareDirect(hash, seller, price) {
        const count = prompt("How many available shares (percentage) do you want to buy?");
        if (!count || isNaN(count)) return;
        try {
            await window.CoreEngine.sendSignedTransaction('BUY_SONG_SHARE', seller, { audioHash: hash, shareCount: parseInt(count), pricePerShare: parseFloat(price) });
            alert(`Successfully purchased ${count}% stake!`);
            loadMainGlobalFeed();
            fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
        } catch(err) { alert(err.message); }
    },

    async respondToStakeRequest(requestId, type) {
        if (!confirm(`Are you sure you want to ${type === 'ACCEPT_SHARE_REQUEST' ? 'accept' : 'decline'} this request?`)) return;
        try {
            await window.CoreEngine.sendSignedTransaction(type, '0x00', { requestId });
            alert("Request processed successfully.");
            fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
        } catch(err) { alert(err.message); }
    },

    promptEditSong(audioHash) {
        if (!window.CoreEngine.userKeys.publicKey || !currentViewedProfile) return;

        const track = currentViewedProfile.uploadedTracks.find(t => t.hash === audioHash);
        if (!track) return alert("Track details not found.");

        const modalTitle = document.getElementById('form-modal-title');
        const modalBody = document.getElementById('form-modal-body');
        
        modalTitle.innerText = 'Edit Track Metadata';
        modalBody.innerHTML = `
            <p style="font-size: 13px; color: var(--text-muted);">Update the details for your track. This will be recorded as a new transaction on the ledger.</p>
            <label>Track Title</label>
            <input id="form-input-edit-title" type="text" value="${escapeHtml(track.title || '')}">
            <label>Artist Name</label>
            <input id="form-input-edit-artist" type="text" value="${escapeHtml(track.artist || '')}">
            <label>Off-Platform Collaborator (optional)</label>
            <input id="form-input-edit-offcollab" type="text" value="${escapeHtml(track.offPlatformCollaborator || '')}">
            <button id="form-modal-submit" style="width: 100%; margin-top: 10px;">Update Metadata</button>
        `;

        const submitBtn = document.getElementById('form-modal-submit');
        submitBtn.onclick = async () => {
            const newTitle = document.getElementById('form-input-edit-title').value;
            const newArtist = document.getElementById('form-input-edit-artist').value;
            const newOffCollab = document.getElementById('form-input-edit-offcollab').value;

            try {
                let data = { audioHash: audioHash };
                if (newTitle) data.title = newTitle;
                if (newArtist) data.artist = newArtist;
                if (newOffCollab !== undefined) data.offPlatformCollaborator = newOffCollab;
                await window.CoreEngine.sendSignedTransaction('EDIT_SONG_METADATA', '0x00', data);
                alert("Metadata updated!"); 
                toggleModal('form-modal');
                fetchUserProfile(window.CoreEngine.userKeys.publicKey, false); 
                loadMainGlobalFeed();
            } catch(err) { alert("Failed to edit: " + err.message); }
        };
        toggleModal('form-modal');
    },

    async saveInlineEdit() {
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

        // More robust CSS sanitization to prevent layout-breaking and XSS-like attacks
        const dangerousProperties = /@import|url\(|expression|behavior|position|float|clear|overflow|top|left|right|bottom|clip|visibility|z-index|transform|filter|pointer-events/gi;
        if (dangerousProperties.test(rawCSS)) {
            return alert("SECURITY WARNING: Your custom CSS contained prohibited layout-breaking properties (like position, url, @import, etc.) and was blocked.");
        }

        // Second pass for script-like content
        const dangerousContent = /<script|javascript:|onclick|onerror|onload/gi;
        if (dangerousContent.test(rawCSS)) {
            return alert("SECURITY WARNING: Your custom CSS appears to contain script-like content and was blocked.");
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
    },

    async executeTargetFollow(targetPeerPublicKey, isReply = false) {
        if(!targetPeerPublicKey) return;
        if (window.CoreEngine.userKeys.publicKey === targetPeerPublicKey) return alert("Cannot connect to your own node.");
        try {
            await window.CoreEngine.sendSignedTransaction('FOLLOW_USER', targetPeerPublicKey, {});
            
            if (!isReply && this.socket) {
                this.socket.emit('send_crew_request', { target: targetPeerPublicKey, from: window.CoreEngine.userKeys.publicKey });
            }
            
            alert("Crew connection established.");
            
            // Refresh profiles to immediately update the button UI and feed priorities
            fetchUserProfile(targetPeerPublicKey, false);
            fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);
        } catch (err) { alert(err.message); }
    },

    async createCommission() {
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
    },

    fulfillCommission(commId) {
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
                if(c) this.socket.emit('trigger_push', { target: c.buyer, payload: { title: 'Commission Fulfilled! 📦', body: `${resolveProfile(window.CoreEngine.userKeys.publicKey).username} uploaded the asset for your escrow.` } });

                fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
            } catch(err) { alert("Fulfillment failed: " + err.message); }
        };
        input.click();
    },

    async executeSellItem() {
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
    },

    async buyDigitalItem(itemId, price, seller) {
        if (seller === window.CoreEngine.userKeys.publicKey) return alert("You cannot buy your own item.");
        if (!confirm(`Purchase this asset for ${price} $VOD?`)) return;
        try {
            await window.CoreEngine.sendSignedTransaction('BUY_ITEM', seller, { itemId, price });
            alert("Purchase successful! You can now view this asset in your Wallet.");
            window.loadMarketplace();
            fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
        } catch(err) { alert("Purchase failed: " + err.message); }
    },

    createOpenBounty() {
        const modalTitle = document.getElementById('form-modal-title');
        const modalBody = document.getElementById('form-modal-body');
        
        modalTitle.innerText = 'Create Open Commission Bounty';
        modalBody.innerHTML = `
            <p style="font-size: 13px; color: var(--text-muted);">Post a public request for work. The funds will be locked in escrow until you award the bounty to a submission.</p>
            <label>Bounty Amount ($VOD)</label>
            <input id="form-input-bounty-amount" type="number" placeholder="e.g., 100000">
            <label>Bounty Description</label>
            <textarea id="form-input-bounty-desc" rows="3" placeholder="e.g., 'Need a 16-bar verse for this track...'"></textarea>
            <button id="form-modal-submit" style="width: 100%; margin-top: 10px;">Post Bounty to Ledger</button>
        `;

        const submitBtn = document.getElementById('form-modal-submit');
        submitBtn.onclick = async () => {
            const amount = document.getElementById('form-input-bounty-amount').value;
            const desc = document.getElementById('form-input-bounty-desc').value.trim();

            if (!amount || isNaN(parseFloat(amount)) || amount <= 0) return alert("Please enter a valid bounty amount.");
            if (!desc) return alert("Please provide a description for the bounty.");

            try {
                await window.CoreEngine.sendSignedTransaction('CREATE_BOUNTY', '0x00', { amount: parseFloat(amount), description: desc });
                alert("Bounty posted securely to the ledger!");
                toggleModal('form-modal');
                window.loadMarketplace();
                fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
            } catch(err) { alert("Bounty failed: " + err.message); }
        };
        toggleModal('form-modal');
    },

    submitToBounty(bountyId) {
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
    },

    async awardBounty(bountyId, winnerAddress) {
        if(!confirm(`Award this bounty to Node_${winnerAddress.substring(0,6)}? The funds will be released to their wallet permanently.`)) return;
        try {
            await window.CoreEngine.sendSignedTransaction('AWARD_BOUNTY', '0x00', { bountyId, winner: winnerAddress });
            alert("Bounty awarded successfully!");
            window.loadMarketplace();
        } catch(err) { alert("Award failed: " + err.message); }
    },

    async handleFlyerSelect(e) {
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
    },

    async handleBulletinBoardClick(e) {
        if (!eventsState.isPlacing || !eventsState.currentFile) {
            // If no file is selected, trigger the upload dialog to help users "add events"
            const input = document.getElementById('event-file-input');
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
    },

    async toggleLike(txHash, receiver) {
        const countEl = document.getElementById(`like-count-${txHash}`);
        if (countEl) {
            countEl.innerText = parseInt(countEl.innerText) + 1;
            this.socket.emit('like_post', { txHash, address: window.CoreEngine.userKeys.publicKey });
        }

        try {
            await window.CoreEngine.sendSignedTransaction('LIKE_POST', receiver || '0x00', { txHash: txHash });
        } catch (err) {
            console.error("Like block failed:", err);
        }
    },

    async submitReply(txHash, receiver, parentReplyId = null) {
        const boxId = parentReplyId ? `reply-box-${parentReplyId}` : `reply-box-${txHash}`;
        const box = document.getElementById(boxId);
        if (!box) return;
        const text = box.querySelector('textarea').value;
        if (!text.trim()) return;
        
        detectMentionsAndEmit(text);
        
        box.querySelector('textarea').value = '';
        this.socket.emit('reply_post', { txHash, address: window.CoreEngine.userKeys.publicKey, text: text.trim(), parentReplyId });

        try {
            const replyId = Date.now() + '_' + window.CoreEngine.userKeys.publicKey.substring(0, 10);
            await window.CoreEngine.sendSignedTransaction('REPLY_POST', receiver || '0x00', { txHash: txHash, text: text.trim(), parentReplyId, replyId });
        } catch (err) {
            console.error("Reply block failed:", err);
        }
    },

    async submitShout() {
        if (!window.CoreEngine.userKeys.publicKey) return alert("You must be logged in to post a shout.");
        if (!viewingUserPublicKey) return;

        const input = document.getElementById('shoutbox-input');
        const message = input.value.trim();
        if (!message) return;

        try {
            await window.CoreEngine.sendSignedTransaction('SHOUTBOX_POST', viewingUserPublicKey, { message });
            input.value = '';
            alert("Shout posted to the ledger!");
            // Refresh the profile to show the new shout
            fetchUserProfile(viewingUserPublicKey, false);
        } catch (err) {
            alert("Failed to post shout: " + err.message);
        }
    },

    acceptCrewRequest(fromAddress) {
        this.executeTargetFollow(fromAddress, true); // The 'true' prevents sending a request back
        window.pendingCrewRequests = window.pendingCrewRequests.filter(r => r.from !== fromAddress);
        window.renderCrewRequests();
    },

    declineCrewRequest(fromAddress) {
        window.pendingCrewRequests = window.pendingCrewRequests.filter(r => r.from !== fromAddress);
        window.renderCrewRequests();
    },

    async handlePublishArticle() {
        const title = document.getElementById('zine-publish-title').value.trim();
        const body = document.getElementById('zine-publish-body').value.trim();
        const price = document.getElementById('zine-publish-price').value.trim();

        if(!title || !body || !price) return alert("Title, body, and price are required to publish.");
        if(!window.CoreEngine.userKeys.publicKey) return alert("Identity required.");

        this.socket.emit('publish_article', { title, body, price: parseFloat(price), author: window.CoreEngine.userKeys.publicKey });

        document.getElementById('zine-publish-title').value = '';
        document.getElementById('zine-publish-body').value = '';
        alert("Masterpiece published to the swarm!");
        switchZineSubTab('market');
    },

    purchaseArticleRights(articleId) {
        if(!window.CoreEngine.userKeys.publicKey) return alert("Please login.");
        this.socket.emit('purchase_article_rights', articleId);
    },

    likeArticle(articleId) {
        if (!window.CoreEngine.userKeys.publicKey) return alert("Must be logged in to like.");
        this.socket.emit('like_article', articleId);
    },

    async tipArticle(articleId, author) {
        if (!window.CoreEngine.userKeys.publicKey) return alert("Must be logged in to tip.");
        if (author === window.CoreEngine.userKeys.publicKey) return alert("You cannot tip your own article.");
        const amount = prompt("How much $VOD would you like to tip the author?");
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return;
        
        try {
            await window.CoreEngine.sendSignedTransaction('TRANSFER_COIN', author, { amount: parseFloat(amount) });
            
            this.socket.emit('trigger_push', { target: author, payload: { title: 'Tip Received! 💸', body: `You received ${amount} $VOD from ${resolveProfile(window.CoreEngine.userKeys.publicKey).username} for your Zine Article!` } });

            alert(`Successfully tipped ${amount} $VOD to the author!`);
        } catch (err) { alert("Tip failed: " + err.message); }
    },

    async castHotOrNotVote(submissionId, submitter, vote, targetHash) {
        if (!window.CoreEngine || !window.CoreEngine.userKeys || !window.CoreEngine.userKeys.publicKey) return alert('Must be logged in to vote.');
        if (submitter === window.CoreEngine.userKeys.publicKey) return alert('You cannot vote on your own submission.');

        try {
            const player = document.getElementById('global-audio-player');
            const activeHash = window.AudioEngine && window.AudioEngine.activeTrackHash;
            const listened = player && ((activeHash && activeHash === targetHash && player.currentTime >= 30) || player.currentTime >= 30);
            if (!listened) return alert('You must listen to at least 30 seconds of the track before voting.');

            await window.CoreEngine.sendSignedTransaction('VOTE_HOT_OR_NOT', submitter, { submissionId, vote, targetHash });
            window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);
            window.BattleEngines.loadHotOrNot();
        } catch(err) { console.error(err); alert('Vote failed: ' + (err.message || err)); }
    },

    async submitHotOrNotFromDropdown() {
        if (!window.CoreEngine.userKeys.publicKey) return alert("Must be logged in.");
        const select = document.getElementById('hotornot-submit-select');
        const catSelect = document.getElementById('hotornot-category-select');
        let targetHash = select.value;
        const originalHash = targetHash;
        const category = catSelect ? catSelect.value : 'music';
        if (!targetHash) return alert("Please select a valid item to submit.");

        try {
            let data = { category: category, targetHash: targetHash, originalHash: originalHash };
            if (category === 'music') {
                const btn = document.querySelector('button[onclick="window.ActionEngine.submitHotOrNotFromDropdown()"]');
                const originalText = btn.innerText;
                btn.innerText = "Formatting MP3..."; btn.disabled = true;
                try {
                    const procRes = await fetch('/api/feed/process-hotornot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetHash }) });
                    if (procRes.ok) {
                        const procData = await procRes.json();
                        data.targetHash = procData.formattedHash || targetHash;
                        data.audioHash = data.targetHash;
                    }
                } catch (e) { console.error("Formatting error:", e); }
                btn.innerText = originalText; btn.disabled = false;
            }

            await window.CoreEngine.sendSignedTransaction('SUBMIT_HOT_OR_NOT', '0x00', data);
            alert("Item submitted to Hot or Not!");
            window.BattleEngines.loadHotOrNot();
        } catch(err) { alert("Submission failed: " + err.message); }
    }
};