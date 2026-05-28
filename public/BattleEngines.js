window.MusicBattleEngine = {
    renderPlayer(trackDetails, isPreview = false) {
        const artistName = trackDetails.artist || (window.resolveProfile && window.resolveProfile(trackDetails.creator) || {}).username || 'Unknown';
        if (window.AudioEngine && typeof window.AudioEngine.playTrack === 'function') {
            window.AudioEngine.playTrack(trackDetails.title, trackDetails.audioHash, trackDetails.creator, artistName, isPreview);
        }
    }
};

window.LooksBattleEngine = {
    renderLooksGrid(item) {
        const submitterProfile = (window.resolveProfile && window.resolveProfile(item.submitter)) || {};
        const username = submitterProfile.username || item.submitter;
        const imgHtml = item.targetHash ? `<img src="/tracks/${item.targetHash}" style="max-width:100%;max-height:400px;border-radius:8px;object-fit:contain;border:1px solid var(--danger);margin-top:10px;">` : '';
        return `
            <div style="background:rgba(0,0,0,0.3);border:1px solid var(--danger);padding:15px;border-radius:8px;text-align:center;">
                <div style="font-size:18px;font-weight:bold;color:var(--primary);margin-bottom:5px;">@${username}</div>
                <div style="font-size:11px;color:var(--text-muted);">Looks Battle</div>
                ${imgHtml}
            </div>
        `;
    }
};

