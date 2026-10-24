import { getYtDlpHealth } from '../player/yt-dlp-engine.js'

try {
  const state = await getYtDlpHealth({ autoInstall: true })
  if (!state.available) throw new Error('yt-dlp não pôde ser preparado')
  console.log('✅ Player pronto: yt-dlp')
  console.log(`   Binário: ${state.path}`)
  console.log(`   Versão: ${state.version}`)
  console.log('   Backend do .play: somente yt-dlp')
  console.log('   Fragmentos paralelos: 8')
} catch (error) {
  console.error(`❌ Player yt-dlp indisponível: ${error.message}`)
  process.exitCode = 1
}
