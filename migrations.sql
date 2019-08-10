CREATE TABLE posts (
   text text,
   author varchar(50),
   dt datetime,
   title varchar(255)
);
CREATE TABLE users (
    email varchar(100),
    displayName varchar(50),
    imageUrl text
);
CREATE TABLE likes (
    postId integer,
    author varchar(70),
    dt datetime
);
CREATE UNIQUE INDEX postId_author on likes(postId, author)
CREATE UNIQUE INDEX email on users (email);
CREATE TABLE rpsImbaMatches (
    winner varchar(70),
    looser varchar(70),
    dt Datetime
);
CREATE INDEX winner on rpsImbaMatches (winner);
CREATE INDEX looser on rpsImbaMatches (looser);
CREATE TABLE rpsImbaMoves (
matchId INTEGER,
winnerMove VARCHAR(15),
looserMove VARCHAR(15)
);
CREATE INDEX matcId_winnerMove on rpsImbaMoves (matchId, winnerMove);
CREATE INDEX matcId_looserMove on rpsImbaMoves (matchId, looserMove);
