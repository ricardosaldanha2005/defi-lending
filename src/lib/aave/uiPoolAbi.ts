import { IUiPoolDataProvider_ABI } from "@bgd-labs/aave-address-book/abis";

type AbiParam = {
  type: string;
  name?: string;
  internalType?: string;
  components?: AbiParam[];
};

type AbiItem = {
  type: string;
  name?: string;
  inputs?: AbiParam[];
  outputs?: AbiParam[];
  stateMutability?: string;
};

function transformParam(param: AbiParam): AbiParam {
  const next: AbiParam = { ...param };
  if (next.components) {
    next.components = next.components.map(transformParam);
  }
  if (next.type === "bool") {
    next.type = "uint256";
    next.internalType = "uint256";
    return next;
  }
  const uintMatch = next.type.match(/^uint(\d+)?$/);
  if (uintMatch) {
    next.type = "uint256";
    next.internalType = "uint256";
    return next;
  }
  const intMatch = next.type.match(/^int(\d+)?$/);
  if (intMatch) {
    next.type = "int256";
    next.internalType = "int256";
    return next;
  }
  return next;
}

function transformItem(item: AbiItem): AbiItem {
  return {
    ...item,
    inputs: item.inputs?.map(transformParam),
    outputs: item.outputs?.map(transformParam),
  };
}

const baseAbi = IUiPoolDataProvider_ABI as unknown as AbiItem[];

export const UI_POOL_DATA_PROVIDER_ABI = baseAbi.map(transformItem);
