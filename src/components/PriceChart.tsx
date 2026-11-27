import { useEffect, useMemo, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { clsx } from 'clsx'
import { TIMEFRAMES, priceDecimals, sma, type Candle, type Timeframe } from '@/trading/market'
import { useSettings } from '@/trading/settings'
import { Notice, Skeleton } from './ui'

function cssRgb(name: string, alpha = 1): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim().replace(/\s+/g, ' ')
  return `rgb(${v} / ${alpha})`
}

interface Props {
  candles: Candle[]
  loading: boolean
  error: string | null
  timeframe: Timeframe
  onTimeframe: (t: Timeframe) => void
  /** Footer text naming where the chart comes from. */
  sourceLabel: string | null
  live: boolean
  liveLabel?: string
  /** Last price, used to pick how many decimals the price axis shows. */
  lastPrice?: number | null
}

export function PriceChart({ candles, loading, error, timeframe, onTimeframe, sourceLabel, live, liveLabel = 'Live', lastPrice = null }: Props) {
  const { theme, accent, chartVolume: showVol, chartMa: showSma, chartType, set } = useSettings()
  const host = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const smaRef = useRef<ISeriesApi<'Line'> | null>(null)
  const closeRef = useRef<ISeriesApi<'Line'> | null>(null)
  const fitted = useRef('')

  useEffect(() => {
    if (!host.current) return
    const chart = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssRgb('muted'), fontFamily: 'DM Sans' },
      grid: { vertLines: { color: cssRgb('line', 0.5) }, horzLines: { color: cssRgb('line', 0.5) } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: cssRgb('line') },
      timeScale: { borderColor: cssRgb('line'), timeVisible: true, secondsVisible: false },
    })
    chartRef.current = chart
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: cssRgb('up'),
      downColor: cssRgb('down'),
      wickUpColor: cssRgb('up'),
      wickDownColor: cssRgb('down'),
      borderVisible: false,
    })
    volRef.current = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol' })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    closeRef.current = chart.addSeries(LineSeries, { color: cssRgb('fg'), lineWidth: 2, priceLineVisible: true, lastValueVisible: true, visible: false })
    smaRef.current = chart.addSeries(LineSeries, { color: cssRgb('warn'), lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    return () => {
      chart.remove()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { textColor: cssRgb('muted') },
      grid: { vertLines: { color: cssRgb('line', 0.5) }, horzLines: { color: cssRgb('line', 0.5) } },
      rightPriceScale: { borderColor: cssRgb('line') },
      timeScale: { borderColor: cssRgb('line') },
    })
    candleRef.current?.applyOptions({ upColor: cssRgb('up'), downColor: cssRgb('down'), wickUpColor: cssRgb('up'), wickDownColor: cssRgb('down') })
    smaRef.current?.applyOptions({ color: cssRgb('warn') })
    closeRef.current?.applyOptions({ color: cssRgb('fg') })
  }, [theme, accent])

  const sma20 = useMemo(() => sma(candles, 20), [candles])

  // Small prices (0.0001462) need more decimals than the library's default two.
  const decimals = priceDecimals(lastPrice ?? candles[candles.length - 1]?.close ?? null)
  useEffect(() => {
    const priceFormat = { type: 'price' as const, precision: decimals, minMove: 1 / 10 ** decimals }
    candleRef.current?.applyOptions({ priceFormat })
    closeRef.current?.applyOptions({ priceFormat })
    smaRef.current?.applyOptions({ priceFormat })
  }, [decimals])

  useEffect(() => {
    const t = (n: number) => n as UTCTimestamp
    candleRef.current?.setData(candles.map((c) => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close })))
    closeRef.current?.setData(candles.map((c) => ({ time: t(c.time), value: c.close })))
    candleRef.current?.applyOptions({ visible: chartType === 'candles' })
    closeRef.current?.applyOptions({ visible: chartType === 'line' })
    volRef.current?.setData(
      showVol ? candles.map((c) => ({ time: t(c.time), value: c.volume, color: c.close >= c.open ? cssRgb('up', 0.35) : cssRgb('down', 0.35) })) : [],
    )
    smaRef.current?.setData(showSma ? sma20.map((p) => ({ time: t(p.time), value: p.value })) : [])
    const key = `${timeframe}:${candles[0]?.time ?? 0}`
    if (candles.length && fitted.current !== key) {
      chartRef.current?.timeScale().fitContent()
      fitted.current = key
    }
  }, [candles, showVol, showSma, sma20, timeframe, chartType])

  const toggles: [string, boolean, (v: boolean) => void][] = [
    ['Vol', showVol, (v) => set('chartVolume', v)],
    ['MA 20', showSma, (v) => set('chartMa', v)],
  ]

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="flex gap-0.5" role="tablist" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === timeframe}
              onClick={() => onTimeframe(t.id)}
              className={clsx('num min-h-[30px] rounded-md px-2.5 text-xs transition', t.id === timeframe ? 'bg-raised text-ink' : 'text-mute hover:text-ink')}
            >
              {t.id}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs">
          {toggles.map(([label, on, set]) => (
            <button
              key={label}
              onClick={() => set(!on)}
              aria-pressed={on}
              className={clsx('min-h-[36px] border border-line px-3 font-bold', on ? 'bg-accent text-accent-ink' : 'bg-panel hover:bg-raised')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-[300px] sm:h-[400px] lg:h-[440px]">
        <div ref={host} className="absolute inset-0" />
        {loading && candles.length === 0 && <Skeleton className="absolute inset-3" />}
        {error && (
          <div className="absolute inset-x-3 top-3">
            <Notice tone="error" title="Market data unavailable">
              {error}.
            </Notice>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[11px] text-mute">
        <span>{sourceLabel ?? 'No market data for this asset.'}</span>
        <span className={clsx('flex items-center gap-1', live && 'text-up')}>
          <span className={clsx('h-2 w-2', live ? 'bg-up' : 'bg-mute')} aria-hidden="true" />
          {live ? liveLabel : 'Not updating'}
        </span>
      </div>
    </div>
  )
}
