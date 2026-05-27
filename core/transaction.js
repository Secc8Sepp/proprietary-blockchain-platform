const crypto = require('crypto');
const Wallet = require('./wallet');

// JSON replacer to safely hash BigInt values without crashing
const bigIntReplacer = (key, value) => typeof value === 'bigint' ? value.toString() + 'n' : value;

class Transaction {
    constructor(senderAddress, recipientAddress, amount, type, payload = {}, timestamp = Date.now(), signature = '', id = '') {
        this.senderAddress = senderAddress;
        this.recipientAddress = recipientAddress;
        this.amount = BigInt(amount); // Enforces integer-safe scale
        this.type = type;
        this.payload = payload; 
        this.timestamp = timestamp;
        this.signature = signature;
        this.id = id || this.calculateHash();
    }

    calculateHash() {
        const dataStr = JSON.stringify({
            senderAddress: this.senderAddress,
            recipientAddress: this.recipientAddress,
            amount: this.amount,
            type: this.type,
            payload: this.payload,
            timestamp: this.timestamp
        }, bigIntReplacer);
        return crypto.createHash('sha256').update(dataStr).digest('hex');
    }

    sign(privateKeyPem) {
        if (this.senderAddress === 'SYSTEM') return;
        this.signature = Wallet.signData(privateKeyPem, this.id);
    }

    isValid() {
        if (this.id !== this.calculateHash()) return false;

        const PRECISION_SCALAR = 10n ** 27n;

        switch (this.type) {
            case 'MINT_REWARD':
                const MAX_PAYOUT = 5000n * PRECISION_SCALAR;
                return this.senderAddress === 'SYSTEM' && this.amount <= MAX_PAYOUT;

            case 'ASSET_MINT':
                if (!this.payload.fileHash) return false;
                return Wallet.verifySignature(this.senderAddress, this.id, this.signature);

            case 'PROFILE_UPDATE':
                if (!this.payload.css) return false;
                return Wallet.verifySignature(this.senderAddress, this.id, this.signature);

            case 'TRANSFER':
                if (!this.signature || this.amount <= 0n) return false;
                return Wallet.verifySignature(this.senderAddress, this.id, this.signature);

            case 'SYSTEM_INIT':
                return this.senderAddress === 'SYSTEM';

            default:
                return false; 
        }
    }
}

module.exports = Transaction;