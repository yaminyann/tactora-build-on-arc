const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    // Small, consistent radii. Controls 8px, cards 12px, the few featured surfaces 16px. Only `full` is a pill.
    borderRadius: { none: '0', sm: '6px', DEFAULT: '8px', md: '8px', lg: '12px', xl: '16px', '2xl': '20px', '3xl': '24px', full: '9999px' },
    // Every border is a thin 1px line unless a class says otherwise.
    borderWidth: { DEFAULT: '1px', 0: '0', 1: '1px', 2: '2px', 3: '3px', 4: '4px', 8: '8px' },
    extend: {
      colors: {
        canvas: token('bg'),
        panel: token('panel'),
        raised: token('panel2'),
        line: token('line'),
        control: token('control'),
        ink: token('fg'),
        mute: token('muted'),
        accent: token('accent'),
        'accent-ink': token('accent-fg'),
        brand: token('brand'),
        up: token('up'),
        down: token('down'),
        warn: token('warn'),
      },
      boxShadow: {
        // The old names are kept so every component follows: a soft lift now, not a hard offset.
        'hard-sm': '0 1px 2px rgb(var(--shadow) / 0.28)',
        hard: '0 8px 24px -10px rgb(var(--shadow) / 0.45)',
        'hard-lg': '0 24px 56px -20px rgb(var(--shadow) / 0.6)',
      },
      fontFamily: {
        display: ['Archivo', 'system-ui', 'sans-serif'],
        sans: ['Archivo', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
