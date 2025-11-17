import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface PoolData {
  id: string;
  name: string;
  encryptedK: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [pools, setPools] = useState<PoolData[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPool, setCreatingPool] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPoolData, setNewPoolData] = useState({ name: "", kValue: "", description: "" });
  const [selectedPool, setSelectedPool] = useState<PoolData | null>(null);
  const [decryptedK, setDecryptedK] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ visible: true, status: "error", message: "FHEVM init failed" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        const contract = await getContractReadOnly();
        if (!contract) return;
        setContractAddress(await contract.getAddress());
        const businessIds = await contract.getAllBusinessIds();
        const poolsList: PoolData[] = [];
        for (const id of businessIds) {
          const data = await contract.getBusinessData(id);
          poolsList.push({
            id,
            name: data.name,
            encryptedK: id,
            publicValue1: Number(data.publicValue1),
            publicValue2: Number(data.publicValue2),
            description: data.description,
            creator: data.creator,
            timestamp: Number(data.timestamp),
            isVerified: data.isVerified,
            decryptedValue: Number(data.decryptedValue)
          });
        }
        setPools(poolsList);
      } catch (e) {
        setTransactionStatus({ visible: true, status: "error", message: "Load failed" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [isConnected]);

  const createPool = async () => {
    if (!isConnected || !address) {
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return;
    }
    setCreatingPool(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating pool..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("No contract");
      const kValue = parseInt(newPoolData.kValue) || 1000;
      const poolId = `pool-${Date.now()}`;
      const encryptedResult = await encrypt(contractAddress, address, kValue);
      const tx = await contract.createBusinessData(
        poolId,
        newPoolData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newPoolData.description
      );
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting..." });
      await tx.wait();
      setTransactionStatus({ visible: true, status: "success", message: "Pool created!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      setShowCreateModal(false);
      setNewPoolData({ name: "", kValue: "", description: "" });
      window.location.reload();
    } catch (e: any) {
      const errorMsg = e.message?.includes("rejected") ? "Rejected" : "Failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMsg });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setCreatingPool(false);
    }
  };

  const decryptKValue = async (poolId: string) => {
    if (!isConnected || !address) {
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null;
    }
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      const poolData = await contractRead.getBusinessData(poolId);
      if (poolData.isVerified) {
        setDecryptedK(Number(poolData.decryptedValue));
        return Number(poolData.decryptedValue);
      }
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      const encryptedValue = await contractRead.getEncryptedValue(poolId);
      const result = await verifyDecryption(
        [encryptedValue],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(poolId, abiEncodedClearValues, decryptionProof)
      );
      const clearValue = result.decryptionResult.clearValues[encryptedValue];
      setDecryptedK(Number(clearValue));
      return Number(clearValue);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Decrypt failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null;
    } finally {
      setIsDecrypting(false);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("No contract");
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredPools = pools.filter(pool => 
    pool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    pool.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE AMM 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        <div className="connection-prompt">
          <div className="connection-content">
            <h2>Connect Wallet to Access FHE AMM</h2>
            <p>Private liquidity pools with fully homomorphic encryption</p>
            <div className="fhe-flow">
              <div className="flow-step">
                <div className="step-icon">🔒</div>
                <div className="step-content">Encrypt pool data</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">📊</div>
                <div className="step-content">Trade privately</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">🔓</div>
                <div className="step-content">Decrypt securely</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading FHE AMM...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE AMM 🔐</h1>
          <p>Private Automated Market Maker</p>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Pool
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <div className="main-content">
        <div className="dashboard-section">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search pools..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button onClick={checkAvailability} className="check-btn">
              Check Availability
            </button>
          </div>

          <div className="stats-panel">
            <div className="stat-card">
              <h3>Total Pools</h3>
              <div className="stat-value">{pools.length}</div>
            </div>
            <div className="stat-card">
              <h3>Verified</h3>
              <div className="stat-value">{pools.filter(p => p.isVerified).length}</div>
            </div>
            <div className="stat-card">
              <h3>Your Pools</h3>
              <div className="stat-value">{pools.filter(p => p.creator === address).length}</div>
            </div>
          </div>

          <div className="pools-list">
            {filteredPools.length === 0 ? (
              <div className="empty-state">
                <p>No pools found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Pool
                </button>
              </div>
            ) : (
              filteredPools.map((pool, index) => (
                <div
                  key={index}
                  className={`pool-card ${selectedPool?.id === pool.id ? "selected" : ""}`}
                  onClick={() => setSelectedPool(pool)}
                >
                  <div className="pool-header">
                    <h3>{pool.name}</h3>
                    <span className={`status ${pool.isVerified ? "verified" : "unverified"}`}>
                      {pool.isVerified ? "Verified" : "Unverified"}
                    </span>
                  </div>
                  <p className="pool-desc">{pool.description}</p>
                  <div className="pool-meta">
                    <span>Creator: {pool.creator.substring(0, 6)}...{pool.creator.substring(38)}</span>
                    <span>Created: {new Date(pool.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create New Pool</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Pool Name</label>
                <input
                  type="text"
                  value={newPoolData.name}
                  onChange={(e) => setNewPoolData({...newPoolData, name: e.target.value})}
                  placeholder="My Private Pool"
                />
              </div>
              <div className="form-group">
                <label>Initial K Value (FHE Encrypted)</label>
                <input
                  type="number"
                  value={newPoolData.kValue}
                  onChange={(e) => setNewPoolData({...newPoolData, kValue: e.target.value})}
                  placeholder="1000"
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newPoolData.description}
                  onChange={(e) => setNewPoolData({...newPoolData, description: e.target.value})}
                  placeholder="Describe your pool..."
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button
                onClick={createPool}
                disabled={creatingPool || isEncrypting || !newPoolData.name || !newPoolData.kValue}
                className="submit-btn"
              >
                {creatingPool || isEncrypting ? "Creating..." : "Create Pool"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedPool && (
        <div className="modal-overlay">
          <div className="pool-detail-modal">
            <div className="modal-header">
              <h2>{selectedPool.name}</h2>
              <button onClick={() => {
                setSelectedPool(null);
                setDecryptedK(null);
              }} className="close-btn">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="pool-info">
                <p>{selectedPool.description}</p>
                <div className="info-row">
                  <span>Creator:</span>
                  <span>{selectedPool.creator.substring(0, 6)}...{selectedPool.creator.substring(38)}</span>
                </div>
                <div className="info-row">
                  <span>Created:</span>
                  <span>{new Date(selectedPool.timestamp * 1000).toLocaleString()}</span>
                </div>
              </div>

              <div className="fhe-data-section">
                <h3>FHE Protected Data</h3>
                <div className="data-row">
                  <span>K Value:</span>
                  <span>
                    {selectedPool.isVerified ? selectedPool.decryptedValue : 
                     decryptedK !== null ? decryptedK : "🔒 Encrypted"}
                  </span>
                  <button
                    onClick={() => decryptKValue(selectedPool.id)}
                    disabled={isDecrypting || selectedPool.isVerified}
                    className={`decrypt-btn ${selectedPool.isVerified ? "verified" : ""}`}
                  >
                    {selectedPool.isVerified ? "Verified" : 
                     isDecrypting ? "Decrypting..." : "Decrypt"}
                  </button>
                </div>
              </div>

              <div className="swap-section">
                <h3>Swap Tokens</h3>
                <div className="swap-form">
                  <div className="input-group">
                    <input type="number" placeholder="0.0" />
                    <select>
                      <option>ETH</option>
                      <option>USDC</option>
                    </select>
                  </div>
                  <div className="swap-arrow">↓</div>
                  <div className="input-group">
                    <input type="number" placeholder="0.0" />
                    <select>
                      <option>USDC</option>
                      <option>ETH</option>
                    </select>
                  </div>
                  <button className="swap-btn">Swap</button>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => {
                setSelectedPool(null);
                setDecryptedK(null);
              }} className="close-btn">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <span>✓</span>}
            {transactionStatus.status === "error" && <span>✗</span>}
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;


