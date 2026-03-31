const Database = require('better-sqlite3')
const db = new Database('.gitsema/index.db')

function countRows() {
  const c = (sql) => db.prepare(sql).get()['count']
  console.log('chunks before:', c('SELECT count(*) as count FROM chunks'))
  console.log('chunk_embeddings before:', c('SELECT count(*) as count FROM chunk_embeddings'))
}

countRows()

const groups = db.prepare("SELECT blob_hash, start_line, end_line, GROUP_CONCAT(id) ids, MIN(id) as keep_id, COUNT(*) cnt FROM chunks GROUP BY blob_hash, start_line, end_line HAVING cnt>1").all()
console.log('duplicate groups:', groups.length)

for (const g of groups) {
  const ids = g.ids.split(',').map((s) => parseInt(s, 10))
  const keep = g.keep_id
  const others = ids.filter((id) => id !== keep)

  const trx = db.transaction((others) => {
    for (const other of others) {
      const emb = db.prepare('SELECT chunk_id FROM chunk_embeddings WHERE chunk_id = ?').get(other)
      const keepEmb = db.prepare('SELECT chunk_id FROM chunk_embeddings WHERE chunk_id = ?').get(keep)

      if (emb) {
        if (keepEmb) {
          // both have embeddings; delete the other embedding (assume identical)
          db.prepare('DELETE FROM chunk_embeddings WHERE chunk_id = ?').run(other)
        } else {
          // move embedding to keep id
          db.prepare('UPDATE chunk_embeddings SET chunk_id = ? WHERE chunk_id = ?').run(keep, other)
        }
      }

      // delete the duplicate chunk row
      db.prepare('DELETE FROM chunks WHERE id = ?').run(other)
    }
  })

  trx(others)
}

countRows()
console.log('done')
