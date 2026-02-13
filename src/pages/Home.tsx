import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FiGithub,
  FiGlobe,
  FiBook,
  FiDollarSign,
  FiCopy,
  FiCheck,
  FiX,
  FiFolder,
  FiExternalLink,
  FiMapPin,
  FiZap,
  FiLayers,
  FiTerminal,
  FiCode,
  FiArrowUpRight,
  FiCommand,
} from 'react-icons/fi'
import FileTree, { TreeNode, TreeFile } from '../components/FileTree'
import SyntaxHighlighter from '../components/SyntaxHighlighter'
import Panel from '../components/Panel'
import './Home.css'

// ============================================================================
// DATA
// ============================================================================

const FILE_TREE_DATA: TreeNode[] = [
  {
    name: 'src',
    type: 'folder',
    defaultOpen: true,
    children: [
      {
        name: 'fibonacci.ts',
        type: 'file',
        icon: 'code',
        content: `// Fibonacci sequence generators
// Comparing iterative vs recursive approaches

interface FibResult {
  value: number;
  computeTime: number;
}

function fibIterative(n: number): FibResult {
  const start = performance.now();

  if (n <= 1) return { value: n, computeTime: 0 };

  let prev = 0;
  let curr = 1;

  for (let i = 2; i <= n; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }

  return {
    value: curr,
    computeTime: performance.now() - start,
  };
}

// Memoized recursive version
const memo = new Map<number, number>();

function fibMemo(n: number): number {
  if (n <= 1) return n;
  if (memo.has(n)) return memo.get(n)!;

  const result = fibMemo(n - 1) + fibMemo(n - 2);
  memo.set(n, result);
  return result;
}

// Generator for lazy evaluation
function* fibGenerator(): Generator<number> {
  let a = 0;
  let b = 1;

  while (true) {
    yield a;
    [a, b] = [b, a + b];
  }
}

// Take first N fibonacci numbers
function take(gen: Generator<number>, n: number): number[] {
  const result: number[] = [];
  for (const val of gen) {
    if (result.length >= n) break;
    result.push(val);
  }
  return result;
}

const first20 = take(fibGenerator(), 20);
console.log("First 20:", first20);
console.log("Fib(40):", fibIterative(40));`,
      },
      // notes.txt removed
      {
        name: 'http-server.ts',
        type: 'file',
        icon: 'code',
        content: `// Minimal HTTP server with routing
// No external dependencies required

import { createServer, IncomingMessage, ServerResponse } from "http";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
type Method = "GET" | "POST" | "PUT" | "DELETE";

interface Route {
  method: Method;
  path: string;
  handler: Handler;
}

const routes: Route[] = [];

function route(method: Method, path: string, handler: Handler) {
  routes.push({ method, path, handler });
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

  json(res, {
    status: "healthy",
    uptime: process.uptime(),
    memory: process.memoryUsage().heapUsed,
  });
});

route("GET", "/api/users", (_, res) => {
  const users = [
    { id: 1, name: "Alice", role: "admin" },
    { id: 2, name: "Bob", role: "user" },
    { id: 3, name: "Charlie", role: "user" },
  ];
  json(res, { users, total: users.length });
});

route("POST", "/api/echo", (req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    json(res, { echo: JSON.parse(body) });
  });
});

// Start server
const server = createServer((req, res) => {
  const match = routes.find(
    (r) => r.method === req.method && r.path === req.url
  );

  if (match) {
    match.handler(req, res);
  } else {
    json(res, { error: "Not Found" }, 404);
  }
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`);
});`,
      },
      {
        name: 'utils.ts',
        type: 'file',
        icon: 'code',
        content: `// Collection of useful utility functions

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as T;
  if (Array.isArray(obj)) return obj.map(deepClone) as T;

  const cloned = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

export function groupBy<T>(
  arr: T[],
  keyFn: (item: T) => string
): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] ||= []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return \`\${bytes.toFixed(1)} \${units[i]}\`;
}

// Retry with exponential backoff
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  throw new Error("Unreachable");
}`,
      },
    ],
  },
  {
    name: 'config',
    type: 'folder',
    children: [
      {
        name: 'settings.json',
        type: 'file',
        icon: 'settings',
        label: 'CONFIG',
        content: `{
  "editor": {
    "fontFamily": "JetBrains Mono, monospace",
    "fontSize": 14,
    "lineHeight": 1.7,
    "tabSize": 2,
    "wordWrap": "on",
    "minimap": false,
    "bracketPairColorization": true,
    "cursorBlinking": "smooth",
    "smoothScrolling": true,
    "renderWhitespace": "boundary"
  },
  "theme": {
    "name": "One Dark Pro",
    "type": "dark",
    "colors": {
      "background": "#1e1e2e",
      "foreground": "#cdd6f4",
      "accent": "#89b4fa",
      "selection": "#45475a",
      "cursor": "#f5e0dc"
    }
  },
  "terminal": {
    "shell": "/bin/zsh",
    "fontSize": 13,
    "scrollback": 10000,
    "cursorStyle": "bar"
  },
  "git": {
    "autofetch": true,
    "confirmSync": false,
    "enableSmartCommit": true
  },
  "formatOnSave": true,
  "autoSave": "afterDelay",
  "autoSaveDelay": 1000
}`,
      },
      {
        name: 'docker.yml',
        type: 'file',
        icon: 'settings',
        content: `# Docker Compose configuration
# Multi-service development stack

version: "3.9"

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgres://user:pass@db:5432/mydb
      - REDIS_URL=redis://cache:6379
    volumes:
      - ./src:/app/src
      - /app/node_modules
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: mydb
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user"]
      interval: 5s
      timeout: 5s
      retries: 5

  cache:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --maxmemory 128mb

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - app

volumes:
  pgdata:
    driver: local`,
      },
    ],
  },
  {
    name: 'docs',
    type: 'folder',
    children: [
      {
        name: 'README.md',
        type: 'file',
        icon: 'text',
        content: `# Quantum Engine

**A high-performance physics simulation framework**

## Overview

Quantum Engine is a lightweight, GPU-accelerated physics engine
built for real-time particle simulations and fluid dynamics.
It supports both 2D and 3D environments with customizable
force fields and collision detection.

## Quick Start

\`\`\`bash
npm install quantum-engine
\`\`\`

## Features

- **Particle Systems** — Up to 1M particles at 60fps
- **Fluid Dynamics** — SPH-based fluid simulation
- **Collision Detection** — Broad & narrow phase
- **Force Fields** — Gravity, wind, attractors, turbulence
- **GPU Compute** — WebGPU shader support
- **Deterministic** — Frame-perfect replay

## Architecture

The engine uses an Entity-Component-System (ECS) architecture
for maximum cache efficiency and parallelism.

## License

MIT — Free for personal and commercial use.`,
      },
      {
        name: 'changelog.md',
        type: 'file',
        icon: 'text',
        content: `# Changelog

All notable changes to this project.

## [3.2.0] — 2025-06-15

### Added
- WebGPU compute shader pipeline
- Spatial hashing for collision broadphase
- New turbulence force field type
- Debug visualization overlay

### Changed
- Improved memory allocator performance by 40%
- Migrated from Float32Array to SharedArrayBuffer
- Updated particle renderer to use instancing

### Fixed
- Memory leak in constraint solver
- Incorrect angular velocity integration
- Z-fighting in debug wireframes

## [3.1.0] — 2025-04-22

### Added
- Fluid surface reconstruction
- Verlet integration option
- Custom shader hook API

### Changed
- Reduced bundle size by 35%
- Switched to vitest for testing

### Fixed
- Race condition in worker pool
- NaN propagation in force calculations`,
      },
    ],
  },
  // notes.txt removed
]

