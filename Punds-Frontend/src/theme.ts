import { extendTheme } from '@chakra-ui/react';

const theme = extendTheme({
  styles: {
    global: {
      body: {
        bg: 'black',
        color: 'whiteAlpha.900',
        backgroundAttachment: 'fixed',
        backgroundSize: 'cover',
        minHeight: '100vh',
        overflow: 'overlay',
        
        '&::before': {
          content: '""',
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'linear-gradient(0deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.7) 100%)',
          pointerEvents: 'none',
          zIndex: 0,
          backdropFilter: 'blur(4px)',
        },
        '&::after': {
          content: '""',
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '200%',
          background: 'repeating-linear-gradient(transparent 0%, rgba(255,255,255,0.1) 0.5%, transparent 1%)',
          animation: 'rain 15s linear infinite',
          pointerEvents: 'none',
          zIndex: 1,
        },
      },
      '@keyframes rain': {
        '0%': { transform: 'translateY(-50%)' },
        '100%': { transform: 'translateY(0%)' },
      },
      '@keyframes neonPulse': {
        '0%': { opacity: 0.8, textShadow: '0 0 7px #fff, 0 0 10px #fff, 0 0 21px #fff, 0 0 42px #0fa, 0 0 82px #0fa, 0 0 92px #0fa, 0 0 102px #0fa, 0 0 151px #0fa' },
        '50%': { opacity: 1, textShadow: '0 0 7px #fff, 0 0 10px #fff, 0 0 21px #fff, 0 0 42px #0fa, 0 0 82px #0fa, 0 0 102px #0fa, 0 0 151px #0fa, 0 0 201px #0fa' },
        '100%': { opacity: 0.8, textShadow: '0 0 7px #fff, 0 0 10px #fff, 0 0 21px #fff, 0 0 42px #0fa, 0 0 82px #0fa, 0 0 92px #0fa, 0 0 102px #0fa, 0 0 151px #0fa' },
      },
    },
  },
  colors: {
    neon: {
      blue: '#00f3ff',
      purple: '#bf00ff',
      pink: '#ff00ff',
      green: '#00ff9f',
    },
    brand: {
      50: '#e0f7fa',
      100: '#b2ebf2',
      200: '#80deea',
      300: '#4dd0e1',
      400: '#26c6da',
      500: '#00bcd4',
      600: '#00acc1',
      700: '#0097a7',
      800: '#00838f',
      900: '#006064',
    },
    accent: {
      50: '#f3e5f5',
      100: '#e1bee7',
      200: '#ce93d8',
      300: '#ba68c8',
      400: '#ab47bc',
      500: '#9c27b0',
      600: '#8e24aa',
      700: '#7b1fa2',
      800: '#6a1b9a',
      900: '#4a148c',
    },
  },
  
  components: {
    Button: {
      baseStyle: {
        borderRadius: '0',
        fontWeight: '600',
        letterSpacing: '2px',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        position: 'relative',
        overflow: 'hidden',
        textTransform: 'uppercase',
        fontSize: 'sm',
        
        _before: {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'linear-gradient(120deg, transparent, rgba(255,255,255,0.3), transparent)',
          transform: 'translateX(-100%)',
        },
        _hover: {
          _before: {
            transform: 'translateX(100%)',
            transition: 'transform 0.75s cubic-bezier(0.4, 0, 0.2, 1)',
          },
        },
      },
      variants: {
        solid: {
          bg: 'transparent',
          color: 'neon.blue',
          border: '1px solid',
          borderColor: 'neon.blue',
          textShadow: '0 0 10px rgba(0, 243, 255, 0.5)',
          boxShadow: '0 0 10px rgba(0, 243, 255, 0.2), inset 0 0 10px rgba(0, 243, 255, 0.2)',
          _hover: {
            bg: 'rgba(0, 243, 255, 0.1)',
            transform: 'translateY(-3px)',
            boxShadow: '0 0 20px rgba(0, 243, 255, 0.4), inset 0 0 20px rgba(0, 243, 255, 0.4)',
            textShadow: '0 0 20px rgba(0, 243, 255, 0.8)',
          },
        },
        outline: {
          bg: 'transparent',
          color: 'neon.purple',
          border: '1px solid',
          borderColor: 'neon.purple',
          textShadow: '0 0 10px rgba(191, 0, 255, 0.5)',
          boxShadow: '0 0 10px rgba(191, 0, 255, 0.2), inset 0 0 10px rgba(191, 0, 255, 0.2)',
          _hover: {
            bg: 'rgba(191, 0, 255, 0.1)',
            transform: 'translateY(-3px)',
            boxShadow: '0 0 20px rgba(191, 0, 255, 0.4), inset 0 0 20px rgba(191, 0, 255, 0.4)',
            textShadow: '0 0 20px rgba(191, 0, 255, 0.8)',
          },
        },
      },
    },
    Container: {
      baseStyle: {
        maxW: 'container.xl',
        px: { base: 4, md: 8 },
        position: 'relative',
        zIndex: 1,
      },
    },
    Heading: {
      baseStyle: {
        
        letterSpacing: '2px',
        textShadow: '0 0 10px rgba(255, 255, 255, 0.5)',
      },
    },
    Text: {
      baseStyle: {
        letterSpacing: '1px',
      },
    },
  },
});

export default theme; 