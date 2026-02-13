import { useMemo } from 'react'

// ============================================================================
// Token types matching VS Code dark+ theme colors
// ============================================================================

type TokenType =
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'function'
  | 'type'
  | 'variable'
  | 'operator'
  | 'punctuation'
  | 'property'
  | 'tag'
  | 'attribute'
  | 'value'
  | 'heading'
  | 'bold'
  | 'bullet'
  | 'link'
  | 'plain'

interface Token {
  type: TokenType
  text: string
}

// ============================================================================
// Language-specific tokenizers
// ============================================================================

const tokenizeJSON = (code: string): Token[][] => {
  return code.split('\n').map(line => {
    const tokens: Token[] = []
    let remaining = line

    while (remaining.length > 0) {
      // Leading whitespace
      const wsMatch = remaining.match(/^(\s+)/)
      if (wsMatch) {
        tokens.push({ type: 'plain', text: wsMatch[1] })
        remaining = remaining.slice(wsMatch[1].length)
        continue
      }

      // Comments
      if (remaining.startsWith('//')) {
        tokens.push({ type: 'comment', text: remaining })
        remaining = ''
        continue
      }

      // Strings (property keys and values)
      const strMatch = remaining.match(/^"([^"\\]*(?:\\.[^"\\]*)*)"/)
      if (strMatch) {
        const afterStr = remaining.slice(strMatch[0].length).trimStart()
        if (afterStr.startsWith(':')) {
          tokens.push({ type: 'property', text: strMatch[0] })
        } else {
          tokens.push({ type: 'string', text: strMatch[0] })
        }
        remaining = remaining.slice(strMatch[0].length)
        continue
      }

      // Numbers
      const numMatch = remaining.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)
      if (numMatch) {
        tokens.push({ type: 'number', text: numMatch[0] })
        remaining = remaining.slice(numMatch[0].length)
        continue
      }

      // Booleans and null
      const boolMatch = remaining.match(/^(true|false|null)\b/)
      if (boolMatch) {
        tokens.push({ type: 'keyword', text: boolMatch[0] })
        remaining = remaining.slice(boolMatch[0].length)
        continue
      }

      // Punctuation
      if (/^[{}[\]:,]/.test(remaining)) {
        tokens.push({ type: 'punctuation', text: remaining[0] })
        remaining = remaining.slice(1)
        continue
      }

      // Fallback
      tokens.push({ type: 'plain', text: remaining[0] })
      remaining = remaining.slice(1)
    }

    return tokens
  })
}

