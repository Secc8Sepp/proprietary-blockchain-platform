window.GlobalTagEngine = {
    tagRegistry: new Set(),
    activeFeedTag: null,

    syncTags(payload) {
        console.log('[TAG ENGINE] Syncing tags based on ledger update');
        if (payload && payload.transaction && payload.transaction.data && payload.transaction.data.metadata) {
            this.renderTags(payload.transaction.data.metadata);
        }
    },

    searchByTag(query) {
        const q = query.toLowerCase();
        return Array.from(this.tagRegistry).filter(tag => tag.toLowerCase().includes(q));
    },

    renderTags(metadata) {
        if (!metadata) return '';
        return metadata.split(',').map(tag => {
            let t = tag.trim();
            if (!t) return '';
            if (!t.startsWith('#')) t = '#' + t;
            this.tagRegistry.add(t);
            return `<span style="color:var(--primary); cursor:pointer; margin-right: 5px;" onclick="window.GlobalTagEngine.filterFeedByTag('${window.escapeJsArg ? window.escapeJsArg(t) : t}')">${window.escapeHtml ? window.escapeHtml(t) : t}</span>`;
        }).join('');
    },

    filterFeedByTag(tag) {
        this.activeFeedTag = tag; 
        window.activeFeedTag = tag; 
        if(window.switchTab) window.switchTab('feed', document.querySelector('.side-nav-item')); 
        if(window.loadMainGlobalFeed) window.loadMainGlobalFeed();
    }
};