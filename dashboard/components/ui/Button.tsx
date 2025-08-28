import { clsx } from 'clsx'

export function Button({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-medium shadow-sm',
        'bg-black text-white hover:bg-neutral-800 border-neutral-900',
        className,
      )}
      {...props}
    />
  )
}
