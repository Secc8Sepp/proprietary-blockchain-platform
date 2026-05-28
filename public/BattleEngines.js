window.MusicBattleEngine = {
    renderPlayer(trackDetails, isPreview = false) {
        const artistName = trackDetails.artist || (window.resolveProfile && window.resolveProfile(trackDetails.creator) || {}).username || 'Unknown';
        if (window.AudioEngine && typeof window.AudioEngine.playTrack === 'function') window.AudioEngine.playTrack(trackDetails.title, trackDetails.audioHash, trackDetails.creator, artistName, isPreview);
    }
};

window.LooksBattleEngine = {
    renderLooksGrid(item) {
        const submitterProfile = (window.resolveProfile && window.resolveProfile(item.submitter)) || {};
        const username = submitterProfile.username || item.submitter;
        const imgHtml = item.targetHash ? `<img src="/tracks/${item.targetHash}" style="max-width:100%;max-height:400px;border-radius:8px;object-fit:contain;border:1px solid var(--danger);margin-top:10px;">` : '';
        return `<div style="background:rgba(0,0,0,0.3);border:1px solid var(--danger);padding:15px;border-radius:8px;text-align:center;"><div style="font-size:18px;font-weight:bold;color:var(--primary);margin-bottom:5px;">@${username}</div><div style="font-size:11px;color:var(--text-muted);">Looks Battle</div>${imgHtml}</div>`;
    }
};

