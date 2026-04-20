import { createPublicClient, http, formatUnits, getAddress, isAddress } from 'viem';
import { base } from 'viem/chains';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ERC20_ABI = [
  { inputs: [{ name: 'owner', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' }
];

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org')
});

async function readUSDCBalance(address) {
  if (!address || !isAddress(address)) return '0.00';
  const checksummed = getAddress(address);
  const raw = await publicClient.readContract({
    address: USDC_BASE,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [checksummed]
  });
  return formatUnits(raw, 6);
}

async function readETHBalance(address) {
  if (!address || !isAddress(address)) return '0.0000';
  const raw = await publicClient.getBalance({ address: getAddress(address) });
  return parseFloat(formatUnits(raw, 18)).toFixed(4);
}

async function readERC20(token, address) {
  if (!address || !isAddress(address)) return '0';
  const [bal, dec] = await Promise.all([
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [getAddress(address)] }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' })
  ]);
  return formatUnits(bal, dec);
}

const TokenomicViem = {
  client: publicClient,
  chain: base,
  USDC_BASE,
  readUSDCBalance,
  readETHBalance,
  readERC20,
  isAddress,
  getAddress,
  formatUnits
};

if (typeof window !== 'undefined') {
  window.TokenomicViem = TokenomicViem;
  window.dispatchEvent(new CustomEvent('tkn:viem-ready', { detail: TokenomicViem }));
}

export default TokenomicViem;
export { publicClient, base, readUSDCBalance, readETHBalance, readERC20 };
