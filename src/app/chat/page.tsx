import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { chatMessages, contexts } from '@/db/schema'
import { AppHeader } from '@/components/app-header'
import { ChatView } from '@/components/chat-view'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function ChatPage() {
  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)

  const rows = ctx
    ? await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.contextId, ctx.id))
        .orderBy(asc(chatMessages.createdAt))
        .limit(200)
    : []

  return (
    <div className={styles.shell}>
      <AppHeader title="Chat" subtitle="lance escrevendo como você fala" />
      <ChatView
        initialMessages={rows.map((r) => ({
          id: r.id,
          role: r.role,
          content: r.content,
          payload: r.payload as { previews?: never[] } | null,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  )
}
