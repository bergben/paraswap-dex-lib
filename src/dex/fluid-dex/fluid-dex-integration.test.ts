/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { FluidDex } from './fluid-dex';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import ResolverABI from '../../abi/fluid-dex/resolver.abi.json';

/*
  README
  ======

  This test script adds tests for FluidDex general integration
  with the DEX interface. The test cases below are example tests.
  It is recommended to add tests which cover FluidDex specific
  logic.

  You can run this individual test script by running:
  `npx jest src/dex/<dex-name>/<dex-name>-integration.test.ts`

  (This comment should be removed from the final implementation)
*/

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      '0x0b1a513ee24972daef112bc777a5610d4325c9e7',
      funcName == 'estimateSwapIn' ? true : false,
      amount,
      funcName == 'estimateSwapIn' ? 0 : 2n * amount,
    ]),
  }));
}

function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
) {
  return results.map(result => {
    return BigInt(result);
  });
}

async function checkOnChainPricing(
  fluidDex: FluidDex,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
) {
  const resolverAddress = '0xE8a07a32489BD9d5a00f01A55749Cf5cB854Fd13';

  const readerIface = new Interface(ResolverABI);

  const readerCallData = getReaderCalldata(
    resolverAddress,
    readerIface,
    amounts.slice(1),
    funcName,
  );
  const readerResult = (
    await fluidDex.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );
}

async function testPricingOnNetwork(
  fluidDex: FluidDex,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
  funcNameToCheck: string,
) {
  const networkTokens = Tokens[network];

  const pools = await fluidDex.getPoolIdentifiers(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    side,
    blockNumber,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: `,
    pools,
  );

  expect(pools.length).toBeGreaterThan(0);

  const poolPrices = await fluidDex.getPricesVolume(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    amounts,
    side,
    blockNumber,
    pools,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Prices: `,
    poolPrices,
  );
  console.log(
    'logged params : ',
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    amounts,
    side,
    blockNumber,
    pools,
  );
  expect(poolPrices).not.toBeNull();
  if (fluidDex.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    fluidDex,
    funcNameToCheck,
    blockNumber,
    poolPrices![0].prices,
    amounts,
  );
}

describe('FluidDex', function () {
  const dexKey = 'FluidDex';
  let blockNumber: number;
  let fluidDex: FluidDex;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    // Don't forget to update relevant tokens in constant-e2e.ts
    const srcTokenSymbol = 'wstETH';
    const destTokenSymbol = 'ETH';

    const amountsForSell = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals - 10],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals - 10],
      3n * BI_POWS[tokens[srcTokenSymbol].decimals - 10],
      4n * BI_POWS[tokens[srcTokenSymbol].decimals - 10],
      5n * BI_POWS[tokens[srcTokenSymbol].decimals - 10],
      6n * BI_POWS[tokens[srcTokenSymbol].decimals - 10],
      7n * BI_POWS[tokens[srcTokenSymbol].decimals - 10],
      8n * BI_POWS[tokens[srcTokenSymbol].decimals - 10],
      9n * BI_POWS[tokens[srcTokenSymbol].decimals - 10],
      10n * BI_POWS[tokens[srcTokenSymbol].decimals - 10],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.provider.getBlockNumber();
      fluidDex = new FluidDex(network, dexKey, dexHelper);
      if (fluidDex.initializePricing) {
        await fluidDex.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        fluidDex,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        'estimateSwapIn',
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newFluidDex = new FluidDex(network, dexKey, dexHelper);
      await newFluidDex.initializePricing(blockNumber);
      if (newFluidDex.updatePoolState) {
        await newFluidDex.updatePoolState();
      }
      const poolLiquidity = await newFluidDex.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        1,
      );

      if (!newFluidDex.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});
