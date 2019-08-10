
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

let likePost = (post, tokenInfo) =>
    Db.useDb(db => db.insert('likes', [{
        postId: post.postId,
        author: tokenInfo.email,
        dt: new Date().toISOString(),
    }]).then(meta => ({
        message: 'Written OK',
        rowId: meta.rowId,
        author: tokenInfo.email,
    })));

let unlikePost = (post, tokenInfo) => Db.useDb(db => {
    let stmt = db.prepare('DELETE FROM likes WHERE postId = ? AND author = ?');
    let sqlStatus = stmt.run(post.postId, tokenInfo.email);
    stmt.finalize();
    return {message: 'Success', sqlStatus: sqlStatus};
});

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
    Db.useDb(db => db.fetchAll2({
        table: 'posts',
        where: !requestData.beforeId ? [] :
            [['ROWID', '<', requestData.beforeId]],
        limit: requestData.length,
    }).then(resolve).catch(reject));
});

const getLikes = requestData => new Promise( (res, rej) => {
    Db.useDb( db => db.fetchAll2({
        table: 'likes'
    }).then(res).catch(rej) );
} ) ;

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

let login = (tokenInfo) => Db.useDb(db => {
    return db.fetchOne('users', [
        ['email', tokenInfo.email],
    ]).catch(exc => db.insert('users', [{
        email: tokenInfo.email,
        displayName: tokenInfo.name,
        imageUrl: tokenInfo.picture,
    }]));
});

exports.processRequest = (requestData) => {
    let func = requestData.func;
    let handlers = {
        getRelevantPosts: () => getPosts(requestData)
            .then(posts => 1 && {records: posts || null}),
        getPostsLikes : () => getLikes(requestData)
            .then( likes => 1 && {postsLikes: likes || null} ),
        getPublicKey: () => {
            let email = requestData.email;
            // TODO: implement - store public key of each user in DB
            return {publicKey: 'asdasdasdsasa-bfd-bdf-bfd--bdfb-fd-b-fd'};
        },
    };
    let authHandlers = {
        login               : (auth) => login(auth),
        addPost             : (auth) => addPost(requestData, auth),
        likePost            : (auth) => likePost(requestData, auth),
        unlikePost          : (auth) => unlikePost(requestData, auth),
        deletePost          : (auth) => deletePost(requestData, auth),
        uploadImage         : (auth) => uploadImage(requestData, auth),
        syncMatchmaking     : (auth) => RpsImba(auth).syncMatchmaking(requestData),
        challenge           : (auth) => RpsImba(auth).challenge(requestData),
        makeMove            : (auth) => RpsImba(auth).makeMove(requestData),
        getUserList         : (auth) => Db.useDb(db => db.fetchAll('users')).then(rows => ({records: rows})),
        getPrivateMessages  : (auth) => Db.useDb(db => db.fetchAll('privateMessages', [
            ['recipient', auth.email],
        ])).then(rows => ({records: rows, auth: auth || null})),
        getUserData         : (auth) => Db.useDb(db => db.fetchOne('users', [['email', requestData.email]])),
        sendPrivateMessage  : (auth) => {
            let recipient = requestData.recipient;
            let message = requestData.message; // encrypted binary string
            return Db.useDb(db => db.insert('privateMessages', [{
                sender: auth.email,
                recipient: recipient,
                message: message,
                encryption: requestData.encryption,
                dt: new Date().toISOString(),
                publicKey: requestData.publicKey,
            }]))
        },
    };
    if (handlers[func]) {
        return Promise.resolve()
            .then(() => handlers[func]());
    } else if (authHandlers[func]) {
        return getUserData(requestData.googleIdToken)
            .then(auth => authHandlers[func](auth));
    } else {
        return Promise.reject('Unknown func - ' + func);
    }
};
