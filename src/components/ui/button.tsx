import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '../../lib/utils'

type ButtonVariant = 'default' | 'outline' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

const variantClasses: Record<ButtonVariant, string> = {
  default: 'ui-btn ui-btn-default',
  outline: 'ui-btn ui-btn-outline',
  ghost: 'ui-btn ui-btn-ghost',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = 'default', ...props }, ref) => {
  return <button ref={ref} className={cn(variantClasses[variant], className)} {...props} />
})

Button.displayName = 'Button'

export { Button }
