const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const blockchainService = require('../services/blockchainService');
const Wallet = require('../core/wallet');

const USER_DB_FILE = path.join(__dirname, '../user_credentials.json');
let userCredentials = {};
if (fs.existsSync(USER_DB_FILE)) {
    try {
        userCredentials = JSON.parse(fs.readFileSync(USER_DB_FILE, 'utf8'));
    } catch (e) { console.error('Error loading user credentials DB:', e); }
}
function saveUserCredentials() {
    fs.writeFileSync(USER_DB_FILE, JSON.stringify(userCredentials, null, 2));
}

// Expose this so the main server can still purge users if they are deleted by admins
function deleteUserCredential(publicKey) {
    for (const username in userCredentials) {
        if (userCredentials[username].publicKey === publicKey) {
            delete userCredentials[username];
            saveUserCredentials();
            console.log(`[PURGE] Removed username '${username}' from credentials DB.`);
        }
    }
}

router.post('/keygen', (req, res) => {
    try {
        const keys = Wallet.generateKeyPair();
        res.status(201).json(keys);
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate keys: ' + error.message });
    }
});

router.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }
    if (userCredentials[username.toLowerCase()]) {
        return res.status(409).json({ error: 'Username is already taken.' });
    }

    try {
        const salt = crypto.randomBytes(16).toString('hex');
        crypto.pbkdf2(password, salt, 100000, 32, 'sha512', (err, derivedKey) => {
            if (err) return res.status(500).json({ error: 'Key derivation failed.' });
            const privateKeyHex = derivedKey.toString('hex');
            const keyPair = blockchainService.ec.keyFromPrivate(privateKeyHex);
            const publicKeyHex = keyPair.getPublic('hex');

            userCredentials[username.toLowerCase()] = { salt, publicKey: publicKeyHex };
            saveUserCredentials();
            res.status(201).json({ privateKey: privateKeyHex, publicKey: publicKeyHex });
        });
    } catch (e) {
        res.status(500).json({ error: 'Key generation failed: ' + e.message });
    }
});

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
    const userData = userCredentials[username.toLowerCase()];
    if (!userData) return res.status(401).json({ error: 'Invalid credentials.' });
    crypto.pbkdf2(password, userData.salt, 100000, 32, 'sha512', (err, derivedKey) => {
        if (err) return res.status(500).json({ error: 'Authentication failed.' });
        const keyPair = blockchainService.ec.keyFromPrivate(derivedKey.toString('hex'));
        if (keyPair.getPublic('hex') === userData.publicKey) res.json({ privateKey: derivedKey.toString('hex'), publicKey: userData.publicKey });
        else res.status(401).json({ error: 'Invalid credentials.' });
    });
});

module.exports = { router, deleteUserCredential };