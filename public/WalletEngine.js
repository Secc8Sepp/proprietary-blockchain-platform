window.WalletEngine = {
    async promptSendCoins(recipient) {
        if (!window.CoreEngine.userKeys.publicKey) return alert("Must be logged in to send coins.");
        if (recipient === window.CoreEngine.userKeys.publicKey) return alert("You cannot send coins to yourself.");
        const amount = prompt("How much $VOD would you like to send?");
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return;
        
        try {
            await window.CoreEngine.sendSignedTransaction('TRANSFER_COIN', recipient, { amount: parseFloat(amount) });
            alert(`Successfully sent ${amount} $VOD!`);
            if (typeof window.loadMainGlobalFeed === 'function') window.loadMainGlobalFeed();
            if (typeof window.fetchUserProfile === 'function') window.fetchUserProfile(window.viewingUserPublicKey || window.CoreEngine.userKeys.publicKey, false);
        } catch (err) { alert("Transfer failed: " + err.message); }
    },

    async promptSendCoinsDialog() {
        if (!window.CoreEngine.userKeys.publicKey) return alert("Must be logged in.");
        const recipient = prompt("Enter the exact public key of the receiver:");
        if (!recipient) return;
        this.promptSendCoins(recipient);
    },

    async promptAdminDeleteUser(targetPublicKey) {
        if (!window.CoreEngine.userKeys.publicKey) return alert("Must be logged in.");
        if (!window.currentUserIsAdmin) return alert("Only the admin can delete profiles.");
        if (!targetPublicKey || typeof targetPublicKey !== 'string' || !targetPublicKey.trim()) return alert("No target user specified for deletion.");

        const target = targetPublicKey.trim();
        if (target === window.CoreEngine.userKeys.publicKey) return alert("You cannot delete your own admin profile.");
        
        const targetProfile = window.resolveProfile(target);
        if (!confirm(`ARE YOU ABSOLUTELY SURE?\n\nThis will delete the user ${targetProfile.username} (${target.substring(0,10)}...). This action is permanent and cannot be undone.`)) return;

        try {
            await window.CoreEngine.sendSignedTransaction('ADMIN_DELETE_USER', target, {}); // NOSONAR
            alert(`✅ Successfully deleted user! They have been removed from the network. Refreshing...`);

            // If we are on the deleted user's profile, navigate away.
            if (window.currentView === 'profile' && window.viewingUserPublicKey === target) {
                const feedTab = document.querySelector('.side-nav-item');
                if (feedTab) window.switchTab('feed', feedTab);
            }
            
            // Clear input if it exists on the page
            const targetInput = document.getElementById('input-delete-recipient'); // This ID is now in the admin dashboard
            if (targetInput) targetInput.value = '';

            // Force refresh of data
            if (typeof window.loadMainGlobalFeed === 'function') {
                window.loadMainGlobalFeed();
            }
        } catch(err) {
            console.error(`[UI] Admin Delete failed:`, err);
            alert("❌ Admin Delete failed: " + err.message);
        }
    },

    async executeAdminMint() {
        if (!window.CoreEngine.userKeys.publicKey) return alert("Must be logged in.");
        const targetInput = document.getElementById('input-mint-recipient');
        const amountInput = document.getElementById('input-mint-amount');

        const target = targetInput.value.trim();
        const amount = amountInput.value.trim();

        if (!target) return alert("Please enter the target public key for the OTC Mint.");
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return alert("Please enter a valid positive amount to mint.");
        
        try {
            await window.CoreEngine.sendSignedTransaction('ADMIN_MINT', target, { amount: parseFloat(amount) });
            alert(`Successfully minted ${amount} $VOD to Node_${target.substring(0,6)}!`);
            
            targetInput.value = '';
            amountInput.value = '';

            if (typeof window.fetchUserProfile === 'function') {
                window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, false);
                if (window.viewingUserPublicKey === target) {
                    window.fetchUserProfile(target, false);
                }
            }
        } catch(err) { alert("OTC Mint failed: " + err.message); }
    },

    renderWalletDashboard() {
        const walletContainer = document.getElementById('view-wallet');
        if (!walletContainer) return;
        
        let actionArea = document.getElementById('ui-wallet-actions');
        if (!actionArea) {
            actionArea = document.createElement('div');
            actionArea.id = 'ui-wallet-actions';
            actionArea.style = "margin-bottom: 20px; padding: 15px; background: rgba(0,0,0,0.3); border-radius: 8px; border: 1px solid var(--border);";
            walletContainer.insertBefore(actionArea, walletContainer.firstChild);
        }
        
        actionArea.innerHTML = `
            <h3 style="color: var(--primary); margin-top: 0;">Wallet Operations</h3>
            <div style="display: flex; gap: 10px;">
                <button onclick="window.WalletEngine.promptSendCoinsDialog()" style="background: var(--primary); color: #000; padding: 8px 15px;">💸 Send $VOD (Wire Transfer)</button>
                <button class="secondary" onclick="window.WalletEngine.promptSendCoinsDialog()" style="padding: 8px 15px;">🔒 Send to Escrow / Smart Contract</button>
            </div>
        `;
    }
};