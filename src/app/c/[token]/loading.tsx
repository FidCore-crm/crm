export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header skeleton */}
      <div className="bg-[#0A1628] h-20" />

      <div className="max-w-2xl mx-auto px-4 -mt-6 flex flex-col gap-4">
        {/* Welcome skeleton */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 animate-pulse">
          <div className="h-4 w-2/3 bg-slate-200 rounded" />
          <div className="h-3 w-1/3 bg-slate-100 rounded mt-2" />
        </div>

        {/* Section skeletons */}
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
              <div className="h-3 w-40 bg-slate-200 rounded animate-pulse" />
            </div>
            <div className="p-5 flex flex-col gap-3">
              <div className="h-20 bg-slate-100 rounded animate-pulse" />
              <div className="h-20 bg-slate-100 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
