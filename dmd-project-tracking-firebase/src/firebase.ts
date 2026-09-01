import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: "AIzaSyAEA6MoMZP74LzKxeZxp7Gh_Bd_ajhsS5o",
  authDomain: "dmd--project-tracking.firebaseapp.com",
  projectId: "dmd--project-tracking",
  storageBucket: "dmd--project-tracking.firebasestorage.app",
  messagingSenderId: "774467315571",
  appId: "1:774467315571:web:4252c97db0092b19e14706"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
