import React from 'react'

type TiptapNode = Record<string, unknown>

export function textToTiptapDoc(text: string): TiptapNode {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

function extractTiptapText(nodes: TiptapNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return (node.text as string) ?? ''
      if (Array.isArray(node.content)) return extractTiptapText(node.content as TiptapNode[])
      return ''
    })
    .join('')
}

function applyMarks(
  text: string,
  marks: TiptapNode[] | undefined,
  key: string,
): React.ReactNode {
  if (!marks?.length) return text

  return marks.reduce<React.ReactNode>((acc, mark, idx) => {
    const markType = mark.type
    const markKey = `${key}-mark-${idx}`

    if (markType === 'bold') return <strong key={markKey}>{acc}</strong>
    if (markType === 'italic') return <em key={markKey}>{acc}</em>
    if (markType === 'underline') return <u key={markKey}>{acc}</u>
    if (markType === 'link') {
      const href =
        typeof mark.attrs === 'object' && mark.attrs && 'href' in mark.attrs
          ? String((mark.attrs as Record<string, unknown>).href ?? '')
          : ''
      return href ? (
        <a key={markKey} href={href} target="_blank" rel="noopener noreferrer">
          {acc}
        </a>
      ) : (
        acc
      )
    }

    return acc
  }, text)
}

function renderTiptapNodes(nodes: TiptapNode[], path = 'root'): React.ReactNode {
  return nodes.map((node, idx) => {
    const key = `${path}-${idx}`
    const type = node.type

    if (type === 'text') {
      return applyMarks(
        String(node.text ?? ''),
        Array.isArray(node.marks) ? (node.marks as TiptapNode[]) : undefined,
        key,
      )
    }

    if (type === 'hardBreak') return <br key={key} />

    const childNodes = Array.isArray(node.content)
      ? renderTiptapNodes(node.content as TiptapNode[], key)
      : null

    if (type === 'paragraph') return <p key={key}>{childNodes}</p>
    if (type === 'bulletList') return <ul key={key}>{childNodes}</ul>
    if (type === 'orderedList') return <ol key={key}>{childNodes}</ol>
    if (type === 'listItem') return <li key={key}>{childNodes}</li>

    return <React.Fragment key={key}>{childNodes}</React.Fragment>
  })
}

/**
 * Parse note content and provide both rendered rich text and plain text fallback.
 */
export function renderNoteContent(content: unknown): { rich: React.ReactNode | null; plainText: string } {
  if (typeof content === 'string') return { rich: null, plainText: content }
  if (!content || typeof content !== 'object') return { rich: null, plainText: '' }

  const doc = content as TiptapNode

  if (doc.type === 'doc' && Array.isArray(doc.content)) {
    const nodes = doc.content as TiptapNode[]
    const plainText = extractTiptapText(nodes)
    return { rich: renderTiptapNodes(nodes), plainText }
  }

  // Legacy Lexical format compatibility.
  const root = doc.root as { children?: Array<{ children?: Array<{ text?: string }> }> } | undefined
  if (root?.children) {
    const text = root.children
      .flatMap((node) => node.children ?? [])
      .map((child) => child.text ?? '')
      .join('')
    return { rich: null, plainText: text }
  }

  return { rich: null, plainText: '' }
}
