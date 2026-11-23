/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        navy: { 950: '#070709', 900: '#070709', 800: '#111216', 700: '#191B22', 600: '#272A35' },
        volt: '#C8FF00',
        coral: '#FF4D2D',
      },
    },
  },
  plugins: [],
};
