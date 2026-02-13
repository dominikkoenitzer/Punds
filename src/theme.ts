import { extendTheme } from '@chakra-ui/react';

const theme = extendTheme({
  fonts: {
    heading: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
  },
  styles: {
    global: {
      body: {
        bg: '#08080c',
        color: '#e4e4e7',
        minHeight: '100vh',
      },
    },
  },
  colors: {
    brand: {
      50: '#eef2ff',
      100: '#e0e7ff',
      200: '#c7d2fe',
      300: '#a5b4fc',
      400: '#818cf8',
      500: '#6366f1',
      600: '#4f46e5',
      700: '#4338ca',
      800: '#3730a3',
      900: '#312e81',
    },
    surface: {
      50: '#18181b',
      100: '#1e1e24',
      200: '#27272a',
      300: '#3f3f46',
      400: '#52525b',
      500: '#71717a',
    },
    accent: {
      cyan: '#22d3ee',
      emerald: '#34d399',
      violet: '#8b5cf6',
      amber: '#fbbf24',
      rose: '#fb7185',
    },
  },
  components: {
    Button: {
      baseStyle: {
        borderRadius: '8px',
        fontWeight: '500',
        transition: 'all 0.2s ease',
      },
    },
    Container: {
      baseStyle: {
        maxW: 'container.xl',
        px: { base: 4, md: 8 },
      },
    },
    Heading: {
      baseStyle: {
        fontWeight: '600',
        letterSpacing: '-0.02em',
      },
    },
  },
});

export default theme;