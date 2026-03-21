import { ReactNode } from 'react'

interface PanelProps {
  title: string
  icon?: ReactNode
  children: ReactNode
  className?: string
  actions?: ReactNode
  badge?: string
}

const Panel = ({ title, icon, children, className = '', actions, badge }: PanelProps) => {
  return (
    <div
      className={`panel ${className}`}
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
    </div>
  )
}

export default Panel
