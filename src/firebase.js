import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBYFuS1E7b2-FkCZUkeYURFzhpsv7P9mj4",
  authDomain: "photo-tracker-b1e51.firebaseapp.com",
  projectId: "photo-tracker-b1e51",
  storageBucket: "photo-tracker-b1e51.firebasestorage.app",
  messagingSenderId: "234947479670",
  appId: "1:234947479670:web:fcb830436b373d44033757",
  measurementId: "G-NMLK5VGYW1",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
