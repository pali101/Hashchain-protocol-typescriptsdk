import { ethers, BigNumber } from "ethers";
import { decodeContractError, approveToken, getTokenAllowance } from "./utils";
import HashchainProtocolABI from "../abis/HashchainProtocol.abi.json";
import {
  CreateChannelParams,
  RedeemChannelParams,
  ReclaimChannelParams,
} from "./types/channel";

export class HashchainProtocol {
  private contract: ethers.Contract;
  private signer!: ethers.Signer;

  constructor(
    provider: ethers.providers.Provider,
    contractAddress: string,
    signer?: ethers.Signer
  ) {
    this.contract = new ethers.Contract(
      contractAddress,
      HashchainProtocolABI,
      provider
    );
    if (signer || (provider as ethers.providers.JsonRpcProvider).getSigner) {
      this.signer =
        signer || (provider as ethers.providers.JsonRpcProvider).getSigner();
      this.contract = this.contract.connect(this.signer);
    }
  }

  /**
   * Creates a new payment channel between a payer and a merchant.
   *
   * @param params - Parameters required to create a new channel
   * @param params.merchant - The merchant receiving payments.
   * @param params.tokenAddress - The ERC-20 token address used for payments, or `ethers.constants.AddressZero` to use the native currency (ETH).
   * @param params.trustAnchor - The final hash value of the hashchain.
   * @param params.amount - The total deposit amount for the channel.
   * @param params.numberOfTokens - The number of tokens in the hashchain.
   * @param params.merchantWithdrawAfterBlocks - Block number after which the merchant can withdraw. Default is 1000.
   * @param params.payerWithdrawAfterBlocks - Block number after which the payer can reclaim unused funds. Default is 2000.
   * @param params.overrides - Optional transaction overrides (e.g., gas, value).
   */
  async createChannel(
    params: CreateChannelParams
  ): Promise<ethers.providers.TransactionResponse> {
    const {
      merchant,
      tokenAddress,
      trustAnchor,
      amount,
      numberOfTokens,
      merchantWithdrawAfterBlocks = 1000,
      payerWithdrawAfterBlocks = 2000,
      overrides = {},
    } = params;

    if (!this.signer) throw new Error("Signer required to send transactions");

    // Handle native vs token logic here
    const isNative = tokenAddress === ethers.constants.AddressZero;

    // Check allowance if token is not native token
    if (!isNative) {
      const allowance = await this.checkAllowance(tokenAddress);

      // If allowance is less than the amount, throw an error
      if (allowance.lt(amount)) {
        throw new Error(
          "InsufficientAllowanceError: Please approve tokens first."
        );
      }
    }
    const txOverrides = isNative ? { ...overrides, value: amount } : overrides;

    try {
      return await this.contract.createChannel(
        merchant,
        tokenAddress,
        trustAnchor,
        amount,
        numberOfTokens,
        merchantWithdrawAfterBlocks,
        payerWithdrawAfterBlocks,
        txOverrides
      );
    } catch (error: any) {
      const decodedError = decodeContractError(error, HashchainProtocolABI);
      throw new Error(
        `Contract Error: ${decodedError?.errorName || "Unknown"} `
      );
    }
  }

  /**
   * Redeems a payment channel by verifying the final hash value.
   *
   * @param params - Parameters required to redeem the channel
   * @param params.payer - The address of the payer.
   * @param params.tokenAddress - The ERC-20 token address used for payments, or `ethers.constants.AddressZero` to use the native currency (ETH).
   * @param params.finalHashValue - The final hash value after consuming tokens.
   * @param params.numberOfTokensUsed - The number of tokens used during the transaction.
   */
  async redeemChannel(
    params: RedeemChannelParams
  ): Promise<ethers.providers.TransactionResponse> {
    try {
      const { payer, tokenAddress, finalHashValue, numberOfTokensUsed } =
        params;
      return await this.contract.redeemChannel(
        payer,
        tokenAddress,
        finalHashValue,
        numberOfTokensUsed
      );
    } catch (error: any) {
      const decodedError = decodeContractError(error, HashchainProtocolABI);
      throw new Error(
        `Contract Error: ${decodedError?.errorName || "Unknown"} `
      );
    }
  }

  /**
   * Allows the payer to reclaim their deposit after the withdrawal period expires.
   *
   * @param params - Parameters required to reclaim the channel funds
   * @param params.merchant - The address of the merchant.
   * @param params.tokenAddress - The ERC-20 token address used for payments, or `ethers.constants.AddressZero` to use the native currency (ETH).
   */
  async reclaimChannel(
    params: ReclaimChannelParams
  ): Promise<ethers.providers.TransactionResponse> {
    try {
      const { merchant, tokenAddress } = params;
      return await this.contract.reclaimChannel(merchant, tokenAddress);
    } catch (error: any) {
      const decodedError = decodeContractError(error, HashchainProtocolABI);
      throw new Error(
        `Contract Error: ${decodedError?.errorName || "Unknown"} `
      );
    }
  }

  /**
   * Approves the HashchainProtocol contract to spend a specified amount of ERC-20 tokens
   * on behalf of the connected signer.
   *
   * @param {string} tokenAddress - The ERC-20 token contract address.
   * @param {ethers.BigNumber} amount - The amount of tokens to approve.
   * @returns {Promise<ethers.providers.TransactionResponse>} - The transaction response after sending the approval.
   */
  async approve(tokenAddress: string, amount: BigNumber) {
    return await approveToken(
      this.signer,
      tokenAddress,
      this.contract.address,
      amount
    );
  }

  /**
   * Retrieves the current ERC-20 token allowance that the HashchainProtocol contract
   * has to spend on behalf of the connected signer.
   *
   * @param {string} tokenAddress - The ERC-20 token contract address.
   * @returns {Promise<ethers.BigNumber>} - The allowance amount as a BigNumber.
   */
  async checkAllowance(tokenAddress: string): Promise<BigNumber> {
    return await getTokenAllowance(
      this.signer,
      tokenAddress,
      this.contract.address
    );
  }

  /**
   * Verifies the integrity of a hashchain on-chain.
   *
   * @param trustAnchor - The initial hashchain value stored on-chain.
   * @param finalHashValue - The final hash value after off-chain usage.
   * @param numberOfTokensUsed - How many hash iterations were used.
   * @returns boolean indicating if the final hash resolves to the trust anchor.
   */
  async verifyHashchain(
    trustAnchor: string,
    finalHashValue: string,
    numberOfTokensUsed: number
  ): Promise<boolean> {
    return await this.contract.verifyHashchain(
      trustAnchor,
      finalHashValue,
      numberOfTokensUsed
    );
  }

  /**
   * Retrieves payment channel details from the contract.
   *
   * @param payer - The address of the payer who created the channel.
   * @param merchant - The address of the merchant receiving payments.
   * @param token - The ERC-20 token address used, or AddressZero for native ETH.
   * @returns Channel data stored on-chain.
   */
  async getChannel(payer: string, merchant: string, token: string) {
    return await this.contract.channelsMapping(payer, merchant, token);
  }
}
