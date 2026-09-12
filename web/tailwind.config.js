/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pp: {
          bg: '#0a0e14',
          panel: '#101722',
          line: '#1e2a3a',
          ink: '#e8eef6',
          mut: '#8296ad',
          green: '#2ee6a8',
          red: '#ff5d73',
          amber: '#ffc247',
          blue: '#5da8ff',
          violet: '#8b7bff',
        },
      },
      fontFamily: { mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
    },
  },
  plugins: [],
};