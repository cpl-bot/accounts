import type { AgingBucket } from '@/lib/mock-data'

// Fixed data-viz palette for the 5 aging buckets.
export const bucketColors = [
  'var(--chart-1)', // Current  — navy
  'oklch(0.82 0.15 90)', // 1-30   — yellow
  'oklch(0.7 0.17 55)', // 31-60  — orange
  'oklch(0.62 0.2 30)', // 61-90  — deep orange
  'var(--chart-4)', // 90+     — red
]

export function AgingBar({ buckets }: { buckets: AgingBucket[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-6 w-full overflow-hidden rounded-md">
        {buckets.map((b, i) => (
          <div
            key={b.bucket}
            className="flex items-center justify-center text-[11px] font-semibold text-white"
            style={{ width: `${Math.max(b.pct, 1.5)}%`, backgroundColor: bucketColors[i] }}
            title={`${b.bucket}: ${b.pct}%`}
          >
            {b.pct >= 10 ? `${b.pct}%` : ''}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {buckets.map((b, i) => (
          <div key={b.bucket} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-[3px]"
              style={{ backgroundColor: bucketColors[i] }}
              aria-hidden="true"
            />
            <span className="text-xs text-muted-foreground">{b.bucket}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
