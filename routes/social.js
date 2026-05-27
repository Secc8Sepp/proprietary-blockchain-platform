const express = require('express');
const router = express.Router();
const socialController = require('../controllers/socialController');

// Changed from /profile/:publicKey to a clean /profile endpoint
router.get('/profile', socialController.getProfileData);
router.get('/market', socialController.getMarketplace);
router.post('/action', socialController.handleAction);

module.exports = router;