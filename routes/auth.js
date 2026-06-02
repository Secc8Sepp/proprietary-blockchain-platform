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

function deleteUserCredential(publicKey) {
    for (const username in userCredentials) {
        if (userCredentials[username].publicKey === publicKey) {
            delete userCredentials[username];
            saveUserCredentials();
            console.log(`[PURGE] Removed username '${username}' from credentials DB.`);
        }
    }
}

router.post('/keygen', async (req, res) => {
    try {
        const keys = await Wallet.generateKeyPair();
        return res.status(201).json(keys);
    } catch (error) {
        return res.status(500).json({ error: 'Failed to generate keys: ' + error.message });
    }
});

router.post('/sign', async (req, res) => {
    try {
        const { privateKeyHex, dataString } = req.body;
        if (!privateKeyHex || !dataString) {
            return res.status(400).json({ error: 'Private key and data string are required.' });
        }
        const signature = await Wallet.signData(privateKeyHex, dataString);
        return res.status(200).json({ signature });
    } catch (error) {
        return res.status(500).json({ error: 'Signing failed: ' + error.message });
    }
});

router.post('/register', (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required.' });
        }
        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Invalid username or password format.' });
        }
        if (userCredentials[username.toLowerCase()]) {
            return res.status(409).json({ error: 'Username is already taken.' });
        }

        const salt = crypto.randomBytes(16).toString('hex');
        crypto.pbkdf2(password, salt, 100000, 32, 'sha512', async (err, derivedKey) => {
            if (err) return res.status(500).json({ error: 'Key derivation failed.' });
            try {
                const privateKeyHex = derivedKey.toString('hex');
                const publicKeyHex = await Wallet.getPublicKeyFromPrivate(privateKeyHex);

                userCredentials[username.toLowerCase()] = { salt, publicKey: publicKeyHex };
                saveUserCredentials();
                return res.status(201).json({ privateKey: privateKeyHex, publicKey: publicKeyHex });
            } catch (innerErr) {
                return res.status(500).json({ error: 'Key processing failed: ' + innerErr.message });
            }
        });
    } catch (e) {
        return res.status(500).json({ error: 'Registration failed: ' + e.message });
    }
});

router.post('/login', (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Invalid username or password format.' });
        }
        const userData = userCredentials[username.toLowerCase()];
        if (!userData) return res.status(401).json({ error: 'Invalid credentials.' });
        crypto.pbkdf2(password, userData.salt, 100000, 32, 'sha512', async (err, derivedKey) => {
            if (err) return res.status(500).json({ error: 'Authentication failed.' });
            try {
                const privateKeyHex = derivedKey.toString('hex');
                const publicKeyHex = await Wallet.getPublicKeyFromPrivate(privateKeyHex);
                
                if (publicKeyHex === userData.publicKey) return res.json({ privateKey: privateKeyHex, publicKey: userData.publicKey });
                else return res.status(401).json({ error: 'Invalid credentials.' });
            } catch (innerErr) {
                return res.status(500).json({ error: 'Login key processing failed: ' + innerErr.message });
            }
        });
    } catch (e) {
        return res.status(500).json({ error: 'Login failed: ' + e.message });
    }
});

module.exports = { router, deleteUserCredential };