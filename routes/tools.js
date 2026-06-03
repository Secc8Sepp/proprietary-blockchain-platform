const express = require('express');
const router = express.Router();
const toolsController = require('../controllers/toolsController');

router.get('/stem-cost', toolsController.getStemSplitCost);

module.exports = router;