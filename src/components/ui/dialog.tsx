import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ReactNode } from 'react'
import { FiX } from 'react-icons/fi'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}

export function Dialog({ open, onOpenChange, title, description, children, footer }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog-overlay" />
        <DialogPrimitive.Content className="ui-dialog-content">
          <div className="ui-dialog-header">
            <DialogPrimitive.Title className="ui-dialog-title">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="ui-dialog-description">{description}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="ui-dialog-close" aria-label="Close dialog">
            <FiX size={16} />
          </DialogPrimitive.Close>
          <div className="ui-dialog-body">{children}</div>
          {footer && <div className="ui-dialog-footer">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
