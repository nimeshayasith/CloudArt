import fs from 'node:fs'

/**
 * The TLS settings for the PostgreSQL connection, or `false` for none.
 *  - "off":     plain connection (local Postgres, or a database on the same machine);
 *  - "require": encrypted, the server's certificate is not checked (better than plain, weaker than verify);
 *  - "verify":  encrypted and the certificate must chain to the CA bundle in DB_SSL_CA_FILE (use this with RDS).
 */
export function dbSslOptions({ DB_SSL, DB_SSL_CA_FILE }, readFile = (file) => fs.readFileSync(file, 'utf8')) {
  if (DB_SSL === 'require') return { rejectUnauthorized: false }
  if (DB_SSL === 'verify') return { rejectUnauthorized: true, ca: readFile(DB_SSL_CA_FILE) }
  return false
}
