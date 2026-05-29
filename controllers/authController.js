const Wallet = require('../core/wallet');

class AuthController {
    generateKeyPair(req, res) {
        try {
            const keys = Wallet.generateKeyPair();
            return res.status(200).json(keys);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
}

module.exports = new AuthController();