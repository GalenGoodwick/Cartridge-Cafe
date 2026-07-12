export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0c0a09] text-[#e7dcc8] font-mono flex items-center justify-center">
      <div className="text-center">
        <h1 className="font-serif text-4xl text-amber-50 mb-2">nothing on this shelf</h1>
        <a href="/" className="text-xs text-amber-300/60 hover:text-amber-200">← back to the cafe</a>
      </div>
    </div>
  )
}
