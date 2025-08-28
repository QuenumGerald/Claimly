import { clsx } from 'clsx'
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx('w-full min-h-[120px] rounded-md border px-3 py-2 text-sm', props.className)} />
}
