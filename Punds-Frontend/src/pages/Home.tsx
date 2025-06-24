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
import { FaGithub, FaLinkedin } from 'react-icons/fa'
import { Link as RouterLink } from 'react-router-dom'

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
  0% { box-shadow: 0 0 10px #00f3ff, 0 0 20px #00f3ff, 0 0 30px #00f3ff; }
  50% { box-shadow: 0 0 20px #00f3ff, 0 0 40px #00f3ff, 0 0 60px #00f3ff; }
  100% { box-shadow: 0 0 10px #00f3ff, 0 0 20px #00f3ff, 0 0 30px #00f3ff; }
`

const Home = () => {
  const animation = `${fadeIn} 0.6s ease-out forwards`
  const floatAnimation = `${float} 3s ease-in-out infinite`
  const neonAnimation = `${neonPulse} 2s ease-in-out infinite`

  return (
    <Container maxW="container.sm" py={16}>
      <VStack spacing={10} align="center">
        <Box
          position="relative"
          animation={floatAnimation}
          _before={{
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            animation: `${glitch} 2s infinite`,
            bg: 'rgba(33, 150, 243, 0.2)',
            zIndex: -1,
          }}
        >
          <Box
            position="relative"
            borderRadius="0"
            p={1}
            bg="transparent"
            border="2px solid"
            borderColor="neon.blue"
            animation={neonAnimation}
          >
            <Image
              borderRadius="0"
              boxSize="200px"
              src="https://raw.githubusercontent.com/dominikkoenitzer/Portfolio/refs/heads/main/images/Favicon.png"
              alt="Dominik Könitzer"
              filter="grayscale(100%) brightness(1.2) contrast(1.2)"
              transition="all 0.3s"
              _hover={{
                filter: "grayscale(0%) brightness(1.2) contrast(1.2)",
              }}
            />
          </Box>
        </Box>
        
        <VStack spacing={4} animation={animation} style={{ animationDelay: '0.2s' }}>
          <Heading 
            as="h1" 
            size="xl" 
            color="neon.blue"
            textShadow="0 0 10px #00f3ff, 0 0 20px #00f3ff, 0 0 30px #00f3ff"
            letterSpacing="4px"
            fontWeight="bold"
            textTransform="uppercase"
          >
            Dominik Könitzer
          </Heading>
          <Text 
            fontSize="xl" 
            textAlign="center" 
            fontWeight="medium"
            color="neon.purple"
            textShadow="0 0 10px #bf00ff, 0 0 20px #bf00ff"
            letterSpacing="3px"
            textTransform="uppercase"
          >
            Fullstack Software Engineer
          </Text>
        </VStack>

        <HStack spacing={8} animation={animation} style={{ animationDelay: '0.3s' }}>
          <a href="https://github.com/dominikkoenitzer" target="_blank" rel="noopener noreferrer">
            <Icon 
              as={FaGithub} 
              w={8} 
              h={8} 
              color="neon.blue"
              transition="all 0.3s"
              _hover={{ 
                color: 'neon.purple',
                transform: 'translateY(-2px) scale(1.1)',
                filter: 'drop-shadow(0 0 10px #bf00ff)',
              }} 
            />
          </a>
          <a href="https://www.linkedin.com/in/dominik-koenitzer/" target="_blank" rel="noopener noreferrer">
            <Icon 
              as={FaLinkedin} 
              w={8} 
              h={8} 
              color="neon.blue"
              transition="all 0.3s"
              _hover={{ 
                color: 'neon.purple',
                transform: 'translateY(-2px) scale(1.1)',
                filter: 'drop-shadow(0 0 10px #bf00ff)',
              }} 
            />
          </a>
        </HStack>

        <VStack spacing={6} w="100%" animation={animation} style={{ animationDelay: '0.4s' }}>
          <Button
            as={RouterLink}
            to="/portfolio"
            size="lg"
            w="100%"
            variant="outline"
            color="neon.green"
            borderColor="neon.green"
            textShadow="0 0 10px #00ff9f"
            boxShadow="0 0 10px rgba(0, 255, 159, 0.2)"
            _hover={{
              bg: 'rgba(0, 255, 159, 0.1)',
              boxShadow: '0 0 20px rgba(0, 255, 159, 0.4)',
              transform: 'translateY(-3px)',
            }}
          >
            My Portfolio
          </Button>

          <Button
            as="a"
            href="https://www.paypal.com/paypalme/dominikkoenitzer"
            target="_blank"
            rel="noopener noreferrer"
            size="lg"
            w="100%"
            variant="solid"
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
            color="neon.pink"
            borderColor="neon.pink"
            textShadow="0 0 10px #ff00ff"
            boxShadow="0 0 10px rgba(255, 0, 255, 0.2)"
            _hover={{
              bg: 'rgba(255, 0, 255, 0.1)',
              boxShadow: '0 0 20px rgba(255, 0, 255, 0.4)',
              transform: 'translateY(-3px)',
            }}
          >
            Visit My Website
          </Button>
        </VStack>

        <Text 
          fontSize="sm" 
          mt={8}
          animation={animation} 
          style={{ animationDelay: '0.5s' }}
          textAlign="center"
          fontWeight="medium"
          letterSpacing="2px"
          color="whiteAlpha.700"
          textShadow="0 0 5px rgba(255, 255, 255, 0.5)"
        >
          © 2025 Dominik Könitzer. All rights reserved.
        </Text>
      </VStack>
    </Container>
  )
}

export default Home 
