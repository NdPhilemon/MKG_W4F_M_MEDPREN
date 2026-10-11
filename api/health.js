import admin from "firebase-admin";
import { initFirebase } from "./firebase-init.js";

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  try{
    initFirebase();
    const db=admin.firestore();
    const snap=await db.collection("mmedpren").doc("global").get();
    return res.status(200).json({
      ok:true,
      provider:"firebase",
      firestore:true,
      exists:snap.exists,
      revision:snap.exists?Number(snap.data()?.revision||0):0
    });
  }catch(error){
    console.error("HEALTH_CHECK_ERROR",error);
    return res.status(500).json({
      ok:false,
      provider:"firebase",
      error:error?.message||"Erreur Firebase"
    });
  }
}
