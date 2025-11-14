pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FheAMM_Zama is ZamaEthereumConfig {
    struct Pool {
        euint32 encryptedK; // Encrypted constant product formula constant
        euint32 encryptedBalanceA; // Encrypted balance of token A
        euint32 encryptedBalanceB; // Encrypted balance of token B
        uint256 publicBalanceA; // Public balance for verification
        uint256 publicBalanceB; // Public balance for verification
        address creator; // Address that created the pool
        uint256 creationTimestamp; // When the pool was created
        bool isVerified; // Whether the pool has been verified
    }

    mapping(string => Pool) public pools;
    string[] public poolIds;

    event PoolCreated(string indexed poolId, address indexed creator);
    event SwapExecuted(string indexed poolId, address indexed swapper);
    event PoolVerified(string indexed poolId);

    constructor() ZamaEthereumConfig() {
        // Contract initializer
    }

    function createPool(
        string calldata poolId,
        externalEuint32 encryptedK,
        externalEuint32 encryptedBalanceA,
        externalEuint32 encryptedBalanceB,
        bytes calldata kProof,
        bytes calldata balanceAProof,
        bytes calldata balanceBProof,
        uint256 publicBalanceA,
        uint256 publicBalanceB
    ) external {
        require(bytes(pools[poolId].creator).length == 0, "Pool already exists");

        // Validate encrypted inputs with proofs
        require(FHE.isInitialized(FHE.fromExternal(encryptedK, kProof)), "Invalid encrypted K");
        require(FHE.isInitialized(FHE.fromExternal(encryptedBalanceA, balanceAProof)), "Invalid encrypted balance A");
        require(FHE.isInitialized(FHE.fromExternal(encryptedBalanceB, balanceBProof)), "Invalid encrypted balance B");

        // Store pool data
        pools[poolId] = Pool({
            encryptedK: FHE.fromExternal(encryptedK, kProof),
            encryptedBalanceA: FHE.fromExternal(encryptedBalanceA, balanceAProof),
            encryptedBalanceB: FHE.fromExternal(encryptedBalanceB, balanceBProof),
            publicBalanceA: publicBalanceA,
            publicBalanceB: publicBalanceB,
            creator: msg.sender,
            creationTimestamp: block.timestamp,
            isVerified: false
        });

        // Allow contract operations on encrypted values
        FHE.allowThis(pools[poolId].encryptedK);
        FHE.allowThis(pools[poolId].encryptedBalanceA);
        FHE.allowThis(pools[poolId].encryptedBalanceB);

        // Enable public decryption
        FHE.makePubliclyDecryptable(pools[poolId].encryptedK);
        FHE.makePubliclyDecryptable(pools[poolId].encryptedBalanceA);
        FHE.makePubliclyDecryptable(pools[poolId].encryptedBalanceB);

        poolIds.push(poolId);
        emit PoolCreated(poolId, msg.sender);
    }

    function swap(
        string calldata poolId,
        externalEuint32 encryptedAmountIn,
        bytes calldata amountInProof,
        uint256 publicAmountIn
    ) external {
        require(bytes(pools[poolId].creator).length > 0, "Pool does not exist");
        require(FHE.isInitialized(FHE.fromExternal(encryptedAmountIn, amountInProof)), "Invalid encrypted amount");

        Pool storage pool = pools[poolId];

        // Homomorphic computation: newBalanceA = balanceA + amountIn
        euint32 encryptedNewBalanceA = FHE.add(pool.encryptedBalanceA, FHE.fromExternal(encryptedAmountIn, amountInProof));

        // Homomorphic computation: newBalanceB = balanceA * balanceB / (balanceA + amountIn)
        euint32 encryptedNewBalanceB = FHE.div(
            FHE.mul(pool.encryptedBalanceA, pool.encryptedBalanceB),
            encryptedNewBalanceA
        );

        // Update pool state
        pool.encryptedBalanceA = encryptedNewBalanceA;
        pool.encryptedBalanceB = encryptedNewBalanceB;
        pool.publicBalanceA += publicAmountIn;

        emit SwapExecuted(poolId, msg.sender);
    }

    function verifyPool(
        string calldata poolId,
        bytes memory kProof,
        bytes memory balanceAProof,
        bytes memory balanceBProof
    ) external {
        require(bytes(pools[poolId].creator).length > 0, "Pool does not exist");
        require(!pools[poolId].isVerified, "Pool already verified");

        Pool storage pool = pools[poolId];

        // Verify encrypted values match public values
        require(FHE.verifyDecryption(pool.encryptedK, abi.encode(pool.publicBalanceA * pool.publicBalanceB), kProof), 
                "K value verification failed");
        require(FHE.verifyDecryption(pool.encryptedBalanceA, abi.encode(pool.publicBalanceA), balanceAProof), 
                "Balance A verification failed");
        require(FHE.verifyDecryption(pool.encryptedBalanceB, abi.encode(pool.publicBalanceB), balanceBProof), 
                "Balance B verification failed");

        pool.isVerified = true;
        emit PoolVerified(poolId);
    }

    function getPoolDetails(string calldata poolId) external view returns (
        uint256 publicBalanceA,
        uint256 publicBalanceB,
        address creator,
        uint256 creationTimestamp,
        bool isVerified
    ) {
        require(bytes(pools[poolId].creator).length > 0, "Pool does not exist");
        Pool storage pool = pools[poolId];

        return (
            pool.publicBalanceA,
            pool.publicBalanceB,
            pool.creator,
            pool.creationTimestamp,
            pool.isVerified
        );
    }

    function getAllPoolIds() external view returns (string[] memory) {
        return poolIds;
    }

    function getEncryptedValues(string calldata poolId) external view returns (
        euint32 encryptedK,
        euint32 encryptedBalanceA,
        euint32 encryptedBalanceB
    ) {
        require(bytes(pools[poolId].creator).length > 0, "Pool does not exist");
        Pool storage pool = pools[poolId];

        return (
            pool.encryptedK,
            pool.encryptedBalanceA,
            pool.encryptedBalanceB
        );
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


