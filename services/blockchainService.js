const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const Wallet = require('../core/wallet');
const { BALANCE_EXEMPT_ACTIONS, ADMIN_ACTIONS } = require('../config/txTypes');

function normalizeAddress(address) {
    if (!address || typeof address !== 'string') return null;
    return address.trim().replace(/^0x/i, '').toLowerCase();
}

// ==========================================
// ADMIN CONFIGURATION
// ==========================================
// Set your admin public key here. If configured, this address will always be recognized as the network admin.
// If not configured (null), the first user to perform a transaction becomes admin.
const CONFIGURED_ADMIN_ADDRESS = normalizeAddress('3056301006072a8648ce3d020106052b8104000a034200049b412e497874ec237606ac926aaf1e70654e3155fa5d6421b1eb8f018c0c68c6ec17b5c94a9bd7ab6fc34c38760e9f02686dafe2163712416c51cf5ef6826d43');

const LEDGER_DIR = path.join(__dirname, '..', 'ledger-data');
if (!fs.existsSync(LEDGER_DIR)) {
    fs.mkdirSync(LEDGER_DIR, { recursive: true });
}
const CHAIN_FILE = path.join(LEDGER_DIR, 'chain.json');

class BlockchainService extends EventEmitter {
    constructor() {
        super();
        this.initializeChainFile();
        this.stemSplitUsage = {
            lastReset: Date.now(),
            globalCount: 0,
            userCounts: {}
        };
    }

    initializeChainFile() {
        if (!fs.existsSync(CHAIN_FILE)) {
            const genesisBlock = {
                index: 0,
                timestamp: 1700000000000,
                transactions: [],
                previousHash: "0",
                nonce: 0,
                hash: "00000"
            };
            fs.writeFileSync(CHAIN_FILE, JSON.stringify([genesisBlock], null, 2));
        }
    }

