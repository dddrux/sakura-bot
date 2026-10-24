import { defineCommand } from '../data/workstation.js'
import { evaluateExpression, formatCalculatorNumber } from '../data/calculator.js'
import { reply } from '../data/reply.js'

export default defineCommand({
  name: 'calculadora',
  aliases: ['calc', 'calcular', 'contamatematica'],
  menuEntries: [
    { name: 'calculadora', usage: '.calculadora 2 + 2', description: 'Calcula expressões com parser seguro e sem eval.', menuGroup: 'Utilidades' },
    { name: 'calc', usage: '.calc (25 + 5) * 2', description: 'Atalho da calculadora segura.', menuGroup: 'Utilidades' }
  ],
  category: 'Principal',
  usage: '.calculadora 2 + 2',
  description: 'Calcula soma, subtração, multiplicação, divisão, porcentagem, parênteses e potência sem usar eval.',
  async execute({ sock, msg, rawArgs, settings }) {
    const expression = String(rawArgs || '').trim()
    if (!expression) {
      return reply(sock, msg, [
        `Use ${settings.prefix}calc 2 + 2`,
        `Exemplos:`,
        `${settings.prefix}calc (25 + 5) * 2`,
        `${settings.prefix}calc 200 * 10%`,
        `${settings.prefix}calc 2 ^ 8`,
        'Operadores: +  -  *  /  %  ^  ( )'
      ].join('\n'), { title: 'CALCULADORA SEGURA', icon: '💮' })
    }
    try {
      const result = evaluateExpression(expression)
      return reply(sock, msg, `expressão: ${result.expression}\nresultado: ${formatCalculatorNumber(result.value)}`, { title: 'CALCULADORA', icon: '💮' })
    } catch (error) {
      return reply(sock, msg, `Não consegui calcular.\n${error?.message || 'Expressão inválida.'}`, { title: 'CALCULADORA', icon: '💮' })
    }
  }
})
