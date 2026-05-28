const express = require('express');
const router = express.Router();
const Wallet = require('../core/wallet');

// Mock database to hold user profiles in memory
// (In production, replace this with MongoDB, PostgreSQL, or a Redis cache)
const usersDb = {};

// ==========================================
// WEB3 WALLET AUTHENTICATION
// ==========================================
router.post('/keygen', (req, res) => {
    try {
        const keys = Wallet.generateKeyPair();
        res.json(keys);
    } catch (err) {
        console.error("Keygen Error:", err);
        res.status(500).json({ success: false, error: "Failed to generate keys" });
    }
});

// This replaces /keygen. The frontend passes the Wallet Address and a Signature.
router.post('/verify', async (req, res) => {
    try {
        const body = req.body || {};
        const { address, signature } = body;

        if (!address || !signature) {
            return res.status(400).json({ success: false, error: "Missing address or signature" });
        }

        // Perform cryptographic signature verification
        const expectedMessage = "Sign this message to login to VOD Social.";
        const isValid = Wallet.verifySignature(address, expectedMessage, signature);

        if (!isValid) {
            return res.status(401).json({ success: false, error: "Invalid signature. Authentication failed." });
        }
        
        // If this is a brand new wallet connecting for the first time, 
        // mint their initial profile state!
        if (!usersDb[address]) {
            usersDb[address] = {
                publicKey: address,
                username: "Node_" + address.substring(0, 6),
                bio: "Active on the Vibe or Die Network.",
                balance: 100000, // Balance is fully determined by the immutable ledger
                avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${address}`,
                top8: [],
                css: ""
            };
            console.log(`✨ New Identity Minted: ${address}`);
        } else {
            console.log(`🔓 Existing Node Unlocked: ${address}`);
        }

        // Return success and the user's data to unlock the frontend UI
        res.json({
            success: true,
            user: usersDb[address]
        });

    } catch (err) {
        console.error("Auth Error:", err);
        res.status(500).json({ success: false, error: "Authentication failed" });
    }
});

module.exports = router;