    getChain() {
        try {
            const data = fs.readFileSync(CHAIN_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error(`[BLOCKCHAIN ERROR] Failed to read or parse ${CHAIN_FILE}:`, error.message);
            console.error("Falling back to a fresh Genesis block to prevent server crash.");
            return [
                {
                    index: 0,
                    timestamp: 1700000000000,
                    transactions: [],
                    previousHash: "0",
                    nonce: 0,
                    hash: "00000"
                }
            ];
        }
    }

    getBlockByHash(hash) {
        const chain = this.getChain();
        return chain.find(b => b.hash === hash);
    }

    saveChain(chain) {
        fs.writeFileSync(CHAIN_FILE, JSON.stringify(chain, null, 2));
    }

    getLatestBlock() {
        const chain = this.getChain();
        return chain[chain.length - 1];
    }

    calculateHash(index, previousHash, timestamp, transactions, nonce) {
        return crypto
            .createHash('sha256')
            .update(index + previousHash + timestamp + JSON.stringify(transactions) + nonce)
            .digest('hex');
    }

    getAdminAddress(chain) {
        // If admin is configured, always return it
        if (CONFIGURED_ADMIN_ADDRESS) {
            return CONFIGURED_ADMIN_ADDRESS;
        }

        // Otherwise, return the first user to perform any transaction (fallback)
        for (const block of chain) {
            for (const tx of block.transactions) {
                if (tx.sender) {
                    return tx.sender; // The first user to ever perform a transaction becomes admin
                }
            }
        }
        return null;
    }

    verifySignature(publicKeyStr, data, signatureHex) {
        try {
            const dataStr = JSON.stringify(data);
            const normalizedKey = normalizeAddress(publicKeyStr);

            // Use the correct verification from core/wallet.js which uses ECDSA
            return Wallet.verifySignature(normalizedKey, dataStr, signatureHex);
        } catch (error) {
            console.error("Signature verification failed:", error);
            return false;
        }
    }

    calculateStemSplitCost(publicKey) {
        const now = Date.now();
        if (now - this.stemSplitUsage.lastReset > 24 * 60 * 60 * 1000) {
            this.stemSplitUsage = { lastReset: now, globalCount: 0, userCounts: {} };
        }

        const baseCost = 100000;
        const userUsageToday = this.stemSplitUsage.userCounts[publicKey] || 0;
        const globalUsageToday = this.stemSplitUsage.globalCount || 0;

        const personalEscalation = Math.pow(userUsageToday, 2) * 10000; 
        const networkCongestion = globalUsageToday * 500; 

        return baseCost + personalEscalation + networkCongestion;
    }

    // THE ATTENTION ECONOMY CALCULATOR
    calculateBalance(publicKey, chain) {
        let balance = 100000; // Starting faucet to afford initial transactions
        const assetShareDistribution = {};
        const escrowContracts = {};
        const openBounties = {};
        const songListings = {};
        const shareRequests = {};

        // The Admin receives the Genesis Airdrop to jumpstart the economy
        const adminAddress = this.getAdminAddress(chain);
        if (publicKey === adminAddress) balance += 1000000000; // 1 Billion $VOD Airdrop

        for (const block of chain) {
            for (const tx of block.transactions) {
                
                // --- DEFLATIONARY ASSET MINTING ---
                if (tx.type === 'SONG_UPLOAD' || tx.type === 'IMAGE_POST' || tx.type === 'VIDEO_POST' || tx.type === 'PROJECT_FILE_POST') {
                    const assetHash = tx.data.audioHash || tx.data.imageHash || tx.data.videoHash || tx.data.fileHash;
                    if (!assetHash) continue;
                    assetShareDistribution[assetHash] = assetShareDistribution[assetHash] || {};

                    let remainingShares = parseInt(tx.data.totalShares) || 100;
                    if (tx.data.collaborators && Array.isArray(tx.data.collaborators)) {
                        for (const collab of tx.data.collaborators) {
                            const percent = parseInt(collab.percentage) || 0;
                            if (percent > 0 && remainingShares >= percent) {
                                assetShareDistribution[assetHash][collab.address] = (assetShareDistribution[assetHash][collab.address] || 0) + percent;
                                remainingShares -= percent;
                            }
                        }
                    }
                    if (remainingShares > 0) {
                        assetShareDistribution[assetHash][tx.sender] = (assetShareDistribution[assetHash][tx.sender] || 0) + remainingShares;
                    }

                    // Minting cost varies by type
                    if (tx.type === 'SONG_UPLOAD') {
                        if (tx.sender === publicKey) balance -= 50000; // Cost to mint track (50k VOD)
                    } else if (tx.type === 'IMAGE_POST') {
                        if (tx.sender === publicKey) balance -= 5000; // Image mint cost
                    } else if (tx.type === 'VIDEO_POST') {
                        const baseCost = 5000000; // large cost
                        const sizePenalty = tx.data.fileSize ? Math.floor(tx.data.fileSize / 1024) * 100 : 0;
                        if (tx.sender === publicKey) balance -= (baseCost + sizePenalty);
                    } else if (tx.type === 'PROJECT_FILE_POST') {
                        if (tx.sender === publicKey) balance -= 15000;
                    }

                    if (tx.data.forStake) {
                        const assetListings = songListings; // reuse existing variable name for compatibility
                        assetListings[assetHash] = {
                            price: parseFloat(tx.data.pricePerShare) || 0,
                            available: parseInt(tx.data.sellPercentage) || 0,
                            totalShares: parseInt(tx.data.totalShares) || 100
                        };
                    }
                }
                if (tx.type === 'IMAGE_POST') {
                    if (tx.sender === publicKey) balance -= 5000; // Cost to mint image (5k VOD)
                }
                if (tx.type === 'VIDEO_POST') {
                    const baseCost = 5000000; // 100x standard 50k VOD cost
                    const sizePenalty = tx.data.fileSize ? Math.floor(tx.data.fileSize / 1024) * 100 : 0; // 100 VOD per KB
                    if (tx.sender === publicKey) balance -= (baseCost + sizePenalty);
                }
                if (tx.type === 'PROJECT_FILE_POST') {
                    if (tx.sender === publicKey) balance -= 15000; // Cost to mint project file (15k VOD)
                }

                // --- ZERO-SUM TRANSFERS ---
                if (tx.type === 'BUY_SONG_SHARE') {
                    const assetHash = tx.data.audioHash || tx.data.imageHash || tx.data.videoHash || tx.data.fileHash;
                    const buyer = tx.sender;
                    const seller = tx.receiver;
                    const count = parseInt(tx.data.shareCount) || 0;
                    const totalCost = count * (parseFloat(tx.data.pricePerShare) || 0);
                    const listing = songListings[assetHash];

                    if (listing && listing.available >= count && listing.price === parseFloat(tx.data.pricePerShare) && assetShareDistribution[assetHash] && (assetShareDistribution[assetHash][seller] >= count)) {
                        if (buyer === publicKey) balance -= totalCost;
                        if (seller === publicKey) balance += totalCost;
                        assetShareDistribution[assetHash][seller] -= count;
                        if (!assetShareDistribution[assetHash][buyer]) assetShareDistribution[assetHash][buyer] = 0;
                        assetShareDistribution[assetHash][buyer] += count;
                        listing.available -= count;
                    }
                }
                if (tx.type === 'TRANSFER_COIN') {
                    const amt = parseFloat(tx.data.amount) || 0;
                    if (tx.sender === publicKey) balance -= amt;
                    if (tx.receiver === publicKey) balance += amt;
                }

                // --- INFLATIONARY MINTING (PROOF-OF-ENGAGEMENT) ---
                if (tx.type === 'STREAM_COMPLETED') {
                    const audioHash = tx.data.audioHash;
                    // Listener mines 5,000 $VOD for their attention
                    if (tx.sender === publicKey) balance += 5000; 
                    
                    // Dividend splits: 20,000 $VOD minted and split across shareholders
                    const sharesTable = assetShareDistribution[audioHash];
                    if (sharesTable) {
                        for (const [holderKey, sharesOwned] of Object.entries(sharesTable)) {
                            if (sharesOwned > 0 && holderKey === publicKey) {
                                balance += (sharesOwned / 100) * 20000;
                            }
                        }
                    }
                }
                if (tx.type === 'LIKE_IMAGE') {
                    // Curator mines 500 $VOD, Creator mines 2000 $VOD
                    if (tx.sender === publicKey) balance += 500;
                    if (tx.receiver === publicKey) balance += 2000;
                }
                if (tx.type === 'LIKE_POST') {
                    // Curator mines 500 $VOD, Creator mines 2000 $VOD
                    if (tx.sender === publicKey) balance += 500;
                    if (tx.receiver === publicKey) balance += 2000;
                }

                // --- ESCROW & COMMISSIONS ---
                if (tx.type === 'CREATE_COMMISSION') {
                    const amt = parseFloat(tx.data.amount) || 0;
                    escrowContracts[block.hash] = { amount: amt, creator: tx.receiver, fulfilled: false };
                    if (tx.sender === publicKey) balance -= amt; // Lock funds out of buyer's wallet
                }
                if (tx.type === 'FULFILL_COMMISSION') {
                    const contract = escrowContracts[tx.data.commissionId];
                    if (contract && !contract.fulfilled && tx.sender === contract.creator) {
                        contract.fulfilled = true;
                        if (tx.sender === publicKey) balance += contract.amount; // Release funds to creator
                    }
                }

                // --- OPEN MARKETPLACE ---
                if (tx.type === 'LIST_ITEM') {
                    if (tx.sender === publicKey) balance -= 500; // 500 $VOD Listing Tax
                }
                if (tx.type === 'CREATE_BOUNTY') {
                    const amt = parseFloat(tx.data.amount) || 0;
                    openBounties[block.hash] = { amount: amt, creator: tx.sender, awarded: false };
                    if (tx.sender === publicKey) balance -= amt; // Lock funds
                }
                if (tx.type === 'AWARD_BOUNTY') {
                    const bounty = openBounties[tx.data.bountyId];
                    if (bounty && !bounty.awarded && tx.sender === bounty.creator) {
                        bounty.awarded = true;
                        if (tx.data.winner === publicKey) balance += bounty.amount; // Pay the winner
                    }
                }
                if (tx.type === 'BUY_ITEM') {
                    const price = parseFloat(tx.data.price) || 0;
                    const networkTax = price * 0.05; // 5% Sales Tax burned to the network
                    const netEarnings = price - networkTax;

                    if (tx.sender === publicKey) balance -= price; // Buyer pays full price
                    if (tx.receiver === publicKey) balance += netEarnings; // Seller gets 95%
                }

                if (tx.type === 'PURCHASE_ZINE_RIGHTS') {
                    const price = parseFloat(tx.data.price) || 0;
                    if (tx.sender === publicKey) balance -= price;
                    if (tx.receiver === publicKey) balance += price; // No tax on zine rights for now
                }


                // --- ERC-20 BRIDGE (LAYER 1 <-> LAYER 2) ---
                if (tx.type === 'BRIDGE_WITHDRAW') {
                    const amt = parseFloat(tx.data.amount) || 0;
                    if (tx.sender === publicKey) balance -= amt; // Burn local VOD to mint ERC-20
                }
                if (tx.type === 'BRIDGE_DEPOSIT') {
                    const amt = parseFloat(tx.data.amount) || 0;
                    if (tx.receiver === publicKey) balance += amt; // Lock ERC-20 to mint local VOD
                }

                // --- TOOLS ---
                if (tx.type === 'STEM_SPLIT') {
                    if (tx.sender === publicKey) balance -= tx.data.cost;
                }

                // --- ADMIN OTC MINTING (INVESTORS) ---
                if (tx.type === 'ADMIN_MINT') {
                    if (tx.sender === adminAddress && tx.receiver === publicKey) {
                        balance += parseFloat(tx.data.amount) || 0; // Create $VOD out of thin air for the investor
                    }
                }

                // --- HOT OR NOT ---
                if (tx.type === 'VOTE_HOT_OR_NOT') {
                    if (tx.sender === publicKey) balance += 100; // Voter reward
                    if (tx.receiver === publicKey && tx.data.vote === 1) balance += 500; // Submitter reward for upvotes
                }
            }
        }
        return Math.floor(balance);
    }

    addTransaction(txData) {
        const { sender, receiver, type: rawType, data, timestamp, signature } = txData;
        const type = (rawType || '').toString().trim().toUpperCase();
        const chain = this.getChain();

        if (!this.verifySignature(sender, { sender, receiver, type, data, timestamp }, signature)) {
            throw new Error("Invalid transaction signature.");
        }

        if (type === 'LIKE_SONG' || type === 'UNLIKE_SONG') {
            if (!data.songId) throw new Error('Missing songId for like action.');
        }

        if (type === 'REPOST_POST') {
            if (!data.originalTxHash) throw new Error('Missing originalTxHash for repost action.');
            // Optional caption validation
            if (data.caption && (typeof data.caption !== 'string' || data.caption.length > 280)) throw new Error('Invalid repost caption (max 280 chars).');
        }

        const currentBalance = this.calculateBalance(sender, chain);
        // Skip balance checks for certain types that don't consume balance
        const balanceRequired = !BALANCE_EXEMPT_ACTIONS.includes(type);

        // --- Centralized Admin Action Authorization ---
        if (ADMIN_ACTIONS.includes(type)) {
            const adminAddress = this.getAdminAddress(chain);
            const normalizedSender = normalizeAddress(sender);
            console.log(`[ADMIN ACTION] Type: ${type}, Sender: ${normalizedSender ? normalizedSender.substring(0,8) + '...' : sender}, AdminAddr: ${adminAddress ? adminAddress.substring(0,8) + '...' : 'NONE'}`);
            if (!adminAddress) {
                console.log(`[BOOTSTRAP] No admin found. Sender ${normalizedSender ? normalizedSender.substring(0,8) + '...' : sender} is becoming the network admin.`);
            } else if (normalizedSender !== adminAddress) {
                console.error(`[AUTH FAILED] ${normalizedSender ? normalizedSender.substring(0,8) + '...' : sender} attempted ${type} but admin is ${adminAddress.substring(0,8)}...`);
                throw new Error(`Unauthorized: Only the network admin (${adminAddress.substring(0,8)}...) can perform ${type}.`);
            } else {
                console.log(`[AUTH SUCCESS] ${normalizedSender.substring(0,8)}... authorized for ${type}.`);
            }
        }
        
        if (balanceRequired) {
            if (type === 'TRANSFER_COIN' && currentBalance < parseFloat(data.amount)) throw new Error("Insufficient funds for wire.");
            if (type === 'BUY_SONG_SHARE' && currentBalance < (parseInt(data.shareCount) * parseFloat(data.pricePerShare))) throw new Error("Insufficient funds for equity trade.");
            if (type === 'REQUEST_SONG_SHARE' && currentBalance < (parseInt(data.shareCount) * parseFloat(data.pricePerShare))) throw new Error("Insufficient funds to request equity.");
            if (type === 'SONG_UPLOAD' && currentBalance < 50000) throw new Error("Need 50,000 $VOD to mint a track.");
            if (type === 'VIDEO_POST') {
                const baseCost = 5000000;
                const sizePenalty = data.fileSize ? Math.floor(data.fileSize / 1024) * 100 : 0;
                const totalCost = baseCost + sizePenalty;
                if (currentBalance < totalCost) throw new Error(`Need ${totalCost.toLocaleString()} $VOD to mint a video of this size.`);
            }
            if (type === 'PROJECT_FILE_POST' && currentBalance < 15000) throw new Error("Need 15,000 $VOD to mint a project file.");
            if (type === 'BUY_ITEM' && currentBalance < parseFloat(data.price)) throw new Error("Insufficient funds for purchase.");
            if (type === 'LIST_ITEM' && currentBalance < 500) throw new Error("Need 500 $VOD to list an item on the market.");
            if (type === 'CREATE_BOUNTY' && currentBalance < parseFloat(data.amount)) throw new Error("Insufficient funds for bounty.");
            if (type === 'PURCHASE_ZINE_RIGHTS' && currentBalance < parseFloat(data.price)) throw new Error("Insufficient funds to purchase Zine rights.");
            if (type === 'BRIDGE_WITHDRAW' && currentBalance < parseFloat(data.amount)) throw new Error("Insufficient funds for bridge withdrawal.");
            if (type === 'STEM_SPLIT') {
                const expectedCost = this.calculateStemSplitCost(sender);
                // Security check: ensure user isn't submitting a fraudulent (lower) cost
                if (data.cost !== expectedCost) throw new Error(`Cost mismatch. Network expects ${expectedCost}, you sent ${data.cost}.`);
                if (currentBalance < expectedCost) throw new Error(`Insufficient funds for Stem Split. You need ${expectedCost.toLocaleString()} $VOD.`);
            }
        }

        if (type === 'SUBMIT_HOT_OR_NOT') {
            const category = data.category || 'music';
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            const recentSubmissions = chain.flatMap(b => b.transactions).filter(t => t.type === 'SUBMIT_HOT_OR_NOT' && t.sender === sender && t.timestamp > oneDayAgo && (t.data.category || 'music') === category);
            if (recentSubmissions.length > 0) throw new Error(`You can only submit 1 item per day to the ${category} category.`);
        }

        if (type === 'VOTE_HOT_OR_NOT') {
            // Prevent voting for your own submission
            try {
                const submissionId = data.submissionId;
                if (submissionId) {
                    const submissionBlock = chain.find(b => b.hash === submissionId);
                    if (submissionBlock) {
                        const submissionTx = submissionBlock.transactions.find(t => t.type === 'SUBMIT_HOT_OR_NOT');
                        if (submissionTx && submissionTx.sender === sender) {
                            throw new Error('You cannot vote on your own submission.');
                        }
                    }
                }
            } catch (e) { throw e; }
        }

        const latestBlock = this.getLatestBlock();
        const nextIndex = latestBlock.index + 1;
        const nextTimestamp = Date.now();
        const transactions = [txData];
        
        let nonce = 0;
        let hash = this.calculateHash(nextIndex, latestBlock.hash, nextTimestamp, transactions, nonce);
        while (!hash.startsWith('00')) {
            nonce++;
            hash = this.calculateHash(nextIndex, latestBlock.hash, nextTimestamp, transactions, nonce);
        }

        const newBlock = { index: nextIndex, timestamp: nextTimestamp, transactions, previousHash: latestBlock.hash, nonce, hash };
        chain.push(newBlock);
        this.saveChain(chain);

        // Post-transaction state updates
        if (type === 'STEM_SPLIT') {
            this.stemSplitUsage.globalCount++;
            this.stemSplitUsage.userCounts[sender] = (this.stemSplitUsage.userCounts[sender] || 0) + 1;
        }

        this.emit('new_block', newBlock);
        return newBlock;
    }
}

module.exports = new BlockchainService();