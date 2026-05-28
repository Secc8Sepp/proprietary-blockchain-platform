window.MusicBattleEngine = {
    renderPlayer(trackDetails) {
        const artistName = trackDetails.artist || window.resolveProfile(trackDetails.creator).username;
        window.AudioEngine.playTrack(trackDetails.title, trackDetails.audioHash, trackDetails.creator, artistName);
    }
};

window.LooksBattleEngine = {
    renderLooksGrid(item) {
        let imgHtml = item.targetHash ? `<img src="/tracks/${item.targetHash}" style="max-width: 100%; max-height: 400px; border-radius: 8px; object-fit: contain; border: 1px solid var(--danger); margin-top: 10px;">` : '';
        return `
            <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--danger); padding: 15px; border-radius: 8px; text-align: center;">
                <div style="font-size: 18px; font-weight: bold; color: var(--primary); margin-bottom: 5px;">@${window.resolveProfile(item.submitter).username}</div>
                <div style="font-size: 11px; color: var(--text-muted);">Looks Battle</div>
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
            this.populateHotOrNotDropdown();
            this.populateHotOrNotSubmitDropdown();
            this.renderHotOrNot();
        } catch(err) { console.error("HotOrNot Error:", err); }
    },

    async populateHotOrNotDropdown() {
    async populateHotOrNotSubmitDropdown() {
        const select = document.getElementById('hotornot-submit-select');
        const catSelect = document.getElementById('hotornot-category-select');
        if (!select || !catSelect) return;
        if (!select) return;
        if (!window.CoreEngine.userKeys || !window.CoreEngine.userKeys.publicKey) {
            select.innerHTML = '<option value="">Login to submit</option>';
            return;
        }
        try {
            const response = await fetch(`/api/social/profile?publicKey=${encodeURIComponent(window.CoreEngine.userKeys.publicKey)}`);
            const profile = await response.json();
            const category = this.hotOrNotSubmitCategory;

            const submittedHashes = (window.hotOrNotData || [])
                .filter(s => s.submitter === window.CoreEngine.userKeys.publicKey && (s.category || 'music') === category)
                .map(s => s.originalHash || s.targetHash);
            
            catSelect.onchange = () => {
                const category = catSelect.value;
                if (category === 'music') {
                    const myTracks = profile.uploadedTracks || [];
                    if (myTracks.length === 0) select.innerHTML = '<option value="">No tracks uploaded</option>';
                    else select.innerHTML = '<option value="">Select your track...</option>' + myTracks.map(t => `<option value="${t.hash}">${window.escapeHtml(t.title)}</option>`).join('');
                } else if (category === 'looks') {
                    const myImages = profile.uploadedImages || [];
                    let options = '<option value="">Select your image...</option>';
                    if (profile.avatarHash) options += `<option value="${profile.avatarHash}">Current Avatar</option>`;
                    if (myImages.length > 0) options += myImages.map(img => `<option value="${img.hash}">Gallery Image (${new Date(img.timestamp).toLocaleDateString()})</option>`).join('');
                    if (!profile.avatarHash && myImages.length === 0) options = '<option value="">No images uploaded</option>';
                    select.innerHTML = options;
            if (category === 'music') {
                const myTracks = (profile.uploadedTracks || []).filter(t => !submittedHashes.includes(t.hash));
                if (myTracks.length === 0) select.innerHTML = '<option value="">No tracks left to submit</option>';
                else select.innerHTML = '<option value="">Select your track...</option>' + myTracks.map(t => `<option value="${t.hash}">${window.escapeHtml(t.title)}</option>`).join('');
            } else if (category === 'looks') {
                const myImages = (profile.uploadedImages || []).filter(img => !submittedHashes.includes(img.hash));
                let options = '<option value="">Select your image...</option>';
                const avatarNotSubmitted = profile.avatarHash && !submittedHashes.includes(profile.avatarHash);
                if (avatarNotSubmitted) {
                    options += `<option value="${profile.avatarHash}">Current Avatar</option>`;
                }
            };
            catSelect.onchange();
        } catch(e) { select.innerHTML = '<option value="">Error loading tracks</option>'; }
                if (myImages.length > 0) {
                    options += myImages.map(img => `<option value="${img.hash}">Gallery Image (${new Date(img.timestamp).toLocaleDateString()})</option>`).join('');
                }
                if (!avatarNotSubmitted && myImages.length === 0) {
                    options = '<option value="">No images left to submit</option>';
                }
                select.innerHTML = options;
            }
        } catch(e) { select.innerHTML = '<option value="">Error loading items</option>'; }
    },

    _renderHotOrNotItem(item, isVoteMode) {
        let voteHtml = '';
        if (isVoteMode) {
            voteHtml = `
                <div style="display: flex; gap: 15px; margin-top: 15px;">
                    <button style="flex:1; background: var(--danger); color: #fff;" onclick="window.BattleEngines.castHotOrNotVote('${item.id}', '${item.submitter}', 1, '${item.targetHash}')">🔥 HOT</button>
                    <button class="secondary" style="flex:1; border-color: var(--danger); color: var(--danger);" onclick="window.BattleEngines.castHotOrNotVote('${item.id}', '${item.submitter}', -1, '${item.targetHash}')">🧊 NOT</button>
                </div>
            `;
        } else {
            voteHtml = `<div style="font-size:12px; color:var(--text-muted); margin-top: 10px;">🔥 ${item.upvotes} Hot | 🧊 ${item.downvotes} Not</div>`;
        }

        if ((item.category || 'music') === 'music') {
            let displayArtist = item.trackDetails && item.trackDetails.artist ? window.escapeHtml(item.trackDetails.artist) : window.resolveProfile(item.submitter).username;
            let title = item.trackDetails ? item.trackDetails.title : "Unknown Track";
            
            let coverHtml;
            if (item.trackDetails && item.trackDetails.coverHash) {
                coverHtml = `<img src="/tracks/${item.trackDetails.coverHash}" style="width: 80px; height: 80px; border-radius: 6px; object-fit: cover;">`;
            } else {
                coverHtml = `<img src="${window.getAvatarUrl(item.submitter)}" style="width: 80px; height: 80px; border-radius: 6px; object-fit: cover;">`;
            }

            return `
                <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--danger); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <div style="display: flex; gap: 15px;">
                        ${coverHtml}
                        <div style="flex:1;">
                            <div style="font-size: 18px; font-weight: bold; color: #fff;">${window.escapeHtml(title)}</div>
                            <div style="font-size: 12px; color: var(--primary); margin-bottom: 5px;">By ${displayArtist}</div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">Submitted by @${window.resolveProfile(item.submitter).username}</div>
                            <button style="padding: 5px 15px; font-size: 12px; background: var(--danger); color: #fff;" onclick="window.MusicBattleEngine.renderPlayer({ title: '${window.escapeJsArg(title)}', audioHash: '${item.targetHash}', creator: '${item.submitter}', artist: '${window.escapeJsArg(displayArtist)}' })">▶ Play Track</button>
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
        const filter = document.getElementById('hotornot-filter').value;
        const categoryFilter = document.getElementById('hotornot-view-category').value;
        const listFilter = document.getElementById('hotornot-filter').value;
        const categoryFilter = this.hotOrNotViewCategory;
        const container = document.getElementById('ui-hotornot-content');
        if (!container) return;

        let items = [...(window.hotOrNotData || [])].filter(i => (i.category || 'music') === categoryFilter);
        let allItems = [...(window.hotOrNotData || [])].filter(i => (i.category || 'music') === categoryFilter);
        const now = Date.now();
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        
        if (filter === 'weekly') items = items.filter(i => (now - i.timestamp) < oneWeek).sort((a,b) => b.upvotes - a.upvotes);
        else if (filter === 'alltime') items.sort((a,b) => b.upvotes - a.upvotes);
        else if (filter === 'new') items.sort((a,b) => b.timestamp - a.timestamp);
        else if (filter === 'vote') items = items.filter(i => !i.votes[window.CoreEngine.userKeys.publicKey]).sort(() => Math.random() - 0.5).slice(0, 1);
        let voteItemHtml;
        const voteableItems = allItems
            .filter(i => i.submitter !== window.CoreEngine.userKeys.publicKey && !i.votes[window.CoreEngine.userKeys.publicKey])
            .sort(() => Math.random() - 0.5);

        if (items.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted);">No entries found in this category.</div>';
            return;
        if (voteableItems.length > 0) {
            voteItemHtml = this._renderHotOrNotItem(voteableItems[0], true);
        } else {
            voteItemHtml = '<div style="color:var(--text-muted); text-align:center; padding: 20px; border: 1px dashed var(--border); border-radius: 8px;">Nothing new to vote on in this category.</div>';
        }

        container.innerHTML = items.map(item => {
            let voteHtml = '';
            if (filter === 'vote') {
                voteHtml = `
                    <div style="display: flex; gap: 15px; margin-top: 15px;">
                        <button style="flex:1; background: var(--danger); color: #fff;" onclick="window.BattleEngines.castHotOrNotVote('${item.id}', '${item.submitter}', 1, '${item.targetHash}')">🔥 HOT</button>
                        <button class="secondary" style="flex:1; border-color: var(--danger); color: var(--danger);" onclick="window.BattleEngines.castHotOrNotVote('${item.id}', '${item.submitter}', -1, '${item.targetHash}')">🧊 NOT</button>
                    </div>
                `;
            } else {
                voteHtml = `<div style="font-size:12px; color:var(--text-muted); margin-top: 10px;">🔥 ${item.upvotes} Hot | 🧊 ${item.downvotes} Not</div>`;
            }
        let listItems = [...allItems];
        let effectiveFilter = listFilter === 'vote' ? 'new' : listFilter;
        
        if (effectiveFilter === 'weekly') listItems = listItems.filter(i => (now - i.timestamp) < oneWeek).sort((a,b) => b.upvotes - a.upvotes);
        else if (effectiveFilter === 'alltime') listItems.sort((a,b) => b.upvotes - a.upvotes);
        else if (effectiveFilter === 'new') listItems.sort((a,b) => b.timestamp - a.timestamp);

            if (categoryFilter === 'music') {
                let displayArtist = item.trackDetails && item.trackDetails.artist ? window.escapeHtml(item.trackDetails.artist) : window.resolveProfile(item.submitter).username;
                let title = item.trackDetails ? item.trackDetails.title : "Unknown Track";
                let coverHtml = item.trackDetails && item.trackDetails.coverHash ? `<img src="/tracks/${item.trackDetails.coverHash}" style="width: 80px; height: 80px; border-radius: 6px; object-fit: cover;">` : `<div style="width:80px; height:80px; border-radius:6px; background:var(--bg-darker); display:flex; align-items:center; justify-content:center; border:1px solid var(--border);">🎵</div>`;
        let listItemsHtml;
        if (listItems.length === 0) {
            listItemsHtml = '<div style="color:var(--text-muted); margin-top: 20px;">No entries found in this category.</div>';
        } else {
            listItemsHtml = listItems.map(item => this._renderHotOrNotItem(item, false)).join('');
        }

                return `
                    <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--danger); padding: 15px; border-radius: 8px;">
                        <div style="display: flex; gap: 15px;">
                            ${coverHtml}
                            <div style="flex:1;">
                                <div style="font-size: 18px; font-weight: bold; color: #fff;">${window.escapeHtml(title)}</div>
                                <div style="font-size: 12px; color: var(--primary); margin-bottom: 5px;">By ${displayArtist}</div>
                                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">Submitted by @${window.resolveProfile(item.submitter).username}</div>
                                <button style="padding: 5px 15px; font-size: 12px; background: var(--danger); color: #fff;" onclick="window.MusicBattleEngine.renderPlayer({ title: '${window.escapeJsArg(title)}', audioHash: '${item.targetHash}', creator: '${item.submitter}', artist: '${window.escapeJsArg(displayArtist)}' })">▶ Play Track</button>
                            </div>
                        </div>
                        ${voteHtml}
                    </div>
                `;
            } else {
                return window.LooksBattleEngine.renderLooksGrid(item) + voteHtml;
            }
        }).join('');
        container.innerHTML = `
            <h3 style="color: var(--primary); border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 15px;">Vote Now</h3>
            ${voteItemHtml}
            <hr style="margin: 25px 0; border-color: var(--border);">
            <h3 style="color: var(--primary); border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 15px;">Leaderboards</h3>
            ${listItemsHtml}
        `;
    },

    async castHotOrNotVote(submissionId, submitter, vote, targetHash) {
        if (!window.CoreEngine.userKeys.publicKey) return alert("Must be logged in to vote.");
        if (submitter === window.CoreEngine.userKeys.publicKey) return alert("You cannot vote on your own submission.");
        try {
            await window.CoreEngine.sendSignedTransaction('VOTE_HOT_OR_NOT', submitter, { submissionId, vote, targetHash });
            alert(`Voted! You mined 100 $VOD.`);
            window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true); 
            this.loadHotOrNot();
        } catch(err) { alert("Vote failed: " + err.message); }
    },

    async submitHotOrNotFromDropdown() {
        if (!window.CoreEngine.userKeys.publicKey) return alert("Must be logged in.");
        const select = document.getElementById('hotornot-submit-select');
        const catSelect = document.getElementById('hotornot-category-select');
        let targetHash = select.value;
        const originalHash = targetHash;
        const category = catSelect ? catSelect.value : 'music';
        const category = this.hotOrNotSubmitCategory;
        if (!targetHash) return alert("Please select a valid item to submit.");

        try {
            let data = { category: category, targetHash: targetHash, originalHash: originalHash };
            if (category === 'music') {
                const btn = document.querySelector('button[onclick="window.BattleEngines.submitHotOrNotFromDropdown()"]');
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
            this.loadHotOrNot();
        } catch(err) { alert("Submission failed: " + err.message); }
    }
};