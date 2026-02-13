import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FiChevronRight,
  FiChevronDown,
  FiFolder,
  FiFile,
  FiFileText,
  FiCode,
  FiLock,
  FiKey,
  FiTerminal,
  FiDatabase,
  FiSettings,
  FiShield,
} from 'react-icons/fi'

// ============================================================================
// TYPES
// ============================================================================

export interface TreeFile {
  name: string
  type: 'file'
  icon?: 'file' | 'text' | 'code' | 'lock' | 'key' | 'terminal' | 'database' | 'settings' | 'shield'
  label?: string
  content?: string
}

export interface TreeFolder {
  name: string
  type: 'folder'
  children: (TreeFile | TreeFolder)[]
  defaultOpen?: boolean
}

export type TreeNode = TreeFile | TreeFolder

interface FileTreeProps {
  nodes: TreeNode[]
  onFileSelect: (file: TreeFile) => void
  selectedFile?: string | null
  depth?: number
}

// ============================================================================
// FILE ICON MAP
// ============================================================================

const fileIconMap = {
  file: FiFile,
  text: FiFileText,
  code: FiCode,
  lock: FiLock,
  key: FiKey,
  terminal: FiTerminal,
  database: FiDatabase,
  settings: FiSettings,
  shield: FiShield,
}

// ============================================================================
// FILE TREE NODE
// ============================================================================

const FileTreeNode = ({
  node,
  onFileSelect,
  selectedFile,
  depth = 0,
}: {
  node: TreeNode
  onFileSelect: (file: TreeFile) => void
  selectedFile?: string | null
  depth: number
}) => {
  const [isOpen, setIsOpen] = useState(
    node.type === 'folder' && node.defaultOpen !== false
  )

  const handleToggle = useCallback(() => {
    setIsOpen(prev => !prev)
  }, [])

  const handleFileClick = useCallback(() => {
    if (node.type === 'file') {
      onFileSelect(node)
    }
  }, [node, onFileSelect])

  if (node.type === 'folder') {
    return (
      <div className="tree-folder">
        <button
          className="tree-item tree-folder-header"
          onClick={handleToggle}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
        >
          <span className="tree-chevron">
            {isOpen ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
          </span>
          <FiFolder size={15} className={`tree-icon folder-icon ${isOpen ? 'open' : ''}`} />
          <span className="tree-name folder-name">{node.name}</span>
          <span className="tree-count">{node.children.length}</span>
        </button>
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              className="tree-children"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {node.children.map((child, i) => (
                <FileTreeNode
                  key={`${child.name}-${i}`}
                  node={child}
                  onFileSelect={onFileSelect}
                  selectedFile={selectedFile}
                  depth={depth + 1}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  const IconComponent = fileIconMap[node.icon || 'file']
  const isSelected = selectedFile === node.name

  return (
    <button
      className={`tree-item tree-file ${isSelected ? 'selected' : ''}`}
      onClick={handleFileClick}
      style={{ paddingLeft: `${depth * 16 + 12}px` }}
    >
      <span className="tree-chevron" style={{ visibility: 'hidden' }}>
        <FiChevronRight size={14} />
      </span>
      <IconComponent size={15} className={`tree-icon file-icon ${node.icon || 'file'}`} />
      <span className="tree-name">{node.name}</span>
      {node.label && <span className={`tree-label label-${node.label.toLowerCase()}`}>{node.label}</span>}
    </button>
  )
}

// ============================================================================
// FILE TREE
// ============================================================================

const FileTree = ({ nodes, onFileSelect, selectedFile, depth = 0 }: FileTreeProps) => {
  return (
    <div className="file-tree" role="tree">
      {nodes.map((node, i) => (
        <FileTreeNode
          key={`${node.name}-${i}`}
          node={node}
          onFileSelect={onFileSelect}
          selectedFile={selectedFile}
          depth={depth}
        />
      ))}
    </div>
  )
}

export default FileTree
