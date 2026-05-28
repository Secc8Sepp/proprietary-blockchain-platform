window.GlobalTagEngine = {
    activeFeedTag: null,

    /**
     * Takes a comma-separated string of tags and returns clickable HTML elements.
     * @param {string} metadataString - e.g., "lofi, hiphop, chill"
     * @returns {string} HTML string of tag elements.
     */
    renderTags(metadataString) {
        if (!metadataString || typeof metadataString !== 'string') return '';
        
        const tags = metadataString.split(',').map(t => t.trim()).filter(t => t);
        if (tags.length === 0) return '';

        return tags.map(tag => {
            const cleanTag = '#' + tag.replace(/#/g, '');
            return `<span class="post-tag" onclick="window.GlobalTagEngine.filterFeedByTag('${cleanTag}')">${cleanTag}</span>`;
        }).join(' ');
    },

    /**
     * Sets the active tag for filtering the main feed and reloads it.
     * @param {string | null} tag - The tag to filter by (e.g., "#lofi"), or null to clear.
     */
    filterFeedByTag(tag) {
        this.activeFeedTag = tag;
        if (window.loadMainGlobalFeed) {
            window.loadMainGlobalFeed();
        }
    },

    /**
     * Searches for tags based on a query.
     * @param {string} query - The search query.
     * @returns {string[]} An array of matching tags.
     */
    searchByTag(query) {
        const q = query.toLowerCase().trim();
        if (!q.startsWith('#')) return [];

        // In a more advanced system, we'd have a pre-compiled list of all tags.
        // For now, we just return the query if it looks like a tag.
        return [q];
    }
};

// Add some basic styling for the tags
const style = document.createElement('style');
style.innerHTML = `
    .post-tag {
        display: inline-block;
        background: rgba(102, 252, 241, 0.1);
        color: var(--primary);
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 500;
        margin-right: 5px;
        margin-top: 5px;
        cursor: pointer;
        transition: background 0.2s;
        border: 1px solid transparent;
    }
    .post-tag:hover {
        background: var(--primary);
        color: #000;
        border-color: var(--primary);
    }
`;
document.head.appendChild(style);