const tokenizeMarkdown = (code: string): Token[][] => {
  return code.split('\n').map(line => {
    const tokens: Token[] = []

    // Headings
    const headingMatch = line.match(/^(#{1,6}\s)(.*)/)
    if (headingMatch) {
      tokens.push({ type: 'keyword', text: headingMatch[1] })
      tokens.push({ type: 'heading', text: headingMatch[2] })
      return tokens
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      tokens.push({ type: 'comment', text: line })
      return tokens
    }

    // Bullet points
    const bulletMatch = line.match(/^(\s*)([-*+•]|\d+\.)\s(.*)/)
    if (bulletMatch) {
      tokens.push({ type: 'plain', text: bulletMatch[1] })
      tokens.push({ type: 'bullet', text: bulletMatch[2] + ' ' })
      // Parse inline within bullet
      tokens.push(...tokenizeInlineMarkdown(bulletMatch[3]))
      return tokens
    }

    // Block quotes
    if (line.trimStart().startsWith('>')) {
      tokens.push({ type: 'comment', text: line })
      return tokens
    }

    // Code blocks
    if (line.trimStart().startsWith('```')) {
      tokens.push({ type: 'keyword', text: line })
      return tokens
    }

    // Default: parse inline
    tokens.push(...tokenizeInlineMarkdown(line))
    return tokens
  })
}

const tokenizeInlineMarkdown = (text: string): Token[] => {
  const tokens: Token[] = []
  let remaining = text

  while (remaining.length > 0) {
    // Bold **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/)
    if (boldMatch) {
      tokens.push({ type: 'bold', text: boldMatch[0] })
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // Inline code `text`
    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      tokens.push({ type: 'string', text: codeMatch[0] })
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // Links [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      tokens.push({ type: 'link', text: linkMatch[0] })
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }

    // Arrow →
    if (remaining.startsWith('→')) {
      tokens.push({ type: 'keyword', text: '→' })
      remaining = remaining.slice(1)
      continue
    }

    // Plain text (grab until next special char)
    const plainMatch = remaining.match(/^[^*`[\]→]+/)
    if (plainMatch) {
      tokens.push({ type: 'plain', text: plainMatch[0] })
      remaining = remaining.slice(plainMatch[0].length)
      continue
    }

    tokens.push({ type: 'plain', text: remaining[0] })
    remaining = remaining.slice(1)
  }

  return tokens
}

const tokenizeYAML = (code: string): Token[][] => {
  return code.split('\n').map(line => {
    const tokens: Token[] = []

    // Comments
    const commentIdx = line.indexOf('#')
    if (commentIdx >= 0 && (commentIdx === 0 || line[commentIdx - 1] === ' ')) {
      if (commentIdx > 0) {
        tokens.push(...tokenizeYAMLValue(line.slice(0, commentIdx)))
      }
      tokens.push({ type: 'comment', text: line.slice(commentIdx) })
      return tokens
    }

    // Key: value pairs
    const kvMatch = line.match(/^(\s*)([\w.-]+)(\s*:\s*)(.*)/)
    if (kvMatch) {
      tokens.push({ type: 'plain', text: kvMatch[1] })
      tokens.push({ type: 'property', text: kvMatch[2] })
      tokens.push({ type: 'punctuation', text: kvMatch[3] })
      tokens.push(...tokenizeYAMLValue(kvMatch[4]))
      return tokens
    }

    // List items
    const listMatch = line.match(/^(\s*)(- )(.*)/)
    if (listMatch) {
      tokens.push({ type: 'plain', text: listMatch[1] })
      tokens.push({ type: 'bullet', text: listMatch[2] })
      tokens.push(...tokenizeYAMLValue(listMatch[3]))
      return tokens
    }

    tokens.push({ type: 'plain', text: line })
    return tokens
  })
}

const tokenizeYAMLValue = (value: string): Token[] => {
  const trimmed = value.trim()
  if (!trimmed) return [{ type: 'plain', text: value }]

  // Quoted strings
  if (/^'[^']*'$/.test(trimmed) || /^"[^"]*"$/.test(trimmed)) {
    const leading = value.slice(0, value.indexOf(trimmed))
    return [
      { type: 'plain', text: leading },
      { type: 'string', text: trimmed },
    ]
  }

  // Booleans
  if (/^(true|false|yes|no|on|off|null|enabled|disabled)$/i.test(trimmed)) {
    const leading = value.slice(0, value.indexOf(trimmed))
    return [
      { type: 'plain', text: leading },
      { type: 'keyword', text: trimmed },
    ]
  }

  // Numbers
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const leading = value.slice(0, value.indexOf(trimmed))
    return [
      { type: 'plain', text: leading },
      { type: 'number', text: trimmed },
    ]
  }

  // Dates
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const leading = value.slice(0, value.indexOf(trimmed))
    return [
      { type: 'plain', text: leading },
      { type: 'number', text: trimmed },
    ]
  }

  return [{ type: 'plain', text: value }]
}

const tokenizePlainText = (code: string): Token[][] => {
  return code.split('\n').map(line => {
    const tokens: Token[] = []

    // Box-drawing lines
    if (/^[╭╰├│╮╯┤─┬┴┼]+/.test(line.trim())) {
      tokens.push({ type: 'comment', text: line })
      return tokens
    }

    // Lines with box chars mixed in
    if (line.includes('│') || line.includes('╭') || line.includes('╰') || line.includes('├')) {
      tokens.push({ type: 'comment', text: line })
      return tokens
    }

    // Arrow lines
    const arrowMatch = line.match(/^(\s*)(→\s*)(.*)/)
    if (arrowMatch) {
      tokens.push({ type: 'plain', text: arrowMatch[1] })
      tokens.push({ type: 'keyword', text: arrowMatch[2] })
      tokens.push({ type: 'string', text: arrowMatch[3] })
      return tokens
    }

    // KEY: value pattern
    const kvMatch = line.match(/^(\s*)([A-Za-z][A-Za-z\s]+?)(\s{2,}—\s*)(.*)/)
    if (kvMatch) {
      tokens.push({ type: 'plain', text: kvMatch[1] })
      tokens.push({ type: 'type', text: kvMatch[2] })
      tokens.push({ type: 'comment', text: kvMatch[3] })
      tokens.push({ type: 'plain', text: kvMatch[4] })
      return tokens
    }

    // Section headers (lines starting with # or all caps)
    if (line.startsWith('#') || /^[A-Z][A-Z\s&]+$/.test(line.trim())) {
      tokens.push({ type: 'heading', text: line })
      return tokens
    }

    // Copyright
    if (line.includes('©')) {
      tokens.push({ type: 'comment', text: line })
      return tokens
    }

    tokens.push({ type: 'plain', text: line })
    return tokens
  })
}

const tokenizeTypeScript = (code: string): Token[][] => {
  const keywords = new Set([
    'import', 'export', 'from', 'const', 'let', 'var', 'function', 'return',
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
    'new', 'this', 'class', 'extends', 'implements', 'interface', 'type',
    'enum', 'async', 'await', 'try', 'catch', 'finally', 'throw',
    'default', 'as', 'of', 'in', 'typeof', 'instanceof',
    'true', 'false', 'null', 'undefined', 'void',
  ])

  const types = new Set([
    'string', 'number', 'boolean', 'any', 'never', 'unknown', 'object',
    'Promise', 'Array', 'Map', 'Set', 'Record', 'Partial', 'Required',
    'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract', 'ReturnType',
    'React', 'ReactNode', 'FC', 'Component',
  ])

  return code.split('\n').map(line => {
    const tokens: Token[] = []
    let remaining = line

    while (remaining.length > 0) {
      // Whitespace
      const wsMatch = remaining.match(/^(\s+)/)
      if (wsMatch) {
        tokens.push({ type: 'plain', text: wsMatch[1] })
        remaining = remaining.slice(wsMatch[1].length)
        continue
      }

      // Single-line comments
      if (remaining.startsWith('//')) {
        tokens.push({ type: 'comment', text: remaining })
        remaining = ''
        continue
      }

      // Template literals
      if (remaining.startsWith('`')) {
        const end = remaining.indexOf('`', 1)
        if (end >= 0) {
          tokens.push({ type: 'string', text: remaining.slice(0, end + 1) })
          remaining = remaining.slice(end + 1)
        } else {
          tokens.push({ type: 'string', text: remaining })
          remaining = ''
        }
        continue
      }

      // Strings
      const strMatch = remaining.match(/^("[^"]*"|'[^']*')/)
      if (strMatch) {
        tokens.push({ type: 'string', text: strMatch[0] })
        remaining = remaining.slice(strMatch[0].length)
        continue
      }

      // Numbers
      const numMatch = remaining.match(/^0x[0-9a-fA-F]+|^\d+(\.\d+)?/)
      if (numMatch) {
        tokens.push({ type: 'number', text: numMatch[0] })
        remaining = remaining.slice(numMatch[0].length)
        continue
      }

      // Decorators
      const decoMatch = remaining.match(/^@\w+/)
      if (decoMatch) {
        tokens.push({ type: 'function', text: decoMatch[0] })
        remaining = remaining.slice(decoMatch[0].length)
        continue
      }

      // Word tokens
      const wordMatch = remaining.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/)
      if (wordMatch) {
        const word = wordMatch[0]
        const afterWord = remaining.slice(word.length)

        if (keywords.has(word)) {
          tokens.push({ type: 'keyword', text: word })
        } else if (types.has(word) || /^[A-Z][a-zA-Z]+/.test(word)) {
          tokens.push({ type: 'type', text: word })
        } else if (afterWord.trimStart().startsWith('(')) {
          tokens.push({ type: 'function', text: word })
        } else {
          tokens.push({ type: 'variable', text: word })
        }
        remaining = remaining.slice(word.length)
        continue
      }

      // Operators
      const opMatch = remaining.match(/^(===|!==|=>|<=|>=|&&|\|\||[+\-*/%=<>!&|^~?])/)
      if (opMatch) {
        tokens.push({ type: 'operator', text: opMatch[0] })
        remaining = remaining.slice(opMatch[0].length)
        continue
      }

      // Punctuation
      if (/^[{}()[\];:.,]/.test(remaining)) {
        tokens.push({ type: 'punctuation', text: remaining[0] })
        remaining = remaining.slice(1)
        continue
      }

      tokens.push({ type: 'plain', text: remaining[0] })
      remaining = remaining.slice(1)
    }

    return tokens
  })
}

// ============================================================================
// Get tokenizer by file extension
// ============================================================================

const getTokenizer = (filename: string) => {
  if (filename.endsWith('.json')) return tokenizeJSON
  if (filename.endsWith('.md')) return tokenizeMarkdown
  if (filename.endsWith('.yml') || filename.endsWith('.yaml')) return tokenizeYAML
  if (filename.endsWith('.ts') || filename.endsWith('.tsx') || filename.endsWith('.js') || filename.endsWith('.jsx')) return tokenizeTypeScript
  return tokenizePlainText
}

// ============================================================================
// Component
// ============================================================================

interface SyntaxHighlighterProps {
  code: string
  filename: string
  currentLine?: number
}

const SyntaxHighlighter = ({ code, filename, currentLine }: SyntaxHighlighterProps) => {
  const lines = useMemo(() => {
    const tokenize = getTokenizer(filename)
    return tokenize(code)
  }, [code, filename])

  return (
    <div className="syntax-highlighted">
      {lines.map((tokens, lineIdx) => {
        const lineNumber = lineIdx + 1
        const isCurrentLine = currentLine === lineNumber
        
        return (
          <div key={lineIdx} className={`syntax-line${isCurrentLine ? ' current-line' : ''}`}>
            <span className="line-number">{lineNumber}</span>
            <span className="line-content">
              {tokens.map((token, tokenIdx) => (
                <span key={tokenIdx} className={`syn-${token.type}`}>
                  {token.text}
                </span>
              ))}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default SyntaxHighlighter
