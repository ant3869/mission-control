import 'dotenv/config'
import { createApp } from './app.js'
import { startMemoryCollector } from './lib/memoryCollector.js'
import { assertSafeBinding, resolveApiHost } from './lib/dashboardAuth.js'
import { startBriefingScheduler } from './lib/briefing.js'

const PORT = Number(process.env.API_PORT ?? 3001)
const HOST = resolveApiHost(process.env.API_HOST)
const dashboardToken = process.env.DASHBOARD_TOKEN ?? ''
assertSafeBinding(HOST, dashboardToken)

const app = createApp({ dashboardToken })

app.listen(PORT, HOST, () => {
  console.log(`Mission Control API → http://${HOST}:${PORT}`)
  startMemoryCollector()
  startBriefingScheduler()
  if (process.env.DISCORD_BOT_TOKEN) {
    import('./lib/discordBot.js').then(({ startDiscordBot }) => startDiscordBot(PORT))
  }
})
