import { clsx } from 'clsx'

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx('rounded-lg border bg-white p-4 shadow-sm', className)}>{children}</div>
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold mb-2">{children}</div>
}
