/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pp: {
          // Apple.com design language (awesome-design-md apple/DESIGN.md)
          bg: '#f5f5f7',          // canvas parchment
          panel: '#ffffff',       // utility card canvas
          line: '#e0e0e0',        // hairline
          ink: '#1d1d1f',         // ink
          mut: '#7a7a7a',         // ink muted 48%
          green: '#34c759',       // Apple green
          red: '#ff3b30',         // Apple red
          amber: '#ff9500',       // Apple orange
          blue: '#0066cc',        // Action Blue (primary)
          blueFocus: '#0071e3',
          blueDark: '#2997ff',
          violet: '#5e5ce6',      // iOS indigo (accents)
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'SF Pro Display', 'system-ui', 'Helvetica Neue', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        apple: '18px',
        card: '11px',
      },
    },
  },
  plugins: [],
};
