
let Db = require('../Utils/Db.js');

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

    let getWinRate = (db, email) =>
        db.all([
            'SELECT COUNT(*) AS cnt FROM rpsImbaMatches',
            'WHERE winner = ' + JSON.stringify(email),
        ].join('\n')).then(winRows => db.all([
            'SELECT COUNT(*) AS cnt FROM rpsImbaMatches',
            'WHERE looser = ' + JSON.stringify(email),
        ].join('\n')).then(loseRows => ({
            wins: winRows.length > 0 ? winRows[0].cnt : 0,
            loses: loseRows.length > 0 ? loseRows[0].cnt : 0,
        })));

    let syncMatchmaking = (rqData) => {
        let challengedBy = challengedToChallenger.get(actor);
        emailToPlayer.set(actor, {activityTs: new Date().getTime()});
        let whenActivePlayers = Db.useDb(db =>
            [...emailToPlayer]
                .filter(([email, data]) => new Date().getTime() - data.activityTs < 30 * 1000)
                .map(([email, data]) =>
                    getWinRate(db, email).then(({wins, loses}) => ({
                        wins, loses, email, activityTs: data.activityTs,
                    }))
                )
        ).then(promises => Promise.all(promises));

        return whenActivePlayers.then(activePlayers => {
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
        });
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

    let storeMatchInDb = match =>
        Db.useDb(db => {
            let winner = match.players.filter(p => p.points >= 3)[0].email;
            let looser = match.players.filter(p => p.points < 3)[0].email;
            return db.insert('rpsImbaMatches', [{
                winner: winner,
                looser: looser,
                dt: new Date().toISOString(),
            }]) .then(({rowId}) => rowId ? rowId :
                    Promise.reject('last insert id of match is empty'))
                .then(rowId => match.moveHistory.map(moveRecs =>
                    db.insert('rpsImbaMoves', [{
                        matchId: rowId,
                        winnerMove: moveRecs.filter(p => p.email === winner)[0].move,
                        looserMove: moveRecs.filter(p => p.email === looser)[0].move,
                    }])
                ))
                .then(movePromises => Promise.all(movePromises));
        }).catch(exc => console.error('Failed to store RPS match to DB', exc));

    let makeMove = (rqData) => {
        let move = rqData.move;
        let match = matches.filter(m => m.players
            .some(p => p.email === actor))[0];
        if (!match) { return Promise.reject('You are not in a match!'); }
        let you = match.players.filter(p => p.email === actor)[0];
        let opponent = match.players.filter(p => p.email !== actor)[0];
        you.move = move;
        if (opponent.move) {
            match.moveHistory.push(deepCopy(match.players));
            let sign = compareMoves(you.move, opponent.move);
            if (sign > 0) {
                you.points += prizePoints[you.move];
            } else if (sign < 0) {
                opponent.points += prizePoints[opponent.move];
            }
            match.players.forEach(p => p.move = null);
            let gameOver = match.players.some(p => p.points >= 3);
            if (gameOver) {
                storeMatchInDb(match);
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