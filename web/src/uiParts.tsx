// Shared tiny UI atoms (extracted from App.tsx for reuse)
export function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-pp-mut">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}

export function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-pp-line rounded-lg p-3">
      <div className="label mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
