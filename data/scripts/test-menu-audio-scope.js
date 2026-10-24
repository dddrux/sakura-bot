import assert from 'node:assert/strict'
import { shouldPlayMainMenuAudio } from '../../commands/menu.js'

assert.equal(shouldPlayMainMenuAudio('menu', ''), true)
assert.equal(shouldPlayMainMenuAudio('MENU', ''), true)
assert.equal(shouldPlayMainMenuAudio('m', ''), false)
assert.equal(shouldPlayMainMenuAudio('menu', 'category'), false)
assert.equal(shouldPlayMainMenuAudio('menu', 'catalog'), false)
assert.equal(shouldPlayMainMenuAudio('ajuda', ''), false)
assert.equal(shouldPlayMainMenuAudio('help', ''), false)
assert.equal(shouldPlayMainMenuAudio('comandos', ''), false)
console.log('✅ Áudio do menu: exclusivo do .menu principal')