window.BattleEngines = {
    hotOrNotSubmitCategory: 'music',
    hotOrNotViewCategory: 'music',

    async loadHotOrNot() {
        try {
            const res = await fetch('/api/social/hotornot');
            window.hotOrNotData = await res.json();
            this.populateHotOrNotSubmitDropdown();
            this.renderHotOrNot();
        } catch(err) { console.error("HotOrNot Error:", err); }
    },

    async populateHotOrNotSubmitDropdown() {
        const select = document.getElementById('hotornot-submit-select');
        const catSelect = document.getElementById('hotornot-category-select');
        if (!select || !catSelect) return;
        if (!window.CoreEngine || !window.CoreEngine.userKeys || !window.CoreEngine.userKeys.publicKey) {
            select.innerHTML = '<option value="">Login to submit</option>';
            return;
        }

        try {
            const response = await fetch(`/api/social/profile?publicKey=${encodeURIComponent(window.CoreEngine.userKeys.publicKey)}`);
            const profile = await response.json();
            const category = this.hotOrNotSubmitCategory || 'music';

            const submittedHashes = (window.hotOrNotData || [])
                .filter(s => s.submitter === window.CoreEngine.userKeys.publicKey && (s.category || 'music') === category)
                .map(s => s.originalHash || s.targetHash);

            let options = '';
            if (category === 'music') {
                const myTracks = (profile.uploadedTracks || []).filter(t => !submittedHashes.includes(t.hash));
                if (myTracks.length === 0) options = '<option value="">No tracks left to submit</option>';
                else options = '<option value="">Select your track...</option>' + myTracks.map(t => `<option value="${t.hash}">${window.escapeHtml(t.title)}</option>`).join('');
            } else if (category === 'looks') {
                const myImages = (profile.uploadedImages || []).filter(img => !submittedHashes.includes(img.hash));
                const avatarNotSubmitted = profile.avatarHash && !submittedHashes.includes(profile.avatarHash);
                options = '<option value="">Select your image...</option>';
                if (avatarNotSubmitted) options += `<option value="${profile.avatarHash}">Current Avatar</option>`;
                if (myImages.length > 0) options += myImages.map(img => `<option value="${img.hash}">Gallery Image (${new Date(img.timestamp).toLocaleDateString()})</option>`).join('');
                if (!avatarNotSubmitted && myImages.length === 0) options = '<option value="">No images left to submit</option>';
            }

            select.innerHTML = options;
        } catch (e) {
            select.innerHTML = '<option value="">Error loading items</option>';
        }
    },

    _renderHotOrNotItem(item, isVoteMode) {
        let voteHtml = '';
        if (isVoteMode) {
            voteHtml = `
                <div style="display: flex; gap: 15px; margin-top: 15px;">
                    <button id="hot-btn-${item.id}" style="flex:1; background: var(--danger); color: #fff;" onclick="window.BattleEngines.castHotOrNotVote('${item.id}', '${item.submitter}', 1, '${item.targetHash}')">🔥 HOT</button>
                    <button id="not-btn-${item.id}" class="secondary" style="flex:1; border-color: var(--danger); color: var(--danger);" onclick="window.BattleEngines.castHotOrNotVote('${item.id}', '${item.submitter}', -1, '${item.targetHash}')">🧊 NOT</button>
                </div>
            `;
        } else {
            voteHtml = `<div style="font-size:12px; color:var(--text-muted); margin-top: 10px;">🔥 ${item.upvotes} Hot | 🧊 ${item.downvotes} Not</div>`;
        }

        if ((item.category || 'music') === 'music') {
            const displayArtist = item.trackDetails && item.trackDetails.artist ? window.escapeHtml(item.trackDetails.artist) : ((window.resolveProfile && window.resolveProfile(item.submitter) || {}).username || item.submitter);
            const title = item.trackDetails ? item.trackDetails.title : "Unknown Track";
            const coverHtml = (item.trackDetails && item.trackDetails.coverHash)
                ? `<img src="/tracks/${item.trackDetails.coverHash}" style="width:80px;height:80px;border-radius:6px;object-fit:cover;">`
                : `<img src="${(window.getAvatarUrl && window.getAvatarUrl(item.submitter)) || '#'}" style="width:80px;height:80px;border-radius:6px;object-fit:cover;">`;

            return `
                <div style="background:rgba(0,0,0,0.3);border:1px solid var(--danger);padding:15px;border-radius:8px;margin-bottom:15px;">
                    <div style="display:flex;gap:15px;">
                        ${coverHtml}
                        <div style="flex:1;">
                            <div style="font-size:18px;font-weight:bold;color:#fff; cursor:pointer;" onclick="window.BattleEngines.openAssetInMarket('${item.targetHash}')">${window.escapeHtml(title)}</div>
                            <div style="font-size:12px;color:var(--primary);margin-bottom:5px;"><a style=\"color:var(--primary);cursor:pointer;\" onclick=\"window.inspectTargetNode('${item.submitter}')\">By ${displayArtist}</a></div>
                            <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">Submitted by @${(window.resolveProfile && window.resolveProfile(item.submitter) || {}).username || item.submitter}</div>
                            <button style="padding:5px 15px;font-size:12px;background:var(--danger);color:#fff;" onclick="window.MusicBattleEngine.renderPlayer({ title: '${window.escapeJsArg ? window.escapeJsArg(title) : title}', audioHash: '${item.targetHash}', creator: '${item.submitter}', artist: '${window.escapeJsArg ? window.escapeJsArg(displayArtist) : displayArtist}' }, true)">▶ Play Track</button>
                        </div>
                    </div>
                    ${voteHtml}
                </div>
            `;
        } else {
            return `<div style="margin-bottom: 15px;">${window.LooksBattleEngine.renderLooksGrid(item)}${voteHtml}</div>`;
        }
    },

    renderHotOrNot() {
        const container = document.getElementById('ui-hotornot-content');
        if (!container) return;

        // This filter is for the leaderboard section
        const filterEl = document.getElementById('hotornot-filter');
        const leaderboardFilter = (filterEl && filterEl.value) || 'new';

        // This category is now set by the main dropdown at the top of the page
        const categoryFilter = this.hotOrNotViewCategory || 'music';

        const allItemsInCategory = [...(window.hotOrNotData || [])].filter(i => (i.category || 'music') === categoryFilter);
        
        // --- 1. Prepare the "Vote Now" item ---
        // Find a random item to vote on that the user hasn't voted on and didn't submit themselves
        const voteableItems = allItemsInCategory
            .filter(i => {
                const myKey = window.CoreEngine && window.CoreEngine.userKeys ? window.CoreEngine.userKeys.publicKey : null;
                if (!myKey) return true; // Not logged in, show anything
                const hasVoted = i.votes && i.votes[myKey];
                const isSubmitter = i.submitter === myKey;
                return !hasVoted && !isSubmitter;
            })
            .sort(() => Math.random() - 0.5);

        let voteItemHtml = '<div style="color:var(--text-muted); text-align:center; padding:20px; border:1px dashed var(--border); border-radius:8px;">Nothing new to vote on in this category.</div>';
        if (voteableItems.length > 0) {
            voteItemHtml = this._renderHotOrNotItem(voteableItems[0], true);
        }

        // --- 2. Prepare the Leaderboard items ---
        let leaderboardItems = [...allItemsInCategory];
        const now = Date.now();
        const oneWeek = 7 * 24 * 60 * 60 * 1000;

        if (leaderboardFilter === 'weekly') {
            leaderboardItems = leaderboardItems.filter(i => (now - i.timestamp) < oneWeek).sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
        } else if (leaderboardFilter === 'alltime') {
            leaderboardItems.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
        } else { // 'new' is the default
            leaderboardItems.sort((a, b) => b.timestamp - a.timestamp);
        }

        const leaderboardItemsHtml = leaderboardItems.length === 0 
            ? '<div style="color:var(--text-muted);margin-top:20px;">No entries found in this category.</div>' 
            : leaderboardItems.map(item => this._renderHotOrNotItem(item, false)).join('');

        // --- 3. Render everything ---
        // (Player bar logic is fine and can stay)
        const parent = container.parentElement;
        if (parent) {
            let playerBar = document.getElementById('hotornot-player-bar');
            if (!playerBar) {
                playerBar = document.createElement('div');
                playerBar.id = 'hotornot-player-bar';
                playerBar.style = 'display:flex; align-items:center; gap:12px; padding:10px; border:1px solid var(--border); border-radius:8px; margin-bottom:12px; background: rgba(0,0,0,0.15);';
                playerBar.innerHTML = `<div style="font-weight:700;">Now Playing:</div><div id="hotornot-player-title" style="flex:1; color:var(--primary); cursor:pointer;">None</div><div id="hotornot-player-artist" style="color:var(--text-muted); cursor:pointer;">Unknown</div>`;
                parent.insertBefore(playerBar, container);
                document.getElementById('hotornot-player-title').onclick = () => { const a = window.AudioEngine && window.AudioEngine.activeTrackHash; if (a) window.BattleEngines.openAssetInMarket(a); };
                document.getElementById('hotornot-player-artist').onclick = () => { const a = window.AudioEngine && window.AudioEngine.activeTrackArtist; if (a) window.inspectTargetNode(a); };
            }
            const titleEl = document.getElementById('hotornot-player-title');
            const artistEl = document.getElementById('hotornot-player-artist');
            if (titleEl) titleEl.innerText = document.getElementById('global-track-title') ? document.getElementById('global-track-title').innerText : 'None';
            if (artistEl) artistEl.innerText = document.getElementById('global-track-artist-link') ? document.getElementById('global-track-artist-link').innerText : 'Unknown';
        }

        container.innerHTML = `
            <h3 style="color:var(--primary);border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:15px;">Vote Now</h3>
            ${voteItemHtml}
            <hr style="margin:25px 0;border-color:var(--border);">
            <h3 style="color:var(--primary);border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:15px;">Leaderboards</h3>
            ${leaderboardItemsHtml}
        `;
    },

    async castHotOrNotVote(submissionId, submitter, vote, targetHash) {
        if (!window.CoreEngine || !window.CoreEngine.userKeys || !window.CoreEngine.userKeys.publicKey) return alert('Must be logged in to vote.');
        if (submitter === window.CoreEngine.userKeys.publicKey) return alert('You cannot vote on your own submission.');

        // Enforce 30 second listen requirement
        try {
            const player = document.getElementById('global-audio-player');
            const activeHash = window.AudioEngine && window.AudioEngine.activeTrackHash;
            const hasListened = player && activeHash === targetHash && player.currentTime >= 30;
            if (!hasListened) return alert('You must listen to at least 30 seconds of this specific track before voting.');

            await window.CoreEngine.sendSignedTransaction('VOTE_HOT_OR_NOT', submitter, { submissionId, vote, targetHash });
            window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);
            this.loadHotOrNot();
        } catch (err) { console.error(err); alert('Vote failed: ' + (err.message || err)); }
    },

        openAssetInMarket(hash) {
            try {
                if (!hash) return;
                if (typeof window.switchTab === 'function') window.switchTab('market', document.getElementById('nav-market-tab'));
                if (typeof window.switchMarketTab === 'function') window.switchMarketTab('buy');
                const f = document.getElementById('buy-search-filter'); if (f) f.value = hash;
                if (typeof window.loadMarketplace === 'function') window.loadMarketplace();
            } catch (e) { console.error('openAssetInMarket', e); }
        }
};

    // Global wrapper so inline event handlers in index.html work
    window.renderHotOrNot = function() { if (window.BattleEngines && typeof window.BattleEngines.renderHotOrNot === 'function') window.BattleEngines.renderHotOrNot(); };