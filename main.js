
let md5 = require('md5');
let fs = require('fs');
let RpsImba = require('./Controllers/RpsImba.js');

let useDb = (callback) => {
    let sqlite3 = require('sqlite3');
    let db = new sqlite3.Database('./zhopa.db');
    db.serialize(function() {
        callback(db);
    });
    db.close();
};

let fetchAll = (db, table, keyFields = []) => new Promise((resolve, reject) => {
    let quote = value => value === undefined ? 'null' : JSON.stringify(value);
    let sql = [
        `SELECT *, ROWID as rowId FROM ${table}`,
        `WHERE TRUE`,
    ].concat(keyFields.map(([name, value]) => {
        return 'AND `' + name + '` = ' + quote(value);
    }).join(' ')).concat([
        `ORDER BY ROWID DESC;`,
    ]).join('\n');
    db.all(sql, (err, rows) => {
        if (err) {
            reject(err);
        } else {
            resolve(rows);
        }
    });
});

let fetchOne = (db, table, keyFields) => fetchAll(db, table, keyFields)
    .then(rows => rows.length > 0
        ? Promise.resolve(rows[0])
        : Promise.reject('No record in DB that would match ' + JSON.stringify(keyFields)));

let addPost = (post, tokenInfo) => new Promise((resolve, reject) => {
    useDb(db => {
        let stmt = db.prepare('INSERT INTO posts VALUES (?,?,?,?);');
        stmt.run(post.text, tokenInfo.email, new Date().toISOString(), post.title, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({message: 'Written OK', rowId: this.lastID || null, author: tokenInfo.email});
            }
            stmt.finalize();
        });
    });
});

let deletePost = (post, tokenInfo) => new Promise((resolve, reject) => {
    useDb(db => {
        fetchOne(db, 'posts', [
            ['ROWID', post.rowId],
        ]).then(row => {
            if (row.author !== tokenInfo.email) {
                reject('You can not delete this post since you are not it\s author - you are ' + tokenInfo.email + ', not ' + row.author);
            } else {
                let stmt = db.prepare('DELETE FROM posts WHERE ROWID = ?;');
                let sqlStatus = stmt.run(post.rowId);
                stmt.finalize();
                resolve({message: 'Deleted OK... probably', sqlStatus: sqlStatus});
            }
        }).then(resolve).catch(reject);
    });
});

let getPosts = (requestData) => new Promise((resolve, reject) => {
    useDb(db => fetchAll(db, 'posts', []).then(resolve).catch(reject));
});

let getUserData = (googleIdToken) => new Promise((resolve, reject) => {
    if (!googleIdToken) {
        reject('googleIdToken is empty');
    }
    let verifier = require('google-id-token-verifier');
    let clientId = '521166378127-vhkak167b5ghngfkk5r6ukrq059njoo8.apps.googleusercontent.com';
    verifier.verify(googleIdToken, clientId, function (err, tokenInfo) {
        if (err) {
            reject(err);
        } else {
            resolve(tokenInfo);
        }
    });
});

let uploadImage = (rqData, tokenInfo) => new Promise((resolve, reject) => {
    let {fileName = '', imageBase64} = rqData;
    if (!imageBase64) {
        return reject('File is empty');
    }
    let maxSize = 1024 * 1024; // a mebibyte
    let fileSize = imageBase64.length / 4 * 3;
    if (fileSize > 1024 * 1024) {
        return reject('File size, ' + (fileSize / 1024) + ' KiB, exceeds max allowed size, ' + maxSize + ' KiB');
    }
    let popular = ['bmp', 'gif', 'ico', 'jpeg', 'jpg', 'pic', 'tga', 'tif', 'tiff', 'psd', 'xcf', 'svg', 'png'];
    let buf = Buffer.from(imageBase64, 'base64');
    let imgMd5 = md5(buf);
    let fileExt = '';
    for (let ext of popular) {
        if (fileName.endsWith('.' + ext)) {
            fileExt = '.' + ext;
        }
    }
    let dirName = new Date().toISOString().slice(0, 10);
    let email = tokenInfo.email.replace(/\//g, ''); // just in case
    let urlPath = '/unv/hosted/' + dirName + '/' + email + '@' + imgMd5 + fileExt;
    let fsPath = '/var/www/html' + urlPath;
    let dirPath = fsPath.replace(/^(.*)\/.*$/, '$1');
    fs.promises.mkdir(dirPath, {recursive: true, mode: 0o777}).finally(() => {
        let wstream = fs.createWriteStream(fsPath, {mode: 0o777});
        wstream.write(buf);
        wstream.end();
        wstream.on('finish', (...args) => resolve({
            imageUrl: 'https://midiana.lv' + urlPath,
            args: args,
        }));
        wstream.on('error', (error) => reject(error));
    });
});

let login = (googleIdToken) => getUserData(googleIdToken)
    .then(tokenInfo => useDb(db => {
        let stmt = db.prepare('REPLACE INTO users (email, displayName, imageUrl) VALUES (?,?,?);');
        stmt.run(tokenInfo.email, tokenInfo.name, tokenInfo.picture);
        stmt.finalize();
        return {tokenInfo: tokenInfo};
    }));

exports.processRequest = (requestData) => {
    let func = requestData.func;
    let handlers = {
        getRelevantPosts: () => getPosts(requestData)
            .then(posts => 1 && {records: posts || null}),
        login: () => login(requestData.googleUser.Zi.id_token),
    };
    let authHandlers = {
        addPost             : (auth) => addPost(requestData, auth),
        deletePost          : (auth) => deletePost(requestData, auth),
        uploadImage         : (auth) => uploadImage(requestData, auth),
        syncMatchmaking     : (auth) => RpsImba(auth).syncMatchmaking(requestData),
        challenge           : (auth) => RpsImba(auth).challenge(requestData),
        makeMove            : (auth) => RpsImba(auth).makeMove(requestData),
    };
    if (handlers[func]) {
        return handlers[func]();
    } else if (authHandlers[func]) {
        return getUserData(requestData.googleIdToken)
            .then(auth => authHandlers[func](auth));
    } else {
        return Promise.reject('Unknown func - ' + func);
    }
};