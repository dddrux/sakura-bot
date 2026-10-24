import assert from 'node:assert/strict'
import { evaluateExpression, formatCalculatorNumber } from '../calculator.js'

const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
close(evaluateExpression('2 + 2 * 3').value, 8)
close(evaluateExpression('(25 + 5) * 2').value, 60)
close(evaluateExpression('200 * 10%').value, 20)
close(evaluateExpression('2 ^ 8').value, 256)
close(evaluateExpression('2 ^ -3').value, 0.125)
close(evaluateExpression('-2 ^ 2').value, -4)
close(evaluateExpression('1,5 + 2,25').value, 3.75)
assert.equal(formatCalculatorNumber(3.7500000000), '3,75')
assert.throws(() => evaluateExpression('1 / 0'), /dividir por zero/i)
assert.throws(() => evaluateExpression('2 + process.exit()'), /Caractere não permitido/i)
assert.throws(() => evaluateExpression('2(3)'), /sem operador/i)
assert.throws(() => evaluateExpression('2 ^ 1000'), /expoente/i)
assert.throws(() => evaluateExpression('('.repeat(20) + '1' + ')'.repeat(20)), /aninhados/i)
console.log('✅ Parte 9: parser matemático seguro, porcentagem, potência e limites aprovados')
