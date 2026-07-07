import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase Configuration
// IMPORTANT: Replace "YOUR_API_KEY" with your Web API Key from the Firebase Console 
// (Project Settings > General > Web API Key)
const firebaseConfig = {
  apiKey: "AQ.Ab8RN6J1coKidOLtr3DpH081OQ-mH7G8VizfBQy1fSywOYpvIw",
  authDomain: "nexus-e7a36.firebaseapp.com",
  projectId: "nexus-e7a36",
  storageBucket: "nexus-e7a36.appspot.com",
  messagingSenderId: "599145268754", // Derived from provided API Key/Project context
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
