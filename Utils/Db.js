

let useDb = (callback) => new Promise((resolve, reject) => {
    let sqlite3 = require('sqlite3');
    // seems to be from project root, not from current file
    let db = new sqlite3.Database('./zhopa.db');
    db.serialize(function() {
        resolve(callback(db));
    });
    db.close();
});

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

let fetchOne = (db, table, keyFields = []) => fetchAll(db, table, keyFields)
    .then(rows => rows.length > 0
        ? Promise.resolve(rows[0])
        : Promise.reject('No record in DB that would match ' + JSON.stringify(keyFields)));

let Db = (db) => ({
    fetchAll: (table, keyFields = []) => fetchAll(db, table, keyFields),
    fetchOne: (table, keyFields = []) => fetchOne(db, table, keyFields),
    // TODO: replace with generic SQL generation functions
    prepare: (...args) => db.prepare(...args),
});
Db.useDb = (process) => useDb(db => process(Db(db)));

module.exports = Db;