import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// DMD Project Tracking2 - Clean Production Firebase
export const firebaseConfig = {
  apiKey: "AIzaSyDQ669HDsElGchr6mi13bjqliZkShrKSzQ",
  authDomain: "dmd-project-tracking2.firebaseapp.com",
  projectId: "dmd-project-tracking2",
  storageBucket: "dmd-project-tracking2.firebasestorage.app",
  messagingSenderId: "535399984682",
  appId: "1:535399984682:web:c17b41f84f6574c6655d53"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
