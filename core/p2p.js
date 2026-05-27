const WebSocket = require('ws');
const MessageType = { QUERY_LATEST: 0, RESPONSE_LATEST: 1, QUERY_ALL: 2, RESPONSE_CHAIN: 3, BROADCAST_TRANSACTION: 4, BROADCAST_BLOCK: 5 };

class P2PServer {
    constructor(blockchain, p2pPort) { this.blockchain = blockchain; this.p2pPort = p2pPort; this.sockets = []; }
    listen(peers = []) {
        const server = new WebSocket.Server({ port: this.p2pPort });
        server.on('connection', ws => this.initConnection(ws));
        peers.forEach(p => this.connectToPeer(p));
    }
    connectToPeer(peer) {
        const ws = new WebSocket(peer);
        ws.on('open', () => this.initConnection(ws));
    }
    initConnection(ws) {
        this.sockets.push(ws);
        ws.on('message', data => {
            const msg = JSON.parse(data);
            if (msg.type === MessageType.QUERY_LATEST) ws.send(JSON.stringify({ type: MessageType.RESPONSE_LATEST, data: JSON.stringify(this.blockchain.getLatestBlock()) }));
            if (msg.type === MessageType.QUERY_ALL) ws.send(JSON.stringify({ type: MessageType.RESPONSE_CHAIN, data: JSON.stringify(this.blockchain.chain) }));
            if (msg.type === MessageType.RESPONSE_LATEST) {
                const b = JSON.parse(msg.data);
                if (b.index > this.blockchain.getLatestBlock().index) this.blockchain.chain.push(b); this.blockchain.saveChain();
            }
            if (msg.type === MessageType.RESPONSE_CHAIN) this.blockchain.replaceChain(JSON.parse(msg.data));
        });
        ws.send(JSON.stringify({ type: MessageType.QUERY_LATEST }));
    }
    broadcast(msg) { this.sockets.forEach(s => s.send(JSON.stringify(msg))); }
}
module.exports = { P2PServer, MessageType };