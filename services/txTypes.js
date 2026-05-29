/**
 * @file Centralized configuration for all blockchain transaction types.
 * This file serves as the single source of truth for transaction validation,
 * routing, and business logic across the backend services.
 */

// Actions handled by the specialized social controller for profile/graph management.
const SOCIAL_ACTIONS = [
    'PROFILE_UPDATE',
    'THEME_UPDATE',
    'SET_TOP_8',
    'FOLLOW_USER',
];

// Actions requiring administrative privileges.
const ADMIN_ACTIONS = [
    'ADMIN_MINT',
    'ADMIN_DELETE_USER',
];

// General-purpose interactions handled by the main feed controller.
const FEED_INTERACTIONS = [
    'SONG_UPLOAD', 'IMAGE_POST', 'VIDEO_POST', 'PROJECT_FILE_POST', 'STORY_POST',
    'TEXT_POST', 'LIKE_IMAGE', 'LIKE_POST', 'REPLY_POST', 'DELETE_POST',
    'STREAM_COMPLETED', 'BUY_SONG_SHARE', 'TRANSFER_COIN', 'SHOUTBOX_POST',
    'CREATE_COMMISSION', 'FULFILL_COMMISSION', 'CREATE_BOUNTY', 'SUBMIT_BOUNTY',
    'AWARD_BOUNTY', 'LIST_ITEM', 'BUY_ITEM', 'BRIDGE_WITHDRAW', 'BRIDGE_DEPOSIT',
    'REQUEST_SONG_SHARE', 'ACCEPT_SHARE_REQUEST', 'DECLINE_SHARE_REQUEST',
    'VOTE_HOT_OR_NOT', 'SUBMIT_HOT_OR_NOT', 'PURCHASE_ZINE_RIGHTS',
    'EDIT_POST_METADATA', 'EDIT_SONG_METADATA', 'REPOST_POST', 'STEM_SPLIT'
];

// Actions that do not require a balance check before being added to a block.
const BALANCE_EXEMPT_ACTIONS = [
    'FOLLOW_USER',
    'PROFILE_UPDATE',
    'THEME_UPDATE',
    'SET_TOP_8',
    'SHOUTBOX_POST',
    'ADMIN_MINT', // Admin actions are exempt from balance checks
    'ADMIN_DELETE_USER',
    'SUBMIT_HOT_OR_NOT',
    'VOTE_HOT_OR_NOT',
    'STORY_POST',
    'REPOST_POST'
];

// Combined list for the feed controller's validation.
const ALL_FEED_ACTIONS = [
    ...FEED_INTERACTIONS,
    ...ADMIN_ACTIONS // Admin actions are also handled by the feed controller
];

// Combined list for the social controller's validation.
const ALL_SOCIAL_ACTIONS = [
    ...SOCIAL_ACTIONS,
    ...ADMIN_ACTIONS
];

module.exports = {
    ALL_FEED_ACTIONS,
    ALL_SOCIAL_ACTIONS,
    BALANCE_EXEMPT_ACTIONS,
    ADMIN_ACTIONS
};