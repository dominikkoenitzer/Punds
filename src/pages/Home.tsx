import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  FiCopy,
  FiCheck,
  FiX,
  FiFolder,
  FiTerminal,
  FiPlus,
  FiEdit2,
} from 'react-icons/fi'
import FileTree, { TreeFile, TreeFolder, TreeNode } from '../components/FileTree'
import Panel from '../components/Panel'
import { Dialog } from '../components/ui/dialog'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import './Home.css'

const DEFAULT_WORKSPACE_TREE: TreeNode[] = []
const STORAGE_TREE_KEY = 'punds.workspace.tree.v1'
const STORAGE_CONTENT_KEY = 'punds.workspace.content.v1'

type DialogMode = 'create-file' | 'create-folder' | 'rename' | 'delete' | null

interface QuickOpenFile extends TreeFile {
  path: string
}

const isFolder = (node: TreeNode): node is TreeFolder => node.type === 'folder'

const flattenFiles = (nodes: TreeNode[], parent = ''): QuickOpenFile[] => {
  return nodes.flatMap(node => {
    if (isFolder(node)) {
      return flattenFiles(node.children, `${parent}${node.name}/`)
    }

    return [{ ...node, path: `${parent}${node.name}` }]
  })
}

const addChildAtPath = (
  nodes: TreeNode[],
  parentPath: string,
  child: TreeNode,
  parent = ''
): { nodes: TreeNode[]; added: boolean } => {
  if (!parentPath) {
    const duplicate = nodes.some(node => node.name.toLowerCase() === child.name.toLowerCase())
    if (duplicate) {
      return { nodes, added: false }
    }

    return { nodes: [...nodes, child], added: true }
  }

  let added = false
  const nextNodes = nodes.map(node => {
    if (!isFolder(node)) return node

    const currentPath = `${parent}${node.name}`
    if (currentPath === parentPath) {
      const duplicate = node.children.some(entry => entry.name.toLowerCase() === child.name.toLowerCase())
      if (duplicate) return node

      added = true
      return {
        ...node,
        children: [...node.children, child],
      }
    }

    const result = addChildAtPath(node.children, parentPath, child, `${currentPath}/`)
    if (result.added) {
      added = true
      return {
        ...node,
        children: result.nodes,
      }
    }

    return node
  })

  return { nodes: nextNodes, added }
}

const removeNodeAtPath = (
  nodes: TreeNode[],
  targetPath: string,
  parent = ''
): { nodes: TreeNode[]; removed: TreeNode | null } => {
  let removed: TreeNode | null = null

  const nextNodes = nodes
    .map(node => {
      const currentPath = `${parent}${node.name}`

      if (currentPath === targetPath) {
        removed = node
        return null
      }

      if (isFolder(node)) {
        const result = removeNodeAtPath(node.children, targetPath, `${currentPath}/`)
        if (result.removed) {
          removed = result.removed
          return {
            ...node,
            children: result.nodes,
          }
        }
      }

      return node
    })
    .filter(Boolean) as TreeNode[]

  return { nodes: nextNodes, removed }
}

const findNodeAtPath = (nodes: TreeNode[], targetPath: string, parent = ''): TreeNode | null => {
  for (const node of nodes) {
    const currentPath = `${parent}${node.name}`
    if (currentPath === targetPath) {
      return node
    }

    if (isFolder(node)) {
      const found = findNodeAtPath(node.children, targetPath, `${currentPath}/`)
      if (found) return found
    }
  }

  return null
}

const remapPath = (path: string, oldBase: string, newBase: string): string => {
  if (path === oldBase) return newBase
  if (path.startsWith(`${oldBase}/`)) {
    return `${newBase}${path.slice(oldBase.length)}`
  }
  return path
}

const getBasename = (path: string) => {
  const parts = path.split('/')
  return parts[parts.length - 1]
}

const countNestedEntries = (node: TreeNode): number => {
  if (!isFolder(node)) return 0
  return node.children.reduce((total, child) => total + 1 + countNestedEntries(child), 0)
}