const LINKS = [
  {
    name: 'Website',
    url: 'https://dominikkoenitzer.ch',
    description: 'Portfolio & blog',
    icon: FiGlobe,
    color: 'cyan' as const,
  },
  {
    name: 'GitHub',
    url: 'https://github.com/dominikkoenitzer',
    description: 'Code & repositories',
    icon: FiGithub,
    color: 'violet' as const,
  },
  {
    name: 'Journal',
    url: 'https://senbon.ch',
    description: 'Writing & thoughts',
    icon: FiBook,
    color: 'emerald' as const,
  },
  {
    name: 'Support',
    url: 'https://www.paypal.com/paypalme/dominikkoenitzer',
    description: 'Buy me a coffee',
    icon: FiDollarSign,
    color: 'amber' as const,
  },
]

// ============================================================================
// COMPONENT
// ============================================================================

const Home = () => {
  const [selectedFile, setSelectedFile] = useState<TreeFile | null>(null)
  const [copied, setCopied] = useState(false)
  const [time, setTime] = useState(new Date())
  const [lineCol, setLineCol] = useState({ line: 1, col: 1 })

  // Clock
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const handleFileSelect = (file: TreeFile) => {
    setSelectedFile(file)
    // Simulate cursor position
    if (file.content) {
      // open at the top of the file by default
      setLineCol({ line: 1, col: 1 })
    }
  }

  const handleCopyContent = () => {
    if (selectedFile?.content) {
      navigator.clipboard.writeText(selectedFile.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="workspace">
      {/* Ambient background */}
      <div className="ambient-bg">
        <div className="ambient-gradient" />
        <div className="ambient-grid" />
        <div className="ambient-orb orb-1" />
        <div className="ambient-orb orb-2" />
        <div className="ambient-orb orb-3" />
      </div>

      {/* Top Bar */}
      <header className="topbar" role="banner">
        <div className="topbar-left">
          <div className="topbar-brand">
            <div className="brand-icon">
              <FiLayers size={18} />
            </div>
            <span className="brand-name">workspace</span>
            <span className="brand-separator">/</span>
            <span className="brand-path">dominik</span>
          </div>
        </div>
        <div className="topbar-right">
          <div className="topbar-status">
            <span className="status-dot online" />
          </div>
          <span className="topbar-time mono">{time.toLocaleTimeString('en-US', { hour12: false })}</span>
        </div>
      </header>

      {/* Main Layout — VS Code style 3-column */}
      <main className="main-layout" role="main">
        {/* Left: Sidebar — Profile + Explorer */}
        <aside className="sidebar">
          {/* Profile Card */}
          <motion.div
            className="sidebar-profile"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="profile-avatar-wrapper">
              <div className="avatar-glow" />
              <img
                src="https://avatars.githubusercontent.com/u/82450286?v=4"
                alt="Dominik Koenitzer"
                className="profile-avatar"
              />
              <span className="avatar-status-ring" />
            </div>
            <div className="profile-info">
              <h2 className="profile-name">Dominik Koenitzer</h2>
              <p className="profile-role">Full-Stack Developer</p>
              <p className="profile-bio">Crafting web experiences with clean code and thoughtful design.</p>
            </div>
            <div className="profile-meta">
              <span className="meta-item">
                <FiMapPin size={12} />
                Switzerland
              </span>
              <span className="meta-divider" />
              <span className="meta-item meta-available" />
            </div>
          </motion.div>

          {/* Explorer */}
          <Panel
            title="Explorer"
            icon={<FiFolder size={15} />}
            className="panel-explorer"
            delay={0.1}
          >
            <FileTree
              nodes={FILE_TREE_DATA}
              onFileSelect={handleFileSelect}
              selectedFile={selectedFile?.name}
            />
          </Panel>
        </aside>

        {/* Center: Editor / File Viewer */}
        <Panel
          title={selectedFile ? selectedFile.name : 'Editor'}
          icon={<FiTerminal size={15} />}
          className="panel-viewer"
          delay={0.15}
          actions={
            selectedFile ? (
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
                  onClick={() => setSelectedFile(null)}
                  aria-label="Close file"
                >
                  <FiX size={14} />
                </button>
              </div>
            ) : undefined
          }
        >
          <div className="viewer-content">
            <AnimatePresence mode="wait">
              {selectedFile ? (
                <motion.div
                  key={selectedFile.name}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="file-content-wrapper"
                >
                  <div className="file-breadcrumb">
                    <span className="breadcrumb-segment">~</span>
                    <span className="breadcrumb-sep">/</span>
                    <span className="breadcrumb-segment">{selectedFile.name}</span>
                  </div>
                  <div className="file-content-area">
                    <SyntaxHighlighter
                      code={selectedFile.content || ''}
                      filename={selectedFile.name}
                      currentLine={lineCol.line}
                    />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="viewer-empty"
                >
                  <div className="empty-icon">
                    <FiTerminal size={28} />
                  </div>
                  <p className="empty-title">No file selected</p>
                  <p className="empty-subtitle">
                    Choose a file from the explorer to view its contents
                  </p>
                  <div className="empty-hint">
                    <FiCommand size={11} />
                    <span>Click any file to view</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Panel>

        {/* Right: Links Panel */}
        <aside className="sidebar-right">
          <Panel
            title="Links"
            icon={<FiExternalLink size={15} />}
            className="panel-links"
            delay={0.2}
          >
            <div className="links-list">
              {LINKS.map((link, i) => (
                <motion.a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`link-card color-${link.color}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ y: -2 }}
                >
                  <div className={`link-icon-wrapper color-${link.color}`}>
                    <link.icon size={18} />
                  </div>
                  <div className="link-text">
                    <span className="link-name">{link.name}</span>
                    <span className="link-desc">{link.description}</span>
                  </div>
                  <FiArrowUpRight size={14} className="link-external" />
                </motion.a>
              ))}
            </div>
          </Panel>
        </aside>
      </main>

      {/* Footer */}
      <footer className="workspace-footer" role="contentinfo">
        <div className="footer-accent" />
        <div className="footer-content">
          <div className="footer-left">
            <span className="footer-item footer-branch">
              <FiCode size={11} />
            </span>
            <span className="footer-separator" />
            <span className="footer-item mono">
              Ln {lineCol.line}, Col {lineCol.col}
            </span>
            <span className="footer-separator" />
            <span className="footer-item">
              <FiZap size={11} />
              <span>Vite + React</span>
            </span>
          </div>
          <div className="footer-right">
            <span className="footer-item mono">UTF-8</span>
            <span className="footer-separator" />
            <span className="footer-item mono">TypeScript</span>
            <span className="footer-separator" />
          </div>
        </div>
      </footer>
    </div>
  )
}

export default Home
