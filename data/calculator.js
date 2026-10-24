const MAX_EXPRESSION_LENGTH = 160
const MAX_TOKENS = 120
const MAX_OPERATIONS = 200
const MAX_NESTING = 16
const MAX_ABS_RESULT = 1e100
const MAX_EXPONENT = 100

export class CalculatorError extends Error {
  constructor(message, code = 'INVALID_EXPRESSION') {
    super(message)
    this.name = 'CalculatorError'
    this.code = code
  }
}

function normalizeExpression(input = '') {
  const expression = String(input || '')
    .trim()
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/,/g, '.')
  if (!expression) throw new CalculatorError('Digite uma expressão para calcular.', 'EMPTY')
  if (expression.length > MAX_EXPRESSION_LENGTH) throw new CalculatorError(`A expressão pode ter no máximo ${MAX_EXPRESSION_LENGTH} caracteres.`, 'TOO_LONG')
  return expression
}

function tokenize(input) {
  const tokens = []
  let index = 0
  while (index < input.length) {
    const rest = input.slice(index)
    const whitespace = rest.match(/^\s+/)
    if (whitespace) { index += whitespace[0].length; continue }

    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)
    if (number) {
      const value = Number(number[0])
      if (!Number.isFinite(value)) throw new CalculatorError('Número fora do limite permitido.', 'NUMBER_RANGE')
      tokens.push({ type: 'number', value, raw: number[0] })
      index += number[0].length
    } else {
      const char = input[index]
      if (!'+-*/^%()'.includes(char)) throw new CalculatorError(`Caractere não permitido: ${char}`, 'INVALID_CHARACTER')
      tokens.push({ type: char, value: char })
      index += 1
    }
    if (tokens.length > MAX_TOKENS) throw new CalculatorError('A expressão é complexa demais.', 'TOO_MANY_TOKENS')
  }
  tokens.push({ type: 'eof', value: '' })
  return tokens
}

function ensureResult(value) {
  if (!Number.isFinite(value)) throw new CalculatorError('O resultado não é finito.', 'NON_FINITE')
  if (Math.abs(value) > MAX_ABS_RESULT) throw new CalculatorError('O resultado ultrapassou o limite permitido.', 'RESULT_RANGE')
  return Object.is(value, -0) ? 0 : value
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens
    this.index = 0
    this.operations = 0
    this.depth = 0
    this.deadline = Date.now() + 50
  }

  current() { return this.tokens[this.index] }
  match(type) {
    if (this.current().type !== type) return false
    this.index += 1
    return true
  }
  expect(type, message) {
    if (!this.match(type)) throw new CalculatorError(message, 'UNEXPECTED_TOKEN')
  }
  operation() {
    this.operations += 1
    if (this.operations > MAX_OPERATIONS || Date.now() > this.deadline) throw new CalculatorError('A expressão é complexa demais.', 'COMPLEXITY_LIMIT')
  }

  parse() {
    const value = this.parseExpression()
    if (this.current().type !== 'eof') throw new CalculatorError('Há valores sem operador entre eles.', 'TRAILING_TOKEN')
    return ensureResult(value)
  }

  parseExpression() {
    let value = this.parseTerm()
    while (this.current().type === '+' || this.current().type === '-') {
      const operator = this.current().type
      this.index += 1
      const right = this.parseTerm()
      this.operation()
      value = ensureResult(operator === '+' ? value + right : value - right)
    }
    return value
  }

  parseTerm() {
    let value = this.parseUnary()
    while (this.current().type === '*' || this.current().type === '/') {
      const operator = this.current().type
      this.index += 1
      const right = this.parseUnary()
      this.operation()
      if (operator === '/' && right === 0) throw new CalculatorError('Não é possível dividir por zero.', 'DIVISION_BY_ZERO')
      value = ensureResult(operator === '*' ? value * right : value / right)
    }
    return value
  }

  parseUnary() {
    if (this.match('+')) { this.operation(); return this.parseUnary() }
    if (this.match('-')) { this.operation(); return ensureResult(-this.parseUnary()) }
    return this.parsePower()
  }

  parsePower() {
    let value = this.parsePostfix()
    if (this.match('^')) {
      const exponent = this.parseUnary()
      this.operation()
      if (Math.abs(exponent) > MAX_EXPONENT) throw new CalculatorError(`O expoente deve ficar entre -${MAX_EXPONENT} e ${MAX_EXPONENT}.`, 'EXPONENT_RANGE')
      value = ensureResult(Math.pow(value, exponent))
    }
    return value
  }

  parsePostfix() {
    let value = this.parsePrimary()
    while (this.match('%')) {
      this.operation()
      value = ensureResult(value / 100)
    }
    return value
  }

  parsePrimary() {
    const token = this.current()
    if (token.type === 'number') {
      this.index += 1
      return token.value
    }
    if (this.match('(')) {
      this.depth += 1
      if (this.depth > MAX_NESTING) throw new CalculatorError('Há parênteses aninhados demais.', 'NESTING_LIMIT')
      const value = this.parseExpression()
      this.expect(')', 'Feche todos os parênteses da expressão.')
      this.depth -= 1
      return value
    }
    throw new CalculatorError('Expressão incompleta ou operador fora de posição.', 'UNEXPECTED_TOKEN')
  }
}

export function evaluateExpression(input) {
  const expression = normalizeExpression(input)
  return { expression, value: new Parser(tokenize(expression)).parse() }
}

export function formatCalculatorNumber(value) {
  const number = ensureResult(Number(value))
  const absolute = Math.abs(number)
  if (absolute !== 0 && (absolute >= 1e15 || absolute < 1e-9)) return number.toExponential(10).replace(/\.0+(?=e)/, '').replace(/(\.\d*?)0+(?=e)/, '$1')
  return Number(number.toFixed(12)).toLocaleString('pt-BR', { maximumFractionDigits: 12, useGrouping: false })
}

export const calculatorLimits = Object.freeze({
  maxExpressionLength: MAX_EXPRESSION_LENGTH,
  maxTokens: MAX_TOKENS,
  maxOperations: MAX_OPERATIONS,
  maxNesting: MAX_NESTING,
  maxExponent: MAX_EXPONENT
})
