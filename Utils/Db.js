

let useDb = (callback) => {
    let sqlite3 = require('sqlite3');
    // seems to be from project root, not from current file
    let db = new sqlite3.Database('./zhopa.db');
    return Promise.resolve()
        .then(() => callback(db))
        .finally(() => db.close());
};

let all = (db, sql) => new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
        if (err) {
            reject(err);
        } else {
            resolve(rows);
        }
    });
});

let fetchAll = (db, table, keyFields = []) => {
    let quote = value => value === undefined ? 'null' : JSON.stringify(value);
    let sql = [
        `SELECT *, ROWID as rowId FROM ${table}`,
        `WHERE TRUE`,
    ].concat(keyFields.map(([name, value]) => {
        return 'AND `' + name + '` = ' + quote(value);
    }).join(' ')).concat([
        `ORDER BY ROWID DESC;`,
    ]).join('\n');
    return all(db, sql);
};

let fetchOne = (db, table, keyFields = []) => fetchAll(db, table, keyFields)
    .then(rows => rows.length > 0
        ? Promise.resolve(rows[0])
        : Promise.reject('No record in DB that would match ' + JSON.stringify(keyFields)));

let Db = (db) => {
    let insert = ($table, $rows) => new Promise((resolve, reject) => {
        if ($rows.length === 0) {
            return resolve({rowId: null});
        }
        let $colNames = Object.keys($rows[0]);
        let $dataToInsert = [];
        for (let $i = 0; $i < $rows.length; ++$i) {
            let $row = $rows[$i];
            for (let $colName of $colNames) {
                if ($colName in $row) {
                    $dataToInsert.push($row[$colName]);
                } else {
                    return reject('No key `' + $colName + '` in the ' + $i + '-th row required to insert many');
                }
            }
        }

        // setup the placeholders - a fancy way to make the long "(?, ?, ?)..." string
        let $rowPlaces = '(' + new Array($colNames.length).fill('?').join(', ') + ')';
        let $allPlaces = new Array($rows.length).fill($rowPlaces).join(', ');

        let $sql = [
            'INSERT',
            'INTO ' + $table + ' (' + $colNames.join(', ') + ')',
            'VALUES ' + $allPlaces,
        ].join('\n');

        let stmt = db.prepare($sql);
        stmt.run(...$dataToInsert, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({rowId: this.lastID});
            }
            stmt.finalize();
        });
    });


    return {
        insert: insert,
        fetchAll: (table, keyFields = []) => fetchAll(db, table, keyFields),
        fetchOne: (table, keyFields = []) => fetchOne(db, table, keyFields),
        // for complex SQL-s with JOIN-s and stuff
        all: (sql) => all(db, sql),
        // TODO: replace with generic SQL generation functions
        prepare: (...args) => db.prepare(...args),
    };
};
Db.useDb = (process) => useDb(db => process(Db(db)));

module.exports = Db;
