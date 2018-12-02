
let md5 = require('md5');
let fs = require('fs');
let RpsImba = require('./Controllers/RpsImba.js');
let Db = require('./Utils/Db.js');

let addPost = (post, tokenInfo) =>
    Db.useDb(db => db.insert('posts', [{
        text: post.text,
        author: tokenInfo.email,
        dt: new Date().toISOString(),
        title: post.title,
    }]).then(meta => ({
        message: 'Written OK',
        rowId: meta.rowId,
        author: tokenInfo.email,
    })));


let deletePost = (post, tokenInfo) => new Promise((resolve, reject) => {
    Db.useDb(db => {
        db.fetchOne('posts', [
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
    Db.useDb(db => db.fetchAll('posts', []).then(resolve).catch(reject));
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