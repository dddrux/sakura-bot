import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-webp-fallback-'))
try {
  const anim = path.join(temp, 'anim.webp')
  const made = spawnSync('/usr/bin/ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc=size=64x64:rate=3','-t','1','-c:v','libwebp','-loop','0',anim], { encoding: 'utf8' })
  assert.equal(made.status, 0, made.stderr || 'não consegui gerar WebP animado de teste')
  const bytes = await fs.readFile(anim)
  assert.ok(bytes.includes(Buffer.from('ANIM')), 'fixture precisa ser WebP animado')

  const fake = path.join(temp, 'ffmpeg')
  await fs.writeFile(fake, `#!/bin/sh\nfor arg in \"$@\"; do\n  case \"$arg\" in\n    *.webp) if [ -f \"$arg\" ] && grep -a -q ANIM \"$arg\"; then exit 69; fi ;;\n  esac\ndone\nexec /usr/bin/ffmpeg \"$@\"\n`)
  await fs.chmod(fake, 0o755)

  const converterUrl = new URL('../sticker-convert.js', import.meta.url).href
  const runner = path.join(temp, 'runner.mjs')
  await fs.writeFile(runner, `import fs from 'node:fs/promises'; import { convertStickerToVideo } from ${JSON.stringify(converterUrl)}; const input=await fs.readFile(process.argv[2]); const out=await convertStickerToVideo(input,{debug(){},warn(){}}); if(!out?.buffer?.length) process.exit(2); await fs.writeFile(process.argv[3],out.buffer);`)
  const output = path.join(temp, 'out.mp4')
  const run = spawnSync(process.execPath, [runner, anim, output], { env: { ...process.env, FFMPEG_PATH: fake, PATH: temp }, encoding: 'utf8', timeout: 30000 })
  assert.equal(run.status, 0, run.stderr || run.stdout || 'fallback não converteu WebP animado quando decoder principal falhou')
  const stat = await fs.stat(output)
  assert.ok(stat.size > 1000, 'MP4 de fallback ficou vazio')
  console.log('✅ RC11 fix3 converter: fallback demuxa WebP animado quando o decoder principal falha')
} finally {
  await fs.rm(temp, { recursive: true, force: true })
}
