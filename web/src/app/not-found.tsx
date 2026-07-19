export default function NotFound() {
  return (
    <div className="cafe-room text-steamer flex items-center justify-center">
      <div className="relative z-10 text-center px-6">
        <h1 className="cafe-sign text-5xl mb-3">nothing on this shelf</h1>
        <p className="font-mono text-[12px] tracking-[0.35em] text-grounds uppercase mb-8">
          the cartridge you wanted was never pressed — or someone took it home
        </p>
        <a href="/" className="brass-tab px-3 py-1.5 text-[12px]">← BACK TO THE ROOM</a>
      </div>
    </div>
  )
}
