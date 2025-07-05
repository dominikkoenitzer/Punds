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

const glitch = keyframes`
  0% {
    clip-path: polygon(0 2%, 100% 2%, 100% 5%, 0 5%);
    transform: translate(0);
  }
  20% {
    clip-path: polygon(0 15%, 100% 15%, 100% 15%, 0 15%);
    transform: translate(-5px);
  }
  30% {
    clip-path: polygon(0 10%, 100% 10%, 100% 20%, 0 20%);
    transform: translate(5px);
  }
  40% {
    clip-path: polygon(0 1%, 100% 1%, 100% 2%, 0 2%);
    transform: translate(-5px);
  }
  50% {
    clip-path: polygon(0 33%, 100% 33%, 100% 33%, 0 33%);
    transform: translate(0);
  }
  55% {
    clip-path: polygon(0 44%, 100% 44%, 100% 44%, 0 44%);
    transform: translate(5px);
  }
  60% {
    clip-path: polygon(0 50%, 100% 50%, 100% 20%, 0 20%);
    transform: translate(-5px);
  }
  100% {
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
    transform: translate(0);
  }
`

const neonPulse = keyframes`

`

const geistFont = `'Geist', 'Inter', 'sans-serif'`;

const Home = () => {
  const animation = `${fadeIn} 0.6s ease-out forwards`;
  const floatAnimation = `${float} 3s ease-in-out infinite`;
  const neonAnimation = `${neonPulse} 2s ease-in-out infinite`;

  // Add Geist font to body for this page only
  useEffect(() => {
    document.body.style.fontFamily = geistFont;
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
          background: rgba(58, 44, 77, 0.82);
          border-radius: 1.5rem;
          box-shadow: 0 8px 40px 0 #1a1423cc, 0 1.5px 0 #bfa7d7 inset;
          border: 1.5px solid #bfa7d733;
          backdrop-filter: blur(7px) brightness(1.08);
        }
      `}</style>
      <VStack spacing={10} align="center" w="100%" className="lain-glass" p={{ base: 4, md: 8 }}>
        {/* Profile Picture */}
        <Box
          position="relative"
          animation={floatAnimation}
          mb={2}
          borderRadius="xl"
          overflow="hidden"
          p={1.5}
          bg="#2d223a"
          /* border removed */
          boxShadow="0 0 32px #bfa7d7, 0 0 64px #1a1423"
          w="210px"
          h="210px"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Image
            borderRadius="xl"
            boxSize="192px"
            src="https://avatars.githubusercontent.com/u/82450286?v=4"
            alt="Dominik Könitzer"
            filter="grayscale(100%) brightness(1.1) contrast(1.1)"
            transition="all 0.3s"
            _hover={{
              filter: "grayscale(0%) brightness(1.2) contrast(1.2)",
            }}
          />
        </Box>
        {/* Name and Motto */}
        <VStack spacing={1} align="center" maxW="340px">
          <Heading
            as="h1"
            size="xl"
            color="#bfa7d7"
            letterSpacing="4px"
            fontWeight="extrabold"
            textTransform="uppercase"
            fontFamily={geistFont}
            style={{ fontFamily: geistFont }}
            textAlign="center"
          >
            Dominik Könitzer
          </Heading>
          <Text
            fontSize="lg"
            textAlign="center"
            fontWeight="medium"
            color="#bfa7d7"
            fontFamily={geistFont}
            style={{ fontFamily: geistFont }}
            opacity={0.95}
            letterSpacing="2px"
          >
            Nothing stays the same.
          </Text>
        </VStack>
        
        {/* Remove duplicate heading/text, keep only the Lain-inspired section above */}

        <HStack spacing={8} animation={animation} style={{ animationDelay: '0.3s' }} justify="center">
          <a href="https://github.com/dominikkoenitzer" target="_blank" rel="noopener noreferrer"
            style={{ color: '#bfa7d7', textDecoration: 'none', transition: 'color 0.2s' }}
            onMouseOver={e => e.currentTarget.style.color = '#6b5c7d'}
            onMouseOut={e => e.currentTarget.style.color = '#bfa7d7'}
          >
            <Icon 
              as={FaGithub} 
              w={8} 
              h={8} 
            color="inherit"
              transition="all 0.3s"
              _hover={{ 
                boxShadow: '0 0 32px #bfa7d7, 0 0 64px #1a1423',
              }} 
            />
          </a>
          <a href="https://www.linkedin.com/in/dominik-koenitzer/" target="_blank" rel="noopener noreferrer"
            style={{ color: '#bfa7d7', textDecoration: 'none', transition: 'color 0.2s' }}
            onMouseOver={e => e.currentTarget.style.color = '#6b5c7d'}
            onMouseOut={e => e.currentTarget.style.color = '#bfa7d7'}
          >
            <Icon 
              as={FaLinkedin} 
              w={8} 
              h={8} 
            color="inherit"
              transition="all 0.3s"
              _hover={{ 
                boxShadow: '0 0 32px #bfa7d7, 0 0 64px #1a1423',
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