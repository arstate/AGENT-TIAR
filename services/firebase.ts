import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Configuration provided by user
const firebaseConfig = {
  apiKey: "AIzaSyA51Owi_gOx2ALLvbXY6QgaIFpQ0UVVDO0",
  authDomain: "ai-agent-tiar.firebaseapp.com",
  databaseURL: "https://ai-agent-tiar-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ai-agent-tiar",
  storageBucket: "ai-agent-tiar.firebasestorage.app",
  messagingSenderId: "858916252507",
  appId: "1:858916252507:web:75f78903c1c7cc169f887e"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);