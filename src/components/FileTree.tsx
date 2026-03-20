import { useState, useCallback, type DragEvent } from 'react'
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
  path?: string
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
  onFolderSelect?: (path: string) => void
  onMoveNode?: (sourcePath: string, targetFolderPath: string) => void
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
  onFolderSelect,
  onMoveNode,
  selectedFile,
  depth = 0,
  parentPath = '',
}: {
  node: TreeNode
  onFileSelect: (file: TreeFile) => void
  onFolderSelect?: (path: string) => void
  onMoveNode?: (sourcePath: string, targetFolderPath: string) => void
  selectedFile?: string | null
  depth: number
  parentPath?: string
}) => {
  const [isOpen, setIsOpen] = useState(
    node.type === 'folder' && node.defaultOpen !== false
  )

  const currentPath = `${parentPath}${node.name}`

  const handleToggle = useCallback(() => {
    setIsOpen(prev => !prev)
    if (node.type === 'folder') {
      onFolderSelect?.(currentPath)
    }
  }, [currentPath, node.type, onFolderSelect])

  const handleFileClick = useCallback(() => {
    if (node.type === 'file') {
      onFileSelect({
        ...node,
        path: node.path || currentPath,
      })
    }
  }, [currentPath, node, onFileSelect])

  const handleDragStart = useCallback((event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('application/x-tree-node-path', currentPath)
    event.dataTransfer.effectAllowed = 'move'
  }, [currentPath])

  const handleDropOnFolder = useCallback((event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const sourcePath = event.dataTransfer.getData('application/x-tree-node-path')
    if (!sourcePath || sourcePath === currentPath) return
    onMoveNode?.(sourcePath, currentPath)
  }, [currentPath, onMoveNode])

  const handleDragOverFolder = useCallback((event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  if (node.type === 'folder') {
    const isSelectedFolder = selectedFile === currentPath

    return (
      <div className="tree-folder">
        <button
          className={`tree-item tree-folder-header ${isSelectedFolder ? 'selected' : ''}`}
          onClick={handleToggle}
          draggable
          onDragStart={handleDragStart}
          onDrop={handleDropOnFolder}
          onDragOver={handleDragOverFolder}
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
                  onFolderSelect={onFolderSelect}
                  onMoveNode={onMoveNode}
                  selectedFile={selectedFile}
                  depth={depth + 1}
                  parentPath={`${parentPath}${node.name}/`}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  const IconComponent = fileIconMap[node.icon || 'file']
  const filePath = node.path || `${parentPath}${node.name}`
  const isSelected = selectedFile === filePath

  return (
    <button
      className={`tree-item tree-file ${isSelected ? 'selected' : ''}`}
      onClick={handleFileClick}
      draggable
      onDragStart={handleDragStart}
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

const FileTree = ({ nodes, onFileSelect, onFolderSelect, onMoveNode, selectedFile, depth = 0 }: FileTreeProps) => {
  return (
    <div
      className="file-tree"
      role="tree"
      onDragOver={event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={event => {
        const sourcePath = event.dataTransfer.getData('application/x-tree-node-path')
        if (!sourcePath) return
        onMoveNode?.(sourcePath, '')
      }}
    >
      {nodes.map((node, i) => (
        <FileTreeNode
          key={`${node.name}-${i}`}
          node={node}
          onFileSelect={onFileSelect}
          onFolderSelect={onFolderSelect}
          onMoveNode={onMoveNode}
          selectedFile={selectedFile}
          depth={depth}
          parentPath=""
        />
      ))}
    </div>
  )
}

export default FileTree
