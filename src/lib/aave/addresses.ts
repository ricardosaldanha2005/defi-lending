import { AaveV3Arbitrum, AaveV3Polygon } from "@bgd-labs/aave-address-book";

export type AaveChain = "polygon" | "arbitrum";

export const AAVE_CONFIG = {
  polygon: {
    poolAddressesProvider: AaveV3Polygon.POOL_ADDRESSES_PROVIDER,
    uiPoolDataProvider: AaveV3Polygon.UI_POOL_DATA_PROVIDER,
    priceOracle: AaveV3Polygon.ORACLE,
    protocolDataProvider: AaveV3Polygon.AAVE_PROTOCOL_DATA_PROVIDER,
  },
  arbitrum: {
    poolAddressesProvider: AaveV3Arbitrum.POOL_ADDRESSES_PROVIDER,
    uiPoolDataProvider: AaveV3Arbitrum.UI_POOL_DATA_PROVIDER,
    priceOracle: AaveV3Arbitrum.ORACLE,
    protocolDataProvider: AaveV3Arbitrum.AAVE_PROTOCOL_DATA_PROVIDER,
  },
} as const;

export const DEFAULT_AAVE_CHAIN: AaveChain = "polygon";
