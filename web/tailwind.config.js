/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pp: {
          bg: 'var(--pp-bg)', panel: 'var(--pp-panel)', line: 'var(--pp-line)',
          ink: 'var(--pp-ink)', mut: 'var(--pp-mut)',
          green: 'var(--pp-green)', red: 'var(--pp-red)', amber: 'var(--pp-amber)',
          blue: 'var(--pp-blue)', blueFocus: 'var(--pp-blueFocus)', blueDark: 'var(--pp-blueDark)',
          violet: 'var(--pp-violet)',
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