window.BattleEngines = {
    hotOrNotCategory: 'music', // 'music' or 'looks'
    leaderboardFilter: 'new', // 'new', 'weekly', 'alltime'
    currentItemForVote: null,

    async loadHotOrNot() {
        try {
            const res = await fetch('/api/social/hotornot');
            window.hotOrNotData = await res.json();
            this.renderHotOrNotLayout();
            this.populateHotOrNotSubmitUI();
            this.loadNextItemForVote();
            this.renderHotOrNotFeed();
        } catch(err) { console.error("HotOrNot Error:", err); }
    },

    renderHotOrNotLayout() {
        const container = document.getElementById('view-hotornot');
        if (!container) return;

        container.innerHTML = `
            <div id="hotornot-category-selector" style="display: flex; justify-content: center; gap: 20px; margin-bottom: 20px;">
                <div id="hon-cat-music" class="hon-category-btn" onclick="window.BattleEngines.switchCategory('music')">
                    <span style="font-size: 32px;">🎵</span>
                    <div>Music Battle</div>
                </div>
                <div id="hon-cat-looks" class="hon-category-btn" onclick="window.BattleEngines.switchCategory('looks')">
                    <span style="font-size: 32px;">🖼️</span>
                    <div>Looks Battle</div>
                </div>
            </div>

            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">Submit to the Battle</div>
                <div class="card-body" id="hotornot-submit-area">
                    <!-- Populated by populateHotOrNotSubmitUI -->
                </div>
            </div>

            <div id="hot-or-not-voter" style="margin-bottom: 20px;">
                <!-- Populated by renderVoter -->
            </div>

            <div id="hotornot-feed-filters" style="display: flex; gap: 10px; margin-bottom: 15px;">
                <button id="hon-filter-new" class="secondary" onclick="window.BattleEngines.switchFeedFilter('new')">Newest</button>
                <button id="hon-filter-weekly" class="secondary" onclick="window.BattleEngines.switchFeedFilter('weekly')">Weekly Hot</button>
                <button id="hon-filter-alltime" class="secondary" onclick="window.BattleEngines.switchFeedFilter('alltime')">All-Time Hot</button>
            </div>

            <div id="ui-hotornot-content">
                <!-- Populated by renderHotOrNotFeed -->
            </div>
        `;
        this.updateCategorySelectionUI();
        this.updateFilterButtonUI();
    },

    switchCategory(category) {
        this.hotOrNotCategory = category;
        this.updateCategorySelectionUI();
        this.populateHotOrNotSubmitUI();
        this.loadNextItemForVote();
        this.renderHotOrNotFeed();
    },

    updateCategorySelectionUI() {
        document.querySelectorAll('.hon-category-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById(`hon-cat-${this.hotOrNotCategory}`);
        if (activeBtn) activeBtn.classList.add('active');
    },
    
    switchFeedFilter(filter) {
        this.leaderboardFilter = filter;
        this.updateFilterButtonUI();
        this.renderHotOrNotFeed();
    },

    updateFilterButtonUI() {
        document.querySelectorAll('#hotornot-feed-filters button').forEach(btn => {
            btn.style.background = '';
            btn.style.color = '';
        });
        const activeBtn = document.getElementById(`hon-filter-${this.leaderboardFilter}`);
        if (activeBtn) {
            activeBtn.style.background = 'var(--primary)';
            activeBtn.style.color = '#000';
        }
    },

    async populateHotOrNotSubmitUI() {
        const submitArea = document.getElementById('hotornot-submit-area');
        if (!submitArea) return;

        if (!window.CoreEngine || !window.CoreEngine.userKeys || !window.CoreEngine.userKeys.publicKey) {
            submitArea.innerHTML = '<p style="color: var(--text-muted);">Login to submit to the battle.</p>';
            return;
        }

        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const recentSubmission = (window.hotOrNotData || []).find(t => 
            t.submitter === window.CoreEngine.userKeys.publicKey && 
            (t.category || 'music') === this.hotOrNotCategory &&
            t.timestamp > oneDayAgo
        );

        if (recentSubmission) {
            submitArea.innerHTML = `<p style="color: var(--text-muted);">You have already submitted to the ${this.hotOrNotCategory} battle today. Come back tomorrow!</p>`;
            return;
        }

        if (this.hotOrNotCategory === 'music') {
            submitArea.innerHTML = `
                <select id="hotornot-submit-select" style="width: 100%; margin-bottom: 10px;"></select>
                <button onclick="window.ActionEngine.submitToHotOrNot()">Submit Track</button>
            `;
            const select = document.getElementById('hotornot-submit-select');
            try {
                const response = await fetch(`/api/social/profile?publicKey=${encodeURIComponent(window.CoreEngine.userKeys.publicKey)}`);
                const profile = await response.json();
                const submittedHashes = (window.hotOrNotData || []).map(s => s.originalHash || s.targetHash);
                const myTracks = (profile.uploadedTracks || []).filter(t => !submittedHashes.includes(t.hash));

                if (myTracks.length === 0) {
                    select.innerHTML = '<option value="">No tracks left to submit</option>';
                } else {
                    select.innerHTML = '<option value="">Select your track...</option>' + myTracks.map(t => `<option value="${t.hash}">${window.escapeHtml(t.title)}</option>`).join('');
                }
            } catch (e) {
                select.innerHTML = '<option value="">Error loading tracks</option>';
            }
        } else if (this.hotOrNotCategory === 'looks') {
            submitArea.innerHTML = `
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">Upload a new photo for the Looks Battle (1 per day).</p>
                <input type="file" id="hotornot-looks-upload" accept="image/*" style="margin-bottom: 10px;">
                <button onclick="window.ActionEngine.submitToHotOrNot()">Submit Photo</button>
            `;
        }
    },

    loadNextItemForVote() {
        const allItemsInCategory = (window.hotOrNotData || [])
            .filter(i => (i.category || 'music') === this.hotOrNotCategory);

        const voteableItems = allItemsInCategory
            .filter(i => {
                const myKey = window.CoreEngine && window.CoreEngine.userKeys ? window.CoreEngine.userKeys.publicKey : null;
                if (!myKey) return true; // Not logged in, show anything
                const hasVoted = i.votes && i.votes[myKey];
                const isSubmitter = i.submitter === myKey;
                return !hasVoted && !isSubmitter;
            })
            .sort(() => Math.random() - 0.5); // Randomize

        this.currentItemForVote = voteableItems.length > 0 ? voteableItems[0] : null;
        this.renderVoter();
    },

    renderVoter() {
        const voterContainer = document.getElementById('hot-or-not-voter');
        if (!voterContainer) return;

        const item = this.currentItemForVote;

        if (!item) {
            voterContainer.innerHTML = '<div class="card"><div class="card-body" style="color:var(--text-muted); text-align:center;">Nothing new to vote on in this category. Check back later!</div></div>';
            return;
        }

        let contentHtml = '';
        if ((item.category || 'music') === 'music') {
            const displayArtist = item.trackDetails && item.trackDetails.artist ? window.escapeHtml(item.trackDetails.artist) : ((window.resolveProfile && window.resolveProfile(item.submitter) || {}).username || item.submitter);
            const title = item.trackDetails ? item.trackDetails.title : "Unknown Track";
            const coverHtml = (item.trackDetails && item.trackDetails.coverHash)
                ? `<img src="/tracks/${item.trackDetails.coverHash}" style="width:100px;height:100px;border-radius:6px;object-fit:cover;">`
                : `<img src="${(window.getAvatarUrl && window.getAvatarUrl(item.submitter)) || '#'}" style="width:100px;height:100px;border-radius:6px;object-fit:cover;">`;

            contentHtml = `
                <div style="display:flex;gap:20px;align-items:center;">
                    ${coverHtml}
                    <div style="flex:1;">
                        <div style="font-size:22px;font-weight:bold;color:#fff;">${window.escapeHtml(title)}</div>
                        <div style="font-size:14px;color:var(--primary);margin-bottom:10px;">By ${displayArtist}</div>
                        <button style="padding:8px 20px;font-size:14px;" onclick="window.MusicBattleEngine.renderPlayer({ title: '${window.escapeJsArg ? window.escapeJsArg(title) : title}', audioHash: '${item.targetHash}', creator: '${item.submitter}', artist: '${window.escapeJsArg ? window.escapeJsArg(displayArtist) : displayArtist}' }, true)">▶ Play Sample</button>
                    </div>
                </div>
            `;
        } else { // Looks
            const submitterProfile = (window.resolveProfile && window.resolveProfile(item.submitter)) || {};
            const username = submitterProfile.username || item.submitter;
            contentHtml = `
                <div style="text-align:center;">
                    <img src="/tracks/${item.targetHash}" style="max-width:100%;max-height:50vh;border-radius:8px;object-fit:contain;border:1px solid var(--border);">
                    <div style="font-size:18px;font-weight:bold;color:var(--primary);margin-top:10px;">@${username}</div>
                </div>
            `;
        }

        voterContainer.innerHTML = `
            <div class="card">
                <div class="card-header">Cast Your Vote</div>
                <div class="card-body">
                    ${contentHtml}
                    <div style="display: flex; gap: 15px; margin-top: 20px;">
                        <button id="hot-btn-${item.id}" style="flex:1; background: var(--danger); color: #fff; padding: 15px; font-size: 18px;" onclick="window.BattleEngines.castHotOrNotVote('${item.id}', '${item.submitter}', 1, '${item.targetHash}')">🔥 HOT</button>
                        <button id="not-btn-${item.id}" class="secondary" style="flex:1; border-color: var(--danger); color: var(--danger); padding: 15px; font-size: 18px;" onclick="window.BattleEngines.castHotOrNotVote('${item.id}', '${item.submitter}', -1, '${item.targetHash}')">💩 NOT</button>
                    </div>
                </div>
            </div>
        `;
    },

    renderHotOrNotFeed() {
        const container = document.getElementById('ui-hotornot-content');
        if (!container) return;

        const categoryFilter = this.hotOrNotCategory || 'music';
        let leaderboardItems = [...(window.hotOrNotData || [])].filter(i => (i.category || 'music') === categoryFilter);
        
        const now = Date.now();
        const oneWeek = 7 * 24 * 60 * 60 * 1000;

        if (this.leaderboardFilter === 'weekly') {
            leaderboardItems = leaderboardItems.filter(i => (now - i.timestamp) < oneWeek).sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
        } else if (this.leaderboardFilter === 'alltime') {
            leaderboardItems.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
        } else { // 'new' is the default
            leaderboardItems.sort((a, b) => b.timestamp - a.timestamp);
        }

        const leaderboardItemsHtml = leaderboardItems.length === 0 
            ? '<div style="color:var(--text-muted);margin-top:20px; text-align: center;">No entries found in this category.</div>' 
            : leaderboardItems.map(item => this._renderHotOrNotLeaderboardItem(item)).join('');

        container.innerHTML = leaderboardItemsHtml;
    },

    _renderHotOrNotLeaderboardItem(item) {
        if ((item.category || 'music') === 'music') {
            const displayArtist = item.trackDetails && item.trackDetails.artist ? window.escapeHtml(item.trackDetails.artist) : ((window.resolveProfile && window.resolveProfile(item.submitter) || {}).username || item.submitter);
            const title = item.trackDetails ? item.trackDetails.title : "Unknown Track";
            const coverHtml = (item.trackDetails && item.trackDetails.coverHash)
                ? `<img src="/tracks/${item.trackDetails.coverHash}" style="width:80px;height:80px;border-radius:6px;object-fit:cover;">`
                : `<img src="${(window.getAvatarUrl && window.getAvatarUrl(item.submitter)) || '#'}" style="width:80px;height:80px;border-radius:6px;object-fit:cover;">`;

            return `
                <div class="card" style="margin-bottom:15px;">
                    <div class="card-body" style="display:flex;gap:15px;">
                        ${coverHtml}
                        <div style="flex:1;">
                            <div style="font-size:18px;font-weight:bold;color:#fff; cursor:pointer;" onclick="window.BattleEngines.openAssetInMarket('${item.originalHash || item.targetHash}')">${window.escapeHtml(title)}</div>
                            <div style="font-size:12px;color:var(--primary);margin-bottom:5px;"><a style="color:var(--primary);cursor:pointer;" onclick="window.inspectTargetNode('${item.submitter}')">By ${displayArtist}</a></div>
                            <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">Submitted by @${(window.resolveProfile && window.resolveProfile(item.submitter) || {}).username || item.submitter}</div>
                            <button style="padding:5px 15px;font-size:12px;" onclick="window.MusicBattleEngine.renderPlayer({ title: '${window.escapeJsArg ? window.escapeJsArg(title) : title}', audioHash: '${item.targetHash}', creator: '${item.submitter}', artist: '${window.escapeJsArg ? window.escapeJsArg(displayArtist) : displayArtist}' }, true)">▶ Play Sample</button>
                        </div>
                        <div style="text-align: right;">
                           <div style="font-size: 18px; font-weight: bold; color: #fff;">${item.upvotes - item.downvotes}</div>
                           <div style="font-size: 11px; color: var(--text-muted);">Score</div>
                        </div>
                    </div>
                </div>
            `;
        } else { // Looks
             const submitterProfile = (window.resolveProfile && window.resolveProfile(item.submitter)) || {};
             const username = submitterProfile.username || item.submitter;
             return `
                <div class="card" style="margin-bottom: 15px;">
                    <div class="card-body" style="text-align:center;">
                        <img src="/tracks/${item.targetHash}" style="max-width:100%;max-height:400px;border-radius:8px;object-fit:contain;border:1px solid var(--border);margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                             <div style="font-size:14px;font-weight:bold;color:var(--primary);">@${username}</div>
                             <div style="text-align: right;">
                                <div style="font-size: 18px; font-weight: bold; color: #fff;">${item.upvotes - item.downvotes}</div>
                                <div style="font-size: 11px; color: var(--text-muted);">Score</div>
                             </div>
                        </div>
                    </div>
                </div>
             `;
        }
    },

    async castHotOrNotVote(submissionId, submitter, vote, targetHash) {
        if (!window.CoreEngine || !window.CoreEngine.userKeys || !window.CoreEngine.userKeys.publicKey) return alert('Must be logged in to vote.');
        if (submitter === window.CoreEngine.userKeys.publicKey) return alert('You cannot vote on your own submission.');

        try {
            // The 30-second listening requirement is removed as requested.

            const voteBtn = document.getElementById(vote === 1 ? `hot-btn-${submissionId}` : `not-btn-${submissionId}`);
            if(voteBtn) {
                voteBtn.innerText = 'Voting...';
                voteBtn.disabled = true;
            }

            await window.CoreEngine.sendSignedTransaction('VOTE_HOT_OR_NOT', submitter, { submissionId, vote, targetHash });
            
            const item = (window.hotOrNotData || []).find(i => i.id === submissionId);
            if (item) {
                if (!item.votes) item.votes = {};
                item.votes[window.CoreEngine.userKeys.publicKey] = vote;
                if (vote === 1) item.upvotes++; else item.downvotes++;
            }
            
            this.loadNextItemForVote();
            this.renderHotOrNotFeed();
            
            window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);

        } catch (err) { 
            console.error(err); 
            alert('Vote failed: ' + (err.message || err)); 
            const voteBtn = document.getElementById(vote === 1 ? `hot-btn-${submissionId}` : `not-btn-${submissionId}`);
            if(voteBtn) {
                voteBtn.innerText = vote === 1 ? '🔥 HOT' : '💩 NOT';
                voteBtn.disabled = false;
            }
        }
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
    window.renderHotOrNot = function() { if (window.BattleEngines && typeof window.BattleEngines.loadHotOrNot === 'function') window.BattleEngines.loadHotOrNot(); };