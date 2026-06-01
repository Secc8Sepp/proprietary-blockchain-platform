/**
 * Calculates the live clout score based on user activity and decay.
 * 
 * @param {Object} userStats - The activity statistics of the user.
 * @param {number} daysInactive - The number of days since the user was last active.
 * @returns {number} The calculated clout score.
 */
function calculateLiveClout(userStats, daysInactive) {
    const { friends = 0, shares = 0, comments = 0, likes = 0, plays = 0, assets = 0 } = userStats;
    
    // Guardrail: Return 0 if all activity stats are 0 to prevent NaN or meaningless scores
    if (friends === 0 && shares === 0 && comments === 0 && likes === 0 && plays === 0) {
        return 0;
    }

    const liveClout = ((10 * friends) + (7 * shares) + (5 * comments) + (2 * likes) + plays) 
                      * ((friends + shares + comments + likes) / Math.max(assets, 1)) 
                      * Math.pow(0.5, (daysInactive / 2));
                      
    return liveClout;
}

/**
 * Sorts users by clout score and calculates rank movement.
 * 
 * @param {Array} usersArray - The array of user objects.
 * @returns {Array} The ranked array with delta metrics.
 */
function generateFeedRanks(usersArray) {
    const sortedUsers = [...usersArray].sort((a, b) => b.liveClout - a.liveClout);
    
    return sortedUsers.map((user, index) => {
        const current_rank = index + 1;
        // Calculate spots moved (positive means moved up in rank, so historical > current)
        const spotsMoved = user.historical_rank > 0 ? (user.historical_rank - current_rank) : 0;
        
        return {
            ...user,
            current_rank,
            spotsMoved
        };
    });
}

module.exports = {
    calculateLiveClout,
    generateFeedRanks
};