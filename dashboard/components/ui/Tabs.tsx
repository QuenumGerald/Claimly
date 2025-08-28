export function Tabs({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2 border-b mb-4">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`px-3 py-2 text-sm border-b-2 ${value === t ? 'border-black font-medium' : 'border-transparent text-neutral-500'}`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}
