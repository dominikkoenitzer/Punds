import { motion } from 'framer-motion'
import { ReactNode } from 'react'

interface PanelProps {
  title: string
  icon?: ReactNode
  children: ReactNode
  className?: string
  actions?: ReactNode
  badge?: string
  delay?: number
}

const Panel = ({ title, icon, children, className = '', actions, badge, delay = 0 }: PanelProps) => {
  return (
    <motion.div
      className={`panel ${className}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="panel-header">
        <div className="panel-header-left">
          {icon && <span className="panel-icon">{icon}</span>}
          <h3 className="panel-title">{title}</h3>
          {badge && <span className="panel-badge">{badge}</span>}
        </div>
        {actions && <div className="panel-actions">{actions}</div>}
      </div>
      <div className="panel-body">
        {children}
      </div>
    </motion.div>
  )
}

export default Panel
