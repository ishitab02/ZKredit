/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        veryLow: '#22c55e',
        low: '#84cc16',
        medium: '#eab308',
        high: '#f97316',
        veryHigh: '#ef4444',
      },
    },
  },
  plugins: [],
}
