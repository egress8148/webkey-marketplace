import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import {
  injectedWallet,
  metaMaskWallet,
  tokenPocketWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { createConfig, http } from 'wagmi'
import { bsc } from 'wagmi/chains'

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

if (!projectId) {
  throw new Error('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID가 없습니다.')
}

const connectors = connectorsForWallets(
  [
    {
      groupName: '추천 지갑',
      wallets: [
        tokenPocketWallet,
        walletConnectWallet,
        injectedWallet,
        metaMaskWallet,
      ],
    },
  ],
  {
    appName: 'WebKey DAO2 Marketplace',
    projectId,
  }
)

export const config = createConfig({
  chains: [bsc],
  connectors,
  transports: {
    [bsc.id]: http(),
  },
  ssr: true,
})

