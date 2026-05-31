window.NotificationEngine = {
    notifications: [],
    unreadCount: 0,
    socket: null,

    init(socket) {
        this.socket = socket;
        this.load();
        this.setupSocketListeners();
        this.setupDOMListeners();
        console.log('[INIT] Notification Engine ready.');
    },

    load() {
        try {
            const persistedNotifs = localStorage.getItem('vod_user_notifications');
            if (persistedNotifs) {
                this.notifications = JSON.parse(persistedNotifs);
                this.recalculateUnreadCount();
                this.updateBadge();
            }
        } catch (e) {
            console.error("Failed to load persisted notifications:", e);
            this.notifications = [];
        }
    },

    save() {
        localStorage.setItem('vod_user_notifications', JSON.stringify(this.notifications));
    },

    setupSocketListeners() {
        if (!this.socket) return;
        this.socket.on('new_notification', (payload) => {
            this.add(payload);
        });

        this.socket.on('stake_request_response', (data) => {
            try {
                if (!window.CoreEngine || !window.CoreEngine.userKeys || data.to !== window.CoreEngine.userKeys.publicKey) return;
                
                const fromUser = (window.resolveProfile && window.resolveProfile(data.from)) || { username: 'A user' };
                const title = data.accepted ? 'Stake Request Accepted ✅' : 'Stake Request Declined ❌';
                const body = `${fromUser.username} has ${data.accepted ? 'accepted' : 'declined'} your stake request.`;
                
                // Add to notification panel for history
                this.add({ title, body });
                
                // Also show an alert for immediate feedback
                alert(`${title}\n\n${body}`);
                
                // Refresh profile to update UI (e.g., commissions list)
                if (typeof fetchUserProfile === 'function') {
                    fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
                }
            } catch (e) { console.error("Error handling stake request response:", e); }
        });
    },

    setupDOMListeners() {
        const notifBtn = document.getElementById('nav-notifications-btn');
        if (notifBtn) {
            notifBtn.addEventListener('click', () => this.togglePanel());
        }
        // Also listen to the mobile button
        const mobileNotifBtn = document.getElementById('mobile-notifications-btn');
        if (mobileNotifBtn) {
            mobileNotifBtn.addEventListener('click', () => this.togglePanel());
        }
    },

    add(payload) {
        this.notifications.push({ ...payload, timestamp: Date.now(), read: false });
        this.save();
        this.unreadCount++;
        this.updateBadge();

        const panel = document.getElementById('notifications-panel');
        if (panel && panel.style.display !== 'none') {
            this.render();
            this.markAllAsRead();
        }
    },

    recalculateUnreadCount() {
        this.unreadCount = this.notifications.filter(n => n.read === false).length;
    },

    updateBadge() {
        document.querySelectorAll('.ui-notif-badge').forEach(badge => {
            if (this.unreadCount > 0) {
                badge.innerText = this.unreadCount;
                badge.classList.remove('hidden');
            } else {
                badge.innerText = '0';
                badge.classList.add('hidden');
            }
        });
    },

    togglePanel() {
        let panel = document.getElementById('notifications-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'notifications-panel';
            panel.style = `
                position: fixed; top: 60px; right: 20px; width: 350px; max-height: 500px;
                background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3); z-index: 2000; display: none; flex-direction: column;
            `;
            panel.innerHTML = `
                <div style="padding: 15px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
                    <h4 style="margin: 0; color: #fff;">Notifications</h4>
                    <button class="secondary" style="padding: 2px 8px; font-size: 11px;" onclick="window.NotificationEngine.clear()">Clear All</button>
                </div>
                <div id="notifications-list" style="overflow-y: auto; flex-grow: 1; padding: 0;"></div>
            `;
            document.body.appendChild(panel);
        }

        const isHidden = panel.style.display === 'none';
        if (isHidden) {
            this.render();
            panel.style.display = 'flex';
            this.markAllAsRead();
        } else {
            panel.style.display = 'none';
        }
    },

    render() {
        const listEl = document.getElementById('notifications-list');
        if (!listEl) return;
        if (this.notifications.length === 0) {
            listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">No notifications yet.</div>';
            return;
        }
        listEl.innerHTML = this.notifications.slice().reverse().map(notif => {
            const isUnread = notif.read === false;
            const unreadStyle = isUnread ? 'background: rgba(102, 252, 241, 0.05);' : '';
            const unreadDot = isUnread ? '<div style="width: 8px; height: 8px; background: var(--primary); border-radius: 50%; box-shadow: 0 0 5px var(--primary); flex-shrink: 0; margin-right: 10px;"></div>' : '<div style="width: 8px; height: 8px; flex-shrink: 0; margin-right: 10px;"></div>';

            return `
            <div style="padding: 12px 15px; border-bottom: 1px solid var(--border); font-size: 13px; color: #eee; display: flex; align-items: center; transition: background 0.3s; ${unreadStyle}">
                ${unreadDot}
                <div style="flex-grow: 1;">
                    <strong>${escapeHtml(notif.title)}</strong>
                    <p style="margin: 4px 0 0 0; color: var(--text-muted);">${escapeHtml(notif.body)}</p>
                    <div style="font-size: 10px; color: var(--text-muted); text-align: right; margin-top: 5px;">${new Date(notif.timestamp).toLocaleString()}</div>
                </div>
            </div>
        `}).join('');
    },

    clear() {
        this.notifications = [];
        this.unreadCount = 0;
        localStorage.removeItem('vod_user_notifications');
        this.render();
        this.updateBadge();
    },

    markAllAsRead() {
        this.notifications.forEach(n => n.read = true);
        this.save();
        this.unreadCount = 0;
        this.updateBadge();
    }
};