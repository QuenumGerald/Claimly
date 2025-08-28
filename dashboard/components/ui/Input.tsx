import { clsx } from 'clsx'
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('w-full rounded-md border px-3 py-2 text-sm', props.className)} />
}
