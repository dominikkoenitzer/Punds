import {
  Box,
  VStack,
  Heading,
  Text,
  Button,
  Image,
  Container,
  Icon,
  HStack,
  keyframes,
} from '@chakra-ui/react'
import { useEffect } from 'react'
import { FaGithub, FaLinkedin } from 'react-icons/fa'

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
`

const float = keyframes`
  0% { transform: translateY(0px) rotate(0deg); }
  50% { transform: translateY(-10px) rotate(2deg); }
  100% { transform: translateY(0px) rotate(0deg); }
`





const geistFont = `'Geist', 'Inter', 'sans-serif'`;
// Use only Love Letter TW as requested
const lainFont = `'Love Letter TW', 'monospace'`;

const Home = () => {

  const animation = `${fadeIn} 0.6s ease-out forwards`;
  const floatAnimation = `${float} 3s ease-in-out infinite`;

  // Add Geist font to body for this page only
  useEffect(() => {
    document.body.style.fontFamily = `${lainFont}, ${geistFont}`;
    document.body.style.background =
      'radial-gradient(ellipse at 60% 40%, #3a2c4d 60%, #1a1423 100%)';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.style.minHeight = '100vh';
    document.body.style.transition = 'background 1s';
    return () => {
      document.body.style.background = '';
      document.body.style.backgroundSize = '';
      document.body.style.backgroundRepeat = '';
      document.body.style.minHeight = '';
      document.body.style.transition = '';
      document.body.style.fontFamily = '';
    };
  }, []);

  return (
    <Container maxW="container.sm" py={16} position="relative" zIndex={1}>
      {/* Import only the exact fonts requested by the user */}
      <link href="https://fonts.cdnfonts.com/css/love-letter-tw" rel="stylesheet" />
      {/* Lain/techno-dystopian overlays */}
      <style>{`
        body::before {
          content: '';
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          pointer-events: none;
          z-index: 0;
          background: repeating-linear-gradient(
            to bottom,
            rgba(255,255,255,0.03) 0px,
            rgba(255,255,255,0.03) 1px,
            transparent 1px,
            transparent 4px
          );
        }
        @keyframes glitch {
          0% { text-shadow: 2px 0 #bfa7d7, -2px 0 #6b5c7d; }
          20% { text-shadow: -2px 0 #bfa7d7, 2px 0 #6b5c7d; }
          40% { text-shadow: 2px 2px #bfa7d7, -2px -2px #6b5c7d; }
          60% { text-shadow: -2px 2px #bfa7d7, 2px -2px #6b5c7d; }
          80% { text-shadow: 2px 0 #bfa7d7, -2px 0 #6b5c7d; }
          100% { text-shadow: none; }
        }
        .lain-glitch {
          animation: glitch 1.2s infinite linear alternate-reverse;
        }
        .lain-glass {
          /* Glass effect removed */
          background: none;
          border-radius: 1.5rem;
          box-shadow: none;
          border: none;
          backdrop-filter: none;
        }
        .lain-scanline {
          position: relative;
          z-index: 1;
          /* Simulated scanline effect */
          background: repeating-linear-gradient(
            to bottom,
            rgba(191,167,215,0.12) 0px,
            rgba(191,167,215,0.12) 1.5px,
            transparent 1.5px,
            transparent 4px
          );
          /* Optional: subtle text shadow for glow */
          text-shadow: 0 1px 0 #6b5c7d, 0 0 8px #bfa7d7;
          /* Optional: roughen font rendering for more typewriter look */
          font-variant-ligatures: none;
          font-smooth: never;
          -webkit-font-smoothing: none;
          -moz-osx-font-smoothing: grayscale;
        }
      `}</style>
      <VStack spacing={10} align="center" w="100%" className="lain-glass" p={{ base: 4, md: 8 }}>
        {/* Profile Picture */}
        <Box
          position="relative"
          animation={floatAnimation}
          mb={2}
          borderRadius="full"
          overflow="hidden"
          p={2.5}
          bgGradient="linear(135deg, #bfa7d7 0%, #6b5c7d 100%)"
          boxShadow="0 0 48px #bfa7d7, 0 0 96px #1a1423"
          w="270px"
          h="270px"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Image
            borderRadius="full"
            boxSize="250px"
            src="https://avatars.githubusercontent.com/u/82450286?v=4"
            alt="Dominik Könitzer"
            filter="grayscale(80%) brightness(1.12) contrast(1.13) drop-shadow(0 0 24px #bfa7d7)"
            transition="all 0.3s"
            _hover={{
              filter: "grayscale(0%) brightness(1.2) contrast(1.2) drop-shadow(0 0 32px #bfa7d7)",
              transform: 'scale(1.04)',
            }}
          />
        </Box>
        {/* Name and Motto */}
        <Heading
          as="h1"
          fontSize={{ base: '3xl', md: '5xl' }}
          color="#bfa7d7"
          letterSpacing="6px"
          fontWeight={500}
          fontStyle="italic"
          textTransform="uppercase"
          fontFamily={geistFont}
          style={{ fontFamily: geistFont, fontWeight: 500, fontStyle: 'italic' }}
          textAlign="center"
          lineHeight={1.1}
        >
          Dominik Könitzer
        </Heading>
        <Text
          fontSize={{ base: 'xl', md: '2xl' }}
          textAlign="center"
          fontWeight="semibold"
          color="#bfa7d7"
          fontFamily="'Special Elite', monospace"
          opacity={0.98}
          letterSpacing="3px"
          mt={2}
          style={{
            fontFamily: 'Special Elite, monospace',
            opacity: 0.98,
            letterSpacing: '3px',
            marginTop: 2,
            textShadow: '0 1px 0 #6b5c7d, 0 0 8px #bfa7d7',
            fontVariantLigatures: 'none',
            WebkitFontSmoothing: 'none',
            MozOsxFontSmoothing: 'grayscale',
            background: 'none',
          }}
        >
          Nothing stays the same.
        </Text>
        
        {/* Remove duplicate heading/text, keep only the Lain-inspired section above */}

        <HStack spacing={8} animation={animation} style={{ animationDelay: '0.3s' }} justify="center">
          <a
            href="https://github.com/dominikkoenitzer"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#bfa7d7', textDecoration: 'none', transition: 'color 0.2s' }}
            onMouseOver={e => e.currentTarget.style.color = '#6b5c7d'}
            onMouseOut={e => e.currentTarget.style.color = '#bfa7d7'}
          >
            <Icon
              as={FaGithub}
              w={12}
              h={12}
              color="inherit"
              transition="all 0.3s"
              _hover={{
                boxShadow: '0 0 24px #bfa7d7',
              }}
            />
          </a>
          <a
            href="https://www.linkedin.com/in/dominik-koenitzer/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#bfa7d7', textDecoration: 'none', transition: 'color 0.2s' }}
            onMouseOver={e => e.currentTarget.style.color = '#6b5c7d'}
            onMouseOut={e => e.currentTarget.style.color = '#bfa7d7'}
          >
            <Icon
              as={FaLinkedin}
              w={12}
              h={12}
              color="inherit"
              transition="all 0.3s"
              _hover={{
                boxShadow: '0 0 24px #bfa7d7',
              }}
            />
          </a>
        </HStack>

        <VStack spacing={4} w="100%" animation={animation} style={{ animationDelay: '0.4s' }}>
          <Button
            as="a"
            href="https://www.paypal.com/paypalme/dominikkoenitzer"
            target="_blank"
            rel="noopener noreferrer"
            size="lg"
            w="100%"
            variant="outline"
            color="#bfa7d7"
            borderColor="#bfa7d7"
            borderWidth={2}
            borderRadius="lg"
            textShadow="0 0 10px #bfa7d7"
            boxShadow="0 0 10px #bfa7d744"
            fontFamily={geistFont}
            style={{ fontFamily: geistFont, fontWeight: 700, letterSpacing: 2 }}
            _hover={{
              bg: '#6b5c7d',
              color: '#fff',
              borderColor: '#6b5c7d',
              boxShadow: '0 0 24px #bfa7d7',
              transform: 'translateY(-3px)',
            }}
          >
            Support My Work
          </Button>
          <Button
            as="a"
            href="https://dominikkoenitzer.ch"
            target="_blank"
            rel="noopener noreferrer"
            size="lg"
            w="100%"
            variant="outline"
            color="#bfa7d7"
            borderColor="#bfa7d7"
            borderWidth={2}
            borderRadius="lg"
            textShadow="0 0 10px #bfa7d7"
            boxShadow="0 0 10px #bfa7d744"
            fontFamily={geistFont}
            style={{ fontFamily: geistFont, fontWeight: 700, letterSpacing: 2 }}
            _hover={{
            bg: '#6b5c7d',
            color: '#fff',
            borderColor: '#6b5c7d',
            boxShadow: '0 0 24px #bfa7d7',
              transform: 'translateY(-3px)',
            }}
          >
            Visit My Website
          </Button>
        </VStack>
      </VStack>
    </Container>
  )
}

export default Home