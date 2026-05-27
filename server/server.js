const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const Blockchain = require('../core/blockchain');
const Transaction = require('../core/transaction');
const { P2PServer, MessageType } = require('../core/p2p');
const multer = require('multer');
const upload = multer({ dest: 'mock_ipfs/' });

const httpPort = process.env.HTTP_PORT || 3001;
const p2pPort = process.env.P2P_PORT || 6001;
const seedPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];

const blockchain = new Blockchain();
const p2pEngine = new P2PServer(blockchain, p2pPort);
p2pEngine.listen(seedPeers);

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/chain', (req, res) => res.json(blockchain.chain));
app.get('/api/balance/:address', (req, res) => res.json({ balance: blockchain.getBalance(req.params.address) }));
app.get('/api/profile/:address', (req, res) => res.json({ css: blockchain.getProfileTheme(req.params.address) }));

app.post('/api/transactions/transact', (req, res) => {
    const { senderAddress, recipientAddress, amount, type, payload, signature } = req.body;
    const tx = new Transaction(senderAddress, recipientAddress, amount, type, payload, Date.now(), signature);
    blockchain.addTransaction(tx);
    p2pEngine.broadcast({ type: MessageType.BROADCAST_TRANSACTION, data: tx });
    const b = blockchain.minePendingTransactions();
    p2pEngine.broadcast({ type: MessageType.BROADCAST_BLOCK, data: JSON.stringify(b) });
    res.json({ success: true });
});

app.post('/api/stream/verify', (req, res) => {
    const { listenerAddress, artistAddress } = req.body;
    const t1 = new Transaction('0000000000000000000000000000000000000000', listenerAddress, 0.15, 'MINT_REWARD');
    const t2 = new Transaction('0000000000000000000000000000000000000000', artistAddress, 0.85, 'MINT_REWARD');
    blockchain.addTransaction(t1); blockchain.addTransaction(t2);
    const b = blockchain.minePendingTransactions();
    p2pEngine.broadcast({ type: MessageType.BROADCAST_BLOCK, data: JSON.stringify(b) });
    res.json({ success: true });
});

io.on('connection', (socket) => {
    socket.on('joinChannel', (c) => socket.join(c));
    socket.on('chatMessage', (d) => io.to(d.channel).emit('messageOut', { username: d.username, message: d.message, timestamp: new Date().toLocaleTimeString() }));
});

app.post('/api/upload', upload.single('myFile'), (req, res) => {
    res.json({ success: true, fileName: req.file.filename });
});

server.listen(httpPort, () => console.log(`Server running on port ${httpPort}`));