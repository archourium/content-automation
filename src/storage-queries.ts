export const storageQueries = {
  saveTrends: 'INSERT INTO trend_snapshots VALUES (?, ?, ?) ON CONFLICT(region, day) DO UPDATE SET trends = excluded.trends',
  getTrends: 'SELECT trends FROM trend_snapshots WHERE region = ? AND day >= ? ORDER BY day DESC',
  removeExpiredImages: 'DELETE FROM images WHERE expires_at <= ?',
  addImage: 'INSERT INTO images VALUES (?, ?, ?)',
  lookupPublication: 'SELECT container_id, media_id, status FROM publications WHERE account = ? AND day = ?',
  claimPublication: 'INSERT INTO publications (account, day, container_id, status) VALUES (?, ?, ?, \'pending\') ON CONFLICT(account, day) DO NOTHING RETURNING container_id',
  completePublication: "UPDATE publications SET status = 'published', media_id = COALESCE(?, media_id) WHERE account = ? AND day = ?"
};
