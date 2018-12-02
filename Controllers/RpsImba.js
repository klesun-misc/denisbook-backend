
let emailToPlayer = new Map();
let challengedToChallenger = new Map();

// note that it may store multiple matches per player, but there can
// only be one _active_ - it will always be the first one in the list
let matches = [];

module.exports = (auth) => {
    let actor = auth.email;

    let maskOpponentChoice = match => ({
        players: match.players.map(p => ({
            email: p.email,
            points: p.points,
            move: p.move === null ? null
                : p.email === actor ? p.move
                    : '***',
        })),
        moveHistory: match.moveHistory,
    });

    let syncMatchmaking = (rqData) => {
        let challengedBy = challengedToChallenger.get(actor);
        emailToPlayer.set(actor, {activityTs: new Date().getTime()});
        let activePlayers = [...emailToPlayer]
            .filter(([email, data]) => new Date().getTime() - data.activityTs < 30 * 1000)
            .map(([email, data]) => ({email: email, activityTs: data.activityTs}));
        let challenged = activePlayers.map(a => a.email)
            .filter(e => challengedToChallenger.get(e) === actor)
            [0] || null;
        let match = matches
            .filter(m => m.players
                .some(p => p.email === actor))[0];
        return {
            activePlayers, challengedBy, challenged,
            match: !match ? null : maskOpponentChoice(match),
        };
    };

    let challenge = (rqData) => {
        let subject = rqData.opponent;
        let oldChallenger = challengedToChallenger.get(subject);
        if (oldChallenger) {
            return Promise.reject('The player was already challenged by ' + oldChallenger);
        } else {
            challengedToChallenger.set(subject, actor);
            if (challengedToChallenger.get(actor) === subject) {
                // challenging someone who already challenged you back
                let match = {
                    players: [
                        {email: subject, points: 0, move: null},
                        {email: actor, points: 0, move: null},
                    ],
                    moveHistory: [],
                };
                matches.unshift(match);
                return Promise.resolve({
                    match: match,
                    message: 'Your challenge was accepted. Starting the match...',
                });
            } else {
                return Promise.resolve({
                    match: null,
                    message: 'Your challenge was delivered. Waiting for opponent to accept it.',
                });
            }
        }
    };

    let compareMoves = (a, b) => {
        let beats = {
            rock: 'scissors',
            scissors: 'paper',
            paper: 'rock',
        };
        if (beats[a] === b) {
            return 1;
        } else if (beats[b] === a) {
            return -1;
        } else {
            return 0;
        }
    };

    let prizePoints = {
        rock: 1,
        scissors: 2,
        paper: 3,
    };

    let deepCopy = val => JSON.parse(JSON.stringify(val));

    let makeMove = (rqData) => {
        let move = rqData.move;
        let match = matches.filter(m => m.players
            .some(p => p.email === actor))[0];
        if (!match) { return Promise.reject('You are not in a match!'); }
        let you = match.players.filter(p => p.email === actor)[0];
        let opponent = match.players.filter(p => p.email !== actor)[0];
        you.move = move;
        if (opponent.move) {
            let sign = compareMoves(you.move, opponent.move);
            if (sign > 0) {
                you.points += prizePoints[you.move];
            } else if (sign < 0) {
                opponent.points += prizePoints[opponent.move];
            }
            match.moveHistory.push(deepCopy(match.players));
            match.players.forEach(p => p.move = null);
            let gameOver = match.players.some(p => p.points >= 3);
            if (gameOver) {
                challengedToChallenger.delete(actor);
                challengedToChallenger.delete(opponent.email);
            }
            return {match: maskOpponentChoice(match)};
        } else {
            return {match: maskOpponentChoice(match)};
        }
    };

    return {
        syncMatchmaking: syncMatchmaking,
        challenge: challenge,
        makeMove: makeMove,
    };
};