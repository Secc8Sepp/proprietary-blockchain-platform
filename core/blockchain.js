const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Transaction = require('./transaction');

// BigInt JSON Handlers for Local Disk I/O
const bigIntReplacer = (key, value) => typeof value === 'bigint' ? value.toString() + 'n' : value;
const bigIntReviver = (key, value) => {
    if (typeof value === 'string' && value.endsWith('n')) return BigInt(value.slice(0, -1));
    return value;
};

class Block {
    constructor(index, timestamp, transactions, previousHash, nonce = 0, hash = '') {
        this.index = index;
        this.timestamp = timestamp;
        this.transactions = transactions.map(tx => 
            tx instanceof Transaction ? tx : new Transaction(tx.senderAddress, tx.recipientAddress, tx.amount, tx.type, tx.payload, tx.timestamp, tx.signature, tx.id)
        );
        this.previousHash = previousHash;
        this.nonce = nonce;
        this.hash = hash || this.calculateHash();
    }

    calculateHash() {
        const txHashes = this.transactions.map(tx => tx.id).join('');
        return crypto.createHash('sha256').update(this.index + this.timestamp + txHashes + this.previousHash + this.nonce).digest('hex');
    }

    mine(difficulty) {
        const target = '0'.repeat(difficulty);
        while (!this.hash.startsWith(target)) {
            this.nonce++;
            this.hash = this.calculateHash();
        }
    }
}

class Blockchain {
    constructor() {
        this.chainPath = path.join(__dirname, '../ledger_data/chain.json');
        this.difficulty = 3; 
        this.mempool = [];
        this.PRECISION_SCALAR = 10n ** 27n;
        
        if (!fs.existsSync(path.dirname(this.chainPath))) {
            fs.mkdirSync(path.dirname(this.chainPath), { recursive: true });
        }
        this.loadChain();
    }

    createGenesisBlock() {
        const tx = new Transaction('SYSTEM', 'SYSTEM', 0n, 'SYSTEM_INIT', { msg: 'Vibe or Die Genesis' });
        const genesisBlock = new Block(0, Date.now(), [tx], '0');
        genesisBlock.mine(this.difficulty);
        return genesisBlock;
    }

    loadChain() {
        if (fs.existsSync(this.chainPath)) {
            try {
                const fileData = fs.readFileSync(this.chainPath, 'utf8');
                const parsedData = JSON.parse(fileData, bigIntReviver);
                this.chain = parsedData.map(b => new Block(b.index, b.timestamp, b.transactions, b.previousHash, b.nonce, b.hash));
            } catch(e) {
                this.chain = [this.createGenesisBlock()];
                this.saveChain();
            }
        } else {
            this.chain = [this.createGenesisBlock()];
            this.saveChain();
        }
    }

    saveChain() {
        fs.writeFileSync(this.chainPath, JSON.stringify(this.chain, bigIntReplacer, 2), 'utf8');
    }

    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }

    addTransaction(tx) {
        if (!tx.isValid()) throw new Error('Transaction validation failed.');
        
        if (tx.senderAddress !== 'SYSTEM') {
            if (this.getBalance(tx.senderAddress) < tx.amount) throw new Error('Insufficient VODCOINS.');
        }

        this.mempool.push(tx);
        return true;
    }

    // --- L2E Anti-Bot Verification Gateway ---
    processStreamTicket(artistAddress, listenerAddress, streamDurationSeconds, trackHash) {
        if (streamDurationSeconds < 30) {
            throw new Error('Stream rejected: Under 30 seconds.');
        }

        const totalMint = 5000n * this.PRECISION_SCALAR; 
        const artistCut = (totalMint * 85n) / 100n;
        const listenerCut = (totalMint * 15n) / 100n;

        this.addTransaction(new Transaction('SYSTEM', artistAddress, artistCut, 'MINT_REWARD', { track: trackHash }));
        this.addTransaction(new Transaction('SYSTEM', listenerAddress, listenerCut, 'MINT_REWARD', { track: trackHash }));
        return true;
    }

    // --- NFT Asset Minting ---
    mintAsset(artistAddress, fileHash, metadata, signature) {
        if (this.getAssetOwner(fileHash) !== null) {
            throw new Error('Asset hash already exists on ledger.');
        }

        const mintTx = new Transaction(
            artistAddress, 'SYSTEM', 0n, 'ASSET_MINT', 
            { fileHash, metadata }, Date.now(), signature
        );
        this.addTransaction(mintTx);
        return true;
    }

    getAssetOwner(fileHash) {
        let owner = null;
        for (const block of this.chain) {
            for (const tx of block.transactions) {
                if (tx.type === 'ASSET_MINT' && tx.payload.fileHash === fileHash) {
                    owner = tx.senderAddress;
                }
            }
        }
        return owner;
    }

    minePendingTransactions() {
        if (this.mempool.length === 0) return null;

        const newBlock = new Block(
            this.getLatestBlock().index + 1, Date.now(), [...this.mempool], this.getLatestBlock().hash
        );

        newBlock.mine(this.difficulty);
        this.chain.push(newBlock);
        this.mempool = [];
        this.saveChain();
        
        return newBlock;
    }

    getBalance(address) {
        let balance = 0n; 
        for (const block of this.chain) {
            for (const tx of block.transactions) {
                if (tx.recipientAddress === address) balance += tx.amount;
                if (tx.senderAddress === address) balance -= tx.amount;
            }
        }
        return balance;
    }

    getProfileTheme(address) {
        let css = '';
        for (const block of this.chain) {
            for (const tx of block.transactions) {
                if (tx.type === 'PROFILE_UPDATE' && tx.senderAddress === address) {
                    css = tx.payload.css || css; 
                }
            }
        }
        return css;
    }
}

module.exports = Blockchain;