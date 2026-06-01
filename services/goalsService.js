const fs = require('fs');
const path = require('path');
const blockchainService = require('./blockchainService');

const GOALS_DB_FILE = path.join(__dirname, '..', 'ledger-data', 'goals_db.json');

// Task 1: The Goal Pool & Dictionary
const GOAL_DICT = {
    daily: [
        { id: 'd_listen_5', type: 'LISTEN_SONGS', target: 5, reward: 1000, desc: 'Listen to 5 songs' },
        { id: 'd_comment_3', type: 'LEAVE_COMMENTS', target: 3, reward: 500, desc: 'Leave 3 comments on the feed' },
        { id: 'd_friend_2', type: 'ADD_FRIENDS', target: 2, reward: 1500, desc: 'Lock in 2 new crew members' },
        { id: 'd_listen_15', type: 'LISTEN_SONGS', target: 15, reward: 3000, desc: 'Listen to 15 songs' }
    ],
    weekly: [
        { id: 'w_refer_1', type: 'REFER_USERS', target: 1, reward: 25000, desc: 'Refer 1 new user to VOD' },
        { id: 'w_upload_1', type: 'UPLOAD_TRACK', target: 1, reward: 10000, desc: 'Upload a new track' },
        { id: 'w_stake_1', type: 'STAKE_SONG', target: 1, reward: 15000, desc: 'Put a song up for stake' },
        { id: 'w_listen_50', type: 'LISTEN_SONGS', target: 50, reward: 10000, desc: 'Listen to 50 songs' }
    ]
};

class GoalsService {
    constructor() {
        this.db = this.loadDB();
    }

    loadDB() {
        if (fs.existsSync(GOALS_DB_FILE)) {
            return JSON.parse(fs.readFileSync(GOALS_DB_FILE, 'utf8'));
        }
        return { lastDailyRotation: Date.now(), lastWeeklyRotation: Date.now(), users: {} };
    }

    saveDB() {
        fs.writeFileSync(GOALS_DB_FILE, JSON.stringify(this.db, null, 2));
    }

    // Task 3: Time Rotation (Cron)
    initCron() {
        setInterval(() => this.checkAndRotateGoals(), 10 * 60 * 1000); // Check every 10 minutes
        this.checkAndRotateGoals();
    }

    checkAndRotateGoals() {
        const now = Date.now();
        const DAY = 24 * 60 * 60 * 1000;
        const WEEK = 7 * DAY;
        let rotated = false;

        if (now - this.db.lastDailyRotation > DAY) {
            this.db.lastDailyRotation = now;
            for (const user in this.db.users) this.db.users[user].daily = this.getRandomGoals('daily', 2);
            rotated = true;
        }

        if (now - this.db.lastWeeklyRotation > WEEK) {
            this.db.lastWeeklyRotation = now;
            for (const user in this.db.users) this.db.users[user].weekly = this.getRandomGoals('weekly', 2);
            rotated = true;
        }

        if (rotated) this.saveDB();
    }

    // Task 2: Assignment
    getRandomGoals(period, count) {
        const pool = GOAL_DICT[period];
        const shuffled = pool.sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count).map(g => ({ ...g, progress: 0, completed: false }));
    }

    getUserGoals(address) {
        if (!this.db.users[address]) {
            this.db.users[address] = { daily: this.getRandomGoals('daily', 2), weekly: this.getRandomGoals('weekly', 2) };
            this.saveDB();
        }
        return this.db.users[address];
    }

    // Task 4: Platform Integration Mapping
    processTransaction(tx) {
        let actor = tx.sender;
        let actions = [];

        if (tx.type === 'STREAM_COMPLETED') actions.push('LISTEN_SONGS');
        if (tx.type === 'PROFILE_UPDATE' && tx.data && tx.data.referrer) {
            actor = tx.data.referrer; // The referrer gets the goal credit!
            actions.push('REFER_USERS');
        }
        if (tx.type === 'SONG_UPLOAD') {
            actions.push('UPLOAD_TRACK');
            if (tx.data && tx.data.forStake) actions.push('STAKE_SONG');
        }
        if (tx.type === 'REPLY_POST') actions.push('LEAVE_COMMENTS');
        if (tx.type === 'FOLLOW_USER') actions.push('ADD_FRIENDS');

        if (actions.length > 0 && actor && actor !== 'SYSTEM' && actor !== '0x00') {
            actions.forEach(actionType => this.incrementGoal(actor, actionType));
        }
    }

    // Task 5: Automated Payouts
    incrementGoal(address, actionType) {
        const userGoals = this.getUserGoals(address);
        let updated = false;

        ['daily', 'weekly'].forEach(period => {
            userGoals[period].forEach(goal => {
                if (goal.type === actionType && !goal.completed) {
                    goal.progress++;
                    updated = true;
                    
                    if (goal.progress >= goal.target) {
                        goal.completed = true;
                        goal.progress = goal.target;
                        console.log(`🏆 Goal Completed by ${address.substring(0,6)}: ${goal.desc}`);
                        // Safely inject reward directly into the ledger
                        blockchainService.addSystemTransaction(address, 'GOAL_REWARD', { amount: goal.reward, goalId: goal.id, description: `Completed Goal: ${goal.desc}` });
                    }
                }
            });
        });

        if (updated) this.saveDB();
    }
}

module.exports = new GoalsService();