// frontend/src/apiClient.js
import axios from "axios";

const apiClient = axios.create({
  baseURL: process.env.REACT_APP_CLOUD_DB_API,
  headers: {
    Authorization: `Bearer ${process.env.REACT_APP_CLOUD_DB_TOKEN}`,
  },
  allowAbsoluteUrls: false, // 🚨 Prevent SSRF
});

export default apiClient;

