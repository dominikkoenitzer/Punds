import {
  Box,
  Container,
  Heading,
  Text,
  VStack,
  Button,
  SimpleGrid,
  Icon,
  useClipboard,
} from '@chakra-ui/react'
import { FaBitcoin, FaEthereum, FaPaypal, FaHeart } from 'react-icons/fa'
import { Link as RouterLink } from 'react-router-dom'

interface SupportOptionProps {
  icon: any
  title: string
  description: string
  action: () => void
  buttonText: string
}

const SupportOption = ({ icon, title, description, action, buttonText }: SupportOptionProps) => (
  <Box
    bg="white"
    p={6}
    borderRadius="xl"
    boxShadow="md"
    textAlign="center"
    transition="transform 0.2s"
    _hover={{ transform: 'translateY(-4px)', boxShadow: 'lg' }}
  >
    <Icon as={icon} w={10} h={10} color="blue.500" mb={4} />
    <Heading size="md" mb={2}>{title}</Heading>
    <Text color="gray.600" mb={4}>{description}</Text>
    <Button onClick={action} colorScheme="blue">
      {buttonText}
    </Button>
  </Box>
)

const Support = () => {
  const btcAddress = 'your-btc-address'
  const ethAddress = 'your-eth-address'
  const { onCopy: copyBtc } = useClipboard(btcAddress)
  const { onCopy: copyEth } = useClipboard(ethAddress)

  const supportOptions = [
    {
      icon: FaBitcoin,
      title: 'Bitcoin',
      description: 'Support my work with Bitcoin cryptocurrency',
      action: copyBtc,
      buttonText: 'Copy BTC Address',
    },
    {
      icon: FaEthereum,
      title: 'Ethereum',
      description: 'Support my work with Ethereum cryptocurrency',
      action: copyEth,
      buttonText: 'Copy ETH Address',
    },
    {
      icon: FaPaypal,
      title: 'PayPal',
      description: 'Support my work via PayPal',
      action: () => window.open('your-paypal-link', '_blank'),
      buttonText: 'Donate with PayPal',
    },
    {
      icon: FaHeart,
      title: 'Buy Me a Coffee',
      description: 'Support my work by buying me a coffee',
      action: () => window.open('your-buymeacoffee-link', '_blank'),
      buttonText: 'Buy Me a Coffee',
    },
  ]

  return (
    <Container maxW="container.lg" py={10}>
      <VStack spacing={8} align="stretch">
        <Box textAlign="center" mb={8}>
          <Heading size="2xl" mb={4}>Support My Work</Heading>
          <Text fontSize="xl" color="gray.600">
            Choose your preferred way to support my projects and development work
          </Text>
        </Box>

        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={8}>
          {supportOptions.map((option) => (
            <SupportOption key={option.title} {...option} />
          ))}
        </SimpleGrid>

        <Box textAlign="center" mt={8}>
          <Button
            as={RouterLink}
            to="/"
            size="lg"
            colorScheme="blue"
            variant="outline"
          >
            Back to Home
          </Button>
        </Box>
      </VStack>
    </Container>
  )
}

export default Support 