const Home = () => {
  const [workspaceTree, setWorkspaceTree] = useState<TreeNode[]>(DEFAULT_WORKSPACE_TREE)
  const [fileContents, setFileContents] = useState<Record<string, string>>({})
  const [selectedFile, setSelectedFile] = useState<QuickOpenFile | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<'file' | 'folder' | null>(null)
  const [copied, setCopied] = useState(false)
  const [time, setTime] = useState(new Date())
  const [lineCol, setLineCol] = useState({ line: 1, col: 1 })
  const [isHydrated, setIsHydrated] = useState(false)

  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [entryName, setEntryName] = useState('')
  const [dialogError, setDialogError] = useState('')

  const editorRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const allFiles = useMemo(() => flattenFiles(workspaceTree), [workspaceTree])
  const allFilePaths = useMemo(() => new Set(allFiles.map(file => file.path)), [allFiles])
  const selectedNode = useMemo(
    () => (selectedPath ? findNodeAtPath(workspaceTree, selectedPath) : null),
    [selectedPath, workspaceTree]
  )
  const deleteTargetType = selectedNode?.type === 'folder' ? 'folder' : 'file'
  const deleteNestedCount = selectedNode ? countNestedEntries(selectedNode) : 0

  useEffect(() => {
    const storedTree = localStorage.getItem(STORAGE_TREE_KEY)
    const storedContent = localStorage.getItem(STORAGE_CONTENT_KEY)

    if (storedTree) {
      try {
        const parsedTree = JSON.parse(storedTree) as TreeNode[]
        if (Array.isArray(parsedTree)) {
          setWorkspaceTree(parsedTree)
        }
      } catch {
        setWorkspaceTree(DEFAULT_WORKSPACE_TREE)
      }
    }

    if (storedContent) {
      try {
        const parsedContent = JSON.parse(storedContent) as Record<string, string>
        if (parsedContent && typeof parsedContent === 'object') {
          setFileContents(parsedContent)
        }
      } catch {
        setFileContents({})
      }
    }

    setIsHydrated(true)
  }, [])

  useEffect(() => {
    if (!isHydrated) return
    localStorage.setItem(STORAGE_TREE_KEY, JSON.stringify(workspaceTree))
    localStorage.setItem(STORAGE_CONTENT_KEY, JSON.stringify(fileContents))
  }, [fileContents, isHydrated, workspaceTree])

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (selectedFile && !allFilePaths.has(selectedFile.path)) {
      setSelectedFile(null)
      setSelectedPath(null)
      setSelectedType(null)
      setLineCol({ line: 1, col: 1 })
    }
  }, [allFilePaths, selectedFile])

  const handleFileSelect = (file: TreeFile) => {
    const filePath = file.path || file.name

    setSelectedFile({
      ...file,
      path: filePath,
      content: fileContents[filePath] ?? file.content ?? '',
    })
    setSelectedPath(filePath)
    setSelectedType('file')
    setLineCol({ line: 1, col: 1 })
  }

  const handleFolderSelect = (folderPath: string) => {
    setSelectedPath(folderPath)
    setSelectedType('folder')
  }

  const getCursorLineCol = (content: string, selectionStart: number) => {
    const beforeCursor = content.slice(0, selectionStart)
    const lines = beforeCursor.split('\n')
    const line = lines.length
    const col = (lines[lines.length - 1]?.length ?? 0) + 1
    return { line, col }
  }

  const activeFileName = selectedFile?.name ?? 'Editor'
  const activeEditorContent = selectedFile
    ? fileContents[selectedFile.path] ?? selectedFile.content ?? ''
    : ''

  const editorLineCount = useMemo(() => Math.max(1, activeEditorContent.split('\n').length), [activeEditorContent])

  const updateEditorContent = (nextContent: string, selectionStart: number) => {
    if (!selectedFile) return

    setFileContents(prev => ({
      ...prev,
      [selectedFile.path]: nextContent,
    }))

    setSelectedFile(prev => (prev ? { ...prev, content: nextContent } : prev))
    setLineCol(getCursorLineCol(nextContent, selectionStart))
  }

  const handleEditorScroll = () => {
    if (!editorRef.current || !gutterRef.current) return
    gutterRef.current.scrollTop = editorRef.current.scrollTop
  }

  const handleEditorCursorUpdate = () => {
    if (!editorRef.current) return
    setLineCol(getCursorLineCol(activeEditorContent, editorRef.current.selectionStart))
  }

  const handleCopyContent = () => {
    if (activeEditorContent) {
      navigator.clipboard.writeText(activeEditorContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const getTargetFolder = () => {
    if (selectedType === 'folder') {
      return selectedPath ?? ''
    }

    if (selectedType === 'file' && selectedPath) {
      const parentSegments = selectedPath.split('/')
      parentSegments.pop()
      return parentSegments.join('/')
    }

    return ''
  }

  const createFolderWithName = (nameInput: string): string | null => {
    const folderName = nameInput.trim()
    if (!folderName) return 'Folder name is required.'

    const parentPath = getTargetFolder()
    const result = addChildAtPath(workspaceTree, parentPath, {
      name: folderName,
      type: 'folder',
      children: [],
      defaultOpen: true,
    })

    if (!result.added) {
      return 'A file or folder with that name already exists here.'
    }

    const nextPath = parentPath ? `${parentPath}/${folderName}` : folderName
    setWorkspaceTree(result.nodes)
    setSelectedPath(nextPath)
    setSelectedType('folder')
    return null
  }

  const createFileWithName = (nameInput: string): string | null => {
    const fileName = nameInput.trim()
    if (!fileName) return 'File name is required.'

    const parentPath = getTargetFolder()
    const result = addChildAtPath(workspaceTree, parentPath, {
      name: fileName,
      type: 'file',
      icon: 'code',
      content: '',
    })

    if (!result.added) {
      return 'A file or folder with that name already exists here.'
    }

    const newPath = parentPath ? `${parentPath}/${fileName}` : fileName
    const initialContent = `// ${fileName}\n\n`

    setWorkspaceTree(result.nodes)
    setFileContents(prev => ({
      ...prev,
      [newPath]: initialContent,
    }))
    setSelectedFile({
      name: fileName,
      type: 'file',
      icon: 'code',
      path: newPath,
      content: initialContent,
    })
    setSelectedPath(newPath)
    setSelectedType('file')
    setLineCol({ line: 1, col: 1 })
    return null
  }

  const renameSelectedNode = (nameInput: string): string | null => {
    if (!selectedPath || !selectedType) return 'Select a file or folder first.'

    const nextName = nameInput.trim()
    if (!nextName) return 'Name is required.'

    const parentSegments = selectedPath.split('/')
    parentSegments.pop()
    const parentPath = parentSegments.join('/')

    const removedResult = removeNodeAtPath(workspaceTree, selectedPath)
    if (!removedResult.removed) return 'Could not rename the selected item.'

    const renamedNode: TreeNode = {
      ...removedResult.removed,
      name: nextName,
    }

    const insertResult = addChildAtPath(removedResult.nodes, parentPath, renamedNode)
    if (!insertResult.added) {
      return 'A file or folder with that name already exists here.'
    }

    const oldPath = selectedPath
    const nextPath = parentPath ? `${parentPath}/${nextName}` : nextName

    setWorkspaceTree(insertResult.nodes)

    setFileContents(prev => {
      const updated: Record<string, string> = {}
      for (const [path, value] of Object.entries(prev)) {
        updated[remapPath(path, oldPath, nextPath)] = value
      }
      return updated
    })

    setSelectedPath(nextPath)

    if (selectedType === 'file') {
      setSelectedFile(prev => prev
        ? {
            ...prev,
            name: nextName,
            path: nextPath,
          }
        : prev
      )
    } else {
      setSelectedFile(prev => {
        if (!prev) return prev
        const nextFilePath = remapPath(prev.path, oldPath, nextPath)
        return {
          ...prev,
          path: nextFilePath,
          name: getBasename(nextFilePath),
        }
      })
    }

    return null
  }

  const moveNodeToFolder = (sourcePath: string, targetFolderPath: string) => {
    if (sourcePath === targetFolderPath) return

    const sourceNode = findNodeAtPath(workspaceTree, sourcePath)
    if (!sourceNode) return

    if (isFolder(sourceNode) && targetFolderPath.startsWith(`${sourcePath}/`)) {
      return
    }

    const removeResult = removeNodeAtPath(workspaceTree, sourcePath)
    if (!removeResult.removed) return

    const insertResult = addChildAtPath(removeResult.nodes, targetFolderPath, removeResult.removed)
    if (!insertResult.added) return

    const newPath = targetFolderPath ? `${targetFolderPath}/${removeResult.removed.name}` : removeResult.removed.name

    setWorkspaceTree(insertResult.nodes)

    if (newPath !== sourcePath) {
      setFileContents(prev => {
        const updated: Record<string, string> = {}
        for (const [path, value] of Object.entries(prev)) {
          updated[remapPath(path, sourcePath, newPath)] = value
        }
        return updated
      })

      setSelectedPath(prev => (prev ? remapPath(prev, sourcePath, newPath) : prev))
      setSelectedFile(prev => {
        if (!prev) return prev
        const nextFilePath = remapPath(prev.path, sourcePath, newPath)
        return {
          ...prev,
          path: nextFilePath,
          name: getBasename(nextFilePath),
        }
      })
    }
  }

  const deleteSelectedNode = (): string | null => {
    if (!selectedPath) return 'Select a file or folder first.'

    const removeResult = removeNodeAtPath(workspaceTree, selectedPath)
    if (!removeResult.removed) return 'Could not delete the selected item.'

    setWorkspaceTree(removeResult.nodes)
    setFileContents(prev => {
      const updated: Record<string, string> = {}
      for (const [path, value] of Object.entries(prev)) {
        if (path === selectedPath || path.startsWith(`${selectedPath}/`)) {
          continue
        }
        updated[path] = value
      }
      return updated
    })

    setSelectedFile(null)
    setSelectedPath(null)
    setSelectedType(null)
    setLineCol({ line: 1, col: 1 })

    return null
  }

  const openDialog = (mode: DialogMode) => {
    setDialogMode(mode)
    setDialogError('')

    if (mode === 'create-file') {
      setEntryName('')
    } else if (mode === 'create-folder') {
      setEntryName('')
    } else {
      setEntryName(selectedPath ? getBasename(selectedPath) : '')
    }

    setIsDialogOpen(true)
  }

  const submitDialog = () => {
    if (!dialogMode) return

    const result = dialogMode === 'create-file'
      ? createFileWithName(entryName)
      : dialogMode === 'create-folder'
        ? createFolderWithName(entryName)
        : dialogMode === 'rename'
          ? renameSelectedNode(entryName)
          : deleteSelectedNode()

    if (result) {
      setDialogError(result)
      return
    }

    setIsDialogOpen(false)
    setDialogMode(null)
  }

  const dialogTitle = dialogMode === 'create-file'
    ? 'Create File'
    : dialogMode === 'create-folder'
      ? 'Create Folder'
      : dialogMode === 'rename'
        ? 'Rename Item'
        : 'Delete Item'

  const dialogDescription = dialogMode === 'rename'
    ? 'Update the name for the selected file or folder.'
    : dialogMode === 'delete'
      ? 'This action cannot be undone.'
      : 'Choose a name for the new item in your workspace.'

  return (
    <div className="workspace">
      <div className="ambient-bg">
        <div className="ambient-gradient" />
        <div className="ambient-grid" />
        <div className="ambient-orb orb-1" />
        <div className="ambient-orb orb-2" />
        <div className="ambient-orb orb-3" />
      </div>

      <header className="topbar" role="banner">
        <div className="topbar-center">
          <span className="topbar-time mono">{time.toLocaleTimeString('en-US', { hour12: false })}</span>
        </div>
      </header>

      <main className="main-layout" role="main">
        <aside className="sidebar">
          <Panel
            title="Explorer"
            icon={<FiFolder size={15} />}
            className="panel-explorer"
            delay={0.1}
            actions={
              <div className="viewer-actions">
                <button
                  className="action-btn"
                  onClick={() => openDialog('create-file')}
                  aria-label="Create file"
                  title="Create file"
                >
                  <FiPlus size={14} />
                </button>
                <button
                  className="action-btn"
                  onClick={() => openDialog('create-folder')}
                  aria-label="Create folder"
                  title="Create folder"
                >
                  <FiFolder size={14} />
                </button>
                <button
                  className="action-btn"
                  onClick={() => openDialog('rename')}
                  aria-label="Rename selected"
                  title="Rename selected"
                  disabled={!selectedPath}
                >
                  <FiEdit2 size={14} />
                </button>
                <button
                  className="action-btn"
                  onClick={() => openDialog('delete')}
                  aria-label="Delete selected"
                  title="Delete selected"
                  disabled={!selectedPath}
                >
                  <FiX size={14} />
                </button>
              </div>
            }
          >
            <FileTree
              nodes={workspaceTree}
              onFileSelect={handleFileSelect}
              onFolderSelect={handleFolderSelect}
              onMoveNode={moveNodeToFolder}
              selectedFile={selectedPath}
            />
          </Panel>
        </aside>

        <Panel
          title={activeFileName}
          icon={<FiTerminal size={15} />}
          className="panel-viewer"
          delay={0.15}
          actions={
            <div className="viewer-actions">
              <button
                className="action-btn"
                onClick={handleCopyContent}
                aria-label={copied ? 'Copied' : 'Copy content'}
              >
                {copied ? <FiCheck size={14} /> : <FiCopy size={14} />}
              </button>
              <button
                className="action-btn"
                onClick={() => {
                  setSelectedFile(null)
                  setSelectedPath(null)
                  setSelectedType(null)
                }}
                aria-label="Close file"
              >
                <FiX size={14} />
              </button>
            </div>
          }
        >
          <div className="viewer-content">
            {selectedFile ? (
              <motion.div
                key={activeFileName}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="file-content-wrapper"
              >
                <div className="file-breadcrumb">
                  <span className="breadcrumb-segment">~</span>
                  <span className="breadcrumb-sep">/</span>
                  <span className="breadcrumb-segment">{selectedFile.path}</span>
                </div>
                <div className="file-content-area code-editor-shell">
                  <div className="editor-gutter" ref={gutterRef} aria-hidden="true">
                    {Array.from({ length: editorLineCount }, (_, index) => (
                      <div
                        key={index + 1}
                        className={`editor-line-number ${lineCol.line === index + 1 ? 'active' : ''}`}
                      >
                        {index + 1}
                      </div>
                    ))}
                  </div>
                  <textarea
                    ref={editorRef}
                    className="editor-textarea mono"
                    spellCheck={false}
                    value={activeEditorContent}
                    onChange={event => updateEditorContent(event.target.value, event.target.selectionStart)}
                    onScroll={handleEditorScroll}
                    onClick={handleEditorCursorUpdate}
                    onKeyUp={handleEditorCursorUpdate}
                    onSelect={handleEditorCursorUpdate}
                    aria-label="Code editor"
                  />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty-editor"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="viewer-empty"
              >
                <div className="empty-icon">
                  <FiTerminal size={28} />
                </div>
                <p className="empty-title">No file selected</p>
                <p className="empty-subtitle">
                  Create files/folders from Explorer. Your structure is persisted locally.
                </p>
              </motion.div>
            )}
          </div>
        </Panel>

      </main>

      <Dialog
        open={isDialogOpen}
        onOpenChange={open => {
          setIsDialogOpen(open)
          if (!open) {
            setDialogMode(null)
            setDialogError('')
          }
        }}
        title={dialogTitle}
        description={dialogDescription}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitDialog}
              className={dialogMode === 'delete' ? 'ui-btn-danger' : undefined}
            >
              {dialogMode === 'delete' ? `Delete ${deleteTargetType}` : 'Save'}
            </Button>
          </>
        )}
      >
        {dialogMode === 'delete' ? (
          <div className="dialog-delete-simple">
            <p className="dialog-delete-note">
              {deleteTargetType === 'folder'
                ? `This will remove this folder and ${deleteNestedCount} nested item${deleteNestedCount === 1 ? '' : 's'} from local storage.`
                : 'This will remove this file from local storage.'}
            </p>
          </div>
        ) : (
          <div className="dialog-form">
            <label className="dialog-label" htmlFor="workspace-entry-name">Name</label>
            <Input
              id="workspace-entry-name"
              value={entryName}
              onChange={event => {
                setEntryName(event.target.value)
                if (dialogError) setDialogError('')
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submitDialog()
                }
              }}
              autoFocus
            />
            {dialogError && <p className="dialog-error">{dialogError}</p>}
          </div>
        )}
        {dialogMode === 'delete' && dialogError && <p className="dialog-error">{dialogError}</p>}
      </Dialog>
    </div>
  )
}

export default Home
