import { BRAND } from '@/brand'

/** The Tactora mark, from the supplied logo file. `size` is its height in pixels. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return <img src="/tactora-mark-wide.png" alt={`${BRAND.name} logo`} height={size} width={Math.round(size * 1.37)} className="shrink-0 select-none" style={{ height: size, width: 'auto' }} draggable={false} />
}

export function Logo({ showName = true, size = 26 }: { showName?: boolean; size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      {showName ? <img src="/tactora-mark-wide.png" alt="" aria-hidden="true" className="shrink-0 select-none" style={{ height: size, width: 'auto' }} draggable={false} /> : <LogoMark size={size} />}
      {showName && <span className="hidden text-[1.15rem] font-bold leading-none tracking-tight min-[430px]:inline">{BRAND.name}</span>}
    </span>
  )
}
