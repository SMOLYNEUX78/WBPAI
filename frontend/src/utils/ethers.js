import { ethers } from "ethers";
import DCC_ABI from "../contract/DCC_ABI.json";

const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS;

export const getEthereumContract = () => {
  if (!window.ethereum) {
    console.error("No Ethereum provider found.");
    return null;
  }

  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();
  return new ethers.Contract(CONTRACT_ADDRESS, DCC_ABI, signer);
};

export const connectWallet = async () => {
  if (!window.ethereum) {
    alert("Please install MetaMask.");
    return null;
  }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    return accounts[0];
  } catch (error) {
    console.error("Wallet connection error:", error);
    return null;
  }
};

