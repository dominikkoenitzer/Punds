import { motion } from 'framer-motion'

interface StatusIndicatorProps {
  label: string
  value: string | number
  color?: 'cyan' | 'emerald' | 'amber' | 'rose' | 'violet' | 'primary'
  barValue?: number // 0-100
}

const StatusIndicator = ({ label, value, color = 'primary', barValue }: StatusIndicatorProps) => {
  return (
    <div className="status-indicator">
      <div className="status-row">
        <span className="status-label">{label}</span>
        <span className={`status-value color-${color}`}>{value}</span>
      </div>
      {barValue !== undefined && (
        <div className="status-bar-track">
          <motion.div
            className={`status-bar-fill color-${color}`}
            initial={{ width: 0 }}
            animate={{ width: `${barValue}%` }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      )}
    </div>
  )
}

export default StatusIndicator
