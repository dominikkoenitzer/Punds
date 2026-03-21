import { InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '../../lib/utils'

type InputProps = InputHTMLAttributes<HTMLInputElement>

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  return <input ref={ref} className={cn('ui-input', className)} {...props} />
})

Input.displayName = 'Input'

export { Input }
