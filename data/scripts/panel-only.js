import { createLogger } from '../logger.js'
import { settings } from '../settings.js'
import { startPanel } from '../panel.js'
const logger = createLogger({ scope: 'PANEL', level: settings.logLevel, logsDir: settings.logsDir })
await startPanel(logger)
