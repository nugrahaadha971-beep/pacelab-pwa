/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Plus Jakarta Sans"', '"Space Grotesk"', 'sans-serif'],
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        navy: {
          950: '#09090B',
          900: '#09090B',
          800: '#121215',
          700: '#18181D',
          600: '#27272E',
        },
        volt: '#BEF264',
        coral: '#FF4D2D',
      },
    },
  },
  plugins: [],
};
