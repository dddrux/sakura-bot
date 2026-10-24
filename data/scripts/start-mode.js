const mode = String(process.argv[2] || 'normal').toLowerCase()

if (mode === 'debug') {
  process.env.LOG_LEVEL = 'debug'
  process.env.BAILEYS_LOG_LEVEL = 'debug'
  process.env.LOG_FILE_LEVEL = 'trace'
  process.env.BAILEYS_LOG_FILE_LEVEL = 'trace'
  process.env.BAILEYS_DETAILED_DEBUG = 'true'
} else if (mode === 'trace') {
  process.env.LOG_LEVEL = 'trace'
  process.env.BAILEYS_LOG_LEVEL = 'trace'
  process.env.LOG_FILE_LEVEL = 'trace'
  process.env.BAILEYS_LOG_FILE_LEVEL = 'trace'
  process.env.BAILEYS_DETAILED_DEBUG = 'true'
}

await import('../../index.js')
