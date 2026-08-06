import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { Pool as NeonPool } from '@neondatabase/serverless'
import { Pool as PgPool } from 'pg'
import * as schema from './schema'

/**
 * O driver da Neon fala WebSocket e so conversa com instancia remota. Contra
 * Postgres local (docker, CI) ele trava sem erro claro. Entao o driver e
 * escolhido pela URL: neon.tech usa WebSocket, o resto usa TCP normal.
 */
const url = process.env.DATABASE_URL

if (!url) {
  throw new Error('DATABASE_URL nao definida. Copie .env.example para .env.local.')
}

const isRemoteNeon = /neon\.tech|vercel-storage\.com/.test(url)

export const db = isRemoteNeon
  ? drizzleNeon({ client: new NeonPool({ connectionString: url }), schema, casing: 'snake_case' })
  : drizzlePg({ client: new PgPool({ connectionString: url }), schema, casing: 'snake_case' })

export { schema }
export type Db = typeof db
